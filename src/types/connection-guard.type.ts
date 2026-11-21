import type { BlockedDestinationError } from '../blocked-destination.error';
import type { GuardedLookupFunction } from '../guarded-lookup';

/** Проверка цели соединения — общая для агентов, коннектора undici, http2 и прокси. */
export interface ConnectionGuard {
  /** Защищённый lookup: имя проверяется ответом DNS, по которому соединятся. */
  readonly lookup: GuardedLookupFunction;
  /**
   * Отказ цели (форма хоста, литерал, порт) или null. Отказ уже учтён: счётчик
   * и хук `onBlocked`. Пустой порт — порт протокола по умолчанию.
   */
  refuse(
    host: string,
    port: number | string | null | undefined,
    defaultPort: number,
  ): BlockedDestinationError | null;
  /** Отказ соединения через unix-сокет: хост при нём не смотрится вовсе. */
  refuseSocketPath(path: string): BlockedDestinationError;
}
