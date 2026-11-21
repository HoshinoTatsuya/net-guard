import type { GuardedLookupOptions } from './guarded-lookup';
import type { AllowedPorts } from './types/allowed-ports.type';

/** Настройки защиты соединения: политика, резолвер, хук аудита и порты цели. */
export interface ConnectionGuardOptions extends GuardedLookupOptions {
  /**
   * Порты цели (по умолчанию `NET_GUARD_DEFAULTS.allowedPorts` — 80 и 443).
   * `'any'` — порт не проверяется.
   */
  readonly allowedPorts?: AllowedPorts;
}
