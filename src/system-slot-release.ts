import { netGuardState } from './net-guard-state';

/** Освобождение занятого слота: передать первому ждущему, иначе вернуть в общий счёт. */
export function systemSlotRelease(): () => void {
  const state = netGuardState();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = state.systemWaiting?.shift();
    if (next === undefined) {
      state.systemInFlight--;
      return;
    }
    next(systemSlotRelease());
  };
}
