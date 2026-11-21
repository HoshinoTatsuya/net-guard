import type { ClientRequestArgs } from 'node:http';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

import { compileProxyUrl } from './compile-proxy-url';
import { connectViaProxy } from './connect-via-proxy';
import { createConnectionGuard } from './connection-guard';
import { DEFAULT_PORT } from './constants/default-port.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { PROXY_TUNNEL } from './constants/proxy-tunnel.constant';
import { TIMER } from './constants/timer.constant';
import { requireInteger } from './require-integer';
import { splitGuardOptions } from './split-guard-options';
import type { GuardedProxyAgentOptions } from './types/guarded-proxy-options.type';

/**
 * Пара агентов `http`/`https`, которые ходят через HTTP-прокси, НЕ перенося
 * проверку с цели на прокси. Обычная настройка прокси (`HTTP_PROXY` у axios,
 * undici `ProxyAgent`) соединяется с прокси, и защита видит только его адрес —
 * цель уходит прокси строкой, и её не проверяет никто. Здесь цель проверяется
 * (хост, порт, все адреса из DNS), а прокси получает `CONNECT` на проверенный
 * литерал адреса; TLS к цели — поверх туннеля, с именем цели в SNI.
 *
 * ```ts
 * const agents = createGuardedProxyAgents({ proxy: 'http://proxy.corp.example:3128' });
 * axios.get(url, { httpAgent: agents.http, httpsAgent: agents.https, proxy: false });
 * ```
 *
 * Обычный HTTP тоже идёт туннелем (`CONNECT адрес:80`): прокси, разрешающий
 * CONNECT только на 443, такие запросы отвергнет — это видно ошибкой
 * `ERR_NET_GUARD_PROXY_TUNNEL_FAILED`, а не тихим обходом.
 */
export function createGuardedProxyAgents(options: GuardedProxyAgentOptions): {
  readonly http: HttpAgent;
  readonly https: HttpsAgent;
} {
  const { proxy, proxyConnectTimeoutMs, ...rest } = options;
  const proxyUrl = compileProxyUrl(proxy);
  const timeoutMs = requireInteger(
    'proxyConnectTimeoutMs',
    proxyConnectTimeoutMs ?? PROXY_TUNNEL.connectTimeoutMs,
    1,
    TIMER.maxDelayMs,
  );
  const { guard: guardOptions, rest: agentOptions } = splitGuardOptions(rest);
  const guard = createConnectionGuard(guardOptions);

  const tunnel = (
    options: ClientRequestArgs,
    callback: ((err: Error | null, stream: Duplex) => void) | undefined,
    tls: boolean,
  ): Duplex => {
    // Туннель асинхронный: сокет существует только после ответа прокси. Без
    // колбэка его некому отдать — прежде вызов возвращал undefined и всё равно
    // открывал туннель, который оставался висеть ничьим.
    if (typeof callback !== 'function') {
      throw new TypeError(
        'createGuardedProxyAgents: createConnection без колбэка не поддерживается — туннель через прокси ' +
          'асинхронный, сокет отдаётся только колбэком (так зовёт http.Agent)',
      );
    }
    const deliver = callback as (error: Error | null, socket: Duplex | null) => void;
    const host = options.host || 'localhost';
    const defaultPort = tls ? DEFAULT_PORT.https : DEFAULT_PORT.http;
    const refused = options.path
      ? guard.refuseSocketPath(options.path)
      : guard.refuse(host, options.port, defaultPort);
    if (refused !== null) {
      // Отказ до ввода-вывода — асинхронно, как отказ сокета: агент не ждёт колбэк до возврата.
      process.nextTick(deliver, refused, null);
      return undefined as unknown as Duplex;
    }
    const port = Number(options.port) || defaultPort;
    // Колбэк туннеля и так асинхронный (ответ прокси). Сокет отдаётся СРАЗУ, без
    // nextTick: между отдачей и подпиской вызывающего на 'error' не должно быть
    // хода, в котором уже прочитанный обрыв соединения выстрелит в пустоту.
    connectViaProxy(guard, proxyUrl, host, port, timeoutMs, (error, socket) => {
      if (error !== null || socket === null) {
        deliver(error, null);
        return;
      }
      if (!tls) {
        deliver(null, socket);
        return;
      }
      const name =
        (options as { servername?: string }).servername || host.replace(IP_ADDRESS_SYNTAX.brackets, '$1');
      const secure = tlsConnect({
        ...(options as Record<string, unknown>),
        socket,
        ...(isIP(name) === 0 ? { servername: name } : {}),
      });
      deliver(null, secure);
    });
    return undefined as unknown as Duplex;
  };

  class ProxyHttpAgent extends HttpAgent {
    override createConnection(
      connectOptions: ClientRequestArgs,
      callback?: (err: Error | null, stream: Duplex) => void,
    ): Duplex {
      return tunnel(connectOptions, callback, false);
    }
  }
  class ProxyHttpsAgent extends HttpsAgent {
    override createConnection(
      connectOptions: ClientRequestArgs,
      callback?: (err: Error | null, stream: Duplex) => void,
    ): Duplex {
      return tunnel(connectOptions, callback, true);
    }
  }
  return { http: new ProxyHttpAgent(agentOptions), https: new ProxyHttpsAgent(agentOptions) };
}
