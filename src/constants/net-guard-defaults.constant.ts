import { deepFreeze } from '../deep-freeze';

export const NET_GUARD_DEFAULTS = {
  /**
   * Потолок ожидания DNS. Резолвер по умолчанию (c-ares) по нему ОТМЕНЯЕТ
   * запрос. Системный (`resolver: 'system'`) — только отпускает вызывающего:
   * поток пула libuv занят до настоящего ответа getaddrinfo, поэтому у него
   * ещё и общий на процесс потолок одновременных поисков.
   */
  lookupTimeoutMs: 10_000,
  /**
   * Порты цели по умолчанию (`allowedPorts`): SSRF на внутренний порт
   * публичного адреса (Redis на :6379, панель на :8080) — тот же класс атак,
   * что и на внутренний адрес. Другие порты — явно, `'any'` — без проверки.
   */
  allowedPorts: [80, 443],
  /** Схемы URL по умолчанию (`allowedSchemes`) — безопасный fetch и `nonPublicUrlReason`. */
  allowedSchemes: ['http:', 'https:'],
  /** Безопасный fetch: редиректов не больше (каждый проверяется заново). */
  maxRedirects: 5,
  /** Безопасный fetch: потолок тела ответа, байт (10 МиБ). */
  maxResponseBytes: 10 * 1024 * 1024,
  /** Безопасный fetch: потолок всего запроса — редиректы и чтение тела, мс. */
  fetchTimeoutMs: 30_000,
} as const;

deepFreeze(NET_GUARD_DEFAULTS);
