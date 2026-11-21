import { isBlockedIp } from './is-blocked-ip';
import { nonPublicHostReason } from './non-public-host-reason';
import { nonPublicResolvedReason } from './non-public-resolved-reason';
import type { HostLookup } from './types/host-lookup.type';

describe('зона IPv6 (fe80::1%eth0)', () => {
  it.each([
    ['fe80::1%eth0', 'адрес [fe80::1%eth0] не публичный'],
    ['FE80::1%en0', 'адрес [fe80::1%en0] не публичный'],
    ['fe80::1%12', 'адрес [fe80::1%12] не публичный'],
    // RFC 6874: внутри скобок URL `%` перед зоной кодируется как `%25`.
    ['[fe80::1%25eth0]', 'адрес [fe80::1%eth0] не публичный'],
    ['[fe80::1%eth0]', 'адрес [fe80::1%eth0] не публичный'],
    ['ff02::1%eth0', 'адрес [ff02::1%eth0] не публичный'],
  ])('«%s» — зона снята, адрес классифицирован: %s', (host, reason) => {
    expect(nonPublicHostReason(host)).toBe(reason);
  });

  it('зона у глобального адреса — отказ со своей причиной (нестандартная форма)', () => {
    expect(nonPublicHostReason('2606:4700::1111%eth0')).toBe(
      'адрес [2606:4700::1111%eth0]: зона «eth0» у глобального адреса — нестандартная форма, считается непубличной',
    );
    // Контроль: без зоны тот же адрес публичный.
    expect(nonPublicHostReason('2606:4700::1111')).toBeNull();
  });

  it.each([['fe80::1%'], ['[fe80::1%25]'], ['fe80::zz%eth0'], ['fe80::1%eth0%1']])(
    '«%s» — неразборная зона или адрес: отказ «не разбирается»',
    (host) => {
      expect(nonPublicHostReason(host)).toBe(`хост «${host}» не разбирается`);
    },
  );

  it('isBlockedIp: адрес с зоной — всегда отказ, в том числе у глобального', () => {
    expect(
      ['fe80::1%eth0', '[fe80::1%25eth0]', '2606:4700::1111%eth0'].filter((ip) => !isBlockedIp(ip)),
    ).toEqual([]);
  });
});

describe('хост с портом', () => {
  it.each([
    ['example.com:8080', null],
    ['EXAMPLE.com.:443', null],
    ['8.8.8.8:53', null],
    ['[2606:4700::1111]:443', null],
    ['127.0.0.1:80', 'адрес 127.0.0.1 не публичный'],
    ['0x7f.1:80', 'адрес 127.0.0.1 не публичный'],
    ['[::1]:443', 'адрес [::1] не публичный'],
    ['[::ffff:127.0.0.1]:8080', 'адрес [::ffff:7f00:1] не публичный'],
    ['localhost:3000', 'имя «localhost» без точки публично не резолвится'],
    ['npm.corp:4873', 'имя «npm.corp» в зоне .corp публично не резолвится'],
  ])('allowPort: «%s» — порт снят → %s', (host, reason) => {
    expect(nonPublicHostReason(host, { allowPort: true })).toBe(reason);
  });

  it('голый IPv6 порта не несёт: «::1:443» — это адрес, а не ::1 и порт', () => {
    expect(nonPublicHostReason('::1:443', { allowPort: true })).toBe('адрес [::1:443] не публичный');
    expect(nonPublicHostReason('2606:4700::1111:443', { allowPort: true })).toBeNull();
  });

  it.each([
    ['example.com:0'],
    ['example.com:65536'],
    ['example.com:'],
    ['example.com:http'],
    [':80'],
    ['[::1]:'],
    ['[::1]x'],
    ['[::1'],
  ])('«%s» — неразборный порт или скобки: отказ', (host) => {
    expect(nonPublicHostReason(host, { allowPort: true })).toBe(`хост «${host}» не разбирается`);
  });

  it('без allowPort порт у имени и IPv4 — отказ с причиной (как и прежде — отказ)', () => {
    expect(nonPublicHostReason('example.com:8080')).toBe(
      'в хосте «example.com:8080» указан порт 8080 — ожидается хост без порта (снять порт — опция allowPort)',
    );
    expect(nonPublicHostReason('8.8.8.8:53')).toContain('указан порт 53');
  });

  it('без allowPort `[IPv6]:порт` разбирается, как и прежде', () => {
    expect(nonPublicHostReason('[2606:4700::1111]:443')).toBeNull();
    expect(nonPublicHostReason('[::1]:443')).toBe('адрес [::1] не публичный');
  });

  it('allowPort: false — порт запрещён и у `[IPv6]:порт` (запрет порта не обходится скобками)', () => {
    expect(nonPublicHostReason('[2606:4700::1111]:443', { allowPort: false })).toBe(
      'в хосте «[2606:4700::1111]:443» указан порт 443 — ожидается хост без порта (снять порт — опция allowPort)',
    );
    expect(nonPublicHostReason('example.com:8080', { allowPort: false })).toContain('указан порт 8080');
    // Контроль: без порта тот же адрес в скобках публичный и с allowPort: false.
    expect(nonPublicHostReason('[2606:4700::1111]', { allowPort: false })).toBeNull();
  });

  it('allowPort: false действует и в nonPublicResolvedReason (DNS не спрашивается)', async () => {
    const lookup = jest.fn<ReturnType<HostLookup>, Parameters<HostLookup>>();

    await expect(
      nonPublicResolvedReason('[2606:4700::1111]:443', lookup, { allowPort: false }),
    ).resolves.toContain('указан порт 443');
    await expect(nonPublicResolvedReason('[2606:4700::1111]:443', lookup)).resolves.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
