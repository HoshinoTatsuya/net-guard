import type { LookupAddress, LookupAllOptions, LookupOptions } from 'node:dns';
import { Agent, createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import type { LookupCallback, ResolveAllAddresses } from './guarded-lookup';
import { createGuardedLookup, guardedLookup } from './guarded-lookup';

/**
 * Резолвер-фикстура: имя → адреса, без сети. Записывает, с какими настройками
 * его звали, — проверка проброса `family`/`hints`.
 */
const fakeResolver = (table: Record<string, LookupAddress[]>) => {
  const calls: Array<{ hostname: string; options: LookupAllOptions }> = [];
  const resolve: ResolveAllAddresses = (hostname, options, callback) => {
    calls.push({ hostname, options });
    setImmediate(() => {
      const addresses = table[hostname];
      if (addresses === undefined) {
        callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
        return;
      }
      callback(null, addresses);
    });
  };
  return { resolve, calls };
};

const TABLE: Record<string, LookupAddress[]> = {
  'loopback.example': [{ address: '127.0.0.1', family: 4 }],
  'public.example': [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ],
  'rebind.example': [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ],
  'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }],
  'empty.example': [],
};

/** Ответ колбэка lookup целиком: ошибка, адрес(а), семейство. */
const call = (
  lookup: (hostname: string, options: object | number, callback: LookupCallback) => void,
  hostname: string,
  options: object | number,
) =>
  new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family: unknown }>((done) => {
    lookup(hostname, options, (error, address, family) => done({ error, address, family }));
  });

describe('guardedLookup: форма dns.lookup', () => {
  it('all: true — все адреса массивом, если все публичные', async () => {
    const { resolve } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    await expect(call(lookup, 'public.example', { all: true })).resolves.toEqual({
      error: null,
      address: TABLE['public.example'],
      family: undefined,
    });
  });

  it('без all — первый адрес и его семейство, как у dns.lookup', async () => {
    const { resolve } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    await expect(call(lookup, 'public.example', {})).resolves.toEqual({
      error: null,
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('family (числом и в объекте) и hints уходят в резолвер, all — всегда true', async () => {
    const { resolve, calls } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    await call(lookup, 'public.example', 6);
    await call(lookup, 'public.example', { family: 4, hints: 32 });

    expect(calls.map(({ options }) => options)).toEqual([
      { family: 6, all: true },
      { family: 4, hints: 32, all: true },
    ]);
  });

  it('форма (hostname, callback) без настроек', async () => {
    const { resolve } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    const result = await new Promise<unknown[]>((done) => {
      lookup('public.example', (...args) => done(args));
    });

    expect(result).toEqual([null, '93.184.216.34', 4]);
  });

  it('хотя бы ОДИН непубличный адрес — отказ всего ответа (а не «первый публичный»)', async () => {
    const { resolve } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    for (const all of [true, false]) {
      const { error } = await call(lookup, 'rebind.example', { all });
      expect(error).toBeInstanceOf(BlockedDestinationError);
      expect({ code: error?.code, address: (error as BlockedDestinationError).address }).toEqual({
        code: NET_GUARD_ERROR_CODE.blockedDestination,
        address: '10.0.0.5',
      });
    }
  });

  it('встроенный IPv4 в ответе DNS — решение по нему', async () => {
    const { resolve } = fakeResolver(TABLE);

    const { error } = await call(createGuardedLookup({ resolve }), 'mapped.example', { all: true });

    expect(error?.code).toBe(NET_GUARD_ERROR_CODE.blockedDestination);
  });

  it('пустой ответ резолвера — отказ; ошибка резолвера — отдаётся как есть', async () => {
    const { resolve } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });

    expect((await call(lookup, 'empty.example', {})).error?.code).toBe(
      NET_GUARD_ERROR_CODE.blockedDestination,
    );
    expect((await call(lookup, 'missing.example', {})).error?.code).toBe('ENOTFOUND');
  });

  it('форма имени проверяется ДО DNS и асинхронно: резолвер не вызывается', async () => {
    const { resolve, calls } = fakeResolver(TABLE);
    const lookup = createGuardedLookup({ resolve });
    let answered = false;

    const pending = new Promise<NodeJS.ErrnoException | null>((done) => {
      lookup('metadata.google.internal', {}, (error) => {
        answered = true;
        done(error);
      });
    });
    const answeredSynchronously = answered;
    const error = await pending;

    expect({ answeredSynchronously, calls, code: error?.code }).toEqual({
      answeredSynchronously: false,
      calls: [],
      code: NET_GUARD_ERROR_CODE.blockedDestination,
    });
  });

  it('`[адрес]:порт` в lookup — отказ по форме, резолвер не вызывается (прежде порт снимался)', async () => {
    const { resolve, calls } = fakeResolver(TABLE);

    const { error } = await call(createGuardedLookup({ resolve }), '[2606:4700::1111]:443', {});

    expect({ code: error?.code, calls }).toEqual({
      code: NET_GUARD_ERROR_CODE.blockedDestination,
      calls: [],
    });
    expect((error as BlockedDestinationError).reason).toContain('указан порт 443');
  });

  it('дополнительные подсети применяются к ответу DNS; контроль — без них тот же ответ проходит', async () => {
    const { resolve } = fakeResolver(TABLE);
    const strict = createGuardedLookup({ resolve, extraBlockedSubnets: ['93.184.216.0/24'] });
    const plain = createGuardedLookup({ resolve });

    expect((await call(strict, 'public.example', { all: true })).error?.code).toBe(
      NET_GUARD_ERROR_CODE.blockedDestination,
    );
    expect((await call(plain, 'public.example', { all: true })).error).toBeNull();
  });

  it('опечатка в настройках — исключение при создании, а не молча открытый диапазон', () => {
    expect(() => createGuardedLookup({ extraBlockedSubnets: ['10.0.0.0'] })).toThrow('Некорректная подсеть');
  });

  it('по умолчанию — dns.lookup: литерал публичного адреса проходит через него, loopback-литерал — отказ (без сети)', async () => {
    await expect(call(guardedLookup, '8.8.8.8', { all: true })).resolves.toEqual({
      error: null,
      address: [{ address: '8.8.8.8', family: 4 }],
      family: undefined,
    });
    expect((await call(guardedLookup, '127.0.0.1', { all: true })).error?.code).toBe(
      NET_GUARD_ERROR_CODE.blockedDestination,
    );
  });
});

describe('guardedLookup в http.Agent: соединение не устанавливается (настоящий loopback)', () => {
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

  const request = (hostname: string, agent: Agent) =>
    new Promise<string>((done) => {
      get(`http://${hostname}:${port}/`, { agent }, (response) => {
        response.resume();
        response.on('end', () => done(`status ${response.statusCode}`));
      }).on('error', (error: NodeJS.ErrnoException) => done(`error ${error.code}`));
    });

  it('контроль: тот же резолвер без защиты доводит запрос до сервера', async () => {
    // Без этого контроля отказ ниже мог бы означать «фикстура не соединяется вовсе».
    const { resolve } = fakeResolver(TABLE);
    const unguarded = (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
      resolve(hostname, { ...options, all: true }, (error, addresses) => {
        const [first] = addresses;
        if (error || first === undefined) {
          callback(error, []);
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      });
    };

    await expect(request('loopback.example', new Agent({ lookup: unguarded }))).resolves.toBe('status 200');
    expect(connections).toBe(1);
  });

  it('имя, разрешающееся в 127.0.0.1, — отказ до соединения', async () => {
    const { resolve } = fakeResolver(TABLE);

    await expect(
      request('loopback.example', new Agent({ lookup: createGuardedLookup({ resolve }) })),
    ).resolves.toBe(`error ${NET_GUARD_ERROR_CODE.blockedDestination}`);
    expect(connections).toBe(0);
  });

  it('системный резолвер: localhost — отказ по форме имени, соединения нет', async () => {
    await expect(request('localhost', new Agent({ lookup: guardedLookup }))).resolves.toBe(
      `error ${NET_GUARD_ERROR_CODE.blockedDestination}`,
    );
    expect(connections).toBe(0);
  });
});
