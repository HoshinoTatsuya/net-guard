import type { AgentOptions, Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';

import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import type { GuardedAgentOptions } from './guarded-agent';
import { createGuardedAgents } from './guarded-agent';
import type { GuardedClientLimits } from './types/guarded-client-limits.type';

/**
 * Настройки got, при которых защита не обходится: агенты `http`/`https` (got
 * выбирает по протоколу цели, редиректы тоже), `http2: false` (http2 got
 * ведёт через свою обёртку мимо агентов), потолки редиректов и времени.
 * Потолка тела у got нет — для недоверенного ответа читайте тело потоком со
 * своим счётчиком или берите `createSafeFetch`.
 *
 * ```ts
 * const client = got.extend(guardedGotOptions());
 * ```
 *
 * Зависимости от got нет: это объект настроек. Проверено контрактом (форма,
 * защищённые агенты), на настоящем got — нет.
 */
export function guardedGotOptions(
  options: GuardedAgentOptions<AgentOptions> & Omit<GuardedClientLimits, 'maxResponseBytes'> = {},
): {
  readonly agent: { readonly http: HttpAgent; readonly https: HttpsAgent };
  readonly http2: false;
  readonly maxRedirects: number;
  readonly timeout: { readonly request: number };
} {
  const { maxRedirects, timeoutMs, ...agentOptions } = options;
  return {
    agent: createGuardedAgents(agentOptions),
    http2: false,
    maxRedirects: maxRedirects ?? NET_GUARD_DEFAULTS.maxRedirects,
    timeout: { request: timeoutMs ?? NET_GUARD_DEFAULTS.fetchTimeoutMs },
  };
}
