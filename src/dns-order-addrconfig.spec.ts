import dns = require('node:dns');
import os = require('node:os');

import type { LookupCallback } from './guarded-lookup';
import { createGuardedLookup } from './guarded-lookup';
import { lookupFamilies } from './lookup-families';
import { type FakeDnsServer, startFakeDnsServer } from './testing/fake-dns-server';

/**
 * Порядок адресов и флаг ADDRCONFIG у резолвера c-ares — против подставного DNS
 * на 127.0.0.1. `net` при соединении зовёт lookup с `hints: ADDRCONFIG` и БЕЗ
 * `order` (замер: `{"hints":1024,"all":true}`), так что порядок процесса и флаг
 * обязан учесть сам резолвер.
 */
describe('c-ares: порядок адресов процесса и ADDRCONFIG', () => {
  let server: FakeDnsServer;
  let savedServers: string[] = [];
  let savedOrder: ReturnType<typeof dns.getDefaultResultOrder>;

  beforeAll(async () => {
    server = await startFakeDnsServer({ 'dual.example': ['93.184.216.34', '2606:2800:220:1::1'] });
    savedServers = dns.getServers();
    savedOrder = dns.getDefaultResultOrder();
    dns.setServers([server.address]);
  });

  afterAll(async () => {
    dns.setServers(savedServers);
    dns.setDefaultResultOrder(savedOrder);
    await server.close();
  });

  beforeEach(() => {
    server.questions.length = 0;
    dns.setDefaultResultOrder('verbatim');
  });

  const call = (options: object) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family: number | undefined }>(
      (done) => {
        createGuardedLookup()('dual.example', options, ((error, address, family) =>
          done({ error, address, family })) as LookupCallback);
      },
    );
  /** Интерфейсы машины: адреса на НЕ-loopback интерфейсе — по семействам. */
  const interfaces = (
    families: Array<'IPv4' | 'IPv6'>,
    internal = false,
  ): NodeJS.Dict<os.NetworkInterfaceInfo[]> => ({
    lo: [
      { address: '127.0.0.1', family: 'IPv4', internal: true } as os.NetworkInterfaceInfo,
      { address: '::1', family: 'IPv6', internal: true } as os.NetworkInterfaceInfo,
    ],
    eth0: families.map(
      (family) =>
        ({
          address: family === 'IPv4' ? '192.0.2.10' : '2001:db8::10',
          family,
          internal,
        }) as os.NetworkInterfaceInfo,
    ),
  });

  it('порядок процесса ipv6first без order в настройках (как зовёт net) — первым IPv6; verbatim — IPv4', async () => {
    dns.setDefaultResultOrder('ipv6first');
    const v6first = await call({ hints: dns.ADDRCONFIG, all: true });
    const single = await call({ hints: 0 });
    dns.setDefaultResultOrder('verbatim');
    const verbatim = await call({ all: true });
    expect({
      v6first: v6first.address,
      single: [single.address, single.family],
      verbatim: verbatim.address,
    }).toEqual({
      v6first: [
        { address: '2606:2800:220:1::1', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ],
      single: ['2606:2800:220:1::1', 6],
      verbatim: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ],
    });
  });

  it('явный order в настройках сильнее порядка процесса', async () => {
    dns.setDefaultResultOrder('ipv6first');
    const result = await call({ all: true, order: 'ipv4first' });
    expect((result.address as Array<{ family: number }>).map(({ family }) => family)).toEqual([4, 6]);
  });

  it('ADDRCONFIG на машине без IPv6 (только loopback ::1) — вопроса AAAA нет; без флага — есть', async () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue(interfaces(['IPv4']));
    await call({ hints: dns.ADDRCONFIG, all: true });
    const withFlag = server.questions.map(({ type }) => type).sort();
    server.questions.length = 0;
    await call({ all: true });
    const withoutFlag = server.questions.map(({ type }) => type).sort();
    expect({ withFlag, withoutFlag }).toEqual({ withFlag: ['A'], withoutFlag: ['A', 'AAAA'] });
  });

  it('ADDRCONFIG: машина только с IPv6 — только AAAA; без адресов вне loopback — оба (флаг не делает поиск невозможным)', () => {
    const spy = jest.spyOn(os, 'networkInterfaces');
    spy.mockReturnValue(interfaces(['IPv6']));
    const v6only = lookupFamilies({ all: true, hints: dns.ADDRCONFIG });
    spy.mockReturnValue(interfaces(['IPv4', 'IPv6'], true));
    const loopbackOnly = lookupFamilies({ all: true, hints: dns.ADDRCONFIG });
    spy.mockReturnValue(interfaces(['IPv4', 'IPv6']));
    const dual = lookupFamilies({ all: true, hints: dns.ADDRCONFIG | dns.V4MAPPED });
    expect({
      v6only,
      loopbackOnly,
      dual,
      explicit: lookupFamilies({ all: true, family: 6, hints: dns.ADDRCONFIG }),
    }).toEqual({
      v6only: [6],
      loopbackOnly: [4, 6],
      dual: [4, 6],
      explicit: [6],
    });
  });
});
