import type { ConnectionGuardOptions } from '../connection-guard-options';

/**
 * Ключи защиты в настройках клиента. Каждый ОБЯЗАН дойти до защиты: ключ,
 * потерянный по дороге, молча выключает политику потребителя (свои подсети,
 * зоны, таймаут) в агенте, — и запрос уходит со встроенной политикой.
 */
export const GUARD_OPTION_KEYS = [
  'extraBlockedSubnets',
  'extraBlockedNameSuffixes',
  'extraNat64Prefixes',
  'resolve',
  'resolver',
  'lookupTimeoutMs',
  'onBlocked',
  'allowedPorts',
] as const satisfies ReadonlyArray<keyof ConnectionGuardOptions>;
