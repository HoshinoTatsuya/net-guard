import { BlockList, isIPv6 } from 'node:net';

import { parseIpv6 } from './parse-ipv6';

/**
 * Дифференциальная сверка разборщика IPv6 с независимым эталоном Node
 * (`net.isIPv6` — что считается адресом, `BlockList` — какие это байты) на
 * записях, собранных генератором с детерминированным сидом: полные, сжатые
 * `::` в любом месте, со встроенным IPv4, и испорченные (лишние группы,
 * тройное двоеточие, два `::`, одиночное `:` с краю, длинная группа, плохой
 * октет). Мутант разборщика, меняющий принятие или байты, краснеет здесь.
 */
const SEED = 0x6e67;
const CASES = 20_000;

/** mulberry32: детерминированный ГПСЧ — сбой воспроизводится тем же сидом. */
const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const next = random(SEED);
const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
const int = (max: number): number => Math.floor(next() * max);

const group = (): string => {
  const value = int(0x10000).toString(16);
  return pick([value, value.toUpperCase(), value.padStart(4, '0'), '0', '0000']);
};

const ipv4 = (): string =>
  pick([
    () => [int(256), int(256), int(256), int(256)].join('.'),
    () => `${int(400)}.${int(256)}.${int(256)}.${int(256)}`,
    () => `0${int(10)}.1.2.3`,
    () => '1.2.3',
    () => '1.2.3.4.5',
  ])();

/** Запись IPv6: groups — сколько групп явно, compress — где `::` (или нет), tail — IPv4 в конце. */
function form(): string {
  const withTail = next() < 0.3;
  const total = pick([6, 7, 8, 9, 5, 3, 1]) - (withTail ? 2 : 0);
  const groups = Array.from({ length: Math.max(0, total) }, group);
  let text: string;
  if (next() < 0.6) {
    const at = int(groups.length + 1);
    text = `${groups.slice(0, at).join(':')}::${groups.slice(at).join(':')}`;
  } else {
    text = groups.join(':');
  }
  if (withTail) {
    text = text.endsWith(':') || text === '' ? `${text}${ipv4()}` : `${text}:${ipv4()}`;
  }
  return pick([
    () => text,
    () => text,
    () => text,
    () => `${text}:`,
    () => `:${text}`,
    () => text.replace('::', ':::'),
    () => `${text}::`,
    () => `::${text}`,
    () => text.replace(/:/, '::').replace(/::(?!.*::)/, '::'),
    () => `${text}:12345`,
    () => text.replace(/[0-9a-f]/i, 'g'),
  ])();
}

/** Байты → полная запись `xxxx:…:xxxx` для эталона. */
const full = (bytes: Uint8Array): string =>
  Array.from({ length: 8 }, (_, i) =>
    (((bytes[2 * i] ?? 0) << 8) | (bytes[2 * i + 1] ?? 0)).toString(16),
  ).join(':');

describe('parseIpv6 против эталона Node', () => {
  const forms = Array.from({ length: CASES }, form);

  it('выборка не выродилась: есть и валидные, и невалидные, и со встроенным IPv4', () => {
    const valid = forms.filter((text) => isIPv6(text));
    expect({
      valid: valid.length > CASES / 10,
      invalid: CASES - valid.length > CASES / 5,
      withTail: valid.filter((text) => text.includes('.')).length > 100,
      compressed: valid.filter((text) => text.includes('::')).length > 1_000,
    }).toEqual({ valid: true, invalid: true, withTail: true, compressed: true });
  });

  it('принимает ровно то, что net.isIPv6, и даёт те же байты, что BlockList', () => {
    const mismatches: string[] = [];
    for (const text of forms) {
      const bytes = parseIpv6(text);
      if ((bytes !== null) !== isIPv6(text)) {
        mismatches.push(`${text}: разборщик ${bytes !== null}, эталон ${isIPv6(text)}`);
        continue;
      }
      if (bytes !== null) {
        const exact = new BlockList();
        exact.addSubnet(full(bytes), 128, 'ipv6');
        if (!exact.check(text, 'ipv6')) {
          mismatches.push(`${text}: байты ${full(bytes)}`);
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it.each([
    ['::', '0:0:0:0:0:0:0:0'],
    ['1::', '1:0:0:0:0:0:0:0'],
    ['::ffff:1.2.3.4', '0:0:0:0:0:ffff:102:304'],
    ['1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:102:304'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
  ])('граница %s → %s', (text, expected) => {
    const bytes = parseIpv6(text);
    expect(bytes === null ? null : full(bytes)).toBe(expected);
  });

  it.each([
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7:8::',
    '1::2::3',
    ':1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:',
    '1:2:3:4:5:6:7:1.2.3.4',
    '::12345',
    '::ffff:300.1.1.1',
    '',
  ])('не адрес: %p', (text) => {
    expect(parseIpv6(text)).toBeNull();
  });
});
