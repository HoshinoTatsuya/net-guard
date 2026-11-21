import type { LookupAddress } from 'node:dns';
import { isIP, type Socket } from 'node:net';

import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { openProxyTunnel } from './open-proxy-tunnel';
import type { ConnectionGuard } from './types/connection-guard.type';

/**
 * Соединение с целью через прокси: имя разрешает ЗАЩИЩЁННЫЙ lookup (все
 * адреса проверены), прокси получает `CONNECT` на проверенный литерал — сам он
 * имя не разрешает, и подменить ответ DNS между проверкой и соединением нечем.
 * Проверку хоста и порта вызывающий делает до (`guard.refuse`).
 *
 * Адреса пробуются по порядку ответа DNS: прокси ОТКАЗАЛ в туннеле к адресу
 * (502 на IPv6, которого у прокси нет, 403 по его политике) — следующий адрес
 * той же проверенной выборки. Прокси недоступен или молчит — отказ сразу:
 * дело не в адресе цели, и перебор только умножил бы ожидание.
 */
export function connectViaProxy(
  guard: ConnectionGuard,
  proxy: URL,
  host: string,
  port: number,
  timeoutMs: number,
  callback: (error: Error | null, socket: Socket | null) => void,
): void {
  const literal = host.replace(IP_ADDRESS_SYNTAX.brackets, '$1');
  if (isIP(literal) !== 0) {
    openProxyTunnel(proxy, literal, port, timeoutMs, callback);
    return;
  }
  guard.lookup(host, { all: true }, (error, addresses) => {
    const candidates = (addresses ?? []) as LookupAddress[];
    if (error !== null || candidates.length === 0) {
      callback(error ?? new Error(`имя «${host}» не разрешилось`), null);
      return;
    }
    const attempt = (index: number): void => {
      const candidate = candidates[index] as LookupAddress;
      openProxyTunnel(proxy, candidate.address, port, timeoutMs, (tunnelError, socket, refusedByProxy) => {
        if (tunnelError !== null && refusedByProxy === true && index + 1 < candidates.length) {
          attempt(index + 1);
          return;
        }
        callback(tunnelError, socket);
      });
    };
    attempt(0);
  });
}
