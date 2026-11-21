import { compileProxyUrl } from './compile-proxy-url';
import { connectViaProxy } from './connect-via-proxy';
import { createConnectionGuard } from './connection-guard';
import { DEFAULT_PORT } from './constants/default-port.constant';
import { PROXY_TUNNEL } from './constants/proxy-tunnel.constant';
import { TIMER } from './constants/timer.constant';
import { requireInteger } from './require-integer';
import type { GuardedConnectOptions } from './types/guarded-connect-options.type';
import type { UndiciBuildConnector } from './types/undici-build-connector.type';
import type { UndiciConnector } from './types/undici-connector.type';

export type { GuardedConnectOptions } from './types/guarded-connect-options.type';
export type { UndiciBuildConnector } from './types/undici-build-connector.type';
export type { UndiciConnectCallback } from './types/undici-connect-callback.type';
export type { UndiciConnectOptions } from './types/undici-connect-options.type';
export type { UndiciConnector } from './types/undici-connector.type';

/**
 * Коннектор undici, который не соединяется с непубличной целью НИ В КАКОЙ
 * форме хоста — в том числе после редиректа. `fetch` идёт за редиректом сам,
 * а для хоста-литерала (`http://169.254.169.254/`) `net` соединяется без
 * `lookup`: одного `connect: { lookup: guardedLookup }` мало, и `302` на адрес
 * метаданных проходил. Здесь каждое соединение — первое и после каждого
 * редиректа — проверяется по хосту и порту до сокета, имя разрешается
 * защищённым `lookup` (DNS-ребиндинг закрыт тем же ответом DNS).
 *
 * `socketPath` в настройках `connect` — исключение при создании: undici
 * соединяется с unix-сокетом, НЕ глядя на хост, и проверка хоста теряет смысл.
 *
 * ```ts
 * import { Agent, buildConnector, fetch } from 'undici';
 * const dispatcher = new Agent({ connect: createGuardedConnect(buildConnector) });
 * await fetch(url, { dispatcher });
 * ```
 */
export function createGuardedConnect<C extends (options: never, callback: never) => unknown>(
  buildConnector: UndiciBuildConnector<C>,
  options: GuardedConnectOptions = {},
): C {
  const { connect, proxy, proxyConnectTimeoutMs, ...guardOptions } = options;
  for (const key of ['socketPath', 'path'] as const) {
    if (connect?.[key] !== undefined) {
      throw new Error(
        `createGuardedConnect: connect.${key} — соединение с unix-сокетом мимо проверки хоста; ` +
          'защита к такому соединению неприменима',
      );
    }
  }
  // Опечатка в политике — исключение при создании, а не на запросе.
  const guard = createConnectionGuard(guardOptions);
  // Граница со структурными типами undici: настройки и коннектор — его формы,
  // зависимости пакета от undici нет.
  const base = buildConnector({ ...connect, lookup: guard.lookup } as never) as unknown as UndiciConnector;
  const proxyUrl = proxy === undefined ? null : compileProxyUrl(proxy);
  const tunnelTimeoutMs = requireInteger(
    'proxyConnectTimeoutMs',
    proxyConnectTimeoutMs ?? PROXY_TUNNEL.connectTimeoutMs,
    1,
    TIMER.maxDelayMs,
  );
  const guarded: UndiciConnector = (connectOptions, callback) => {
    const https = connectOptions.protocol === 'https:';
    const defaultPort = https ? DEFAULT_PORT.https : DEFAULT_PORT.http;
    const error = guard.refuse(connectOptions.hostname, connectOptions.port, defaultPort);
    if (error !== null) {
      // Асинхронно, как отказ сокета: вызывающий не ждёт колбэк до возврата.
      process.nextTick(callback, error, null);
      return null;
    }
    if (proxyUrl === null) {
      return base(connectOptions, callback);
    }
    const port = Number(connectOptions.port) || defaultPort;
    connectViaProxy(
      guard,
      proxyUrl,
      connectOptions.hostname,
      port,
      tunnelTimeoutMs,
      (tunnelError, socket) => {
        if (tunnelError !== null || socket === null) {
          callback(tunnelError, null);
        } else if (https) {
          // TLS к цели поверх туннеля: имя цели — в SNI и проверке сертификата.
          base({ ...connectOptions, httpSocket: socket }, callback);
        } else {
          callback(null, socket);
        }
      },
    );
    return null;
  };
  return guarded as unknown as C;
}
