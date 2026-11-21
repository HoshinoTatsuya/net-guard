import type { ConnectionGuardOptions } from '../connection-guard-options';

export interface GuardedConnectOptions extends ConnectionGuardOptions {
  /**
   * Настройки `buildConnector` (TLS, `timeout`, `keepAlive`…); `lookup` в них
   * заменяется защищённым, `socketPath` — исключение.
   */
  readonly connect?: Record<string, unknown>;
  /**
   * HTTP-прокси с `CONNECT` (`http://[user:pass@]хост:порт`) — вместо undici
   * `ProxyAgent`, который переносит проверку с цели на прокси. Цель
   * проверяется, прокси получает `CONNECT` на проверенный литерал адреса.
   */
  readonly proxy?: string | URL;
  /** Ожидание туннеля через прокси, мс (по умолчанию 10 000). */
  readonly proxyConnectTimeoutMs?: number;
}
