import type { BlockStage } from './block-stage.type';

/** Изменяемое состояние пакета на процесс: счётчики отказов и системных поисков. */
export interface NetGuardState {
  /** Отказы защиты по шагам. */
  readonly blocked: Map<BlockStage, number>;
  /** Системных поисков (`getaddrinfo`) сейчас в пуле libuv — до НАСТОЯЩЕГО ответа, а не до таймаута. */
  systemInFlight: number;
  /** Системных поисков отказано сверх потолка (очередь ожидания полна). */
  systemRefused: number;
  /**
   * Поиски, ждущие слота: получают освобождённый слот по очереди. Поле
   * необязательное — состояние могла создать копия пакета старше 0.7.0.
   */
  systemWaiting?: Array<(release: () => void) => void>;
}
