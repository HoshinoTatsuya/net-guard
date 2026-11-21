import { BLOCK_STAGE } from './constants/block-stage.constant';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import type { BlockStage } from './types/block-stage.type';

/**
 * Отказ защиты: соединение не устанавливалось. Совместим с
 * `NodeJS.ErrnoException` — сокет и HTTP-клиент отдают его в `'error'` как есть.
 */
export class BlockedDestinationError extends Error {
  readonly code = NET_GUARD_ERROR_CODE.blockedDestination;
  /** Имя, которое просили разрешить (или литерал адреса, или путь unix-сокета). */
  readonly hostname: string;
  /** Причина — та же формулировка, что у `nonPublicHostReason`. */
  readonly reason: string;
  /** Непубличный адрес из ответа DNS, если отказ по адресу. */
  readonly address: string | undefined;
  /** Шаг отказа. */
  readonly stage: BlockStage;

  constructor(hostname: string, reason: string, address?: string, stage: BlockStage = BLOCK_STAGE.host) {
    super(`соединение с «${hostname}» запрещено: ${reason}`);
    this.name = 'BlockedDestinationError';
    this.hostname = hostname;
    this.reason = reason;
    this.address = address;
    this.stage = stage;
  }
}
