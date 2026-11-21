import { get } from 'node:http';
import { PassThrough } from 'node:stream';

import { createGuardedProxyAgents } from './guarded-proxy-agents';

/**
 * Окно между отдачей сокета туннеля агенту и подпиской запроса на его 'error'.
 * Обрыв, прочитанный в том же цикле, что и ответ прокси, выстреливает через
 * nextTick. Прежде сокет отдавался агенту тоже через nextTick, а http-клиент
 * подписывается ещё одним nextTick позже — ошибка улетала в пустоту и роняла
 * процесс (uncaughtException). Туннель подменён: сокет-поток, который
 * обрывается сразу после отдачи, — ровно это упорядочивание, без гонки сети.
 *
 * Замер: на Node 24.11.0 http-клиент подписывается на 'error' в onSocketNT
 * (nextTick) — прежняя отдача роняла процесс; с 24.22 клиент подписывается
 * синхронно в onSocket, и окно закрыто им самим. Поэтому второй тест моделирует
 * потребителя, подписывающегося через nextTick, — независимо от версии Node.
 */
jest.mock('./connect-via-proxy', () => ({
  connectViaProxy: (
    _guard: unknown,
    _proxy: unknown,
    _host: string,
    _port: number,
    _timeout: number,
    callback: (error: Error | null, socket: PassThrough | null) => void,
  ) => {
    setImmediate(() => {
      const socket = new PassThrough();
      callback(null, socket);
      // Обрыв, уже прочитанный из сети: 'error' уйдёт через nextTick.
      socket.destroy(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    });
  },
}));

describe('createGuardedProxyAgents: отдача сокета туннеля', () => {
  it('обрыв сразу после отдачи — ошибка запроса, а не uncaughtException', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => {
      uncaught.push(error);
    };
    // Свой слушатель первым: без него jest принял бы падение за провал теста без итога.
    process.prependListener('uncaughtException', onUncaught);
    try {
      const agents = createGuardedProxyAgents({ proxy: 'http://127.0.0.1:3128', allowedPorts: 'any' });
      const result = await new Promise<string>((done) => {
        get('http://93.184.216.34/', { agent: agents.http }, (response) =>
          done(`ответ ${response.statusCode}`),
        ).on('error', (error: NodeJS.ErrnoException) => done(`ошибка запроса ${error.code}`));
      });
      await new Promise((done) => setImmediate(done));
      expect({ result, uncaught: uncaught.map((error) => (error as NodeJS.ErrnoException).code) }).toEqual({
        result: 'ошибка запроса ECONNRESET',
        uncaught: [],
      });
    } finally {
      process.removeListener('uncaughtException', onUncaught);
    }
  });

  it('потребитель, подписывающийся на error через nextTick (http-клиент Node до 24.22), обрыв получает', async () => {
    const agents = createGuardedProxyAgents({ proxy: 'http://127.0.0.1:3128', allowedPorts: 'any' });
    const outcome = await new Promise<string>((done) => {
      // Так подписывался ClientRequest до 24.22: onSocket → nextTick(onSocketNT) → socket.on('error').
      agents.http.createConnection({ host: '93.184.216.34', port: 80 } as never, (error, socket) => {
        if (error !== null) {
          done(`ошибка колбэка ${String(error)}`);
          return;
        }
        process.nextTick(() =>
          socket.on('error', (late: NodeJS.ErrnoException) => done(`ошибка сокета ${late.code}`)),
        );
      });
    }).catch((error: unknown) => `исключение ${String(error)}`);
    expect(outcome).toBe('ошибка сокета ECONNRESET');
  });
});
