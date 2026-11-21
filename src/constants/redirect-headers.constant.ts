/** Заголовки при редиректе на другой origin. */
export const REDIRECT_HEADERS = {
  /** Не уходят на другой origin никогда (как у undici): учётные данные и `host` исходного запроса. */
  crossOriginDropped: ['authorization', 'cookie', 'proxy-authorization', 'host'],
} as const;
