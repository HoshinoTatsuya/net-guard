import type { BlockedEvent } from './blocked-event.type';

/**
 * Хук аудита: зовётся на КАЖДЫЙ отказ защиты, до ошибки запроса. Исключение
 * хука отказ не отменяет и запрос не роняет — оно уходит предупреждением
 * процесса (`process.emitWarning`).
 */
export type OnBlocked = (event: BlockedEvent) => void;
