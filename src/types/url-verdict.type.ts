import type { BlockStage } from './block-stage.type';

/** Отказ проверки URL: шаг и причина (null у проверки — URL допустим). */
export interface UrlVerdict {
  readonly stage: BlockStage;
  readonly reason: string;
  /** Хост цели (или весь URL, если он не разобрался). */
  readonly target: string;
}
