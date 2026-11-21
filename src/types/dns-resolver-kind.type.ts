import type { DNS_RESOLVER } from '../constants/dns-resolver.constant';

/** Значение опции `resolver`: `'c-ares'` (по умолчанию) или `'system'`. */
export type DnsResolverKind = (typeof DNS_RESOLVER)[keyof typeof DNS_RESOLVER];
