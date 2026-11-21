/**
 * IPv6, куда запросы не уходят.
 *
 * `::ffff:0:0/96` (IPv4-mapped) и `64:ff9b::/96` (NAT64) сюда не входят: внутри
 * них лежит IPv4, и решение принимается по нему. Замер: libcurl соединяется
 * с `[::ffff:127.0.0.1]` и доставляет запрос на loopback.
 */
export const BLOCKED_IPV6_SUBNETS: readonly string[] = Object.freeze([
  '::/96', // неуказанный, loopback и устаревшие IPv4-compatible
  '::ffff:0:0:0/96', // IPv4-translated (SIIT)
  '64:ff9b:1::/48', // локальный NAT64
  '100::/64', // discard
  '2001::/23', // протокольные назначения IETF, включая Teredo
  '2001:db8::/32', // документация
  '2002::/16', // 6to4: внутри произвольный IPv4
  '3fff::/20', // документация (RFC 9637)
  '5f00::/16', // SRv6 SID (RFC 9602): адреса сегментов внутри сети, не сайты
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'fec0::/10', // site-local
  'ff00::/8', // multicast
]);
