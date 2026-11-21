import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/** Встроенный резолвер: таймаут ОТМЕНЯЕТ запрос (c-ares), колбэк учитывается один раз. */
export function resolveWithin(
  resolve: ResolveAllAddresses,
  hostname: string,
  timeoutMs: number,
): Promise<ReadonlyArray<{ readonly address: string }>> {
  return new Promise((done, reject) => {
    let settled = false;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      settled = true;
      cancel?.();
      reject(new Error(`резолвер не ответил за ${timeoutMs} мс`));
    }, timeoutMs);
    try {
      cancel =
        resolve(hostname, { all: true, order: 'verbatim' }, (error, addresses) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (error) {
            reject(error);
          } else {
            done(addresses);
          }
        }) ?? undefined;
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}
