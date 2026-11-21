import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import { BlockedDestinationError } from './blocked-destination.error';
import type { ConnectionGuardOptions } from './connection-guard-options';
import { GUARD_OPTION_KEYS } from './constants/guard-option-keys.constant';
import { createGuardedHttpAgent, createGuardedHttpsAgent } from './guarded-agent';
import { createGuardedConnect } from './guarded-connect';
import type { LookupCallback, ResolveAllAddresses } from './guarded-lookup';
import type { BlockedEvent } from './types/blocked-event.type';

/**
 * Каждая настройка защиты, переданная агенту или коннектору, ОБЯЗАНА дойти до
 * проверки: ключ, потерянный по дороге, молча выключает политику потребителя
 * (свои подсети, зоны, NSP, резолвер, таймаут, хук, порты) — а запрос уходит
 * со встроенной политикой. Каждый ключ — своим утверждением с контролем «без
 * настройки ведёт себя иначе».
 */
type Created = {
  connect: (host: string, port: number) => Promise<Error | 'соединение'>;
  /** Настройки, с которыми создано базовое соединение. */
  options: () => object;
  /** Настройки самого клиента (агента / buildConnector): защита в них уходить не должна. */
  clientOptions: () => object;
};

/** Агент с перехваченным базовым соединением: «соединение» — защита пропустила. */
const viaAgent =
  (
    factory: typeof createGuardedHttpAgent | typeof createGuardedHttpsAgent,
    base: typeof HttpAgent | typeof HttpsAgent,
  ) =>
  (options: ConnectionGuardOptions): Created => {
    let seen: object = {};
    jest.spyOn(base.prototype, 'createConnection').mockImplementation(((connectOptions: object) => {
      seen = connectOptions;
      return { fake: true };
    }) as never);
    const agent = factory(options) as unknown as {
      createConnection: (o: object, cb: (e: Error | null) => void) => unknown;
    };
    return {
      connect: (host, port) =>
        new Promise((done) => {
          const socket = agent.createConnection({ host, port }, (error) => done(error ?? 'соединение'));
          if (socket !== undefined) {
            done('соединение');
          }
        }),
      options: () => seen,
      clientOptions: () => (agent as unknown as { options: object }).options,
    };
  };

/** Коннектор undici поверх подставного buildConnector. */
const viaConnector = (options: ConnectionGuardOptions): Created => {
  let built: Record<string, unknown> = {};
  const connector = createGuardedConnect((buildOptions: Record<string, unknown>) => {
    built = buildOptions;
    return (_o: unknown, callback: (e: Error | null, s: unknown) => void) => callback(null, {});
  }, options);
  return {
    connect: (host, port) =>
      new Promise((done) => {
        connector({ hostname: host, protocol: 'http:', port: String(port) }, (error) =>
          done(error ?? 'соединение'),
        );
      }),
    options: () => built,
    clientOptions: () => built,
  };
};

const CLIENTS: ReadonlyArray<readonly [string, (options: ConnectionGuardOptions) => Created]> = [
  ['http.Agent', viaAgent(createGuardedHttpAgent, HttpAgent)],
  ['https.Agent', viaAgent(createGuardedHttpsAgent, HttpsAgent)],
  ['undici connect', viaConnector],
];

/** Вызвать защищённый lookup, который клиент передал бы в net.connect. */
const lookupVia = (created: Created, hostname: string) =>
  new Promise<NodeJS.ErrnoException | null>((done) => {
    const { lookup } = created.options() as { lookup: (h: string, o: object, c: LookupCallback) => void };
    lookup(hostname, {}, (error) => done(error));
  });

const blocked = (result: Error | 'соединение'): string =>
  result instanceof BlockedDestinationError
    ? `отказ:${result.stage}`
    : result === 'соединение'
      ? result
      : String(result);

describe.each(CLIENTS)('%s: настройки защиты доходят до проверки', (_name, create) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('список ключей защиты не выродился', () => {
    expect(GUARD_OPTION_KEYS.length).toBe(8);
  });

  it('extraBlockedSubnets', async () => {
    expect(
      blocked(await create({ extraBlockedSubnets: ['93.184.216.0/24'] }).connect('93.184.216.34', 80)),
    ).toBe('отказ:host');
    expect(blocked(await create({}).connect('93.184.216.34', 80))).toBe('соединение');
  });

  it('extraBlockedNameSuffixes', async () => {
    expect(blocked(await create({ extraBlockedNameSuffixes: ['acme'] }).connect('git.acme', 80))).toBe(
      'отказ:host',
    );
    expect(blocked(await create({}).connect('git.acme', 80))).toBe('соединение');
  });

  it('extraNat64Prefixes', async () => {
    const metadataViaNsp = '2a00:1450:64::a9fe:a9fe';
    expect(
      blocked(await create({ extraNat64Prefixes: ['2a00:1450:64::/96'] }).connect(metadataViaNsp, 80)),
    ).toBe('отказ:host');
    expect(blocked(await create({}).connect(metadataViaNsp, 80))).toBe('соединение');
  });

  it('allowedPorts', async () => {
    expect(blocked(await create({ allowedPorts: [8443] }).connect('93.184.216.34', 8443))).toBe('соединение');
    expect(blocked(await create({}).connect('93.184.216.34', 8443))).toBe('отказ:port');
    expect(blocked(await create({ allowedPorts: 'any' }).connect('93.184.216.34', 6379))).toBe('соединение');
  });

  it('onBlocked', async () => {
    const events: BlockedEvent[] = [];
    await create({ onBlocked: (event) => events.push(event) }).connect('169.254.169.254', 80);
    expect(events).toEqual([
      {
        stage: 'host',
        target: '169.254.169.254',
        reason: 'адрес 169.254.169.254 не публичный',
        address: '169.254.169.254',
      },
    ]);
  });

  it('resolve — свой резолвер в защищённом lookup', async () => {
    const names: string[] = [];
    const resolve: ResolveAllAddresses = (hostname, _options, callback) => {
      names.push(hostname);
      callback(null, [{ address: '10.0.0.7', family: 4 }]);
    };
    const created = create({ resolve });
    await created.connect('evil.example', 80);
    const error = await lookupVia(created, 'evil.example');
    expect({ names, address: (error as BlockedDestinationError | null)?.address }).toEqual({
      names: ['evil.example'],
      address: '10.0.0.7',
    });
  });

  it('lookupTimeoutMs — потолок защищённого lookup', async () => {
    const silent: ResolveAllAddresses = () => undefined;
    const created = create({ resolve: silent, lookupTimeoutMs: 20 });
    await created.connect('slow.example', 80);
    expect((await lookupVia(created, 'slow.example'))?.code).toBe('ETIMEOUT');
    expect(() => create({ lookupTimeoutMs: 0 })).toThrow('lookupTimeoutMs');
  });

  it('resolver — доходит до выбора резолвера (вместе с resolve — исключение)', () => {
    expect(() => create({ resolver: 'system', resolve: () => undefined })).toThrow('и resolve, и resolver');
    expect(() => create({ resolver: 'bind' as never })).toThrow('неизвестный resolver');
  });

  it('защита в настройки клиента не уходит, а lookup клиента — защищённый', async () => {
    const created = create({
      extraBlockedSubnets: ['198.51.100.0/24'],
      onBlocked: () => undefined,
      allowedPorts: 'any',
    });
    await created.connect('93.184.216.34', 80);
    const seen = created.options() as Record<string, unknown>;
    const client = created.clientOptions() as Record<string, unknown>;
    expect({
      leaked: GUARD_OPTION_KEYS.filter((key) => key in client),
      lookup: (seen.lookup as { name?: string } | undefined)?.name,
    }).toEqual({ leaked: [], lookup: 'guardedLookup' });
  });
});
