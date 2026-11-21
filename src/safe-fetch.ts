import { BlockedDestinationError } from './blocked-destination.error';
import { compileUrlCheck } from './compile-url-check';
import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { NULL_BODY_STATUSES } from './constants/null-body-statuses.constant';
import { TIMER } from './constants/timer.constant';
import { limitResponseBody } from './limit-response-body';
import { netGuardError } from './net-guard-error';
import { redirectInit } from './redirect-init';
import { reportBlocked } from './report-blocked';
import { requireInteger } from './require-integer';
import type { FetchLike } from './types/fetch-like.type';
import type { FetchResponseLike } from './types/fetch-response-like.type';
import type { SafeFetch } from './types/safe-fetch.type';
import type { SafeFetchOptions } from './types/safe-fetch-options.type';
import { valueText } from './value-text';

export type { SafeFetch } from './types/safe-fetch.type';

/**
 * `fetch`, у которого SSRF закрыт не только по адресу: КАЖДЫЙ редирект
 * проверяется заново (схема, порт, хост) до запроса, редиректов не больше
 * `maxRedirects`, тело ответа не длиннее `maxResponseBytes`, весь запрос — с
 * редиректами и чтением тела — не дольше `timeoutMs`. Соединение — через
 * защищённый dispatcher (имя → адреса, DNS-ребиндинг, литералы).
 *
 * ```ts
 * import * as undici from 'undici';
 * const safeFetch = createSafeFetch({ dispatcher: createGuardedDispatcher(undici), fetch: undici.fetch });
 * const response = await safeFetch(userUrl); // BlockedDestinationError / ERR_NET_GUARD_* — отказ
 * ```
 *
 * Отказы: `BlockedDestinationError` (URL или редирект), `ERR_NET_GUARD_TOO_MANY_REDIRECTS`,
 * `ERR_NET_GUARD_RESPONSE_TOO_LARGE` (при чтении тела или сразу по `content-length`),
 * `ERR_NET_GUARD_FETCH_TIMEOUT`. `redirect: 'manual'` в запросе — редирект
 * отдаётся как есть, `'error'` — редирект становится ошибкой.
 *
 * Реализация fetch, прячущая редирект (`type: 'opaqueredirect'`, статус 0, как
 * в браузере), — `TypeError`: ни проверить, ни пройти такой редирект нельзя,
 * а отдать его ответом значило бы молча вернуть пустоту. Таймер `timeoutMs` не
 * держит процесс после отдачи ответа: тело, которое не читают, не мешает выйти.
 */
export function createSafeFetch(options: SafeFetchOptions): SafeFetch {
  if (options.dispatcher === undefined || options.dispatcher === null) {
    throw new Error(
      'createSafeFetch: нужен защищённый dispatcher (createGuardedDispatcher) — проверка URL видит только ' +
        'форму хоста, а имя во внутренний адрес и DNS-ребиндинг закрывает коннектор соединения',
    );
  }
  const check = compileUrlCheck(options);
  const maxRedirects = requireInteger(
    'maxRedirects',
    options.maxRedirects ?? NET_GUARD_DEFAULTS.maxRedirects,
    0,
    100,
  );
  const maxBytes = requireInteger(
    'maxResponseBytes',
    options.maxResponseBytes ?? NET_GUARD_DEFAULTS.maxResponseBytes,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const timeoutMs = requireInteger(
    'timeoutMs',
    options.timeoutMs ?? NET_GUARD_DEFAULTS.fetchTimeoutMs,
    1,
    TIMER.maxDelayMs,
  );
  const { dispatcher, onBlocked } = options;
  const sensitive = (options.sensitiveHeaders ?? []).map((name) => {
    // Некорректное имя заголовка — исключение здесь, а не молча неудалённый токен.
    try {
      new Headers([[name, '']]);
    } catch {
      throw new Error(`createSafeFetch: sensitiveHeaders — «${valueText(name)}» не имя заголовка`);
    }
    return name.toLowerCase();
  });
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as FetchLike);

  return async (input, init = {}) => {
    const timeout = netGuardError(
      NET_GUARD_ERROR_CODE.fetchTimeout,
      `запрос не уложился в ${timeoutMs} мс (timeoutMs) — с редиректами и чтением тела`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    const mapError = (error: unknown): unknown => (controller.signal.reason === timeout ? timeout : error);
    let url = new URL(input instanceof URL ? input.href : input);
    let request: { method: string; headers: Headers; body: unknown } = {
      method: (init.method ?? 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      body: init.body,
    };
    try {
      for (let redirects = 0; ; redirects++) {
        const verdict = check(url);
        if (verdict !== null) {
          const error = new BlockedDestinationError(verdict.target, verdict.reason, undefined, verdict.stage);
          reportBlocked(error, onBlocked);
          throw error;
        }
        let response: FetchResponseLike;
        try {
          response = await fetchImpl(url, { ...init, ...request, redirect: 'manual', signal, dispatcher });
        } catch (error) {
          throw mapError(error);
        }
        if (response.type === 'opaqueredirect' && init.redirect !== 'manual') {
          throw new TypeError(
            'реализация fetch спрятала редирект (opaqueredirect): адрес не виден, проверить и пройти его ' +
              'нельзя — нужна реализация с настоящим статусом и Location (undici, глобальный fetch Node)',
          );
        }
        const location = response.headers.get('location');
        if (
          [301, 302, 303, 307, 308].includes(response.status) &&
          location !== null &&
          init.redirect !== 'manual'
        ) {
          await response.body?.cancel().catch(() => undefined);
          if (init.redirect === 'error') {
            throw new TypeError(`редирект ${response.status} при redirect: 'error'`);
          }
          if (redirects >= maxRedirects) {
            throw netGuardError(
              NET_GUARD_ERROR_CODE.tooManyRedirects,
              `редиректов больше ${maxRedirects} (maxRedirects); последний — на ${location}`,
            );
          }
          const next = new URL(location, url);
          request = redirectInit(request, response.status, url, next, sensitive);
          url = next;
          continue;
        }
        // Ответ без тела — раньше проверки content-length: у HEAD и 304 он называет длину
        // представления, которого в ответе нет, и потолок тела к нему неприменим.
        if (
          response.body === null ||
          NULL_BODY_STATUSES.includes(response.status) ||
          request.method === 'HEAD'
        ) {
          await response.body?.cancel().catch(() => undefined);
          clearTimeout(timer);
          const bodyless =
            response.body === null
              ? (response as Response)
              : new Response(null, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers as Headers,
                });
          // Каждый переход — отдельный запрос с redirect: 'manual': адрес и признак редиректа —
          // свои. Собранному заново ответу — всегда; ответу реализации — если был редирект.
          if (bodyless !== response || (redirects > 0 && Object.isExtensible(bodyless))) {
            Object.defineProperties(bodyless, {
              url: { value: url.href },
              redirected: { value: redirects > 0 },
            });
          }
          return bodyless;
        }
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw netGuardError(
            NET_GUARD_ERROR_CODE.responseTooLarge,
            `тело ответа ${declared} байт длиннее потолка ${maxBytes} (maxResponseBytes)`,
          );
        }
        const limited = new Response(
          limitResponseBody(response.body as ReadableStream<Uint8Array>, maxBytes, mapError, () =>
            clearTimeout(timer),
          ),
          { status: response.status, statusText: response.statusText, headers: response.headers as Headers },
        );
        // Ответ собран заново (ради потолка тела) — адрес и признак редиректа переносятся.
        Object.defineProperties(limited, {
          url: { value: url.href },
          redirected: { value: redirects > 0 },
        });
        // Дальше таймер стережёт только чтение тела: процесс, бросивший тело, он не держит.
        timer.unref();
        return limited;
      }
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  };
}
