import { CLOUD_METADATA_ENDPOINTS } from './constants/cloud-metadata-endpoints.constant';
import { isBlockedIp } from './is-blocked-ip';
import { nonPublicHostReason } from './non-public-host-reason';

/** Каталог служб метаданных — подмножество встроенной политики: каждое имя и каждый адрес закрыты. */
describe('каталог служб метаданных облаков', () => {
  const names = CLOUD_METADATA_ENDPOINTS.flatMap(({ names }) => [...names]);
  const addresses = CLOUD_METADATA_ENDPOINTS.flatMap(({ ipv4, ipv6 }) => [...ipv4, ...ipv6]);

  it('выборка не выродилась: облака, имена, IPv4 и IPv6', () => {
    expect({
      providers: CLOUD_METADATA_ENDPOINTS.length >= 9,
      names: names.length >= 5,
      ipv6: CLOUD_METADATA_ENDPOINTS.flatMap(({ ipv6 }) => [...ipv6]).length >= 3,
    }).toEqual({ providers: true, names: true, ipv6: true });
  });

  it.each(names)('имя %s — отказ по форме, до DNS', (name) => {
    expect(nonPublicHostReason(name)).not.toBeNull();
  });

  it.each(addresses)('адрес %s — не публичный', (address) => {
    expect([
      isBlockedIp(address),
      nonPublicHostReason(address.includes(':') ? `[${address}]` : address),
    ]).toEqual([true, expect.stringContaining('не публичный')]);
  });

  it('публичный диапазон рядом с WireServer остаётся публичным (закрыт ровно /32)', () => {
    expect([isBlockedIp('168.63.129.15'), isBlockedIp('168.63.129.17')]).toEqual([false, false]);
  });
});
