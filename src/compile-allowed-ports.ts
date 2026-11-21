import { IP_ADDRESS } from './constants/ip-address.constant';
import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import { shownValue } from './shown-value';
import type { AllowedPorts } from './types/allowed-ports.type';
import { valueText } from './value-text';

/**
 * `allowedPorts` из настроек → множество (null — `'any'`, порт не проверяется).
 * Пустой список, дробь, порт вне 1–65535 — исключение: пустой список не
 * означает «без ограничений», а опечатка не должна молча открывать порты.
 */
export function compileAllowedPorts(value: AllowedPorts | undefined): ReadonlySet<number> | null {
  if (value === 'any') {
    return null;
  }
  const ports = value ?? NET_GUARD_DEFAULTS.allowedPorts;
  if (!Array.isArray(ports) || ports.length === 0) {
    throw new Error(`allowedPorts — непустой список портов или 'any', получено ${shownValue(value)}`);
  }
  for (const port of ports) {
    if (!Number.isInteger(port) || port < IP_ADDRESS.portMin || port > IP_ADDRESS.portMax) {
      throw new Error(
        `allowedPorts: порт ${valueText(port)} — ожидается целое от ${IP_ADDRESS.portMin} до ${IP_ADDRESS.portMax}`,
      );
    }
  }
  return new Set(ports);
}
