import type { CompiledPolicy } from './compile-policy';
import { HOST_PORT_MODE, type HostPortMode } from './constants/host-port-mode.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { isBlockedAddress } from './is-blocked-ip';
import { parseIpv4 } from './parse-ipv4';
import { parseIpv6 } from './parse-ipv6';
import { splitHost } from './split-host';

const TRAILING_DOTS = /\.+$/;

/** Итог проверки формы хоста: причина отказа или хост для резолвера. */
export type HostClassification =
  | { readonly reason: string }
  | {
      readonly reason: null;
      /** Хост так, как его поймёт HTTP-клиент (WHATWG URL): `0x7f.1` → `127.0.0.1`, IPv6 — в скобках. */
      readonly hostname: string;
      /** Литерал адреса: в DNS не нужен. */
      readonly literal: boolean;
    };

/** `[2001:DB8::1]` → `[2001:db8::1]` (WHATWG URL); адрес уже разобран parseIpv6. */
function canonicalIpv6(address: string): string {
  try {
    return new URL(`http://[${address}]/`).hostname;
  } catch {
    return `[${address.toLowerCase()}]`;
  }
}

/** `allowPort` из настроек → режим: не задана — прежнее поведение, `false` — порт запрещён в любой форме. */
export function hostPortMode(allowPort: boolean | undefined): HostPortMode {
  if (allowPort === true) {
    return HOST_PORT_MODE.strip;
  }
  return allowPort === false ? HOST_PORT_MODE.forbid : HOST_PORT_MODE.legacy;
}

/**
 * Общая часть `nonPublicHostReason` и `nonPublicResolvedReason`: форма хоста,
 * адрес-литерал, зона имени. DNS не спрашивается.
 */
export function classifyHost(
  host: string,
  policy: CompiledPolicy,
  portMode: HostPortMode,
): HostClassification {
  const raw = (host ?? '').trim();
  if (!raw) {
    return { reason: 'пустой хост' };
  }
  if (IP_ADDRESS_SYNTAX.forbiddenHostChars.test(raw)) {
    return { reason: `недопустимые символы в хосте «${raw}»` };
  }

  const parts = splitHost(raw);
  if (parts === null) {
    return { reason: `хост «${raw}» не разбирается` };
  }
  // `[IPv6]:порт` разбирался и прежде (WHATWG URL снимал порт) — без опции так и
  // остаётся; явное `allowPort: false` запрещает порт и у него: иначе запрет порта
  // обходится скобками (`[2606:4700::1111]:8080` проходил как «без порта»).
  const portRefused =
    portMode === HOST_PORT_MODE.forbid || (portMode === HOST_PORT_MODE.legacy && !parts.bracketed);
  if (parts.port !== null && portRefused) {
    return {
      reason: `в хосте «${raw}» указан порт ${parts.port} — ожидается хост без порта (снять порт — опция allowPort)`,
    };
  }

  if (parts.ipv6) {
    if (parseIpv6(parts.host) === null) {
      return { reason: `хост «${raw}» не разбирается` };
    }
    const hostname = canonicalIpv6(parts.host);
    if (parts.zone !== null) {
      // Зона снимается для классификации; сам адрес с зоной — всегда отказ.
      const shown = `${hostname.slice(0, -1)}%${parts.zone}]`;
      return {
        reason: isBlockedAddress(parts.host, policy)
          ? `адрес ${shown} не публичный`
          : `адрес ${shown}: зона «${parts.zone}» у глобального адреса — нестандартная форма, считается непубличной`,
      };
    }
    return isBlockedAddress(hostname, policy)
      ? { reason: `адрес ${hostname} не публичный` }
      : { reason: null, hostname, literal: true };
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${parts.host}/`).hostname;
  } catch {
    return { reason: `хост «${raw}» не разбирается` };
  }

  if (hostname.startsWith('[') || parseIpv4(hostname)) {
    return isBlockedAddress(hostname, policy)
      ? { reason: `адрес ${hostname} не публичный` }
      : { reason: null, hostname, literal: true };
  }

  const name = hostname.replace(TRAILING_DOTS, '').toLowerCase();
  if (!name.includes('.')) {
    return { reason: `имя «${name}» без точки публично не резолвится` };
  }

  const inZone = (suffix: string): boolean => name === suffix || name.endsWith(`.${suffix}`);
  const builtIn = policy.nameSuffixes.find(inZone);
  if (builtIn !== undefined) {
    return { reason: `имя «${name}» в зоне .${builtIn} публично не резолвится` };
  }
  const extra = policy.extraNameSuffixes.find(inZone);
  if (extra !== undefined) {
    return { reason: `имя «${name}» в зоне .${extra} запрещено настройкой extraBlockedNameSuffixes` };
  }

  return { reason: null, hostname, literal: false };
}
