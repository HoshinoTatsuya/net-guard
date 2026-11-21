import { netGuardState } from './net-guard-state';
import { systemLookupLimit } from './system-lookup-limit';
import { systemSlotRelease } from './system-slot-release';

/**
 * Занять слот системного поиска. `null` — потолок исчерпан: вызывающий ждёт в
 * очереди пакета (`state.systemWaiting`), а не ставит поиск в очередь пула.
 * Иначе — функция освобождения; её зовут на НАСТОЯЩЕМ ответе `getaddrinfo`
 * (поток пула занят до него, таймаут его не освобождает). Освобождённый слот
 * переходит первому ждущему, не возвращаясь в общий счёт. Повторный вызов
 * освобождения — ничего не делает: слот не возвращается дважды.
 */
export function acquireSystemLookup(limit: number = systemLookupLimit()): (() => void) | null {
  const state = netGuardState();
  if (state.systemInFlight >= limit) {
    return null;
  }
  state.systemInFlight++;
  return systemSlotRelease();
}
