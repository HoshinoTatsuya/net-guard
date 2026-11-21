import type { UndiciConnectCallback } from './undici-connect-callback.type';
import type { UndiciConnectOptions } from './undici-connect-options.type';

/** Коннектор undici: `buildConnector(...)` и опция `connect` у `Agent`/`Pool`/`Client`. */
export type UndiciConnector = (options: UndiciConnectOptions, callback: UndiciConnectCallback) => unknown;
