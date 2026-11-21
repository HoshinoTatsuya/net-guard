import { IP_ADDRESS } from './constants/ip-address.constant';

/** Адрес лежит в подсети: первые `prefix` бит совпадают. */
export function inSubnet(bytes: Uint8Array, [network, prefix]: readonly [Uint8Array, number]): boolean {
  for (let bit = 0; bit < prefix; bit++) {
    const byte = bit >> IP_ADDRESS.bitToByteShift;
    const mask = IP_ADDRESS.highBit >> (bit % IP_ADDRESS.bitsPerByte);
    // Байт за пределами адреса — 0, как у побитового оператора с undefined.
    if (((bytes[byte] ?? 0) & mask) !== ((network[byte] ?? 0) & mask)) {
      return false;
    }
  }

  return true;
}
