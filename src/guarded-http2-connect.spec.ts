import { createServer, type Http2Server, connect as http2Connect } from 'node:http2';
import type { AddressInfo, Socket } from 'node:net';

import { BlockedDestinationError } from './blocked-destination.error';
import { createGuardedHttp2Connect } from './guarded-http2-connect';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/** http2 идёт мимо агентов http(s): защита сессии — против настоящего h2c-сервера на loopback. */
describe('createGuardedHttp2Connect', () => {
  let server: Http2Server;
  let port = 0;
  let sessions = 0;
  /** Соединения сервера: close() http2 ждёт каждое — оставшееся от упавшего теста держало бы jest. */
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    server = createServer();
    // TCP-соединения, а не сессии: «соединения нет» — сильнее, чем «сессии нет».
    server.on('connection', (socket: Socket) => {
      sessions++;
      sockets.add(socket);
    });
    server.on('stream', (stream) => {
      stream.respond({ ':status': 200 });
      stream.end('ok');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(() => {
    sessions = 0;
  });

  /** Ошибка сессии (или «соединено», если сессия поднялась). */
  const outcome = (session: ReturnType<typeof http2Connect>) =>
    new Promise<Error | 'соединено'>((done) => {
      session.once('error', (error) => done(error));
      session.once('connect', () => {
        session.close();
        done('соединено');
      });
    });

  it('контроль: обычный http2.connect к 127.0.0.1 соединяется (фикстура рабочая)', async () => {
    const session = http2Connect(`http://127.0.0.1:${port}`);
    // Полный ответ на запрос: сервер точно увидел соединение до проверки счётчика.
    const status = await new Promise<unknown>((done) => {
      const stream = session.request({ ':path': '/' });
      stream.on('response', (headers) => done(headers[':status']));
      stream.resume();
    });
    session.close();
    expect({ status, sessions }).toEqual({ status: 200, sessions: 1 });
  });

  /** Исключение вызова connect (отказ по форме хоста, литералу, порту). */
  const thrown = (run: () => unknown): unknown => {
    try {
      run();
      return 'без исключения';
    } catch (error) {
      return error;
    }
  };

  it.each(['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]'])(
    'литерал %s — отказ исключением, соединения нет',
    async (host) => {
      const connect = createGuardedHttp2Connect({ allowedPorts: 'any' });
      const error = thrown(() => connect(`http://${host}:${port}`));
      await new Promise((done) => setImmediate(done));
      expect({ blocked: error instanceof BlockedDestinationError, sessions }).toEqual({
        blocked: true,
        sessions: 0,
      });
    },
  );

  it('порт вне разрешённых — отказ (по умолчанию 80/443)', () => {
    const error = thrown(() => createGuardedHttp2Connect()(`https://api.example.com:${port}`));
    expect((error as BlockedDestinationError).stage).toBe('port');
  });

  it('имя → защищённый lookup: во внутренний адрес — отказ; не найдено — ошибка резолвера (защита пропустила)', async () => {
    const table: Record<string, string> = { 'evil.example': '127.0.0.1' };
    const resolve: ResolveAllAddresses = (hostname, _options, callback) => {
      const address = table[hostname];
      if (address === undefined) {
        callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
      } else {
        callback(null, [{ address, family: 4 }]);
      }
    };
    const connect = createGuardedHttp2Connect({ resolve, allowedPorts: 'any' });
    const evil = await outcome(connect(`http://evil.example:${port}`));
    const missing = await outcome(connect(`http://missing.example:${port}`));
    expect({
      evil: (evil as BlockedDestinationError).address,
      missing: (missing as NodeJS.ErrnoException).code,
      sessions,
    }).toEqual({ evil: '127.0.0.1', missing: 'ENOTFOUND', sessions: 0 });
  });
});
