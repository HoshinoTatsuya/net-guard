import { lookup as dnsLookup, type LookupAddress } from 'node:dns';

import { acquireSystemLookup } from './acquire-system-lookup';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { SYSTEM_LOOKUP } from './constants/system-lookup.constant';
import { netGuardState } from './net-guard-state';
import { systemLookupLimit } from './system-lookup-limit';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/**
 * `dns.lookup` (getaddrinfo) под общим на процесс потолком. Поток пула libuv
 * занят до НАСТОЯЩЕГО ответа getaddrinfo — таймаут вызывающего его не
 * освобождает, отмены нет. Поэтому слот возвращается только на ответе.
 *
 * Сверх потолка поиск ЖДЁТ слота в очереди пакета — не в пуле libuv: ожидание
 * потока не занимает, а таймаут вызывающего снимает его из очереди (отмена).
 * Прежде (до 0.7.0) отказ был немедленным, и при потолке 1 (пул по умолчанию)
 * два одновременных быстрых поиска уже не проходили. Немедленный
 * `ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY` — только когда ждущих больше
 * `SYSTEM_LOOKUP.maxWaiting`.
 */
export const systemResolve: ResolveAllAddresses = (hostname, options, callback) => {
  const run = (release: () => void): void => {
    try {
      dnsLookup(hostname, options, (error, addresses) => {
        release();
        callback(error, addresses as LookupAddress[]);
      });
    } catch (error) {
      release();
      callback(error as NodeJS.ErrnoException, []);
    }
  };
  const limit = systemLookupLimit();
  const release = acquireSystemLookup(limit);
  if (release !== null) {
    // Синхронное исключение dns.lookup — как раньше, исключением: вызывающий ловит его сам.
    try {
      dnsLookup(hostname, options, (error, addresses) => {
        release();
        callback(error, addresses as LookupAddress[]);
      });
    } catch (error) {
      release();
      throw error;
    }
    return undefined;
  }
  const state = netGuardState();
  state.systemWaiting ??= [];
  const waiting = state.systemWaiting;
  if (waiting.length >= SYSTEM_LOOKUP.maxWaiting) {
    state.systemRefused++;
    const busy = Object.assign(
      new Error(
        `системный резолвер занят: ${state.systemInFlight} поиска(ов) ждут ответа getaddrinfo ` +
          `(потолок ${limit} при UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? 4}) и ещё ` +
          `${waiting.length} ждут слота: ${hostname}`,
      ),
      { code: NET_GUARD_ERROR_CODE.systemLookupBusy, hostname },
    );
    process.nextTick(callback, busy, []);
    return undefined;
  }
  // Слот придёт с ответом чужого поиска — асинхронно, из его колбэка.
  waiting.push(run);
  return () => {
    const index = waiting.indexOf(run);
    if (index >= 0) {
      waiting.splice(index, 1);
    }
  };
};
