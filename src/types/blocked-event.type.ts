import type { BlockStage } from './block-stage.type';

/** Событие аудита: защита отказала соединению или запросу (`onBlocked`). */
export interface BlockedEvent {
  /** Шаг отказа. */
  readonly stage: BlockStage;
  /** Цель так, как её просили: имя, литерал адреса или путь unix-сокета. */
  readonly target: string;
  /** Причина — та же формулировка, что у `nonPublicHostReason` / `BlockedDestinationError.reason`. */
  readonly reason: string;
  /** Непубличный адрес из ответа DNS, если отказ по адресу. */
  readonly address: string | undefined;
}
