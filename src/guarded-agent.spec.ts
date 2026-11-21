import type { LookupAddress, LookupOptions } from 'node:dns';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { Agent, createServer, get, type IncomingMessage, type RequestOptions, type Server } from 'node:http';
import { Agent as HttpsAgent, get as httpsGet } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { createGuardedHttpAgent, createGuardedHttpsAgent } from './guarded-agent';
import type { LookupCallback, ResolveAllAddresses } from './guarded-lookup';
import { guardedLookup } from './guarded-lookup';

/** Резолвер без сети: имя → адреса; неизвестное имя — ENOTFOUND. Записывает имена. */
const fakeResolver = (table: Record<string, LookupAddress[]>) => {
  const names: string[] = [];
  const resolve: ResolveAllAddresses = (hostname, _options, callback) => {
    names.push(hostname);
    setImmediate(() => {
      const addresses = table[hostname];
      if (addresses === undefined) {
        callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
        return;
      }
      callback(null, addresses);
    });
  };
  return { resolve, names };
};

const TABLE: Record<string, LookupAddress[]> = {
  'loopback.example': [{ address: '127.0.0.1', family: 4 }],
};

/** lookup без защиты — тот, что потребитель мог бы передать в настройках запроса. */
const unguardedLookup = (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
  const address = TABLE[hostname]?.[0];
  if (address === undefined) {
    callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  } else if (options.all) {
    callback(null, [address]);
  } else {
    callback(null, address.address, address.family);
  }
};

/** Ошибка запроса одной строкой: код и, для отказа защиты, адрес отказа. */
const describeError = (error: NodeJS.ErrnoException): string =>
  error instanceof BlockedDestinationError ? `error ${error.code} ${error.address}` : `error ${error.code}`;

/** Итог запроса одной строкой: `status 200` или ошибка. */
const httpRequest = (target: string | RequestOptions, options: RequestOptions) =>
  new Promise<string>((done) => {
    const onResponse = (response: IncomingMessage): void => {
      response.resume();
      response.on('end', () => done(`status ${response.statusCode}`));
    };
    const request =
      typeof target === 'string'
        ? get(target, options, onResponse)
        : get({ ...target, ...options }, onResponse);
    request.on('error', (error: NodeJS.ErrnoException) => done(describeError(error)));
  });

describe('createGuardedHttpAgent: настоящий сервер на 127.0.0.1', () => {
  let server: Server;
  let port = 0;
  let connections = 0;

  beforeAll(async () => {
    server = createServer((_, response) => response.end('ok'));
    server.on('connection', () => {
      connections++;
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(() => {
    connections = 0;
  });

  it('контроль: Agent с одним guardedLookup литерал 127.0.0.1 ПРОПУСКАЕТ — net не зовёт lookup', async () => {
    // Ради этого случая и существует агент: без контроля «0 соединений» ниже
    // не отличалось бы от «фикстура не соединяется вовсе».
    await expect(
      httpRequest(`http://127.0.0.1:${port}/`, { agent: new Agent({ lookup: guardedLookup }) }),
    ).resolves.toBe('status 200');
    expect(connections).toBe(1);
  });

  it.each([
    ['127.0.0.1', '127.0.0.1'],
    // WHATWG URL записывает mapped-адрес шестнадцатерично.
    ['[::ffff:127.0.0.1]', '::ffff:7f00:1'],
    ['[::1]', '::1'],
  ])('литерал %s — отказ до соединения, у сервера ноль подключений', async (host, address) => {
    const result = await httpRequest(`http://${host}:${port}/`, { agent: createGuardedHttpAgent() });

    expect(result).toBe(`error ${NET_GUARD_ERROR_CODE.blockedDestination} ${address}`);
    expect(connections).toBe(0);
  });

  it('имя, разрешающееся в 127.0.0.1, — отказ через защищённый lookup', async () => {
    const { resolve } = fakeResolver(TABLE);

    await expect(
      httpRequest(`http://loopback.example:${port}/`, {
        agent: createGuardedHttpAgent({ resolve, allowedPorts: 'any' }),
      }),
    ).resolves.toBe(`error ${NET_GUARD_ERROR_CODE.blockedDestination} 127.0.0.1`);
    expect(connections).toBe(0);
  });

  it('lookup в настройках запроса защиту не подменяет; контроль — без агента тот же lookup доходит до сервера', async () => {
    const { resolve } = fakeResolver(TABLE);
    const url = `http://loopback.example:${port}/`;

    await expect(
      httpRequest(url, {
        agent: createGuardedHttpAgent({ resolve, allowedPorts: 'any' }),
        lookup: unguardedLookup,
      }),
    ).resolves.toBe(`error ${NET_GUARD_ERROR_CODE.blockedDestination} 127.0.0.1`);
    expect(connections).toBe(0);
    await expect(httpRequest(url, { agent: new Agent(), lookup: unguardedLookup })).resolves.toBe(
      'status 200',
    );
    expect(connections).toBe(1);
  });

  it('имя идёт в резолвер политики, а не отвергается проверкой литерала: ошибка резолвера — как есть', async () => {
    const { resolve, names } = fakeResolver(TABLE);

    await expect(
      httpRequest(`http://missing.example:${port}/`, {
        agent: createGuardedHttpAgent({ resolve, allowedPorts: 'any' }),
      }),
    ).resolves.toBe('error ENOTFOUND');
    expect({ names, connections }).toEqual({ names: ['missing.example'], connections: 0 });
  });

  it('createGuardedHttpsAgent: литерал — отказ до TCP; контроль — обычный https.Agent соединяется', async () => {
    const httpsRequest = (agent: HttpsAgent) =>
      new Promise<string>((done) => {
        httpsGet(`https://127.0.0.1:${port}/`, { agent }, (response) => {
          response.resume();
          done(`status ${response.statusCode}`);
        }).on('error', (error: NodeJS.ErrnoException) => done(describeError(error)));
      });

    await expect(httpsRequest(createGuardedHttpsAgent())).resolves.toBe(
      `error ${NET_GUARD_ERROR_CODE.blockedDestination} 127.0.0.1`,
    );
    expect(connections).toBe(0);
    // Сервер — HTTP, рукопожатие TLS не сложится, но TCP-соединение будет.
    await httpsRequest(new HttpsAgent());
    expect(connections).toBe(1);
  });

  it('публичная цель с путём запроса доходит до сервера: path запроса — не unix-сокет (внешний аудит, утверждение 1)', async () => {
    // Защита выносит вердикт до базового createConnection; одобренное соединение
    // уводится на сервер фикстуры (наружу сети нет). Записывается, с чем агент
    // пришёл в базовый createConnection.
    const base = Agent.prototype.createConnection;
    const asked: Array<{ host: unknown; path: unknown }> = [];
    jest.spyOn(Agent.prototype, 'createConnection').mockImplementation(function (
      this: Agent,
      options,
      callback,
    ) {
      asked.push({ host: options.host, path: options.path });
      return base.call(this, { ...options, host: '127.0.0.1', port, lookup: undefined }, callback);
    });
    const result = await httpRequest('http://93.184.216.34/api/v1?x=1', { agent: createGuardedHttpAgent() });
    expect({ result, asked, connections }).toEqual({
      result: 'status 200',
      asked: [{ host: '93.184.216.34', path: null }],
      connections: 1,
    });
  });

  it('настройки агента доходят до Agent, а политика и чужой lookup — нет', () => {
    const agent = createGuardedHttpAgent({ maxSockets: 3, extraBlockedSubnets: ['93.184.216.0/24'] });
    const { options } = agent as unknown as { options: Record<string, unknown> };

    expect({
      maxSockets: agent.maxSockets,
      extra: 'extraBlockedSubnets' in options,
      lookupGuarded: typeof options.lookup === 'function' && options.lookup !== guardedLookup,
    }).toEqual({ maxSockets: 3, extra: false, lookupGuarded: true });
  });

  it('опечатка в политике — исключение при создании агента', () => {
    expect(() => createGuardedHttpAgent({ extraBlockedSubnets: ['10.0.0.0/8/extra'] })).toThrow(
      'Некорректная подсеть',
    );
  });
});

describe('createGuardedHttpAgent: socketPath (unix-сокет) — отказ', () => {
  let server: Server;
  let directory = '';
  let socketPath = '';
  let connections = 0;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'net-guard-'));
    socketPath = join(directory, 's.sock');
    server = createServer((_, response) => response.end('ok'));
    server.on('connection', () => {
      connections++;
    });
    await new Promise<void>((done) => server.listen(socketPath, done));
  });

  afterAll(async () => {
    // Сервер удаляет файл сокета при закрытии; каталог снимается без рекурсии.
    await new Promise<void>((done) => server.close(() => done()));
    rmdirSync(directory);
  });

  it('запрос через socketPath — отказ, ноль подключений; контроль — обычный Agent доходит', async () => {
    await expect(httpRequest({ socketPath, path: '/' }, { agent: createGuardedHttpAgent() })).resolves.toBe(
      `error ${NET_GUARD_ERROR_CODE.blockedDestination} undefined`,
    );
    expect(connections).toBe(0);
    await expect(httpRequest({ socketPath, path: '/' }, { agent: new Agent() })).resolves.toBe('status 200');
    expect(connections).toBe(1);
  });
});
