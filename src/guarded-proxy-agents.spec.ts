import { createServer, get, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo, connect as netConnect, type Socket } from 'node:net';

import { buildConnector, Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { createGuardedConnect } from './guarded-connect';
import { createGuardedProxyAgents } from './guarded-proxy-agents';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/**
 * Режим за прокси против настоящего CONNECT-прокси на loopback. Прокси ведёт
 * ЛЮБОЙ туннель на тестовый сервер и записывает, какую цель у него попросили:
 * так видно, что защита проверила цель и отдала прокси проверенный литерал.
 */
describe('createGuardedProxyAgents и proxy у коннектора undici', () => {
  let target: Server;
  let targetPort = 0;
  let proxy: Server;
  let proxyPort = 0;
  let connects: Array<{ target: string; auth: string | undefined }> = [];
  let refuseTunnels = false;
  /**
   * Все сокеты фикстур: `server.close()` ждёт закрытия КАЖДОГО соединения, а
   * туннели CONNECT сервер не отслеживает (`closeAllConnections` их не видит).
   * Без явного уничтожения зависший туннель держал afterAll и процесс jest.
   */
  const sockets = new Set<Socket>();
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const TABLE: Record<string, string> = { 'public.example': '93.184.216.34', 'evil.example': '10.0.0.7' };
  const resolve: ResolveAllAddresses = (hostname, _options, callback) => {
    const address = TABLE[hostname];
    callback(
      address === undefined ? Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) : null,
      address === undefined ? [] : [{ address, family: 4 }],
    );
  };

  beforeAll(async () => {
    target = createServer((req, res) => res.end(`цель: ${req.headers.host}`));
    target.on('connection', track);
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    targetPort = (target.address() as AddressInfo).port;
    proxy = createServer((_req, res) => {
      res.statusCode = 405;
      res.end();
    });
    proxy.on('connection', track);
    proxy.on('connect', (req: IncomingMessage, client: Socket) => {
      connects.push({ target: req.url ?? '', auth: req.headers['proxy-authorization'] });
      if (refuseTunnels) {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = netConnect(targetPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        track(upstream);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((done) => proxy.close(() => done()));
    await new Promise<void>((done) => target.close(() => done()));
  });

  afterEach(() => {
    // Туннель, оставшийся от упавшего теста, не переживает его.
    for (const socket of sockets) {
      socket.destroy();
    }
  });

  beforeEach(() => {
    connects = [];
    refuseTunnels = false;
  });

  const proxyUrl = () => `http://user:p%40ss@127.0.0.1:${proxyPort}`;
  const request = (url: string, agent: unknown) =>
    new Promise<string>((done) => {
      get(url, { agent: agent as never }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => done(`${response.statusCode} ${body}`));
      }).on('error', (error: NodeJS.ErrnoException) =>
        done(
          error instanceof BlockedDestinationError
            ? `отказ ${error.stage} ${error.address}`
            : `ошибка ${error.code}`,
        ),
      );
    });

  it('контроль: прокси открывает туннель на ЛЮБУЮ цель, включая метаданные (фикстура не отказывает сама)', async () => {
    const socket = netConnect(proxyPort, '127.0.0.1');
    await new Promise<void>((done) => socket.once('connect', () => done()));
    socket.write('CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n');
    const head = await new Promise<string>((done) => socket.once('data', (chunk) => done(String(chunk))));
    socket.destroy();
    expect({ head: head.split('\r\n')[0], connects }).toEqual({
      head: 'HTTP/1.1 200 Connection Established',
      connects: [{ target: '169.254.169.254:80', auth: undefined }],
    });
  });

  it('имя проверяется защитой, прокси получает CONNECT на проверенный литерал (не имя), с учётными данными', async () => {
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    await expect(request('http://public.example/', agents.http)).resolves.toBe('200 цель: public.example');
    expect(connects).toEqual([
      { target: '93.184.216.34:80', auth: `Basic ${Buffer.from('user:p@ss').toString('base64')}` },
    ]);
  });

  it.each([
    ['http://169.254.169.254/', 'отказ host 169.254.169.254'],
    ['http://evil.example/', 'отказ address 10.0.0.7'],
    ['http://public.example:6379/', 'отказ port undefined'],
  ])('%s — отказ до прокси: CONNECT не уходит', async (url, expected) => {
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    await expect(request(url, agents.http)).resolves.toBe(expected);
    expect(connects).toEqual([]);
  });

  it('прокси отказал в туннеле — ERR_NET_GUARD_PROXY_TUNNEL_FAILED, а не тихий обход', async () => {
    refuseTunnels = true;
    const agents = createGuardedProxyAgents({ proxy: proxyUrl(), resolve });
    await expect(request('http://public.example/', agents.http)).resolves.toBe(
      `ошибка ${NET_GUARD_ERROR_CODE.proxyTunnelFailed}`,
    );
  });

  it('адрес прокси не http:// — исключение при создании', () => {
    expect(() => createGuardedProxyAgents({ proxy: 'socks5://127.0.0.1:1080' })).toThrow('HTTP-прокси');
    expect(() => createGuardedProxyAgents({ proxy: 'не адрес' })).toThrow('не разбирается');
  });

  it('undici: коннектор с proxy — та же проверка цели и CONNECT на литерал', async () => {
    const dispatcher = new UndiciAgent({
      connect: createGuardedConnect(buildConnector, { proxy: proxyUrl(), resolve }),
    });
    try {
      const ok = await undiciFetch('http://public.example/', { dispatcher });
      const blocked = await undiciFetch('http://evil.example/', { dispatcher }).catch((e: unknown) => e);
      expect({
        ok: await ok.text(),
        blocked: ((blocked as { cause?: unknown }).cause as BlockedDestinationError | undefined)?.address,
        connects: connects.map(({ target: t }) => t),
      }).toEqual({ ok: 'цель: public.example', blocked: '10.0.0.7', connects: ['93.184.216.34:80'] });
    } finally {
      await dispatcher.close();
    }
  });
});
