import { nonPublicResolvedReason } from './non-public-resolved-reason';
import type { HostLookup } from './types/host-lookup.type';

const answers =
  (table: Record<string, readonly string[]>): HostLookup =>
  async (host) => {
    const addresses = table[host];
    if (addresses === undefined) {
      throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    }
    return addresses.map((address) => ({ address }));
  };

describe('nonPublicResolvedReason', () => {
  const lookup = answers({
    'public.example': ['93.184.216.34'],
    'rebind.example': ['93.184.216.34', '10.0.0.5'],
    'mapped.example': ['::ffff:127.0.0.1'],
    'empty.example': [],
  });

  it('имя с публичными адресами проходит', async () => {
    await expect(nonPublicResolvedReason('public.example', lookup)).resolves.toBeNull();
  });

  it('хотя бы ОДИН внутренний адрес — отказ (а не «первый ответ публичный»)', async () => {
    await expect(nonPublicResolvedReason('rebind.example', lookup)).resolves.toContain('10.0.0.5');
  });

  it('встроенный IPv4 в ответе резолвера — решение по нему', async () => {
    await expect(nonPublicResolvedReason('mapped.example', lookup)).resolves.toContain('непубличный');
  });

  it('отказ резолвера — отказ, а не пропуск', async () => {
    await expect(nonPublicResolvedReason('missing.example', lookup)).resolves.toContain('не разрешилось');
  });

  it('пустой ответ резолвера — отказ', async () => {
    await expect(nonPublicResolvedReason('empty.example', lookup)).resolves.toContain('ни в один адрес');
  });

  it('форма имени проверяется ДО DNS: резолвер не вызывается', async () => {
    const spy = jest.fn<ReturnType<HostLookup>, Parameters<HostLookup>>();
    await expect(nonPublicResolvedReason('npm.corp', spy)).resolves.toContain('.corp');
    expect(spy).not.toHaveBeenCalled();
  });

  it('литерал публичного адреса не уходит в DNS', async () => {
    const spy = jest.fn<ReturnType<HostLookup>, Parameters<HostLookup>>();
    await expect(nonPublicResolvedReason('8.8.8.8', spy)).resolves.toBeNull();
    await expect(nonPublicResolvedReason('[2606:4700::1111]', spy)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('голый IPv6-литерал (без скобок) классифицируется, а не роняет промис', async () => {
    // Прежде: `new URL('http://2606:4700::1111/')` бросал, и промис отклонялся
    // исключением вместо ответа — у вызывающего это «ошибка», а не «можно/нельзя».
    const spy = jest.fn<ReturnType<HostLookup>, Parameters<HostLookup>>();
    await expect(nonPublicResolvedReason('2606:4700::1111', spy)).resolves.toBeNull();
    await expect(nonPublicResolvedReason('::1', spy)).resolves.toBe('адрес [::1] не публичный');
    await expect(nonPublicResolvedReason('::ffff:10.0.0.1', spy)).resolves.toBe(
      'адрес [::ffff:a00:1] не публичный',
    );
    await expect(nonPublicResolvedReason('fe80::1%eth0', spy)).resolves.toBe(
      'адрес [fe80::1%eth0] не публичный',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('allowPort: порт снимается и в проверке с резолвером, в DNS уходит имя без порта', async () => {
    await expect(
      nonPublicResolvedReason('public.example:8443', lookup, { allowPort: true }),
    ).resolves.toBeNull();
    await expect(
      nonPublicResolvedReason('rebind.example:8443', lookup, { allowPort: true }),
    ).resolves.toContain('10.0.0.5');
    await expect(nonPublicResolvedReason('public.example:8443', lookup)).resolves.toContain('указан порт');
  });
});
