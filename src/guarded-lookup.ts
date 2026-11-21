import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';

import { BlockedDestinationError } from './blocked-destination.error';
import { classifyHost } from './classify-host';
import { compilePolicy } from './compile-policy';
import { BLOCK_STAGE } from './constants/block-stage.constant';
import { HOST_PORT_MODE } from './constants/host-port-mode.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { isBlockedAddress } from './is-blocked-ip';
import { lookupTimeoutMs } from './lookup-timeout-ms';
import { pickResolve } from './pick-resolve';
import { reportBlocked } from './report-blocked';
import type { DnsResolverKind } from './types/dns-resolver-kind.type';
import type { NetGuardPolicy } from './types/net-guard-policy.type';
import type { OnBlocked } from './types/on-blocked.type';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

export type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/** Колбэк `dns.lookup`: один адрес и семейство, либо массив при `all: true`. */
export type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Форма `dns.lookup` — годится как `lookup` в `net`/`tls`/`http(s).Agent` и undici `connect`. */
export interface GuardedLookupFunction {
  (hostname: string, options: LookupOptions | number, callback: LookupCallback): void;
  (hostname: string, callback: LookupCallback): void;
}

export interface GuardedLookupOptions extends NetGuardPolicy {
  /** Свой резолвер вместо встроенного (свой DNS, тесты без сети). Может вернуть отмену. */
  readonly resolve?: ResolveAllAddresses;
  /**
   * Встроенный резолвер: `'c-ares'` (по умолчанию; пул потоков не занимает,
   * таймаут отменяет запрос) или `'system'` (getaddrinfo: `/etc/hosts`,
   * nsswitch; поток пула занят до ответа, одновременных — не больше общего
   * потолка процесса). Вместе с `resolve` — исключение.
   */
  readonly resolver?: DnsResolverKind;
  /** Потолок ожидания резолвера, мс (`NET_GUARD_DEFAULTS.lookupTimeoutMs`); не ответил — ошибка `ETIMEOUT`. */
  readonly lookupTimeoutMs?: number;
  /** Хук аудита: каждый отказ защиты (см. `OnBlocked`). */
  readonly onBlocked?: OnBlocked;
}

/** Код ошибки резолвера, не ответившего за потолок, — как у `dns`. */
const LOOKUP_TIMEOUT_CODE = 'ETIMEOUT';

/** Отказ — одним аргументом, как у `dns.lookup`: адреса при ошибке нет. */
const fail = (callback: LookupCallback, error: NodeJS.ErrnoException): void => {
  (callback as (err: NodeJS.ErrnoException) => void)(error);
};

/** Ответ в форме, которую просили: массив при `all: true`, иначе первый адрес и семейство. */
const answer = (callback: LookupCallback, all: boolean, addresses: LookupAddress[]): void => {
  if (all) {
    callback(null, addresses);
    return;
  }
  const [first] = addresses;
  callback(null, first?.address ?? '', first?.family);
};

/**
 * `lookup` для HTTP-клиента, который проверяет ровно те адреса, с которыми
 * клиент СОЕДИНИТСЯ: разрешает имя во все адреса и отказывает, если ХОТЯ БЫ
 * ОДИН не публичный (а не «первый публичный — значит можно»). Так закрывается
 * DNS-ребиндинг между проверкой и соединением: второго разрешения, которое
 * злоумышленник мог бы подменить, нет.
 *
 * Резолвер по умолчанию — c-ares (`dns.Resolver`): пул потоков libuv он не
 * занимает, и таймаут ОТМЕНЯЕТ запрос. `dns.lookup` (getaddrinfo) — только
 * `resolver: 'system'`: его поток пула таймаут не освобождает.
 *
 * В резолвер уходит имя в том виде, в котором его проверили (WHATWG URL:
 * нижний регистр, punycode), а не сырая строка вызывающего. Литерал адреса в
 * DNS не уходит вовсе.
 *
 * Поддерживает `all: true` (его зовёт `net` при `autoSelectFamily`), `family`
 * (числом или в объекте), `hints`, `order` — они уходят в резолвер.
 * Отказ — `BlockedDestinationError` с кодом
 * `NET_GUARD_ERROR_CODE.blockedDestination`; ошибка резолвера отдаётся как
 * есть, синхронное исключение резолвера — тоже ошибкой в колбэк. Колбэк
 * зовётся ровно один раз.
 *
 * ВНИМАНИЕ: одного `lookup` в агенте МАЛО. Если хост запроса — литерал адреса
 * (`http://169.254.169.254/`), `net` соединяется без `lookup`, и эта функция
 * не вызывается вовсе. Для `node:http(s)` — `createGuardedHttpAgent` /
 * `createGuardedHttpsAgent`, для undici — `createGuardedConnect`, для http2 —
 * `createGuardedHttp2Connect`.
 */
export function createGuardedLookup(options: GuardedLookupOptions = {}): GuardedLookupFunction {
  // Опечатка в настройках — исключение здесь, при создании, а не на запросе.
  const policy = compilePolicy(options);
  const resolve = pickResolve(options);
  const timeoutMs = lookupTimeoutMs(options.lookupTimeoutMs);
  const { onBlocked } = options;

  const refuse = (callback: LookupCallback, error: BlockedDestinationError): void => {
    reportBlocked(error, onBlocked);
    fail(callback, error);
  };

  return function guardedLookup(
    hostname: string,
    optionsOrCallback: LookupOptions | number | LookupCallback,
    maybeCallback?: LookupCallback,
  ): void {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (typeof callback !== 'function') {
      throw new TypeError('guardedLookup: колбэк обязателен');
    }
    let requested: LookupOptions;
    if (typeof optionsOrCallback === 'function') {
      requested = {};
    } else if (typeof optionsOrCallback === 'number') {
      requested = { family: optionsOrCallback };
    } else {
      requested = optionsOrCallback ?? {};
    }
    const all = requested.all === true;

    // Имя от `net` порта не несёт; `[адрес]:порт` здесь — не имя, а отказ.
    const classified = classifyHost(hostname, policy, HOST_PORT_MODE.forbid);
    if (classified.reason !== null) {
      // Асинхронно, как у dns.lookup: вызывающий не ждёт колбэк до возврата.
      process.nextTick(refuse, callback, new BlockedDestinationError(hostname, classified.reason));
      return;
    }
    if (classified.literal) {
      // Литерал уже проверен по форме; резолверу (c-ares) он — не имя.
      const address = classified.hostname.replace(IP_ADDRESS_SYNTAX.brackets, '$1');
      process.nextTick(answer, callback, all, [{ address, family: isIP(address) }]);
      return;
    }
    const name = classified.hostname;

    let settled = false;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      settled = true;
      // Отменяемый резолвер (c-ares) снимает запрос; getaddrinfo — нет, его поток держит потолок.
      cancel?.();
      fail(
        callback,
        Object.assign(new Error(`резолвер не ответил за ${timeoutMs} мс: ${hostname}`), {
          code: LOOKUP_TIMEOUT_CODE,
          hostname,
        }),
      );
    }, timeoutMs);
    // Таймер не держит процесс: поздний ответ резолвера просто отбрасывается.
    timer.unref();

    const onAnswer = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        fail(callback, error);
        return;
      }
      if (!Array.isArray(addresses) || addresses.length === 0) {
        refuse(
          callback,
          new BlockedDestinationError(
            hostname,
            `имя «${name}» не разрешилось ни в один адрес`,
            undefined,
            BLOCK_STAGE.emptyAnswer,
          ),
        );
        return;
      }
      const blocked = addresses.find(({ address }) => isBlockedAddress(address, policy));
      if (blocked !== undefined) {
        refuse(
          callback,
          new BlockedDestinationError(
            hostname,
            `имя «${name}» разрешается в непубличный адрес ${blocked.address}`,
            blocked.address,
            BLOCK_STAGE.address,
          ),
        );
        return;
      }
      answer(callback, all, addresses);
    };

    try {
      cancel = resolve(name, { ...requested, all: true }, onAnswer) ?? undefined;
    } catch (error) {
      // Синхронное исключение резолвера — ошибка в колбэк, ровно одна: таймер снят.
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        process.nextTick(fail, callback, error as NodeJS.ErrnoException);
      }
    }
  };
}

/** `createGuardedLookup()` со встроенной политикой и резолвером c-ares. */
export const guardedLookup: GuardedLookupFunction = createGuardedLookup();
