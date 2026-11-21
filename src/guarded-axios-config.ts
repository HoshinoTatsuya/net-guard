import type { AgentOptions, Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';

import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import type { GuardedAgentOptions } from './guarded-agent';
import { createGuardedAgents } from './guarded-agent';
import type { GuardedClientLimits } from './types/guarded-client-limits.type';

/**
 * Настройки axios, при которых защита не обходится: пара защищённых агентов
 * (axios и follow-redirects выбирают агент по протоколу ЦЕЛИ — редирект на
 * `http://` идёт через `httpAgent`), `proxy: false` (иначе axios читает
 * `HTTP_PROXY`/`HTTPS_PROXY` и соединяется с прокси — проверка переезжает с
 * цели на прокси), потолки редиректов, тела и времени.
 *
 * ```ts
 * const client = axios.create(guardedAxiosConfig({ extraBlockedSubnets: ['10.200.0.0/16'] }));
 * ```
 *
 * Зависимости от axios нет: это объект настроек. Проверено контрактом (форма,
 * защищённые агенты), на настоящем axios — нет.
 */
export function guardedAxiosConfig(options: GuardedAgentOptions<AgentOptions> & GuardedClientLimits = {}): {
  readonly httpAgent: HttpAgent;
  readonly httpsAgent: HttpsAgent;
  readonly proxy: false;
  readonly maxRedirects: number;
  readonly maxContentLength: number;
  readonly maxBodyLength: number;
  readonly timeout: number;
} {
  const { maxRedirects, maxResponseBytes, timeoutMs, ...agentOptions } = options;
  const agents = createGuardedAgents(agentOptions);
  const maxBytes = maxResponseBytes ?? NET_GUARD_DEFAULTS.maxResponseBytes;
  return {
    httpAgent: agents.http,
    httpsAgent: agents.https,
    proxy: false,
    maxRedirects: maxRedirects ?? NET_GUARD_DEFAULTS.maxRedirects,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    timeout: timeoutMs ?? NET_GUARD_DEFAULTS.fetchTimeoutMs,
  };
}
