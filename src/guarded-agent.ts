import type { ClientRequestArgs, AgentOptions as HttpAgentOptions } from 'node:http';
import { Agent as HttpAgent } from 'node:http';
import type { AgentOptions as HttpsAgentOptions } from 'node:https';
import { Agent as HttpsAgent } from 'node:https';
import type { Duplex } from 'node:stream';

import { createConnectionGuard } from './connection-guard';
import type { ConnectionGuardOptions } from './connection-guard-options';
import { DEFAULT_PORT } from './constants/default-port.constant';
import { splitGuardOptions } from './split-guard-options';
import type { ConnectionGuard } from './types/connection-guard.type';

/** Настройки агента: обычные настройки `http(s).Agent` (кроме `lookup` — он свой) и защита. */
export type GuardedAgentOptions<T extends HttpAgentOptions> = Omit<T, 'lookup'> & ConnectionGuardOptions;

type ConnectCallback = (err: Error | null, stream: Duplex) => void;
type Connect = (options: ClientRequestArgs, callback?: ConnectCallback) => Duplex;

/** Хост по умолчанию у `net.connect`, когда хост не задан. */
const NET_DEFAULT_HOST = 'localhost';

/**
 * Общая часть `createConnection` обоих агентов. Повторяет ветвление самого
 * `net.connect`: есть `path` — unix-сокет (хост не смотрится) — отказ; хост —
 * литерал (`net` соединится БЕЗ `lookup`) — проверяется здесь, вместе с
 * портом; имя уходит в защищённый `lookup`, который настройками запроса не
 * подменить. Отказ — через колбэк агента (запрос получит `'error'` с
 * `BlockedDestinationError`), сокет не создаётся.
 */
function guardedConnect(
  guard: ConnectionGuard,
  defaultPort: number,
  options: ClientRequestArgs,
  callback: ConnectCallback | undefined,
  connect: Connect,
): Duplex {
  const error = options.path
    ? guard.refuseSocketPath(options.path)
    : guard.refuse(options.host || NET_DEFAULT_HOST, options.port, defaultPort);
  if (error === null) {
    return connect({ ...options, lookup: guard.lookup }, callback);
  }
  if (callback === undefined) {
    throw error;
  }
  // Асинхронно, как отказ резолвера: агент не ждёт колбэк до возврата.
  process.nextTick(() => (callback as (err: Error) => void)(error));
  // Агент `node:http` принимает сокет ЛИБО возвратом, ЛИБО колбэком; здесь — колбэком
  // с ошибкой, и возврат обязан быть пустым (иначе агент взял бы его как сокет).
  return undefined as unknown as Duplex;
}

/** Делит настройки на защиту и настройки агента; `lookup` агента — защищённый. */
function splitOptions<T extends HttpAgentOptions>(
  options: GuardedAgentOptions<T>,
): { guard: ConnectionGuard; agent: T } {
  const { guard: guardOptions, rest } = splitGuardOptions(options);
  // Опечатка в настройках — исключение при создании агента.
  const guard = createConnectionGuard(guardOptions);
  // `lookup` из настроек (если пришёл мимо типов) заменяется защищённым.
  return { guard, agent: { ...rest, lookup: guard.lookup } as unknown as T };
}

class GuardedHttpAgent extends HttpAgent {
  readonly #guard: ConnectionGuard;

  constructor(options: HttpAgentOptions, guard: ConnectionGuard) {
    super(options);
    this.#guard = guard;
  }

  override createConnection(options: ClientRequestArgs, callback?: ConnectCallback): Duplex {
    return guardedConnect(this.#guard, DEFAULT_PORT.http, options, callback, (guarded, done) =>
      super.createConnection(guarded, done),
    );
  }
}

class GuardedHttpsAgent extends HttpsAgent {
  readonly #guard: ConnectionGuard;

  constructor(options: HttpsAgentOptions, guard: ConnectionGuard) {
    super(options);
    this.#guard = guard;
  }

  override createConnection(options: ClientRequestArgs, callback?: ConnectCallback): Duplex {
    return guardedConnect(this.#guard, DEFAULT_PORT.https, options, callback, (guarded, done) =>
      super.createConnection(guarded, done),
    );
  }
}

/**
 * `http.Agent`, который не соединяется с непубличной целью НИ В КАКОЙ форме
 * хоста. `new http.Agent({ lookup: guardedLookup })` этого не даёт: для хоста-
 * литерала (`http://169.254.169.254/`, `http://127.0.0.1/`) `net` соединяется
 * БЕЗ `lookup`. Здесь литерал и порт проверяются в `createConnection`, имя —
 * через защищённый lookup (DNS-ребиндинг закрыт тем же ответом DNS),
 * `socketPath` — отказ.
 *
 * ```ts
 * const agent = createGuardedHttpAgent({ keepAlive: true });
 * http.get('http://169.254.169.254/', { agent }); // 'error': BlockedDestinationError
 * ```
 */
export function createGuardedHttpAgent(options: GuardedAgentOptions<HttpAgentOptions> = {}): HttpAgent {
  const { guard, agent } = splitOptions(options);
  return new GuardedHttpAgent(agent, guard);
}

/** То же для `https.Agent`: проверка до TCP-соединения, TLS не начинается. */
export function createGuardedHttpsAgent(options: GuardedAgentOptions<HttpsAgentOptions> = {}): HttpsAgent {
  const { guard, agent } = splitOptions(options);
  return new GuardedHttpsAgent(agent, guard);
}

/**
 * Пара агентов `http` и `https` с одной политикой. Клиенты с редиректами
 * (axios, got, follow-redirects) выбирают агент по протоколу ЦЕЛИ: защищён
 * только https — и редирект на `http://10.0.0.1/` уходит через глобальный
 * агент без защиты. Отдавайте клиенту оба.
 *
 * ```ts
 * const agents = createGuardedAgents();
 * axios.get(url, { httpAgent: agents.http, httpsAgent: agents.https, proxy: false });
 * got(url, { agent: agents });
 * ```
 */
export function createGuardedAgents(options: GuardedAgentOptions<HttpsAgentOptions> = {}): {
  readonly http: HttpAgent;
  readonly https: HttpsAgent;
} {
  return { http: createGuardedHttpAgent(options), https: createGuardedHttpsAgent(options) };
}
