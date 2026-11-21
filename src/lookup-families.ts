import { ADDRCONFIG, type LookupAllOptions } from 'node:dns';
import { networkInterfaces } from 'node:os';

/**
 * Семейства адресов, которые просили в настройках `dns.lookup`: 4, 6 или оба.
 *
 * Флаг `dns.ADDRCONFIG` в `hints` (его ставит `net` при соединении без явного
 * семейства) — как у getaddrinfo: семейство спрашивается, только если у машины
 * есть адрес этого семейства на НЕ-loopback интерфейсе. Без этого машина без
 * IPv6 всё равно ждала ответ AAAA, и upstream, теряющий такие вопросы,
 * превращал каждый поиск в таймаут. Нет ни одного такого адреса (контейнер без
 * сети) — оба семейства: флаг сужает выборку, но не делает поиск невозможным.
 */
export function lookupFamilies(options: LookupAllOptions): readonly (4 | 6)[] {
  const family = options.family;
  if (family === 4 || family === 'IPv4') {
    return [4];
  }
  if (family === 6 || family === 'IPv6') {
    return [6];
  }
  if (((options.hints ?? 0) & ADDRCONFIG) === 0) {
    return [4, 6];
  }
  const configured = new Set<4 | 6>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal) {
        configured.add(address.family === 'IPv6' ? 6 : 4);
      }
    }
  }
  const families = ([4, 6] as const).filter((candidate) => configured.has(candidate));
  return families.length === 0 ? [4, 6] : families;
}
