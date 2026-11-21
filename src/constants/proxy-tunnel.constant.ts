/** Туннель через прокси (`CONNECT`): потолки ответа и ожидания. */
export const PROXY_TUNNEL = {
  /** Заголовок ответа прокси длиннее — не HTTP-прокси, отказ. */
  maxResponseHeadBytes: 16 * 1024,
  /** Ожидание туннеля по умолчанию, мс. */
  connectTimeoutMs: 10_000,
} as const;
