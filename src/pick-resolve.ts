import { caresResolve } from './cares-resolve';
import { DNS_RESOLVER } from './constants/dns-resolver.constant';
import { systemResolve } from './system-resolve';
import type { DnsResolverKind } from './types/dns-resolver-kind.type';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';
import { valueText } from './value-text';

/**
 * Резолвер по настройкам: свой `resolve`, иначе `resolver` — c-ares по
 * умолчанию, getaddrinfo только явно. Оба сразу или неизвестное имя
 * резолвера — исключение при создании: молча выбранный резолвер не тот,
 * который имели в виду.
 */
export function pickResolve(options: {
  readonly resolve?: ResolveAllAddresses;
  readonly resolver?: DnsResolverKind;
}): ResolveAllAddresses {
  const { resolve, resolver } = options;
  if (resolve !== undefined) {
    if (resolver !== undefined) {
      throw new Error('net-guard: заданы и resolve, и resolver — нужен один');
    }
    return resolve;
  }
  if (resolver === undefined || resolver === DNS_RESOLVER.cAres) {
    return caresResolve;
  }
  if (resolver === DNS_RESOLVER.system) {
    return systemResolve;
  }
  throw new Error(
    `net-guard: неизвестный resolver «${valueText(resolver)}» — ожидается '${DNS_RESOLVER.cAres}' или '${DNS_RESOLVER.system}'`,
  );
}
