import dns = require('node:dns');

import { acquireSystemLookup } from './acquire-system-lookup';
import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { SYSTEM_LOOKUP } from './constants/system-lookup.constant';
import type { LookupCallback } from './guarded-lookup';
import { createGuardedLookup, guardedLookup } from './guarded-lookup';
import { netGuardState } from './net-guard-state';
import { netGuardStats } from './net-guard-stats';
import { nonPublicResolvedReason } from './non-public-resolved-reason';
import { systemLookupLimit } from './system-lookup-limit';
import { type FakeDnsServer, startFakeDnsServer } from './testing/fake-dns-server';

/** Ответ колбэка lookup целиком. */
const call = (
  lookup: (h: string, o: object, c: LookupCallback) => void,
  hostname: string,
  options: object = {},
) =>
  new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) => {
    lookup(hostname, options, (error, address) => done({ error, address }));
  });

describe('резолвер по умолчанию — c-ares (подставной DNS на 127.0.0.1)', () => {
  let server: FakeDnsServer;
  let saved: string[] = [];

  beforeAll(async () => {
    server = await startFakeDnsServer({
      'public.example': ['93.184.216.34', '2606:2800:220:1::1'],
      'v4only.example': ['93.184.216.35'],
      'rebind.example': ['93.184.216.34', '10.0.0.5'],
      'xn--e1afmkfd.example': ['93.184.216.36'],
      'hung.example': 'silent',
    });
    saved = dns.getServers();
    // Новый dns.Resolver этих серверов не видит — пакет обязан передать их сам.
    dns.setServers([server.address]);
  });

  afterAll(async () => {
    dns.setServers(saved);
    await server.close();
  });

  beforeEach(() => {
    server.questions.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('guardedLookup по умолчанию спрашивает DNS-сервер сам (A и AAAA), getaddrinfo не зовётся', async () => {
    const system = jest.spyOn(dns, 'lookup');

    const result = await call(guardedLookup, 'public.example', { all: true });

    expect(result).toEqual({
      error: null,
      address: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ],
    });
    expect(server.questions.map(({ type }) => type).sort()).toEqual(['A', 'AAAA']);
    expect(system).not.toHaveBeenCalled();
  });

  it('один непубличный адрес в ответе DNS — отказ; нет AAAA при наличии A — ответ A', async () => {
    const rebind = await call(guardedLookup, 'rebind.example', { all: true });
    expect((rebind.error as BlockedDestinationError).address).toBe('10.0.0.5');
    await expect(call(guardedLookup, 'v4only.example', {})).resolves.toEqual({
      error: null,
      address: '93.184.216.35',
    });
  });

  it('имени нет (NXDOMAIN) — ENOTFOUND, как у dns.lookup', async () => {
    expect((await call(guardedLookup, 'missing.example')).error?.code).toBe('ENOTFOUND');
  });

  it('family 4 — только вопрос A', async () => {
    await call(guardedLookup, 'public.example', { family: 4 });
    expect(server.questions).toEqual([{ name: 'public.example', type: 'A' }]);
  });

  it('в DNS уходит имя в ПРОВЕРЕННОМ виде: нижний регистр и punycode, а не сырая строка', async () => {
    const result = await call(guardedLookup, 'ПРИМЕР.Example', {});

    expect(result).toEqual({ error: null, address: '93.184.216.36' });
    expect(new Set(server.questions.map(({ name }) => name))).toEqual(new Set(['xn--e1afmkfd.example']));
  });

  it('таймаут ОТМЕНЯЕТ запрос c-ares (cancel), а не только отпускает вызывающего', async () => {
    const cancel = jest.spyOn(dns.Resolver.prototype, 'cancel');

    const { error } = await call(createGuardedLookup({ lookupTimeoutMs: 50 }), 'hung.example');

    expect({ code: error?.code, cancelled: cancel.mock.calls.length }).toEqual({
      code: 'ETIMEOUT',
      cancelled: 1,
    });
  });

  it('зависший поиск не задерживает соседний: ответ здорового имени приходит раньше таймаута зависшего', async () => {
    const order: string[] = [];
    const lookup = createGuardedLookup({ lookupTimeoutMs: 200 });
    const hung = call(lookup, 'hung.example').then(() => order.push('hung'));
    const healthy = call(lookup, 'public.example').then(() => order.push('healthy'));

    await Promise.all([hung, healthy]);

    expect(order).toEqual(['healthy', 'hung']);
  });

  it('литерал адреса в DNS не уходит', async () => {
    await expect(call(guardedLookup, '93.184.216.34', { all: true })).resolves.toEqual({
      error: null,
      address: [{ address: '93.184.216.34', family: 4 }],
    });
    expect(server.questions).toEqual([]);
  });

  it('nonPublicResolvedReason по умолчанию — тот же c-ares; таймаут отменяет запрос', async () => {
    const cancel = jest.spyOn(dns.Resolver.prototype, 'cancel');

    await expect(nonPublicResolvedReason('rebind.example')).resolves.toContain('10.0.0.5');
    await expect(
      nonPublicResolvedReason('hung.example', undefined, { lookupTimeoutMs: 50 }),
    ).resolves.toContain('не ответил за 50 мс');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('резолвер: настройки', () => {
  it('resolve и resolver вместе, неизвестный resolver — исключение при создании', () => {
    const resolve = (): undefined => undefined;
    expect(() => createGuardedLookup({ resolve, resolver: 'system' })).toThrow('и resolve, и resolver');
    expect(() => createGuardedLookup({ resolver: 'bind' as never })).toThrow('неизвестный resolver');
    expect(() =>
      nonPublicResolvedReason('a.example', undefined, { resolver: 'bind' as never }),
    ).rejects.toThrow('неизвестный resolver');
  });

  it('в свой резолвер тоже уходит нормализованное имя', async () => {
    const names: string[] = [];
    const lookup = createGuardedLookup({
      resolve: (hostname, _options, callback) => {
        names.push(hostname);
        callback(null, [{ address: '93.184.216.34', family: 4 }]);
      },
    });
    await call(lookup, 'Api.ПРИМЕР.Example.', {});
    expect(names).toEqual(['api.xn--e1afmkfd.example.']);
  });
});

describe('синхронное исключение резолвера', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ошибка уходит в колбэк ровно один раз, таймер снят', async () => {
    jest.useFakeTimers();
    const calls: Array<string | undefined> = [];
    const lookup = createGuardedLookup({
      lookupTimeoutMs: 1_000,
      resolve: () => {
        throw Object.assign(new Error('сломан'), { code: 'EBROKEN' });
      },
    });

    lookup('sync-throw.example', {}, (error) => calls.push(error?.code));
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    jest.runAllTicks();

    expect({ calls, timers: jest.getTimerCount() }).toEqual({ calls: ['EBROKEN'], timers: 0 });
  });

  it('nonPublicResolvedReason: синхронный бросок встроенного резолвера — отказ с причиной', async () => {
    jest.spyOn(dns.Resolver.prototype, 'resolve4').mockImplementation(() => {
      throw new Error('сломан');
    });
    await expect(nonPublicResolvedReason('a.example', undefined, {})).resolves.toContain('сломан');
    jest.restoreAllMocks();
  });
});

describe('системный резолвер (getaddrinfo): общий на процесс потолок', () => {
  const pending: Array<() => void> = [];

  beforeEach(() => {
    pending.length = 0;
    jest.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      _options: unknown,
      callback: (e: null, a: dns.LookupAddress[]) => void,
    ) => {
      // getaddrinfo, который висит: поток пула занят, пока его не «ответят».
      pending.push(() => callback(null, [{ address: '93.184.216.34', family: 4 }]));
    }) as never);
  });

  afterEach(() => {
    for (const answer of pending.splice(0)) {
      answer();
    }
    jest.restoreAllMocks();
  });

  it('сверх потолка — поиск ЖДЁТ слота не в пуле: ответ getaddrinfo передаёт слот ждущему (прежде — немедленный отказ)', async () => {
    const lookup = createGuardedLookup({ resolver: 'system', lookupTimeoutMs: 5_000 });
    expect(systemLookupLimit()).toBe(1);

    const first = call(lookup, 'first.example');
    const second = call(lookup, 'second.example');
    await new Promise((done) => setImmediate(done));
    const whileFirstHung = {
      inFlight: netGuardStats().systemLookups.inFlight,
      waiting: netGuardStats().systemLookups.waiting,
      calls: (dns.lookup as unknown as jest.Mock).mock.calls.map(([host]) => host),
    };
    pending.shift()?.();
    pending.shift()?.();

    expect({
      whileFirstHung,
      first: (await first).address,
      second: (await second).address,
      after: {
        inFlight: netGuardStats().systemLookups.inFlight,
        waiting: netGuardStats().systemLookups.waiting,
      },
    }).toEqual({
      whileFirstHung: { inFlight: 1, waiting: 1, calls: ['first.example'] },
      first: '93.184.216.34',
      second: '93.184.216.34',
      after: { inFlight: 0, waiting: 0 },
    });
  });

  it('таймаут ждущего снимает его из очереди: в пул он не попадает, слот от ответа возвращается в общий счёт', async () => {
    const lookup = createGuardedLookup({ resolver: 'system', lookupTimeoutMs: 30 });
    const hung = call(lookup, 'hung.example');
    const waiting = await call(lookup, 'waiting.example');
    const queuedAfterTimeout = netGuardStats().systemLookups.waiting;
    await hung;
    pending.shift()?.();
    expect({
      waiting: waiting.error?.code,
      queuedAfterTimeout,
      inFlight: netGuardStats().systemLookups.inFlight,
      calls: (dns.lookup as unknown as jest.Mock).mock.calls.map(([host]) => host),
    }).toEqual({ waiting: 'ETIMEOUT', queuedAfterTimeout: 0, inFlight: 0, calls: ['hung.example'] });
  });

  it('очередь ждущих полна — немедленный ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY, счётчик refused растёт', async () => {
    const state = netGuardState();
    const lookup = createGuardedLookup({ resolver: 'system', lookupTimeoutMs: 5_000 });
    const hung = call(lookup, 'hung.example');
    const fillers = Array.from({ length: SYSTEM_LOOKUP.maxWaiting }, () => () => undefined);
    state.systemWaiting?.push(...fillers);
    const before = netGuardStats().systemLookups.refused;
    try {
      const busy = await call(lookup, 'busy.example');
      expect({
        code: busy.error?.code,
        refused: netGuardStats().systemLookups.refused - before,
      }).toEqual({ code: NET_GUARD_ERROR_CODE.systemLookupBusy, refused: 1 });
    } finally {
      state.systemWaiting?.splice(0, state.systemWaiting.length);
      pending.shift()?.();
      await hung;
    }
  });

  it('nonPublicResolvedReason с resolver: system — та же очередь: ждёт и снимается своим таймаутом', async () => {
    const lookup = createGuardedLookup({ resolver: 'system', lookupTimeoutMs: 5_000 });
    const hung = call(lookup, 'hung.example');
    await expect(
      nonPublicResolvedReason('next.example', undefined, { resolver: 'system', lookupTimeoutMs: 30 }),
    ).resolves.toContain('не ответил');
    expect(netGuardStats().systemLookups.waiting).toBe(0);
    pending.shift()?.();
    await hung;
  });
});

describe('потолок системных поисков', () => {
  it.each([
    [undefined, 1],
    ['1', 1],
    ['2', 1],
    ['3', 1],
    ['4', 1],
    ['5', 2],
    ['8', 3],
    ['64', 31],
    ['5000', 511],
    ['0', 1],
    ['abc', 1],
  ])('UV_THREADPOOL_SIZE=%p → %p', (size, limit) => {
    expect(systemLookupLimit(size === undefined ? {} : { UV_THREADPOOL_SIZE: size })).toBe(limit);
  });

  it('освобождение слота идемпотентно: двойной вызов не отдаёт чужой слот', () => {
    const state = netGuardState();
    const before = state.systemInFlight;
    const release = acquireSystemLookup(before + 2);
    const other = acquireSystemLookup(before + 2);
    release?.();
    release?.();
    expect(state.systemInFlight).toBe(before + 1);
    other?.();
    expect(state.systemInFlight).toBe(before);
  });

  it('состояние общее для копий пакета в процессе (ключ в globalThis)', () => {
    let copy: typeof netGuardState | undefined;
    jest.isolateModules(() => {
      copy = (require('./net-guard-state') as { netGuardState: typeof netGuardState }).netGuardState;
    });
    expect(copy).not.toBe(netGuardState);
    expect(copy?.()).toBe(netGuardState());
  });
});

describe('BlockedDestinationError: шаг отказа', () => {
  it('по умолчанию — host', () => {
    expect(new BlockedDestinationError('a', 'b').stage).toBe('host');
  });
});
