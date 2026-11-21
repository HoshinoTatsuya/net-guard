import { createServer, get, type Server } from 'node:http';
import {
  type AddressInfo,
  createServer as createNetServer,
  type Server as NetServer,
  Socket,
} from 'node:net';

import { buildConnector } from 'undici';

import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { createGuardedConnect } from './guarded-connect';
import { createGuardedProxyAgents } from './guarded-proxy-agents';
import { openProxyTunnel } from './open-proxy-tunnel';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';
import type { UndiciConnector } from './types/undici-connector.type';

/**
 * Туннель CONNECT против прокси-фикстуры на loopback, которая ведёт себя по
 * заданному режиму. Цель — публичный литерал: прокси её не соединяет, ответ
 * за цель пишет сам (или ведёт туннель на сервер фикстуры).
 */
type ProxyMode = 'pipe' | 'extra' | 'refuse-v6' | 'close-silently';

describe('туннель через прокси: байты за заголовком, перебор адресов, вызов без колбэка', () => {
  let target: Server;
  let targetPort = 0;
  let proxy: NetServer;
  let proxyPort = 0;
  let mode: ProxyMode = 'pipe';
  let connects: string[] = [];
  const sockets = new Set<Socket>();
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  beforeAll(async () => {
    target = createServer((req, res) => res.end(`цель: ${req.headers.host}`));
    target.on('connection', track);
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    targetPort = (target.address() as AddressInfo).port;
    proxy = createNetServer((client) => {
      track(client);
      client.on('error', () => undefined);
      let head = '';
      const onData = (chunk: Buffer): void => {
        head += chunk.toString('latin1');
        if (!head.includes('\r\n\r\n')) {
          return;
        }
        client.removeListener('data', onData);
        const requested = /^CONNECT (\S+)/.exec(head)?.[1] ?? '';
        connects.push(requested);
        if (mode === 'extra') {
          // Ответ туннеля и первые байты цели ОДНОЙ записью: цель, говорящая первой.
          client.write('HTTP/1.1 200 Connection Established\r\n\r\nHELLO-FROM-TARGET\n');
        } else if (mode === 'close-silently') {
          client.end();
        } else if (mode === 'refuse-v6' && requested.startsWith('[')) {
          client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } else {
          const upstream = new Socket();
          track(upstream);
          upstream.on('error', () => client.destroy());
          upstream.connect(targetPort, '127.0.0.1', () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.pipe(client);
            client.pipe(upstream);
          });
        }
      };
      client.on('data', onData);
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
  });

  afterAll(async () => {
    await new Promise<void>((done) => proxy.close(() => done()));
    await new Promise<void>((done) => target.close(() => done()));
  });

  beforeEach(() => {
    connects = [];
    mode = 'pipe';
  });

  const proxyUrl = () => `http://127.0.0.1:${proxyPort}`;
  const TABLE: Record<string, Array<{ address: string; family: number }>> = {
    'public.example': [{ address: '93.184.216.34', family: 4 }],
    'dual.example': [
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ],
  };
  const resolve: ResolveAllAddresses = (hostname, _options, callback) => {
    const addresses = TABLE[hostname];
    callback(
      addresses === undefined ? Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) : null,
      addresses ?? [],
    );
  };
  const request = (url: string, agent: unknown) =>
    new Promise<string>((done) => {
      get(url, { agent: agent as never }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => done(`${response.statusCode} ${body}`));
      }).on('error', (error: NodeJS.ErrnoException) => done(`ошибка ${error.code}`));
    });

  /**
   * Предохранитель: прежняя реализация на байтах за заголовком возвращала их
   * `unshift` прямо в свой обработчик 'data' — бесконечный синхронный цикл.
   * Без предохранителя такой тест не упал бы, а повесил процесс jest целиком
   * (таймаут теста не срабатывает, цикл событий занят).
   */
  const guardAgainstReentry = (): (() => number) => {
    const original = Socket.prototype.unshift;
    let calls = 0;
    jest.spyOn(Socket.prototype, 'unshift').mockImplementation(function (this: Socket, ...args) {
      calls++;
      if (calls > 5) {
        throw new Error('unshift повторно вошёл в обработчик туннеля: бесконечный цикл');
      }
      return original.apply(this, args as Parameters<typeof original>);
    });
    return () => calls;
  };

  it('байты цели в одном пакете с ответом CONNECT доходят до вызывающего, подписавшегося НЕ сразу; без зацикливания', async () => {
    mode = 'extra';
    const unshiftCalls = guardAgainstReentry();
    const outcome = await new Promise<{ received: string; error: string | null }>((done) => {
      openProxyTunnel(new URL(proxyUrl()), '93.184.216.34', 80, 2_000, (error, socket) => {
        if (error !== null || socket === null) {
          done({ received: '', error: String(error) });
          return;
        }
        // Как библиотека, вешающая парсер на следующем шаге цикла событий.
        setImmediate(() => {
          let received = '';
          socket.on('data', (chunk: Buffer) => {
            received += chunk.toString('latin1');
            if (received.includes('\n')) {
              socket.destroy();
              done({ received, error: null });
            }
          });
        });
      });
    });
    expect({ ...outcome, unshiftCalls: unshiftCalls() }).toEqual({
      received: 'HELLO-FROM-TARGET\n',
      error: null,
      unshiftCalls: 1,
    });
  });

  it('то же через коннектор undici (подписка синхронно в колбэке)', async () => {
    mode = 'extra';
    guardAgainstReentry();
    const connector = createGuardedConnect(buildConnector, {
      proxy: proxyUrl(),
      resolve,
    }) as unknown as UndiciConnector;
    const received = await new Promise<string>((done) => {
      connector(
        { hostname: 'public.example', host: 'public.example', protocol: 'http:', port: '' } as never,
        (error, connected) => {
          const socket = connected as Socket | null | undefined;
          if (error !== null || socket === null || socket === undefined) {
            done(`ошибка ${String(error)}`);
            return;
          }
          let data = '';
          socket.on('data', (chunk: Buffer) => {
            data += chunk.toString('latin1');
            if (data.includes('\n')) {
              socket.destroy();
              done(data);
            }
          });
        },
      );
    });
    expect({ received, connects }).toEqual({
      received: 'HELLO-FROM-TARGET\n',
      connects: ['93.184.216.34:80'],
    });
  });

  it('прокси отказал в туннеле к первому адресу (IPv6) — следующий адрес той же выборки, запрос проходит', async () => {
    mode = 'refuse-v6';
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    // Прокси на refuse-v6 для IPv4 ведёт туннель на сервер фикстуры.
    const result = await request('http://dual.example/', agents.http);
    expect({ result, connects }).toEqual({
      result: '200 цель: dual.example',
      connects: ['[2606:2800:220:1:248:1893:25c8:1946]:80', '93.184.216.34:80'],
    });
  });

  it('прокси закрыл соединение без ответа — отказ сразу, без перебора адресов (дело не в цели)', async () => {
    mode = 'close-silently';
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    const result = await request('http://dual.example/', agents.http);
    expect({ result, connects }).toEqual({
      result: `ошибка ${NET_GUARD_ERROR_CODE.proxyTunnelFailed}`,
      connects: ['[2606:2800:220:1:248:1893:25c8:1946]:80'],
    });
  });

  it('createConnection без колбэка — TypeError, и туннель НЕ открывается (прежде — undefined и ничей туннель)', async () => {
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    const thrown = (() => {
      try {
        return agents.http.createConnection({ host: 'public.example', port: 80 } as never);
      } catch (error) {
        return error;
      }
    })();
    // Туннель, если бы открылся, успел бы дойти до прокси за этот круг.
    await new Promise((done) => setTimeout(done, 100));
    expect({ thrown: thrown instanceof TypeError, connects }).toEqual({ thrown: true, connects: [] });
  });
});
