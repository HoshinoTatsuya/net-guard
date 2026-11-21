/** Потолки клиента с редиректами (axios, got). */
export interface GuardedClientLimits {
  /** Редиректов не больше (по умолчанию `NET_GUARD_DEFAULTS.maxRedirects`). */
  readonly maxRedirects?: number;
  /** Потолок тела ответа, байт (по умолчанию `NET_GUARD_DEFAULTS.maxResponseBytes`). */
  readonly maxResponseBytes?: number;
  /** Потолок запроса, мс (по умолчанию `NET_GUARD_DEFAULTS.fetchTimeoutMs`). */
  readonly timeoutMs?: number;
}
