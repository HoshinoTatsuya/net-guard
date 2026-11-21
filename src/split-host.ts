import { IP_ADDRESS } from './constants/ip-address.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';

/** Хост, разобранный на части до классификации. */
export interface HostParts {
  /** Имя, IPv4 в любой форме или IPv6 без скобок и без зоны. */
  readonly host: string;
  /** IPv6-литерал: в скобках или с двумя и более двоеточиями. */
  readonly ipv6: boolean;
  /** Был в скобках (`[::1]`, `[::1]:443`). */
  readonly bracketed: boolean;
  /** Зона IPv6 (`eth0` из `fe80::1%eth0` или `[fe80::1%25eth0]`). */
  readonly zone: string | null;
  /** Порт, если был (`8080` из `example.com:8080`). */
  readonly port: string | null;
}

const validPort = (port: string): boolean => {
  const value = Number(port);
  return value >= IP_ADDRESS.portMin && value <= IP_ADDRESS.portMax;
};

/**
 * `example.com:8080` → имя и порт; `[::1]:443` → IPv6 и порт; `fe80::1%eth0` →
 * IPv6 и зона. Голый IPv6 порта не несёт: `::1:443` — тоже адрес, поэтому
 * больше одного двоеточия без скобок — всегда литерал IPv6. Не разобралось
 * (незакрытая скобка, мусор после неё, порт вне 1–65535, пустая зона) — null.
 */
export function splitHost(raw: string): HostParts | null {
  let host: string;
  let port: string | null = null;
  let bracketed = false;
  let ipv6: boolean;

  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0) {
      return null;
    }
    host = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (rest !== '') {
      const match = IP_ADDRESS_SYNTAX.portSuffix.exec(rest);
      if (match === null) {
        return null;
      }
      port = match[1] ?? '';
    }
    bracketed = true;
    ipv6 = true;
  } else {
    const parts = raw.split(':');
    ipv6 = parts.length > IP_ADDRESS.ipv6CompressedParts;
    if (parts.length === IP_ADDRESS.ipv6CompressedParts) {
      const [name = '', portText = ''] = parts;
      if (name === '' || !IP_ADDRESS_SYNTAX.port.test(portText)) {
        return null;
      }
      host = name;
      port = portText;
    } else {
      host = raw;
    }
  }
  if (port !== null && !validPort(port)) {
    return null;
  }

  let zone: string | null = null;
  const percent = host.indexOf('%');
  if (ipv6 && percent >= 0) {
    zone = host.slice(percent + 1);
    host = host.slice(0, percent);
    if (bracketed) {
      zone = zone.replace(IP_ADDRESS_SYNTAX.ipv6ZoneUrlEncoding, '');
    }
    if (!IP_ADDRESS_SYNTAX.ipv6Zone.test(zone)) {
      return null;
    }
  }

  return { host, ipv6, bracketed, zone, port };
}
