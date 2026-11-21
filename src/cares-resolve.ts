import { getDefaultResultOrder, type LookupAddress } from 'node:dns';

import { CaresResolverPool } from './cares-resolver-pool';
import { lookupFamilies } from './lookup-families';
import { mergeDnsAnswers } from './merge-dns-answers';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/**
 * Разрешение имени в A и AAAA через c-ares — сеть в цикле событий, без пула
 * потоков libuv. Возвращает отмену: таймаут вызывающего снимает запрос
 * целиком (`resolver.cancel()`), поток и сокет не остаются заняты.
 *
 * c-ares не читает `/etc/hosts` и nsswitch и не применяет `search`/`ndots`
 * из resolv.conf: имя спрашивается ровно таким, каким его проверили.
 *
 * Порядок адресов — `options.order`, а без него — порядок процесса
 * (`dns.getDefaultResultOrder()`, `--dns-result-order`): `net` порядок в
 * `lookup` не передаёт. `ipv6first` — сначала IPv6; `ipv4first` и `verbatim` —
 * сначала IPv4 (у c-ares два отдельных ответа, «порядка getaddrinfo» по
 * RFC 6724 у них нет). При `autoSelectFamily` (по умолчанию) `net` всё равно
 * пробует оба семейства.
 */
export const caresResolve: ResolveAllAddresses = (hostname, options, callback) => {
  const resolver = CaresResolverPool.acquire();
  const families = lookupFamilies(options);
  const found = new Map<4 | 6, LookupAddress[]>();
  const errors: NodeJS.ErrnoException[] = [];
  let pending = families.length;
  let finished = false;

  for (const family of families) {
    const onAnswer = (error: NodeJS.ErrnoException | null, list: string[]): void => {
      if (finished) {
        return;
      }
      if (error) {
        errors.push(error);
      } else {
        found.set(
          family,
          list.map((address) => ({ address, family })),
        );
      }
      pending--;
      if (pending > 0) {
        return;
      }
      finished = true;
      CaresResolverPool.release(resolver);
      const order = options.order ?? getDefaultResultOrder();
      const merged = mergeDnsAnswers(hostname, order === 'ipv6first', found, errors);
      callback(merged.error, merged.addresses);
    };
    if (family === 4) {
      resolver.resolve4(hostname, onAnswer);
    } else {
      resolver.resolve6(hostname, onAnswer);
    }
  }

  return () => {
    if (!finished) {
      finished = true;
      resolver.cancel();
    }
  };
};
