import { IP_ADDRESS } from './constants/ip-address.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { parseIpv4 } from './parse-ipv4';

/** IPv6 (полный, сжатый, со встроенным IPv4) → шестнадцать байт; иначе null. */
export function parseIpv6(text: string): Uint8Array | null {
  let head = text;
  let tail: number[] = [];

  // Встроенный IPv4 в конце: ::ffff:127.0.0.1
  const lastColon = head.lastIndexOf(':');
  if (lastColon >= 0 && head.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(head.slice(lastColon + 1));
    if (!v4) {
      return null;
    }
    // parseIpv4 отдаёт ровно четыре октета; `?? 0` — то же, что сделал бы
    // побитовый оператор с undefined, — нужен только strict-проверке индексов.
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    tail = [(a << IP_ADDRESS.bitsPerByte) | b, (c << IP_ADDRESS.bitsPerByte) | d];
    head = head.slice(0, lastColon + 1);
    if (head.endsWith(':') && !head.endsWith('::')) {
      head = head.slice(0, -1);
    }
  }

  const halves = head.split('::');
  if (halves.length > IP_ADDRESS.ipv6CompressedParts) {
    return null;
  }

  const toGroups = (part: string): number[] | null => {
    if (part === '') {
      return [];
    }
    const groups = part.split(':');
    if (groups.some((group) => !IP_ADDRESS_SYNTAX.ipv6Group.test(group))) {
      return null;
    }

    return groups.map((group) => parseInt(group, IP_ADDRESS.ipv6GroupRadix));
  };

  const [leftText = '', rightText] = halves;
  const left = toGroups(leftText);
  const right = rightText === undefined ? [] : toGroups(rightText);
  if (!left || !right) {
    return null;
  }

  const explicit = left.length + right.length + tail.length;
  let groups: number[];
  if (halves.length === IP_ADDRESS.ipv6CompressedParts) {
    // `::` сжимает хотя бы одну группу: явных групп меньше полного числа.
    if (explicit >= IP_ADDRESS.ipv6Groups) {
      return null;
    }
    groups = [...left, ...new Array(IP_ADDRESS.ipv6Groups - explicit).fill(0), ...right, ...tail];
  } else {
    if (explicit !== IP_ADDRESS.ipv6Groups) {
      return null;
    }
    groups = [...left, ...tail];
  }

  const bytes = new Uint8Array(IP_ADDRESS.ipv6Bytes);
  groups.forEach((group, i) => {
    bytes[i * IP_ADDRESS.ipv6GroupBytes] = group >> IP_ADDRESS.bitsPerByte;
    bytes[i * IP_ADDRESS.ipv6GroupBytes + 1] = group & IP_ADDRESS.byteMask;
  });

  return bytes;
}
