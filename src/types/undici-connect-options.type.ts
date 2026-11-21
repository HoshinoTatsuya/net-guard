/** Настройки соединения undici, которые смотрит защита (структурно: зависимости от undici нет). */
export interface UndiciConnectOptions {
  readonly hostname: string;
  readonly protocol?: string;
  readonly port?: string | number;
  readonly [key: string]: unknown;
}
