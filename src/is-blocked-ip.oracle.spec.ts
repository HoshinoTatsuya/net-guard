import { BlockList } from 'node:net';

import { BLOCKED_IPV4_SUBNETS } from './constants/blocked-ipv4-subnets.constant';
import { BLOCKED_IPV6_SUBNETS } from './constants/blocked-ipv6-subnets.constant';
import { isBlockedIp } from './is-blocked-ip';

/**
 * Независимый эталон — `node:net` BlockList по тем же спискам. Пакет решает
 * собственным разборщиком; здесь проверяется, что собственный разборщик не расходится с эталоном на
 * случайных адресах, включая адреса у самых границ диапазонов.
 *
 * Встроенный IPv4 (mapped, NAT64) эталон решает иначе по построению, поэтому
 * эти префиксы сверяются отдельными явными случаями в public-destination.spec.
 */
const oracle = new BlockList();
for (const subnet of BLOCKED_IPV4_SUBNETS) {
  const [network = '', prefix = ''] = subnet.split('/');
  oracle.addSubnet(network, Number(prefix), 'ipv4');
}
for (const subnet of BLOCKED_IPV6_SUBNETS) {
  const [network = '', prefix = ''] = subnet.split('/');
  oracle.addSubnet(network, Number(prefix), 'ipv6');
}
// Всё вне глобального unicast 2000::/3 — не публичное: дополнение до него.
// Отдельным списком и только для IPv6: правило `::/3` BlockList применяет и к
// IPv4 (через mapped-форму), и все IPv4 стали бы «запрещёнными».
const outsideUnicast = new BlockList();
for (const [network, prefix] of [
  ['::', 3],
  ['4000::', 2],
  ['8000::', 1],
] as const) {
  outsideUnicast.addSubnet(network, prefix, 'ipv6');
}

/** Детерминированный генератор: падение воспроизводится тем же зерном. */
const random = (() => {
  let state = 0x9e3779b9;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
})();
const byte = (): number => Math.floor(random() * 256);
const SAMPLES = 20_000;
const BOUNDARY_OFFSETS = [-1, 0, 1] as const;

const ipv4ToInt = (text: string): number =>
  text.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
const intToIpv4 = (value: number): string =>
  [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');

describe('isBlockedIp совпадает с BlockList', () => {
  it('на случайных IPv4', () => {
    const mismatches: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const address = [byte(), byte(), byte(), byte()].join('.');
      if (isBlockedIp(address) !== oracle.check(address, 'ipv4')) {
        mismatches.push(address);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('на границах каждой IPv4-подсети (первый, последний и соседние адреса)', () => {
    const cases: string[] = [];
    for (const subnet of BLOCKED_IPV4_SUBNETS) {
      const [network = '', prefixText = ''] = subnet.split('/');
      const start = ipv4ToInt(network);
      const end = start + 2 ** (32 - Number(prefixText)) - 1;
      for (const edge of [start, end]) {
        for (const offset of BOUNDARY_OFFSETS) {
          const value = edge + offset;
          if (value >= 0 && value <= 0xffff_ffff) {
            cases.push(intToIpv4(value));
          }
        }
      }
    }
    // Выборка не выродилась: по шесть адресов на подсеть, за вычетом краёв пространства.
    expect(cases.length).toBeGreaterThan(BLOCKED_IPV4_SUBNETS.length * 4);
    const mismatches = cases.filter((address) => isBlockedIp(address) !== oracle.check(address, 'ipv4'));
    expect(mismatches).toEqual([]);
  });

  it('на случайных IPv6 вне префиксов со встроенным IPv4', () => {
    const mismatches: string[] = [];
    let compared = 0;
    for (let i = 0; i < SAMPLES; i++) {
      // Половина — из заблокированных префиксов (первые байты фиксированы), половина — любые.
      const groups = Array.from({ length: 8 }, () => ((byte() << 8) | byte()).toString(16));
      if (i % 2 === 0) {
        const pick = BLOCKED_IPV6_SUBNETS[i % BLOCKED_IPV6_SUBNETS.length] ?? '::/96';
        const [network = ''] = pick.split('/');
        const head = network.split('::')[0]?.split(':').filter(Boolean) ?? [];
        head.forEach((group, k) => {
          groups[k] = group;
        });
      }
      const address = groups.join(':');
      const embedded = address.startsWith('0:0:0:0:0:ffff:') || address.startsWith('64:ff9b:0:0:0:0:');
      if (embedded) {
        continue;
      }
      compared++;
      if (isBlockedIp(address) !== (oracle.check(address, 'ipv6') || outsideUnicast.check(address, 'ipv6'))) {
        mismatches.push(address);
      }
    }
    expect(compared).toBeGreaterThan(SAMPLES * 0.9);
    expect(mismatches).toEqual([]);
  });
});
