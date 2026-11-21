import type { BlockStage } from './block-stage.type';

/** Снимок счётчиков пакета на процесс (`netGuardStats()`). */
export interface NetGuardStats {
  /** Отказы защиты с начала процесса — по шагам; шагов без отказов здесь нет. */
  readonly blocked: Readonly<Partial<Record<BlockStage, number>>>;
  /** Системные поиски (`resolver: 'system'`). */
  readonly systemLookups: {
    /** Сейчас в пуле libuv (до настоящего ответа getaddrinfo, а не до таймаута). */
    readonly inFlight: number;
    /** Потолок одновременных — из `UV_THREADPOOL_SIZE`. */
    readonly limit: number;
    /** Ждут слота в очереди пакета (не в пуле libuv). */
    readonly waiting: number;
    /** Отказано с начала процесса: очередь ожидания была полна (`SYSTEM_LOOKUP.maxWaiting`). */
    readonly refused: number;
  };
}
