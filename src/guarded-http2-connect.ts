import type { SecureClientSessionOptions } from 'node:http2';
import { connect as http2Connect } from 'node:http2';
import { isIP, connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { createConnectionGuard } from './connection-guard';
import type { ConnectionGuardOptions } from './connection-guard-options';
import { DEFAULT_PORT } from './constants/default-port.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import type { GuardedHttp2Connect } from './types/guarded-http2-connect.type';

export type { GuardedHttp2Connect } from './types/guarded-http2-connect.type';

/**
 * `http2.connect`, который не соединяется с непубличной целью: клиенты
 * `node:http2` идут мимо агентов `http(s)`, и литерал адреса (`https://[::1]/`)
 * `net` соединяет без lookup. Здесь хост и порт сессии проверяются до сокета,
 * имя разрешает защищённый lookup (DNS-ребиндинг закрыт тем же ответом DNS).
 * Отказ по форме хоста, литералу или порту — `BlockedDestinationError`
 * исключением из вызова; имя, разрешившееся во внутренний адрес, — `'error'`
 * сессии с тем же отказом. Соединения нет ни в одном случае.
 *
 * ```ts
 * const connect = createGuardedHttp2Connect({ extraBlockedSubnets: ['10.200.0.0/16'] });
 * const session = connect('https://api.example.com');
 * ```
 *
 * Сессия http2 — одно TCP-соединение на все её запросы, поэтому проверка на
 * сессию и есть проверка на запрос: `session.request({ ':authority': '10.0.0.1' })`
 * уходит по тому же соединению к уже проверенному серверу, а не к 10.0.0.1
 * (замер: одно соединение у сервера на запросы с разными `:authority`).
 * Слияния соединений (`ORIGIN`, общий сертификат) клиент `node:http2` не делает:
 * новой цели — новый вызов, и он проверяется. Чего защита не видит — что
 * проверенный сервер сам сделает с чужим `:authority` (обратный прокси за ним);
 * это так же для `Host` в HTTP/1.1.
 */
export function createGuardedHttp2Connect(options: ConnectionGuardOptions = {}): GuardedHttp2Connect {
  const guard = createConnectionGuard(options);
  return (authority, sessionOptions = {}, listener) => {
    const url = authority instanceof URL ? authority : new URL(authority);
    const https = url.protocol === 'https:';
    const defaultPort = https ? DEFAULT_PORT.https : DEFAULT_PORT.http;
    // Форма хоста, литерал и порт известны до сессии: отказ — исключением здесь.
    // Подставной сокет с ошибкой не годится: сессия http2 успевает сказать 'connect'.
    const refused = guard.refuse(url.hostname, url.port, defaultPort);
    if (refused !== null) {
      throw refused;
    }
    const host = url.hostname.replace(IP_ADDRESS_SYNTAX.brackets, '$1');
    const port = Number(url.port) || defaultPort;
    return http2Connect(
      url,
      {
        ...sessionOptions,
        // Имя разрешает защищённый lookup: во внутренний адрес — 'error' сессии до соединения.
        createConnection: (_url: URL, connectOptions: SecureClientSessionOptions) =>
          https
            ? tlsConnect({
                ...connectOptions,
                host,
                port,
                // SNI — только имя; у литерала адреса его нет.
                ...(isIP(host) === 0 ? { servername: host } : {}),
                ALPNProtocols: ['h2'],
                lookup: guard.lookup,
              })
            : netConnect({ host, port, lookup: guard.lookup }),
      },
      listener,
    );
  };
}
