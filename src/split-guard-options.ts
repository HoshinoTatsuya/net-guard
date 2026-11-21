import type { ConnectionGuardOptions } from './connection-guard-options';
import { GUARD_OPTION_KEYS } from './constants/guard-option-keys.constant';

/** Делит настройки на защиту и настройки клиента (защита в `net.connect` не уходит). */
export function splitGuardOptions<T extends object>(
  options: T & ConnectionGuardOptions,
): { guard: ConnectionGuardOptions; rest: Omit<T, (typeof GUARD_OPTION_KEYS)[number]> } {
  const guard: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  for (const key of GUARD_OPTION_KEYS) {
    if (options[key] !== undefined) {
      guard[key] = options[key];
    }
    delete rest[key];
  }
  return {
    guard: guard as ConnectionGuardOptions,
    rest: rest as Omit<T, (typeof GUARD_OPTION_KEYS)[number]>,
  };
}
