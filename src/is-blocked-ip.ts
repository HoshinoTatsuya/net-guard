import type { CompiledPolicy } from './compile-policy';
import { compilePolicy } from './compile-policy';
import { IP_ADDRESS } from './constants/ip-address.constant';
import { IPV6_EMBEDDED_IPV4 } from './constants/ipv6-embedded-ipv4.constant';
import { inSubnet } from './in-subnet';
import { parseIpv4 } from './parse-ipv4';
import { parseIpv6 } from './parse-ipv6';
import type { NetGuardPolicy } from './types/net-guard-policy.type';

const BRACKETS = /^\[(.*)\]$/;

/** То же, что `isBlockedIp`, по уже разобранной политике (без повторного разбора на рекурсии). */
export function isBlockedAddress(address: string, policy: CompiledPolicy): boolean {
  const text = (address ?? '').trim().replace(BRACKETS, '$1');

  // Зона (fe80::1%eth0, ff02::1%eth0) бывает только у адресов с областью
  // действия — link-local и multicast, они запрещены и без неё. Зона у
  // глобального адреса — нестандартная форма: тоже отказ. Поэтому ответ с
  // зоной — всегда «запрещён»; классифицирует адрес без зоны (для причины
  // отказа) `nonPublicHostReason`.
  if (text.includes('%')) {
    return true;
  }

  const v4 = parseIpv4(text);
  if (v4) {
    return policy.ipv4.some((subnet) => inSubnet(v4, subnet));
  }

  const v6 = parseIpv6(text);
  if (!v6) {
    return true;
  }

  // Встроенные подсети IPv6 с префиксами встроенного IPv4 не пересекаются,
  // поэтому порядок для них не важен; а дополнительная подсеть из настроек
  // (`::ffff:0:0/96`) обязана сработать и на адресе со встроенным IPv4.
  if (policy.ipv6.some((subnet) => inSubnet(v6, subnet))) {
    return true;
  }

  // Внутри IPv4-mapped и NAT64 (хорошо известный и NSP из настроек) лежит
  // IPv4 — решение принимается по нему. Замер: libcurl соединяется с
  // `[::ffff:127.0.0.1]` и доставляет на loopback.
  if (inSubnet(v6, IPV6_EMBEDDED_IPV4.mapped) || policy.nat64.some((prefix) => inSubnet(v6, prefix))) {
    return isBlockedAddress(
      Array.from(v6.subarray(IP_ADDRESS.ipv6Bytes - IP_ADDRESS.ipv4Bytes)).join('.'),
      policy,
    );
  }

  // Вне глобального unicast — не интернет: нераспределённое пространство
  // IANA и всё, чего нет в списках, — отказ, а не пропуск.
  return !inSubnet(v6, policy.globalUnicast);
}

/**
 * Адрес (IPv4 или IPv6 в каноническом или сокращённом виде, в скобках или без)
 * не публичный. То, что не разбирается как адрес, тоже считается запрещённым:
 * «не смогли определить» и «безопасно» — разные ответы.
 *
 * `policy` — дополнительные подсети поверх встроенных (встроенные не снимаются).
 */
export function isBlockedIp(address: string, policy?: NetGuardPolicy): boolean {
  return isBlockedAddress(address, compilePolicy(policy));
}
