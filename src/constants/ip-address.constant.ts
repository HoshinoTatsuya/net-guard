/** Размеры и маски адресной арифметики IPv4/IPv6. */
export const IP_ADDRESS = {
  /** Байт в адресе IPv4. */
  ipv4Bytes: 4,
  /** Байт в адресе IPv6. */
  ipv6Bytes: 16,
  /** Групп по 16 бит в адресе IPv6. */
  ipv6Groups: 8,
  /** Байт в группе IPv6. */
  ipv6GroupBytes: 2,
  /** Основание записи группы IPv6. */
  ipv6GroupRadix: 16,
  /** На сколько частей делит адрес IPv6 сокращение `::` (оно — одно). */
  ipv6CompressedParts: 2,
  /** Бит в байте. */
  bitsPerByte: 8,
  /** Сдвиг номера бита к номеру байта: log2(bitsPerByte). */
  bitToByteShift: 3,
  /** Наибольшее значение октета IPv4. */
  octetMax: 255,
  /** Маска младшего байта. */
  byteMask: 0xff,
  /** Старший бит байта. */
  highBit: 0x80,
  /** Наименьший и наибольший номер порта в хосте (`0` соединением не бывает). */
  portMin: 1,
  portMax: 65535,
} as const;
