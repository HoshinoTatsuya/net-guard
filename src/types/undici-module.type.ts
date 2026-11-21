/**
 * То, что пакету нужно от модуля undici: `Agent` и `buildConnector`
 * (структурно — зависимости от undici у пакета нет, модуль передаёт вызывающий).
 */
export interface UndiciModule<D> {
  readonly Agent: new (options: Record<string, unknown>) => D;
  readonly buildConnector: (options: never) => (options: never, callback: never) => unknown;
}
