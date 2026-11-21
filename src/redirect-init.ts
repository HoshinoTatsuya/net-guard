import { REDIRECT_HEADERS } from './constants/redirect-headers.constant';
import { isStreamBody } from './is-stream-body';

/**
 * Настройки следующего запроса после редиректа — по правилам fetch: 303 (и
 * 301/302 у POST) становятся GET без тела; на другой origin не уходят
 * учётные данные, `host` и заголовки из `sensitive`. Редирект, который требует
 * отправить тело-поток повторно (307/308), — `TypeError`, как у fetch: поток
 * уже прочитан, а запрос без тела был бы другим запросом.
 */
export function redirectInit(
  init: { method: string; headers: Headers; body: unknown },
  status: number,
  from: URL,
  to: URL,
  sensitive: readonly string[] = [],
): { method: string; headers: Headers; body: unknown } {
  const toGet =
    status === 303 ? init.method !== 'HEAD' : (status === 301 || status === 302) && init.method === 'POST';
  const headers = new Headers(init.headers);
  if (toGet) {
    for (const name of [
      'content-type',
      'content-length',
      'content-encoding',
      'content-language',
      'content-location',
    ]) {
      headers.delete(name);
    }
  }
  if (from.origin !== to.origin) {
    // Учётные данные на другой origin не уходят (как у браузера и fetch).
    for (const name of [...REDIRECT_HEADERS.crossOriginDropped, ...sensitive]) {
      headers.delete(name);
    }
  }
  if (!toGet && isStreamBody(init.body)) {
    throw new TypeError(
      `редирект ${status} на ${to.href} требует отправить тело запроса повторно, а тело — поток, ` +
        'уже прочитанный; передайте тело строкой/байтами/Blob или обработайте редирект сами (redirect: manual)',
    );
  }
  return toGet
    ? { method: 'GET', headers, body: undefined }
    : { method: init.method, headers, body: init.body };
}
