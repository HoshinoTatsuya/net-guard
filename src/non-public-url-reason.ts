import { compileUrlCheck } from './compile-url-check';
import type { UrlCheckOptions } from './types/url-check-options.type';

/**
 * Почему URL — не публичная цель, или null. Схема (по умолчанию http/https),
 * порт (по умолчанию 80/443 — SSRF на внутренний порт публичного хоста) и хост
 * (как у `nonPublicHostReason`). Разбор — только WHATWG URL.
 *
 * ```ts
 * nonPublicUrlReason('http://example.com:6379/'); // 'порт 6379 вне разрешённых (80, 443) …'
 * nonPublicUrlReason('file:///etc/passwd');        // 'схема file: вне разрешённых …'
 * ```
 *
 * DNS здесь не спрашивается: проверка имени по адресам — `nonPublicResolvedReason`
 * или защищённое соединение.
 */
export function nonPublicUrlReason(url: string | URL, options?: UrlCheckOptions): string | null {
  return compileUrlCheck(options)(url)?.reason ?? null;
}
