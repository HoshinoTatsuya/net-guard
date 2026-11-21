import { deepFreeze } from '../deep-freeze';

/** На каком шаге защита отказала — поле `stage` события `onBlocked` и счётчиков `netGuardStats()`. */
export const BLOCK_STAGE = {
  /** Форма хоста: литерал непубличного адреса, внутренняя зона, имя без точки, мусор. */
  host: 'host',
  /** Имя разрешилось хотя бы в один непубличный адрес. */
  address: 'address',
  /** Имя не разрешилось ни в один адрес. */
  emptyAnswer: 'empty-answer',
  /** Порт цели вне разрешённых (`allowedPorts`). */
  port: 'port',
  /** Схема URL вне разрешённых (`allowedSchemes`). */
  scheme: 'scheme',
  /** Соединение через unix-сокет (`socketPath`). */
  socketPath: 'socket-path',
} as const;

deepFreeze(BLOCK_STAGE);
