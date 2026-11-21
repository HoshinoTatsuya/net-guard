import { deepFreeze } from '../deep-freeze';

/** Коды ошибок пакета (`error.code`) — для сравнения у потребителя. */
export const NET_GUARD_ERROR_CODE = {
  /** Отказ защиты: форма имени, непубличный адрес из DNS, пустой ответ, порт, схема, socketPath. */
  blockedDestination: 'ERR_NET_GUARD_BLOCKED_DESTINATION',
  /**
   * Системный резолвер (`getaddrinfo`) занят: одновременных поисков уже столько,
   * сколько пакет отдаёт им из пула потоков libuv, И очередь ждущих слота полна.
   * Сверх потолка поиск сначала ждёт слота (не в пуле libuv) до своего таймаута.
   */
  systemLookupBusy: 'ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY',
  /** Безопасный fetch: тело ответа длиннее потолка `maxResponseBytes`. */
  responseTooLarge: 'ERR_NET_GUARD_RESPONSE_TOO_LARGE',
  /** Безопасный fetch: цепочка редиректов длиннее `maxRedirects`. */
  tooManyRedirects: 'ERR_NET_GUARD_TOO_MANY_REDIRECTS',
  /** Безопасный fetch: запрос с редиректами и телом не уложился в `timeoutMs`. */
  fetchTimeout: 'ERR_NET_GUARD_FETCH_TIMEOUT',
  /** Прокси не открыл туннель (`CONNECT` ответил не 2xx) или ответил не по протоколу. */
  proxyTunnelFailed: 'ERR_NET_GUARD_PROXY_TUNNEL_FAILED',
} as const;

deepFreeze(NET_GUARD_ERROR_CODE);
