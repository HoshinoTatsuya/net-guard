import type { FetchLike } from './fetch-like.type';
import type { OnBlocked } from './on-blocked.type';
import type { UrlCheckOptions } from './url-check-options.type';

/** Настройки безопасного fetch. */
export interface SafeFetchOptions extends UrlCheckOptions {
  /**
   * Защищённый dispatcher undici (`createGuardedDispatcher`) — ОБЯЗАТЕЛЕН:
   * проверка URL смотрит только форму хоста, а имя, разрешающееся во
   * внутренний адрес, и DNS-ребиндинг закрывает коннектор соединения.
   */
  readonly dispatcher: unknown;
  /** `fetch` (по умолчанию глобальный); dispatcher должен быть ему совместим. */
  readonly fetch?: FetchLike;
  /** Редиректов не больше (по умолчанию `NET_GUARD_DEFAULTS.maxRedirects`). */
  readonly maxRedirects?: number;
  /** Потолок тела ответа, байт (по умолчанию `NET_GUARD_DEFAULTS.maxResponseBytes`). */
  readonly maxResponseBytes?: number;
  /** Потолок всего запроса — редиректы и чтение тела, мс (`NET_GUARD_DEFAULTS.fetchTimeoutMs`). */
  readonly timeoutMs?: number;
  /**
   * Заголовки, которые НЕ уходят на другой origin при редиректе, — вдобавок к
   * встроенным (`authorization`, `cookie`, `proxy-authorization`, `host`):
   * свои токены (`x-api-key`, `x-auth-token`), которых fetch не знает.
   * Регистр не важен; некорректное имя — исключение при создании.
   */
  readonly sensitiveHeaders?: readonly string[];
  /** Хук аудита: отказ проверки URL (первого и каждого редиректа). */
  readonly onBlocked?: OnBlocked;
}
