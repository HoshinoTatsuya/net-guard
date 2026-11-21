import type { LookupAddress } from 'node:dns';

/**
 * Свести ответы A и AAAA. Адреса — сначала IPv4, затем IPv6 (`ipv6first` —
 * наоборот). Ответ одного семейства при отказе другого — ответ: соединение
 * пойдёт только по полученным адресам, и все они проверены. Нет ни одного
 * адреса — первый отказ, отличный от «имени/записей нет» (`ETIMEOUT`,
 * `ESERVFAIL`…), иначе `ENOTFOUND`, как у `dns.lookup` (ответы — в `cause`).
 */
export function mergeDnsAnswers(
  hostname: string,
  ipv6First: boolean,
  found: ReadonlyMap<4 | 6, LookupAddress[]>,
  errors: readonly NodeJS.ErrnoException[],
): { readonly error: NodeJS.ErrnoException | null; readonly addresses: LookupAddress[] } {
  const order: readonly (4 | 6)[] = ipv6First ? [6, 4] : [4, 6];
  const addresses = order.flatMap((family) => found.get(family) ?? []);
  if (addresses.length > 0) {
    return { error: null, addresses };
  }
  // «Имени нет» и «записей этого типа нет» — единственные ответы, значащие «адресов нет».
  const failure = errors.find((error) => error.code !== 'ENOTFOUND' && error.code !== 'ENODATA');
  const notFound = Object.assign(new Error(`ENOTFOUND ${hostname}`, { cause: errors[0] }), {
    code: 'ENOTFOUND',
    hostname,
    syscall: 'resolve',
  });
  return { error: failure ?? notFound, addresses: [] };
}
