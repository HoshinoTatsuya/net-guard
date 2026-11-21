import type { BlockedDestinationError } from './blocked-destination.error';
import { netGuardState } from './net-guard-state';
import type { OnBlocked } from './types/on-blocked.type';
import { valueText } from './value-text';

/**
 * Учесть отказ: счётчик шага (`netGuardStats()`) и хук аудита. Исключение
 * хука отказ не отменяет — оно становится предупреждением процесса: хук
 * аудита, сломанный опечаткой, не должен ни пропускать запросы, ни молчать.
 */
export function reportBlocked(error: BlockedDestinationError, onBlocked: OnBlocked | undefined): void {
  const { blocked } = netGuardState();
  blocked.set(error.stage, (blocked.get(error.stage) ?? 0) + 1);
  if (onBlocked === undefined) {
    return;
  }
  try {
    onBlocked({ stage: error.stage, target: error.hostname, reason: error.reason, address: error.address });
  } catch (hookError) {
    process.emitWarning(
      `net-guard: хук onBlocked бросил исключение (отказ в силе): ${hookError instanceof Error ? hookError.message : valueText(hookError)}`,
      { code: 'NET_GUARD_ON_BLOCKED_FAILED' },
    );
  }
}
