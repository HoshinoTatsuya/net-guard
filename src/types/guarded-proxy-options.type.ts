import type { AgentOptions } from 'node:https';

import type { ConnectionGuardOptions } from '../connection-guard-options';

/** Настройки агентов за прокси: прокси, защита цели и обычные настройки агента. */
export type GuardedProxyAgentOptions = Omit<AgentOptions, 'lookup'> &
  ConnectionGuardOptions & {
    /** HTTP-прокси с `CONNECT`: `http://[user:pass@]хост:порт`. Сам прокси защитой не проверяется — его задаёт вызывающий. */
    readonly proxy: string | URL;
    /** Ожидание туннеля, мс (по умолчанию 10 000). */
    readonly proxyConnectTimeoutMs?: number;
  };
