import { isIPv6, connect as netConnect, type Socket } from 'node:net';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { PROXY_TUNNEL } from './constants/proxy-tunnel.constant';
import { netGuardError } from './net-guard-error';

/**
 * Туннель `CONNECT адрес:порт` через HTTP-прокси. Цель — ЛИТЕРАЛ адреса, уже
 * проверенный защитой: прокси не разрешает имя сам, и DNS-ребиндинг между
 * проверкой и соединением прокси закрыт. Учётные данные — из `user:pass@` в
 * адресе прокси (`Proxy-Authorization: Basic`). Ответ не 2xx, мусор вместо
 * HTTP, обрыв или таймаут — `ERR_NET_GUARD_PROXY_TUNNEL_FAILED`. Колбэк — один раз;
 * третий аргумент колбэка — `true`, если прокси ОТВЕТИЛ отказом (не 2xx): до
 * прокси достучались, не сложилось с этой целью — другой адрес той же цели
 * имеет смысл попробовать.
 *
 * Ответ прокси читается в режиме paused (`'readable'` + `read()`), а байты за
 * концом заголовка возвращаются в буфер сокета ПОСЛЕ снятия своих слушателей.
 * С `'data'` возврат (`unshift`) внутри обработчика тут же выдавал те же байты
 * тому же обработчику — бесконечный цикл, вешавший процесс, если прокси (или
 * цель, говорящая первой) прислал хоть байт сверх заголовка. Режим paused
 * заодно не теряет эти байты, если вызывающий подпишется не сразу.
 */
export function openProxyTunnel(
  proxy: URL,
  address: string,
  port: number,
  timeoutMs: number,
  callback: (error: Error | null, socket: Socket | null, refusedByProxy?: boolean) => void,
): void {
  const authority = `${isIPv6(address) ? `[${address}]` : address}:${port}`;
  const socket = netConnect({
    host: proxy.hostname.replace(IP_ADDRESS_SYNTAX.brackets, '$1'),
    port: Number(proxy.port) || 80,
  });
  let settled = false;
  let head = Buffer.alloc(0);
  const finish = (error: Error | null, rest?: Buffer, refusedByProxy = false): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    socket.removeListener('readable', onReadable);
    socket.removeListener('error', onError);
    socket.removeListener('close', onClose);
    if (error === null) {
      // Свои слушатели уже сняты: возвращённые байты достанутся вызывающему, а не нам.
      if (rest !== undefined && rest.length > 0) {
        socket.unshift(rest);
      }
      callback(null, socket);
      return;
    }
    socket.destroy();
    callback(error, null, refusedByProxy);
  };
  const failed = (message: string, cause?: unknown): Error =>
    netGuardError(
      NET_GUARD_ERROR_CODE.proxyTunnelFailed,
      `прокси ${proxy.host}: ${message} (CONNECT ${authority})`,
      cause,
    );
  const timer = setTimeout(() => finish(failed(`туннель не открылся за ${timeoutMs} мс`)), timeoutMs);
  const onReadable = (): void => {
    for (;;) {
      const chunk = socket.read() as Buffer | null;
      if (settled || chunk === null) {
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > PROXY_TUNNEL.maxResponseHeadBytes) {
          finish(failed('ответ без конца заголовка — это не HTTP-прокси'));
        }
        continue;
      }
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString('latin1'))?.[1];
      if (status === undefined || !status.startsWith('2')) {
        finish(
          failed(status === undefined ? 'ответ не по протоколу HTTP' : `туннель отказан, ответ ${status}`),
          undefined,
          status !== undefined,
        );
        return;
      }
      finish(null, head.subarray(end + 4));
      return;
    }
  };
  const onError = (error: Error): void => finish(failed('ошибка соединения', error));
  const onClose = (): void => finish(failed('соединение закрыто до ответа'));
  socket.on('readable', onReadable);
  socket.on('error', onError);
  socket.on('close', onClose);
  socket.once('connect', () => {
    const credentials =
      proxy.username === ''
        ? ''
        : `Proxy-Authorization: Basic ${Buffer.from(
            `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
          ).toString('base64')}\r\n`;
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}\r\n`);
  });
}
