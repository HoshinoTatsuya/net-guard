import type { BLOCK_STAGE } from '../constants/block-stage.constant';

/** Шаг, на котором защита отказала. */
export type BlockStage = (typeof BLOCK_STAGE)[keyof typeof BLOCK_STAGE];
