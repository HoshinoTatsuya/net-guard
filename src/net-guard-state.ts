import type { NetGuardState } from './types/net-guard-state.type';

/**
 * Ключ в `globalThis`: две копии пакета в одном процессе (монорепозиторий,
 * разные версии у зависимостей) делят ОДИН пул libuv — значит и один счётчик.
 * Свой счётчик у каждой копии пропустил бы вдвое больше поисков, чем потолок.
 * Состояние создаёт первая копия пакета, остальные берут его же.
 */
export function netGuardState(): NetGuardState {
  const STATE_KEY = Symbol.for('@hoshinotatsuya/net-guard.state.v1');
  const holder = globalThis as { [STATE_KEY]?: NetGuardState };
  holder[STATE_KEY] ??= { blocked: new Map(), systemInFlight: 0, systemRefused: 0, systemWaiting: [] };
  return holder[STATE_KEY];
}
