import { isBlockedIp } from './is-blocked-ip';
import { nonPublicHostReason } from './non-public-host-reason';

/**
 * Дифференциальный зонд, закреплённый спекой: альтернативные записи
 * внутренних адресов и имён. Каждая форма — отказ И сырой, И после
 * нормализации WHATWG URL (так её увидит HTTP-клиент). Форма, которую URL не
 * принимает, проверяется сырой: «URL не разобрал» не значит, что не разберёт
 * libcurl или inet_aton.
 */
const FORMS: readonly string[] = [
  // loopback
  '127.0.0.1',
  '127.1',
  '0x7f.1',
  '0177.0.0.1',
  '2130706433',
  '0x7f000001',
  '127.0.0.1.',
  '１２７.０.０.１',
  '127。0。0。1',
  '[::1]',
  '[::ffff:127.0.0.1]',
  '[::ffff:7f00:1]',
  '[0:0:0:0:0:ffff:127.0.0.1]',
  '[::127.0.0.1]',
  '[64:ff9b::127.0.0.1]',
  '[2002:7f00:1::]',
  '[fe80::1%25eth0]',
  // служба метаданных
  '169.254.169.254',
  '0251.0376.0251.0376',
  '0xa9fea9fe',
  '2852039166',
  '[::ffff:a9fe:a9fe]',
  '[fd00:ec2::254]',
  // «этот» хост и сокращённые частные
  '0.0.0.0',
  '0',
  '10.1',
  '192.168.1',
  // имена
  'localhost',
  'LOCALHOST.',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'xn--localhost-',
  // CGNAT, бенчмарк, неуказанный
  '100.64.0.1',
  '198.18.0.1',
  '[::]',
  '[::ffff:0:0]',
];

/** Хост так, как его поймёт HTTP-клиент; null — URL форму не принял. */
const viaUrl = (form: string): string | null => {
  try {
    return new URL(`http://${form}/`).hostname;
  } catch {
    return null;
  }
};

describe('альтернативные записи внутренних адресов — все отказ', () => {
  it('выборка не выродилась: 37 форм, URL принимает большинство', () => {
    expect(FORMS.length).toBe(37);
    expect(FORMS.filter((form) => viaUrl(form) !== null).length).toBeGreaterThanOrEqual(30);
  });

  it.each(FORMS)('%s — отказ сырым и после нормализации URL', (form) => {
    const normalized = viaUrl(form);
    expect({
      raw: nonPublicHostReason(form) !== null,
      normalized: normalized === null ? 'URL не принял' : nonPublicHostReason(normalized) !== null,
    }).toEqual({ raw: true, normalized: normalized === null ? 'URL не принял' : true });
  });

  it('контроль: публичные формы тех же видов проходят (зонд отличает публичное от внутреннего)', () => {
    expect(
      ['8.8.8.8', '0x8.0x8.0x8.0x8', '134744072', '[2606:4700::1111]', '[::ffff:8.8.8.8]', 'example.com'].map(
        (form) => nonPublicHostReason(form),
      ),
    ).toEqual([null, null, null, null, null, null]);
  });

  it('октет больше 255 — не адрес, а отказ: 300.8.8.8 не читается как 44.8.8.8', () => {
    expect(['300.8.8.8', '8.8.8.256', '1.2.3.999'].map((address) => isBlockedIp(address))).toEqual([
      true,
      true,
      true,
    ]);
    expect(isBlockedIp('8.8.8.255')).toBe(false);
  });
});
