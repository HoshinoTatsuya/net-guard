import type { LookupAddress, LookupAllOptions } from 'node:dns';

/**
 * Резолвер, отдающий ВСЕ адреса (форма `dns.lookup` с `all: true`). Может
 * вернуть функцию отмены: её зовут, когда ответ больше не нужен (таймаут), —
 * так отменяемый резолвер (c-ares) освобождает запрос, а не только вызывающего.
 */
export type ResolveAllAddresses = (
  hostname: string,
  options: LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
  // biome-ignore lint/suspicious/noConfusingVoidType: резолвер потребителя без отмены объявлен как возвращающий void — он обязан подходить
) => (() => void) | undefined | void;
