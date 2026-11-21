import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import { valueText } from './value-text';

/** Потолок таймера Node: больше — setTimeout срабатывает через 1 мс. */
const MAX_TIMER_MS = 2_147_483_647;

/** Потолок ожидания DNS из настроек; опечатка — исключение, а не «без потолка». */
export function lookupTimeoutMs(value: number | undefined): number {
  const timeout = value ?? NET_GUARD_DEFAULTS.lookupTimeoutMs;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_TIMER_MS) {
    throw new Error(`lookupTimeoutMs — целое от 1 до ${MAX_TIMER_MS}, получено ${valueText(value)}`);
  }
  return timeout;
}
