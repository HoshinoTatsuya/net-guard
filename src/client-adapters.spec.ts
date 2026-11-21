import { buildConnector, Agent as UndiciAgent } from 'undici';

import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import { guardedAxiosConfig } from './guarded-axios-config';
import { createGuardedDispatcher } from './guarded-dispatcher';
import { guardedGotOptions } from './guarded-got-options';
import { createGuardedLookup } from './guarded-lookup';
import { netGuardStats } from './net-guard-stats';
import type { BlockedEvent } from './types/blocked-event.type';

/** Готовые подключения клиентов: форма настроек и то, что агенты/коннектор в них защищённые. */
const refusedBy = (agent: unknown, host: string) =>
  new Promise<Error | null>((done) => {
    (agent as { createConnection: (o: object, cb: (e: Error | null) => void) => unknown }).createConnection(
      { host, port: 80 },
      (error) => done(error),
    );
  });

describe('guardedAxiosConfig', () => {
  it('пара защищённых агентов, proxy: false, потолки по умолчанию', async () => {
    const config = guardedAxiosConfig();
    expect({
      proxy: config.proxy,
      maxRedirects: config.maxRedirects,
      maxContentLength: config.maxContentLength,
      maxBodyLength: config.maxBodyLength,
      timeout: config.timeout,
      http: (await refusedBy(config.httpAgent, '169.254.169.254')) instanceof BlockedDestinationError,
      https: (await refusedBy(config.httpsAgent, '10.0.0.1')) instanceof BlockedDestinationError,
    }).toEqual({
      proxy: false,
      maxRedirects: NET_GUARD_DEFAULTS.maxRedirects,
      maxContentLength: NET_GUARD_DEFAULTS.maxResponseBytes,
      maxBodyLength: NET_GUARD_DEFAULTS.maxResponseBytes,
      timeout: NET_GUARD_DEFAULTS.fetchTimeoutMs,
      http: true,
      https: true,
    });
  });

  it('политика и потолки вызывающего доходят до агентов', async () => {
    const config = guardedAxiosConfig({
      extraBlockedSubnets: ['93.184.216.0/24'],
      maxRedirects: 2,
      timeoutMs: 5,
    });
    expect({
      blocked: (await refusedBy(config.httpAgent, '93.184.216.34')) instanceof BlockedDestinationError,
      maxRedirects: config.maxRedirects,
      timeout: config.timeout,
    }).toEqual({ blocked: true, maxRedirects: 2, timeout: 5 });
  });
});

describe('guardedGotOptions', () => {
  it('агенты по протоколу, http2: false, потолки', async () => {
    const options = guardedGotOptions({ maxRedirects: 3 });
    expect({
      http2: options.http2,
      maxRedirects: options.maxRedirects,
      timeout: options.timeout,
      http: (await refusedBy(options.agent.http, '127.0.0.1')) instanceof BlockedDestinationError,
      https: (await refusedBy(options.agent.https, '127.0.0.1')) instanceof BlockedDestinationError,
    }).toEqual({
      http2: false,
      maxRedirects: 3,
      timeout: { request: NET_GUARD_DEFAULTS.fetchTimeoutMs },
      http: true,
      https: true,
    });
  });
});

describe('createGuardedDispatcher', () => {
  it('Agent undici с защищённым коннектором; agent.connect — исключение', async () => {
    const dispatcher = createGuardedDispatcher({ Agent: UndiciAgent, buildConnector } as never, {
      agent: { keepAliveTimeout: 1_000 },
    }) as UndiciAgent;
    try {
      const failure = await dispatcher
        .request({ origin: 'http://169.254.169.254', path: '/', method: 'GET' })
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(BlockedDestinationError);
    } finally {
      await dispatcher.close();
    }
    expect(() =>
      createGuardedDispatcher({ Agent: UndiciAgent, buildConnector } as never, { agent: { connect: {} } }),
    ).toThrow('agent.connect');
  });

  it('socketPath в connect — исключение: unix-сокет минует проверку хоста', () => {
    expect(() =>
      createGuardedDispatcher({ Agent: UndiciAgent, buildConnector } as never, {
        connect: { socketPath: '/var/run/x.sock' },
      }),
    ).toThrow('connect.socketPath');
  });
});

describe('аудит: onBlocked и счётчики', () => {
  it('каждый отказ — событие и счётчик шага; исключение хука — предупреждение, отказ в силе', async () => {
    const before = netGuardStats().blocked;
    const events: BlockedEvent[] = [];
    const emitWarning = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const ok = createGuardedLookup({
      onBlocked: (event) => events.push(event),
      resolve: (_h, _o, callback) => callback(null, [{ address: '10.0.0.9', family: 4 }]),
    });
    const throwing = createGuardedLookup({
      onBlocked: () => {
        throw new Error('хук сломан');
      },
    });
    const errors = await Promise.all(
      [
        [ok, 'evil.example'],
        [ok, 'localhost'],
        [throwing, 'metadata.google.internal'],
      ].map(
        ([lookup, host]) =>
          new Promise<NodeJS.ErrnoException | null>((done) =>
            (lookup as ReturnType<typeof createGuardedLookup>)(host as string, {}, (error) => done(error)),
          ),
      ),
    );
    await new Promise((done) => setImmediate(done));
    const warnings = emitWarning.mock.calls.map(([message]) => String(message));
    emitWarning.mockRestore();
    const after = netGuardStats().blocked;
    expect({
      errors: errors.map((error) => error?.code),
      events: events.map(({ stage, target, address }) => `${stage}:${target}:${address}`),
      warnings: warnings.filter((message) => message.includes('хук сломан')).length,
      address: (after.address ?? 0) - (before.address ?? 0),
      host: (after.host ?? 0) - (before.host ?? 0),
    }).toEqual({
      errors: Array(3).fill('ERR_NET_GUARD_BLOCKED_DESTINATION'),
      events: ['address:evil.example:10.0.0.9', 'host:localhost:undefined'],
      warnings: 1,
      address: 1,
      host: 2,
    });
  });
});
