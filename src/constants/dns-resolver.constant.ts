import { deepFreeze } from '../deep-freeze';

/**
 * Каким резолвером пакет разрешает имена (опция `resolver`).
 *
 * - `cAres` — по умолчанию: `dns.Resolver` (c-ares). Запросы идут сокетами в
 *   цикле событий, пул потоков libuv не занимают; таймаут ОТМЕНЯЕТ запрос
 *   (`resolver.cancel()`), а не только отпускает вызывающего. Не читает
 *   `/etc/hosts` и nsswitch, не применяет `search` из resolv.conf.
 * - `system` — `dns.lookup` (`getaddrinfo`): видит `/etc/hosts`, nsswitch,
 *   mDNS. Занимает поток пула на всё время поиска, и таймаут пакета поток НЕ
 *   освобождает — поэтому одновременных системных поисков не больше общего на
 *   процесс потолка, сверх него — немедленный отказ.
 */
export const DNS_RESOLVER = {
  cAres: 'c-ares',
  system: 'system',
} as const;

deepFreeze(DNS_RESOLVER);
