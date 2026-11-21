import { IP_ADDRESS } from './constants/ip-address.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';

/** IPv4 в десятичной записи с точками → четыре байта; иначе null. */
export function parseIpv4(text: string): Uint8Array | null {
  const match = IP_ADDRESS_SYNTAX.ipv4Text.exec(text);
  if (!match) {
    return null;
  }

  const octets = match.slice(1).map(Number);

  return octets.every((octet) => octet <= IP_ADDRESS.octetMax) ? new Uint8Array(octets) : null;
}
