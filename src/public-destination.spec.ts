import { isBlockedIp, nonPublicHostReason } from './index';

/**
 * Корпус собран из форм, которые реально доходят до цели: замер libcurl 8.17.0
 * на локальной канарейке доставил запрос по `localhost`, `2130706433`, `0x7f.1`,
 * `0177.0.0.1` и `[::ffff:127.0.0.1]`. Рядом — публичные адреса у самых границ
 * запрещённых диапазонов: проверка, закрывающая лишнее, снимает клиентские цели.
 */
const NON_PUBLIC_HOSTS = [
  '127.0.0.1',
  '127.1',
  '2130706433',
  '0x7f.1',
  '0177.0.0.1',
  '127.0.0.1.',
  '0.0.0.0',
  '10.0.0.1',
  '10.42.0.47',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '100.127.255.255',
  '198.18.0.1',
  '192.0.2.1',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '[::1]',
  '::',
  '::ffff:127.0.0.1',
  '[::ffff:7f00:1]',
  '::ffff:10.0.0.1',
  '64:ff9b::a00:1',
  '::127.0.0.1',
  'fe80::1',
  'fe80::1%eth0',
  'fc00::1',
  'fd12:3456::1',
  'ff02::1',
  '2001:db8::1',
  '2002:7f00:1::1',
  // Добавлены в 0.1.1: в пакете этих диапазонов не было.
  '3fff::1',
  '3fff:fff::1',
  '5f00::1',
  'localhost',
  'LOCALHOST',
  'localhost.',
  'foo.localhost',
  'printer.local',
  'metadata.google.internal',
  'router.home.arpa',
  'nas.lan',
  'dc01.corp',
  'gitlab.home',
  'intranet',
  'a@127.0.0.1',
  'example.com/x',
  'exa mple.com',
  'example.com:8080',
  '',
  '   ',
];

const PUBLIC_HOSTS = [
  'example.com',
  'EXAMPLE.com.',
  'xn--e1afmkfd.xn--p1ai',
  'my_host.example.com',
  'localhost.example.com',
  'a.example',
  'example.ru',
  'lan.example.com',
  '8.8.8.8',
  '1.1.1.1',
  '9.255.255.255',
  '11.0.0.0',
  '100.63.255.255',
  '100.128.0.0',
  '172.15.255.255',
  '172.32.0.0',
  '192.167.255.255',
  '192.169.0.1',
  '169.253.255.255',
  '169.255.0.1',
  '223.255.255.255',
  '2a00:1450:4001:80b::200e',
  '[2606:4700:4700::1111]',
  '2001:4860:4860::8888',
  // Граница 3fff::/20: следующий адрес — обычный глобальный unicast.
  '3fff:1000::1',
  '::ffff:8.8.8.8',
  '64:ff9b::808:808',
];

describe('nonPublicHostReason', () => {
  it('каждая внутренняя форма хоста получает причину отказа', () => {
    expect(NON_PUBLIC_HOSTS.filter((host) => nonPublicHostReason(host) === null)).toEqual([]);
  });

  it('публичные хосты, в том числе у самых границ диапазонов, проходят', () => {
    expect(
      PUBLIC_HOSTS.map((host) => [host, nonPublicHostReason(host)]).filter(([, reason]) => reason !== null),
    ).toEqual([]);
  });

  it('причина называет, что именно не так', () => {
    expect(nonPublicHostReason('2130706433')).toBe('адрес 127.0.0.1 не публичный');
    expect(nonPublicHostReason('intranet')).toBe('имя «intranet» без точки публично не резолвится');
    expect(nonPublicHostReason('printer.local')).toBe(
      'имя «printer.local» в зоне .local публично не резолвится',
    );
  });
});

describe('isBlockedIp (адрес установленного соединения)', () => {
  it('отказывает внутренним адресам в тех формах, в которых их отдаёт libcurl', () => {
    const blocked = ['127.0.0.1', '10.42.0.47', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1'];

    expect(blocked.filter((ip) => !isBlockedIp(ip))).toEqual([]);
  });

  it('пропускает публичные адреса', () => {
    const allowed = ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'];

    expect(allowed.filter((ip) => isBlockedIp(ip))).toEqual([]);
  });

  it('то, что не разбирается как адрес, — отказ, а не пропуск', () => {
    expect(['', 'garbage', '1.2.3', '1::2::3', '::ffff:999.0.0.1'].filter((ip) => !isBlockedIp(ip))).toEqual(
      [],
    );
  });

  it('октет с ведущим нулём (восьмеричная форма для libcurl) — отказ, а не «публичный»', () => {
    // 012.0.0.1 libcurl читает как 10.0.0.1; прежний разбор — как 12.0.0.1.
    expect(
      ['012.0.0.1', '0177.0.0.1', '8.8.8.08', '::ffff:012.0.0.1'].filter((ip) => !isBlockedIp(ip)),
    ).toEqual([]);
    // Контроль: ноль сам по себе — обычный октет.
    expect(isBlockedIp('8.8.0.8')).toBe(false);
  });
});
