import { classifyHost } from './classify-host';
import { compileAllowedPorts } from './compile-allowed-ports';
import { compileAllowedSchemes } from './compile-allowed-schemes';
import { compilePolicy } from './compile-policy';
import { BLOCK_STAGE } from './constants/block-stage.constant';
import { HOST_PORT_MODE } from './constants/host-port-mode.constant';
import type { UrlCheckOptions } from './types/url-check-options.type';
import type { UrlVerdict } from './types/url-verdict.type';
import { valueText } from './value-text';

/**
 * Проверка URL целиком, настройки разобраны один раз: схема, порт (явный или
 * порт схемы), хост — той же классификацией, что `nonPublicHostReason`
 * (WHATWG URL уже привёл хост к виду, в котором к нему соединятся). DNS здесь
 * не спрашивается — имя проверяет защищённое соединение.
 */
export function compileUrlCheck(options: UrlCheckOptions = {}): (url: string | URL) => UrlVerdict | null {
  const policy = compilePolicy(options);
  const ports = compileAllowedPorts(options.allowedPorts);
  const schemes = compileAllowedSchemes(options.allowedSchemes);
  return (input) => {
    let url: URL;
    try {
      url = input instanceof URL ? input : new URL(input);
    } catch {
      return {
        stage: BLOCK_STAGE.host,
        reason: `URL «${valueText(input)}» не разбирается`,
        target: valueText(input),
      };
    }
    if (!schemes.has(url.protocol)) {
      return {
        stage: BLOCK_STAGE.scheme,
        reason: `схема ${url.protocol} вне разрешённых (${[...schemes].join(', ')}) — настройка allowedSchemes`,
        target: url.hostname,
      };
    }
    const host = classifyHost(url.hostname, policy, HOST_PORT_MODE.forbid);
    if (host.reason !== null) {
      return { stage: BLOCK_STAGE.host, reason: host.reason, target: url.hostname };
    }
    if (ports !== null) {
      // Порт схемы по умолчанию WHATWG URL в `port` не отдаёт: `https://h/` — ''.
      const port =
        url.port === ''
          ? url.protocol === 'https:'
            ? 443
            : url.protocol === 'http:'
              ? 80
              : NaN
          : Number(url.port);
      if (!ports.has(port)) {
        return {
          stage: BLOCK_STAGE.port,
          reason: `порт ${url.port || '(схемы)'} вне разрешённых (${[...ports].join(', ')}) — настройка allowedPorts`,
          target: url.hostname,
        };
      }
    }
    return null;
  };
}
