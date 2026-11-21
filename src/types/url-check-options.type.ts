import type { AllowedPorts } from './allowed-ports.type';
import type { NetGuardPolicy } from './net-guard-policy.type';

/** Настройки проверки URL: политика адресов плюс схемы и порты цели. */
export interface UrlCheckOptions extends NetGuardPolicy {
  /** Порты (по умолчанию 80 и 443); `'any'` — порт не проверяется. */
  readonly allowedPorts?: AllowedPorts;
  /** Схемы (по умолчанию `http:` и `https:`); `'https'` и `'https:'` равнозначны. */
  readonly allowedSchemes?: readonly string[];
}
