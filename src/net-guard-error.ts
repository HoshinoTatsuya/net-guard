/** Ошибка пакета с кодом из `NET_GUARD_ERROR_CODE` (не отказ защиты — потолок, тайм-аут, прокси). */
export function netGuardError(code: string, message: string, cause?: unknown): NodeJS.ErrnoException {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}
