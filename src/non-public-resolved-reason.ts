import { classifyHost, hostPortMode } from './classify-host';
import { compilePolicy } from './compile-policy';
import { isBlockedAddress } from './is-blocked-ip';
import { lookupTimeoutMs } from './lookup-timeout-ms';
import { pickResolve } from './pick-resolve';
import { raceHostLookup } from './race-host-lookup';
import { resolveWithin } from './resolve-within';
import type { HostLookup } from './types/host-lookup.type';
import type { NonPublicHostOptions } from './types/net-guard-policy.type';
import { valueText } from './value-text';

/**
 * Проверка хоста ВМЕСТЕ с его адресами: сначала форма имени, затем каждый адрес,
 * в который оно разрешилось. Нужна там, где запрос уходит позже и не нами
 * (постановка задачи в очередь, сохранение цели), — одна проверка имени
 * пропустила бы `evil.example`, указывающий на 10.0.0.1.
 *
 * Литерал адреса (`8.8.8.8`, `[2606:4700::1111]`, голый `2606:4700::1111`) в
 * DNS не уходит — он уже проверен по форме. В резолвер уходит имя в
 * проверенном виде (нижний регистр, punycode).
 *
 * Резолвер по умолчанию — c-ares (`resolver: 'system'` — getaddrinfo под общим
 * потолком процесса); свой — вторым аргументом `lookup`.
 *
 * Отказ резолвера и пустой ответ — отказ: «не смогли разрешить» не означает
 * «публичный». Ограничение: DNS-ребиндинг между этой проверкой и соединением
 * она не закрывает — для него защищённый агент/коннектор HTTP-клиента или
 * проверка адреса установленного соединения (`isBlockedIp` на
 * `socket.remoteAddress`).
 */
export async function nonPublicResolvedReason(
  host: string,
  lookup?: HostLookup,
  options?: NonPublicHostOptions,
): Promise<string | null> {
  const policy = compilePolicy(options);
  const timeoutMs = lookupTimeoutMs(options?.lookupTimeoutMs);
  // Опечатка в выборе резолвера — исключение и при своём lookup.
  const resolve = pickResolve(options?.resolver === undefined ? {} : { resolver: options.resolver });
  const classified = classifyHost(host, policy, hostPortMode(options?.allowPort));
  if (classified.reason !== null) {
    return classified.reason;
  }
  if (classified.literal) {
    return null;
  }
  const { hostname } = classified;
  let addresses: ReadonlyArray<{ readonly address: string }>;
  try {
    addresses =
      lookup === undefined
        ? await resolveWithin(resolve, hostname, timeoutMs)
        : await raceHostLookup(lookup, hostname, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : valueText(error);
    return `имя «${hostname}» не разрешилось: ${message}`;
  }
  if (addresses.length === 0) {
    return `имя «${hostname}» не разрешилось ни в один адрес`;
  }
  const blocked = addresses.find(({ address }) => isBlockedAddress(address, policy));
  return blocked ? `имя «${hostname}» разрешается в непубличный адрес ${blocked.address}` : null;
}
