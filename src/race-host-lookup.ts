import type { HostLookup } from './types/host-lookup.type';

/** Свой `lookup` вызывающего: отменить его нельзя — таймаут только отпускает ожидание. */
export function raceHostLookup(
  lookup: HostLookup,
  hostname: string,
  timeoutMs: number,
): Promise<ReadonlyArray<{ readonly address: string }>> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    lookup(hostname),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`резолвер не ответил за ${timeoutMs} мс`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
