import { domainToASCII } from 'node:url';

import { BLOCKED_IPV4_SUBNETS } from './constants/blocked-ipv4-subnets.constant';
import { BLOCKED_IPV6_SUBNETS } from './constants/blocked-ipv6-subnets.constant';
import { BLOCKED_NAME_SUFFIXES } from './constants/blocked-name-suffixes.constant';
import { GLOBAL_UNICAST_IPV6 } from './constants/global-unicast-ipv6.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { IPV6_EMBEDDED_IPV4 } from './constants/ipv6-embedded-ipv4.constant';
import { parseIpv4 } from './parse-ipv4';
import { parseIpv6 } from './parse-ipv6';
import { parseSubnet } from './parse-subnet';
import type { NetGuardPolicy } from './types/net-guard-policy.type';

/** Политика в разобранном виде: подсети байтами, зоны имён в ASCII. */
export interface CompiledPolicy {
  readonly ipv4: ReadonlyArray<readonly [Uint8Array, number]>;
  readonly ipv6: ReadonlyArray<readonly [Uint8Array, number]>;
  /** Встроенные зоны имён. */
  readonly nameSuffixes: readonly string[];
  /** Зоны из настроек — отдельно: причина отказа у них своя. */
  readonly extraNameSuffixes: readonly string[];
  /** Префиксы `/96`, внутри которых решает встроенный IPv4: хорошо известный NAT64 и NSP из настроек. */
  readonly nat64: ReadonlyArray<readonly [Uint8Array, number]>;
  /** Глобальный unicast: IPv6 вне него — не публичный. */
  readonly globalUnicast: readonly [Uint8Array, number];
}

/** Длина префикса NAT64, при которой IPv4 — последние четыре байта (RFC 6052). */
const NAT64_PREFIX_LENGTH = 96;

const LEADING_DOTS = /^\.+/;
const TRAILING_DOTS = /\.+$/;

/**
 * Встроенные списки — разбор при загрузке модуля: опечатка в подсети роняет
 * импорт, а не молча открывает диапазон.
 */
const BUILT_IN: CompiledPolicy = Object.freeze({
  ipv4: Object.freeze(BLOCKED_IPV4_SUBNETS.map((subnet) => parseSubnet(subnet, parseIpv4))),
  ipv6: Object.freeze(BLOCKED_IPV6_SUBNETS.map((subnet) => parseSubnet(subnet, parseIpv6))),
  nameSuffixes: BLOCKED_NAME_SUFFIXES,
  extraNameSuffixes: Object.freeze([]),
  nat64: Object.freeze([IPV6_EMBEDDED_IPV4.nat64]),
  globalUnicast: parseSubnet(GLOBAL_UNICAST_IPV6, parseIpv6),
});

/** NSP из настроек: ровно `/96`, иначе исключение — IPv4 при другой длине лежит не в конце адреса. */
function parseNat64Prefix(raw: string): readonly [Uint8Array, number] {
  const prefix = parseSubnet(raw.trim(), parseIpv6);
  if (prefix[1] !== NAT64_PREFIX_LENGTH) {
    throw new Error(
      `Префикс NAT64 «${raw}»: поддерживается только /${NAT64_PREFIX_LENGTH} — при другой длине IPv4 ` +
        'лежит внутри адреса по RFC 6052, и судить его по последним байтам было бы ошибкой',
    );
  }
  return prefix;
}

/** `.Corp.Example.` → `corp.example`, `пример.рф` → `xn--e1afmkfd.xn--p1ai`; иначе — исключение. */
function normalizeSuffix(raw: string): string {
  const ascii = domainToASCII(raw.trim().replace(LEADING_DOTS, '').replace(TRAILING_DOTS, ''));
  if (!IP_ADDRESS_SYNTAX.nameSuffix.test(ascii)) {
    throw new Error(
      `Некорректная зона имени в списке запрещённых: «${raw}» (ожидается вида corp.example, без *)`,
    );
  }
  return ascii;
}

/**
 * Встроенная политика плюс дополнительные запреты. Разбирается при каждом
 * вызове с настройками (их немного, а кэш по объекту настроек не увидел бы
 * правку массива после первого вызова); `createGuardedLookup` разбирает один раз.
 */
export function compilePolicy(policy: NetGuardPolicy | undefined): CompiledPolicy {
  const subnets = policy?.extraBlockedSubnets ?? [];
  const suffixes = policy?.extraBlockedNameSuffixes ?? [];
  const nat64 = policy?.extraNat64Prefixes ?? [];
  if (subnets.length === 0 && suffixes.length === 0 && nat64.length === 0) {
    return BUILT_IN;
  }
  const ipv4 = [...BUILT_IN.ipv4];
  const ipv6 = [...BUILT_IN.ipv6];
  for (const raw of subnets) {
    const subnet = raw.trim();
    if (subnet.includes(':')) {
      ipv6.push(parseSubnet(subnet, parseIpv6));
    } else {
      ipv4.push(parseSubnet(subnet, parseIpv4));
    }
  }
  return {
    ipv4,
    ipv6,
    nameSuffixes: BUILT_IN.nameSuffixes,
    extraNameSuffixes: suffixes.map(normalizeSuffix),
    nat64: [...BUILT_IN.nat64, ...nat64.map(parseNat64Prefix)],
    globalUnicast: BUILT_IN.globalUnicast,
  };
}
