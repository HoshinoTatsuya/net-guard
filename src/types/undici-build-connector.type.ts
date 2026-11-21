import type { UndiciConnector } from './undici-connector.type';

/**
 * `buildConnector` из `undici`: настройки TLS/таймаутов → коннектор. Тип
 * коннектора берётся у переданной функции (любой: `(options: never, callback: never) => unknown`).
 */
export type UndiciBuildConnector<C extends (options: never, callback: never) => unknown = UndiciConnector> = (
  options: never,
) => C;
