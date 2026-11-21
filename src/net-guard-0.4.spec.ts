import { createServer, Agent as HttpAgent } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildConnector, fetch, Agent as UndiciAgent } from 'undici';

import { BlockedDestinationError } from './blocked-destination.error';
import { BLOCKED_IPV4_SUBNETS } from './constants/blocked-ipv4-subnets.constant';
import { BLOCKED_IPV6_SUBNETS } from './constants/blocked-ipv6-subnets.constant';
import { BLOCKED_NAME_SUFFIXES } from './constants/blocked-name-suffixes.constant';
import { createGuardedAgents, createGuardedHttpAgent } from './guarded-agent';
import { createGuardedConnect, type UndiciConnectOptions, type UndiciConnector } from './guarded-connect';
import { createGuardedLookup } from './guarded-lookup';
import { isBlockedIp } from './is-blocked-ip';
import { nonPublicHostReason } from './non-public-host-reason';
import { nonPublicResolvedReason } from './non-public-resolved-reason';

/** 0.4.0: глобальный unicast, NSP NAT64, таймауты DNS, заморозка, агенты-пара, коннектор undici. */
describe('IPv6 вне глобального unicast 2000::/3 — не публичный', () => {
  it.each([
    ['4000::1', true],
    ['e000::1', true],
    ['1::1', true],
    ['2a00:1450:4001::1', false],
    ['3ffe:ffff::1', false],
  ])('%s → запрещён: %s', (address, blocked) => {
    expect(isBlockedIp(address)).toBe(blocked);
  });

  it('встроенный IPv4 по-прежнему решает: mapped и хорошо известный NAT64 публичного адреса — публичны', () => {
    expect(isBlockedIp('::ffff:93.184.216.34')).toBe(false);
    expect(isBlockedIp('64:ff9b::5db8:d822')).toBe(false);
    expect(isBlockedIp('64:ff9b::a9fe:a9fe')).toBe(true);
  });
});

describe('extraNat64Prefixes — NSP сети судится по встроенному IPv4', () => {
  const NSP = '2a01:5:64::/96';
  it('метаданные через NSP: без настройки проходили, с ней — отказ; публичный — пропуск', () => {
    expect(isBlockedIp('2a01:5:64::a9fe:a9fe')).toBe(false);
    expect(isBlockedIp('2a01:5:64::a9fe:a9fe', { extraNat64Prefixes: [NSP] })).toBe(true);
    expect(isBlockedIp('2a01:5:64::5db8:d822', { extraNat64Prefixes: [NSP] })).toBe(false);
  });

  it('только сужает: NSP внутри запрещённого диапазона остаётся запрещённым', () => {
    expect(isBlockedIp('fd00:64::5db8:d822', { extraNat64Prefixes: ['fd00:64::/96'] })).toBe(true);
  });

  it('длина не /96 — исключение при разборе настроек', () => {
    expect(() => isBlockedIp('2a01:5:64::1', { extraNat64Prefixes: ['2a01:5:64::/64'] })).toThrow('/96');
  });
});

describe('встроенная политика заморожена', () => {
  it('списки нельзя изменить из чужого кода', () => {
    for (const list of [BLOCKED_IPV4_SUBNETS, BLOCKED_IPV6_SUBNETS, BLOCKED_NAME_SUFFIXES]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(() => (list as string[]).push('x')).toThrow(TypeError);
    }
    expect(nonPublicHostReason('printer.local')).toContain('.local');
  });

  it('зона организации — не встроенная: только настройкой', () => {
    expect(BLOCKED_NAME_SUFFIXES).not.toContain('acme');
    expect(nonPublicHostReason('gitlab.acme', { extraBlockedNameSuffixes: ['acme'] })).toContain('.acme');
  });
});

describe('таймаут DNS', () => {
  const never = (): Promise<never> => new Promise<never>(() => undefined);

  it('nonPublicResolvedReason: резолвер молчит — отказ с причиной к потолку', async () => {
    await expect(nonPublicResolvedReason('slow.example', never, { lookupTimeoutMs: 20 })).resolves.toContain(
      'не ответил за 20 мс',
    );
  });

  it('guardedLookup: резолвер молчит — ошибка ETIMEOUT; поздний ответ отбрасывается', async () => {
    let late: (() => void) | undefined;
    const lookup = createGuardedLookup({
      lookupTimeoutMs: 20,
      resolve: (_host, _options, callback) => {
        late = () => callback(null, [{ address: '93.184.216.34', family: 4 }]);
      },
    });
    const calls: Array<{ code?: string } | null> = [];
    await new Promise<void>((resolve) => {
      lookup('slow.example', { all: true }, (error) => {
        calls.push(error as { code?: string } | null);
        resolve();
      });
    });
    late?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.code).toBe('ETIMEOUT');
  });

  it.each([0, -1, 1.5, Number.NaN])('lookupTimeoutMs %p — исключение', (lookupTimeoutMs) => {
    expect(() => createGuardedLookup({ lookupTimeoutMs })).toThrow('lookupTimeoutMs');
  });
});

describe('агенты node:http — положительный путь и пара', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('публичный литерал — соединение идёт, с защищённым lookup (а не отказ всему подряд)', () => {
    const connect = jest
      .spyOn(HttpAgent.prototype, 'createConnection')
      .mockImplementation(() => ({ fake: true }) as never);
    const agent = createGuardedHttpAgent();
    const socket = (
      agent as unknown as { createConnection: (o: object, cb: () => void) => unknown }
    ).createConnection({ host: '93.184.216.34', port: 80 }, () => undefined);
    expect(socket).toEqual({ fake: true });
    expect(connect).toHaveBeenCalledTimes(1);
    const [connectOptions] = connect.mock.calls[0] ?? [];
    expect(typeof (connectOptions as { lookup?: unknown } | undefined)?.lookup).toBe('function');
  });

  it('createGuardedAgents: оба агента защищены одной политикой', async () => {
    const agents = createGuardedAgents({ extraBlockedNameSuffixes: ['acme'] });
    for (const agent of [agents.http, agents.https]) {
      const error = await new Promise<Error>((resolve) => {
        (
          agent as unknown as { createConnection: (o: object, cb: (e: Error) => void) => unknown }
        ).createConnection({ host: '10.0.0.1', port: 80 }, resolve);
      });
      expect(error).toBeInstanceOf(BlockedDestinationError);
    }
  });
});

describe('createGuardedConnect — коннектор undici', () => {
  const stub = () => {
    const seen: UndiciConnectOptions[] = [];
    let built: Record<string, unknown> = {};
    const build = (options: Record<string, unknown>) => {
      built = options;
      return (options2: UndiciConnectOptions, callback: (e: Error | null, s: unknown) => void) => {
        seen.push(options2);
        callback(null, { socket: options2.hostname });
        return { socket: options2.hostname };
      };
    };
    return { seen, build, builtOptions: () => built };
  };
  const connectWith = (connector: UndiciConnector, hostname: string) =>
    new Promise<{ error: Error | null; socket: unknown }>((resolve) => {
      connector({ hostname, protocol: 'http:', port: '80' }, (error, socket) => resolve({ error, socket }));
    });

  it('редирект на адрес метаданных: первое соединение идёт, второе — отказ до сокета', async () => {
    const { seen, build } = stub();
    const connector = createGuardedConnect(build);
    expect((await connectWith(connector, '93.184.216.34')).error).toBeNull();
    const redirected = await connectWith(connector, '169.254.169.254');
    expect(redirected.error).toBeInstanceOf(BlockedDestinationError);
    expect(seen.map((o) => o.hostname)).toEqual(['93.184.216.34']);
  });

  it.each(['127.0.0.1', '[::1]', '[::ffff:10.0.0.1]', 'localhost', 'svc.internal'])(
    '%s — отказ без вызова базового коннектора',
    async (hostname) => {
      const { seen, build } = stub();
      expect((await connectWith(createGuardedConnect(build), hostname)).error).toBeInstanceOf(
        BlockedDestinationError,
      );
      expect(seen).toEqual([]);
    },
  );

  it('базовый коннектор собран с защищённым lookup; свои настройки connect сохраняются', () => {
    const { build, builtOptions } = stub();
    createGuardedConnect(build, { connect: { timeout: 1234, lookup: () => 'чужой' } });
    expect(builtOptions().timeout).toBe(1234);
    expect(builtOptions().lookup).toEqual(expect.any(Function));
    expect((builtOptions().lookup as { name?: string }).name).toBe('guardedLookup');
  });

  it('настоящий undici: fetch на 127.0.0.1 — отказ, сервер запроса не получил', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const dispatcher = new UndiciAgent({ connect: createGuardedConnect(buildConnector) });
    try {
      const failure = await fetch(`http://127.0.0.1:${port}/`, { dispatcher }).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(TypeError);
      expect((failure as { cause?: unknown }).cause).toBeInstanceOf(BlockedDestinationError);
      expect(requests).toBe(0);
    } finally {
      await dispatcher.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
