import type { GuardedConnectOptions } from './guarded-connect-options.type';

/** Настройки защищённого dispatcher undici: защита, `connect` (TLS, таймауты) и настройки `Agent`. */
export interface GuardedDispatcherOptions extends GuardedConnectOptions {
  /** Настройки `undici.Agent` (`keepAliveTimeout`, `connections`…); `connect` здесь — исключение, он свой. */
  readonly agent?: Record<string, unknown>;
}
