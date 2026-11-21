import { IP_ADDRESS } from './constants/ip-address.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';

/** Подсеть `адрес/префикс` → байты сети и длина префикса; опечатка — исключение. */
export function parseSubnet(
  subnet: string,
  parse: (text: string) => Uint8Array | null,
): [Uint8Array, number] {
  // Форма целиком: `10.0.0.0/8/extra` и `10.0.0.0/` — опечатки, а не `/8` и `/0`.
  const match = IP_ADDRESS_SYNTAX.subnet.exec(subnet);
  // Подсеть без адреса (`/8`) не разбирается и роняет загрузку ниже.
  const bytes = match === null ? null : parse(match[1] ?? '');
  const prefix = Number(match?.[2]);
  if (!bytes || !Number.isInteger(prefix) || prefix < 0 || prefix > bytes.length * IP_ADDRESS.bitsPerByte) {
    // Опечатка в списке обязана ронять загрузку модуля, а не молча открывать диапазон
    throw new Error(`Некорректная подсеть в списке запрещённых: ${subnet}`);
  }

  return [bytes, prefix];
}
