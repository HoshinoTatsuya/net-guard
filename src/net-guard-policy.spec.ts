import { isBlockedIp } from './is-blocked-ip';
import { nonPublicHostReason } from './non-public-host-reason';
import { nonPublicResolvedReason } from './non-public-resolved-reason';
import type { HostLookup } from './types/host-lookup.type';

/**
 * Дополнительные запреты — ПОВЕРХ встроенных. Каждый случай — в обе стороны:
 * с настройкой адрес закрыт, без неё тот же адрес открыт (иначе тест зелен на
 * адресе, закрытом встроенным списком).
 */
describe('extraBlockedSubnets', () => {
  const policy = { extraBlockedSubnets: ['93.184.216.0/24', '2a00:1450::/32', ' 203.0.114.7/32 '] };

  it('IPv4 и IPv6 из дополнительных подсетей закрыты; без настройки — открыты', () => {
    const addresses = ['93.184.216.34', '93.184.216.255', '2a00:1450:4001:80b::200e', '203.0.114.7'];

    expect(addresses.filter((address) => !isBlockedIp(address, policy))).toEqual([]);
    expect(addresses.filter((address) => isBlockedIp(address))).toEqual([]);
  });

  it('границы подсети: соседние адреса снаружи остаются открытыми', () => {
    expect(
      ['93.184.215.255', '93.184.217.0', '2a00:1451::1', '203.0.114.8'].filter((a) => isBlockedIp(a, policy)),
    ).toEqual([]);
  });

  it('встроенный список не заменяется: внутренние адреса закрыты и с настройкой', () => {
    expect(
      ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fe80::1'].filter((a) => !isBlockedIp(a, policy)),
    ).toEqual([]);
  });

  it('IPv4-подсеть действует и на встроенный IPv4 (mapped, NAT64)', () => {
    expect(isBlockedIp('::ffff:93.184.216.34', policy)).toBe(true);
    expect(isBlockedIp('64:ff9b::5db8:d822', policy)).toBe(true);
    expect(isBlockedIp('::ffff:93.184.216.34')).toBe(false);
  });

  it('IPv6-подсеть из настроек действует и на префикс со встроенным IPv4', () => {
    // Решение по встроенному IPv4 не должно отменять явный запрет всего префикса.
    expect(isBlockedIp('::ffff:8.8.8.8', { extraBlockedSubnets: ['::ffff:0:0/96'] })).toBe(true);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('проверка хоста и резолвера видит те же подсети', async () => {
    const lookup: HostLookup = async () => [{ address: '93.184.216.34' }];

    expect(nonPublicHostReason('93.184.216.34', policy)).toBe('адрес 93.184.216.34 не публичный');
    expect(nonPublicHostReason('93.184.216.34')).toBeNull();
    await expect(nonPublicResolvedReason('public.example', lookup, policy)).resolves.toContain(
      '93.184.216.34',
    );
    await expect(nonPublicResolvedReason('public.example', lookup)).resolves.toBeNull();
  });

  it.each([['10.0.0.0'], ['10.0.0.0/33'], ['/8'], ['2a00::/129'], ['example.com/8'], ['fe80::1%eth0/64']])(
    'опечатка «%s» — исключение, а не молча пропущенный запрет',
    (subnet) => {
      expect(() => isBlockedIp('8.8.8.8', { extraBlockedSubnets: [subnet] })).toThrow('Некорректная подсеть');
    },
  );

  it.each([
    ['10.0.0.0/8/extra'],
    ['2a00::/32/64'],
    // `Number('')` = 0: прежде это читалось как `/0`, то есть «запретить всё».
    ['10.0.0.0/'],
    ['10.0.0.0/0x8'],
    ['10.0.0.0/8e0'],
    ['10.0.0.0/8x'],
  ])('мусор в префиксе «%s» — исключение (прежде лишнее молча отрезалось)', (subnet) => {
    expect(() => isBlockedIp('8.8.8.8', { extraBlockedSubnets: [subnet] })).toThrow('Некорректная подсеть');
  });

  it('контроль формы: тот же префикс без мусора принимается и действует', () => {
    expect(isBlockedIp('10.200.0.1', { extraBlockedSubnets: ['10.0.0.0/8'] })).toBe(true);
    expect(isBlockedIp('2a00::1', { extraBlockedSubnets: ['2a00::/32'] })).toBe(true);
    expect(isBlockedIp('2a00::1')).toBe(false);
  });
});

describe('extraBlockedNameSuffixes', () => {
  const policy = { extraBlockedNameSuffixes: ['.Corp.Example.', 'пример.рф'] };

  it('имя в зоне и сама зона закрыты; без настройки — открыты', () => {
    const names = ['corp.example', 'svc.corp.example', 'A.B.CORP.EXAMPLE.', 'сайт.пример.рф'];

    expect(
      names.map((name) => nonPublicHostReason(name, policy)).filter((reason) => reason === null),
    ).toEqual([]);
    expect(names.filter((name) => nonPublicHostReason(name) !== null)).toEqual([]);
  });

  it('причина называет зону из настройки', () => {
    expect(nonPublicHostReason('svc.corp.example', policy)).toBe(
      'имя «svc.corp.example» в зоне .corp.example запрещено настройкой extraBlockedNameSuffixes',
    );
  });

  it('совпадение — по границе метки, а не по подстроке', () => {
    expect(nonPublicHostReason('mycorp.example', policy)).toBeNull();
    expect(nonPublicHostReason('corp.example.com', policy)).toBeNull();
  });

  it('встроенные зоны остаются закрытыми', () => {
    expect(nonPublicHostReason('dc01.corp', policy)).toContain('.corp');
  });

  it('форма имени с зоной из настроек проверяется ДО DNS', async () => {
    const lookup = jest.fn<ReturnType<HostLookup>, Parameters<HostLookup>>();

    await expect(nonPublicResolvedReason('svc.corp.example', lookup, policy)).resolves.toContain(
      '.corp.example',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([[''], ['.'], ['*.corp'], ['corp example'], ['a..b']])('опечатка «%s» — исключение', (suffix) => {
    expect(() => nonPublicHostReason('a.example', { extraBlockedNameSuffixes: [suffix] })).toThrow(
      'Некорректная зона имени',
    );
  });
});
