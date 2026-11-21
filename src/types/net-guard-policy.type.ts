import type { DnsResolverKind } from './dns-resolver-kind.type';

/**
 * Дополнительные запреты ПОВЕРХ встроенных списков — встроенные не заменяются
 * никогда: настройка может только сузить, но не открыть.
 *
 * Опечатка (подсеть без префикса, префикс вне длины адреса, зона с `*` или
 * пустая) — исключение при вызове, а не молча пропущенный запрет.
 */
export interface NetGuardPolicy {
  /** Подсети в нотации CIDR, IPv4 и IPv6 вперемешку: `10.200.0.0/16`, `2a02:6b8:c00::/40`. */
  readonly extraBlockedSubnets?: readonly string[];
  /** Зоны имён: `corp.example` запрещает `corp.example` и `*.corp.example`. Юникод приводится к punycode. */
  readonly extraBlockedNameSuffixes?: readonly string[];
  /**
   * Сетевые префиксы NAT64 (NSP) сети, ровно `/96`: адрес внутри такого
   * префикса судится по встроенному IPv4 (последние четыре байта), как
   * хорошо известный `64:ff9b::/96`. Без этого в IPv6-only кластере
   * `NSP::a9fe:a9fe` (169.254.169.254) проходил как публичный. Только сужает:
   * префикс внутри запрещённого диапазона так и остаётся запрещённым.
   */
  readonly extraNat64Prefixes?: readonly string[];
}

/** Настройки проверки хоста. */
export interface NonPublicHostOptions extends NetGuardPolicy {
  /**
   * `true` — хост может нести порт (`example.com:8080`, `10.0.0.1:80`,
   * `[::1]:443`), он снимается перед проверкой.
   *
   * `false` — порт запрещён в ЛЮБОЙ форме, включая `[IPv6]:порт`.
   *
   * Не задана — прежнее поведение: порт у имени и IPv4 — отказ, `[IPv6]:порт`
   * снимается (так разбирал WHATWG URL до 0.2.0). Кто запрещает порт, чтобы
   * ограничить порт цели, задаёт `false` явно: без него запрет обходится скобками.
   *
   * Голый IPv6 (`::1`) порта не несёт никогда: `::1:443` — это тоже адрес.
   */
  readonly allowPort?: boolean;
  /**
   * Потолок ожидания DNS, мс (по умолчанию `NET_GUARD_DEFAULTS.lookupTimeoutMs`).
   * Не ответил — отказ: «не смогли разрешить» не означает «публичный».
   */
  readonly lookupTimeoutMs?: number;
  /**
   * Резолвер `nonPublicResolvedReason`, когда свой `lookup` не передан:
   * `'c-ares'` (по умолчанию) или `'system'` (getaddrinfo под общим потолком).
   */
  readonly resolver?: DnsResolverKind;
}
