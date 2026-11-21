import { netGuardState } from './net-guard-state';
import { systemLookupLimit } from './system-lookup-limit';
import type { NetGuardStats } from './types/net-guard-stats.type';

/**
 * Счётчики на процесс — для метрик и разбора: попытки SSRF по шагам отказа и
 * занятость системного резолвера. Общие для всех копий пакета в процессе.
 *
 * ```ts
 * const { blocked, systemLookups } = netGuardStats();
 * gauge.set(systemLookups.inFlight); // поиски, от которых вызывающий, возможно, уже ушёл
 * ```
 */
export function netGuardStats(): NetGuardStats {
  const state = netGuardState();
  return Object.freeze({
    blocked: Object.freeze(Object.fromEntries(state.blocked)),
    systemLookups: Object.freeze({
      inFlight: state.systemInFlight,
      limit: systemLookupLimit(),
      waiting: state.systemWaiting?.length ?? 0,
      refused: state.systemRefused,
    }),
  });
}
