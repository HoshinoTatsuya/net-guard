/** Колбэк коннектора undici: ошибка или сокет. */
export type UndiciConnectCallback = (error: Error | null, socket: unknown) => void;
