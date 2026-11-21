import { deepFreeze } from './deep-freeze';
import { isBlockedIp } from './is-blocked-ip';
import { lookupTimeoutMs } from './lookup-timeout-ms';
import { nonPublicHostReason } from './non-public-host-reason';
import { splitHost } from './split-host';

/** Границы разбора хоста, подсети, таймаута и заморозки — по мутантам, выжившим в сплошном прогоне. */
describe('границы разбора', () => {
  it.each([
    ['example.com:1', null],
    ['example.com:65535', null],
    ['example.com:0', 'не разбирается'],
    ['example.com:65536', 'не разбирается'],
    ['[2606:4700::1111]:65535', null],
    ['[2606:4700::1111]:0', 'не разбирается'],
    [':80', 'не разбирается'],
    ['example.com:', 'не разбирается'],
    ['[2606:4700::1111', 'не разбирается'],
    ['[::1', 'не разбирается'],
  ])('allowPort: %s → %p', (host, expected) => {
    const reason = nonPublicHostReason(host, { allowPort: true });
    expect(reason === null ? null : expected !== null && reason.includes(expected) ? expected : reason).toBe(
      expected,
    );
  });

  it('splitHost: пустое имя перед портом и незакрытая скобка — не разбирается', () => {
    expect([splitHost(':80'), splitHost('[::1'), splitHost('example.com:80')?.host]).toEqual([
      null,
      null,
      'example.com',
    ]);
  });

  it.each([
    ['', 'пустой хост'],
    ['   ', 'пустой хост'],
    ['a b.example', 'недопустимые символы'],
    ['user@example.com', 'недопустимые символы'],
  ])('%p → %p', (host, expected) => {
    expect(nonPublicHostReason(host)).toContain(expected);
  });

  it('глобальный IPv6 с зоной — отказ (форма нестандартная)', () => {
    expect([isBlockedIp('2606:4700::1111%eth0'), isBlockedIp('2606:4700::1111')]).toEqual([true, false]);
    expect(nonPublicHostReason('2606:4700::1111%eth0')).toContain('нестандартная форма');
  });

  it('подсеть: префикс 0 допустим (запрет всего семейства), префикс за длиной адреса — исключение', () => {
    expect(isBlockedIp('8.8.8.8', { extraBlockedSubnets: ['0.0.0.0/0'] })).toBe(true);
    expect(isBlockedIp('2606:4700::1111', { extraBlockedSubnets: ['0.0.0.0/0'] })).toBe(false);
    expect(() => isBlockedIp('8.8.8.8', { extraBlockedSubnets: ['10.0.0.0/33'] })).toThrow(
      'Некорректная подсеть',
    );
    expect(() => isBlockedIp('8.8.8.8', { extraBlockedSubnets: ['::/129'] })).toThrow('Некорректная подсеть');
  });

  it('потолок таймера: 2147483647 — можно, на единицу больше — исключение', () => {
    expect(lookupTimeoutMs(2_147_483_647)).toBe(2_147_483_647);
    expect(() => lookupTimeoutMs(2_147_483_648)).toThrow('lookupTimeoutMs');
  });

  it('deepFreeze: цикл в словаре не уводит в бесконечную рекурсию, всё заморожено', () => {
    const node: { name: string; self?: unknown; list: unknown[] } = { name: 'a', list: [] };
    node.self = node;
    node.list.push(node, { back: node });
    deepFreeze(node);
    expect([Object.isFrozen(node), Object.isFrozen(node.list), Object.isFrozen(node.list[1])]).toEqual([
      true,
      true,
      true,
    ]);
  });
});
