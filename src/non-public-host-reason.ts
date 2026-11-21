import { classifyHost, hostPortMode } from './classify-host';
import { compilePolicy } from './compile-policy';
import type { NonPublicHostOptions } from './types/net-guard-policy.type';

/**
 * Почему хост цели не публичный, или null, если публичный.
 *
 * Хост приводится к виду, в котором его поймёт HTTP-клиент, парсером WHATWG
 * URL: `2130706433`, `0x7f.1` и `0177.0.0.1` становятся 127.0.0.1 и не проходят
 * мимо списка. Имя без точки, `*.localhost`, `*.local`, `*.internal` и прочие
 * специальные зоны публично не резолвятся — это всегда чья-то внутренняя сеть.
 *
 * IPv6 — в скобках или голым литералом (`::1`, `2606:4700::1111`); зона
 * (`fe80::1%eth0`, `[fe80::1%25eth0]`) снимается для классификации, но адрес
 * с зоной — всегда отказ. Порт (`example.com:8080`) — отказ, если не задано
 * `allowPort: true`; `[IPv6]:порт` без опции снимается (как до 0.2.0), при
 * явном `allowPort: false` — тоже отказ.
 *
 * `options` — дополнительные подсети и зоны имён поверх встроенных.
 *
 * DNS здесь не спрашивается: имя, которое резолвится во внутренний адрес,
 * ловит `nonPublicResolvedReason`, `guardedLookup` или проверка адреса соединения.
 */
export function nonPublicHostReason(host: string, options?: NonPublicHostOptions): string | null {
  return classifyHost(host, compilePolicy(options), hostPortMode(options?.allowPort)).reason;
}
