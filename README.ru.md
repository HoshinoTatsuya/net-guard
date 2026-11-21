# @hoshinotatsuya/net-guard

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/net-guard.svg)](https://www.npmjs.com/package/@hoshinotatsuya/net-guard)
[![CI](https://github.com/HoshinoTatsuya/net-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/net-guard/actions/workflows/ci.yml)

[English](./README.md) · [Changelog](./CHANGELOG.md)

Публичен ли адрес назначения исходящего запроса (защита от SSRF): внутренние службы самого сервиса, Redis, исходящий прокси и служба метаданных облака `169.254.169.254` — не цели.

Заменяет два вида самописной проверки одной политики: собственный разборщик адресов с набором констант и проверку на `node:net` BlockList, которая по форме имени отсекает только `localhost`.

Пакет строже второго вида: имена без точки, `*.internal`, `*.local`, `*.lan`, `*.corp`, `*.home` и формы вида `0x7f.1` / `2130706433` отвергаются на этапе схемы, а не только после DNS. Переходя с такой проверки, перед выкаткой прогнать сквозные тесты потребителя.

## Установка

```sh
npm install @hoshinotatsuya/net-guard
# только для коннектора, dispatcher или безопасного fetch на undici:
npm install undici
```

| Требование | |
|---|---|
| Node.js | ≥ 24 |
| `undici` | `^7.10.0 \|\| ^8.0.0`, необязательный peer. Пакет его не импортирует — модуль передаёт вызывающий, зависимости в рантайме нет |

Пакет — CommonJS с декларациями типов, грузится и из ESM.

## Быстрый старт

```ts
import { get } from 'node:https';
import {
  createGuardedAgents,
  isBlockedIp,
  nonPublicHostReason,
  nonPublicResolvedReason,
  nonPublicUrlReason,
} from '@hoshinotatsuya/net-guard';
```

```ts
export async function validateUserInput(url: string, host: string): Promise<void> {
  console.log(nonPublicUrlReason(url)); // scheme, port and host of the whole URL; null = allowed
  console.log(nonPublicHostReason('0x7f.1')); // the reason text: 127.0.0.1 is not public
  console.log(nonPublicHostReason('example.com')); // null
  console.log(await nonPublicResolvedReason(host)); // checks EVERY address from DNS; a DNS failure is a refusal
}
```

Весь код этого README — выдержки из [`examples/`](./examples): `pnpm run typecheck` компилирует их против исходников пакета, а спека `src/readme-examples.spec.ts` краснеет, если блок README разошёлся с примерами. Комментарии в примерах — по-английски.

Клиенты: `node:http(s)` — `createGuardedAgents`; undici и `fetch` — `createGuardedDispatcher` / `createGuardedConnect` / `createSafeFetch`; axios — `guardedAxiosConfig`; got — `guardedGotOptions`; `node:http2` — `createGuardedHttp2Connect`; за HTTP-прокси — `createGuardedProxyAgents` или `proxy` у коннектора undici.

Не смогли определить — значит запрещено: неразборный адрес, отказ резолвера, пустой ответ DNS.

## Что считается непубличным

| | отказ |
|---|---|
| IPv4 | `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4` и Azure WireServer `168.63.129.16/32` (`BLOCKED_IPV4_SUBNETS`) |
| IPv6 | всё вне глобального unicast `2000::/3`, а также `::/96`, `::ffff:0:0:0/96`, `64:ff9b:1::/48`, `100::/64`, `2001::/23`, `2001:db8::/32`, `2002::/16`, `3fff::/20`, `5f00::/16`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8` (`BLOCKED_IPV6_SUBNETS`). IPv4-mapped и NAT64 (`64:ff9b::/96` и свои `extraNat64Prefixes`) судятся по встроенному IPv4 |
| формы адреса | все формы, которые принимают libcurl и `inet_aton`: `0x7f.1`, `2130706433`, `127.1`, точка в конце; октет с ведущим нулём (`012.0.0.1`, у libcurl — восьмеричный) — неразборная форма, то есть отказ |
| имена | без точки, `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.home.arpa`, `*.lan`, `*.corp`, `*.home`, `metadata.tencentyun.com` (`BLOCKED_NAME_SUFFIXES`) — отказ до DNS; остальные — отказ, если ХОТЬ ОДИН адрес из DNS непубличный |
| порты и схемы | по умолчанию только 80 и 443, `http:`/`https:` |
| unix-сокет | `socketPath` в настройках клиента — отказ |

Пакет строже самописной проверки на `node:net` BlockList, которая по форме имени отсекает только `localhost`: имена без точки, внутренние зоны и формы вида `0x7f.1` / `2130706433` отвергаются на этапе схемы, а не только после DNS. Переходя с такой проверки, перед выкаткой прогнать сквозные тесты потребителя.

## API

| Функция | Ответ | Что делает |
|---|---|---|
| `nonPublicHostReason(host, options?)` | причина или `null` | форма хоста без DNS: литералы, имена, зоны, порт (`allowPort`) |
| `nonPublicUrlReason(url, options?)` | причина или `null` | схема, порт и хост URL целиком; неразборный URL — причина, а не исключение |
| `nonPublicResolvedReason(host, lookup?, options?)` | `Promise<причина \| null>` | форма хоста, затем КАЖДЫЙ адрес из DNS; отказ резолвера, таймаут (`lookupTimeoutMs`, 10 с) и пустой ответ — причина. DNS-ребиндинг между этой проверкой и соединением не закрывает |
| `isBlockedIp(address, policy?)` | `boolean` | адрес установленного соединения (`socket.remoteAddress`, `PRIMARY_IP` libcurl); неразборный — `true` |

Причины — текст по-русски (`адрес 127.0.0.1 не публичный`); решение — по сравнению с `null`.

### Свои запреты — поверх встроенных

`extraBlockedSubnets` (CIDR, IPv4 и IPv6 вперемешку) и `extraBlockedNameSuffixes` (зоны имён; юникод → punycode, `.Corp.Example.` → `corp.example`) — вторым аргументом `isBlockedIp` / `nonPublicHostReason`, третьим `nonPublicResolvedReason`, в `createGuardedLookup`. Встроенные списки не заменяются. IPv4-подсеть действует и на встроенный IPv4 (`::ffff:a.b.c.d`, NAT64), IPv6-подсеть — и на сами эти префиксы (`::ffff:0:0/96` закрывает все mapped). Опечатка (без префикса, префикс длиннее адреса, `*.corp`, пустая зона) — исключение, а не молча пропущенный запрет.

### Зона IPv6

`fe80::1%eth0`, `[fe80::1%25eth0]` (RFC 6874), `ff02::1%eth0` разбираются: зона снимается, адрес классифицируется — причина «адрес [fe80::1%eth0] не публичный» вместо прежнего «не разбирается». `isBlockedIp` с зоной — по-прежнему всегда отказ: зона бывает у link-local и multicast (они закрыты и так), зона у глобального адреса — нестандартная форма и тоже отказ со своей причиной.

### Хост с портом

`allowPort: true` снимает порт: `example.com:8080`, `10.0.0.1:80`, `[::1]:443`. Голый IPv6 порта не несёт никогда (`::1:443` — тоже адрес). Без опции порт у имени и IPv4 — отказ, как и прежде, но с причиной «указан порт» вместо «не разбирается»; `[IPv6]:порт` разбирался и прежде — так и остаётся. Порт вне 1–65535, пустой (`[::1]:`) и мусор после скобки — отказ (прежде `[адрес]:0` и `[адрес]:` проходили через WHATWG URL).

### `allowPort: false` — порт запрещён в любой форме

Без опции `[IPv6]:порт` по-прежнему снимается (`[2606:4700::1111]:8080` — «публичный»), то есть запрет порта обходится скобками. Явное `allowPort: false` теперь запрещает порт и в этой форме; поведение без опции не меняется. `guardedLookup` получает имя от `net` и порт в нём не принимает никогда.

### Агенты `node:http(s)`: `createGuardedHttpAgent`, `createGuardedHttpsAgent`, `createGuardedAgents`

`new http.Agent({ lookup: guardedLookup })` НЕ защищает от литерала адреса: для `http://169.254.169.254/` и `http://127.0.0.1/` `net` соединяется без `lookup`, и запрос уходит (проверено на сервере на 127.0.0.1 — 200 и одно соединение). Агенты пакета проверяют литерал в `createConnection` (формы, которые `net` литералом не считает, — `0x7f.1`, `[::1]` — уходят в защищённый `lookup`), имя — через `guardedLookup`, а `socketPath` (unix-сокет) — отказ. `lookup` из настроек запроса защиту не подменяет. Отказ — `'error'` у запроса с `BlockedDestinationError`, сокет не создаётся.


Для undici — `createGuardedConnect(buildConnector)`: одного `connect.lookup: guardedLookup` мало, литерал и редирект на литерал проходят.

### `guardedLookup` — проверка адреса, с которым клиент соединится


Форма `dns.lookup` (колбэк, `all: true`, `family` числом или в объекте, `hints`, `order`): разрешает имя во ВСЕ адреса и отказывает, если хотя бы один не публичный. Проверяется ровно тот ответ DNS, по которому клиент соединяется, — DNS-ребиндинг между проверкой и соединением закрыт. Форма имени (`localhost`, `*.internal`, имя без точки) отвергается до DNS. Отказ — `BlockedDestinationError` с `code === NET_GUARD_ERROR_CODE.blockedDestination` (сокет и HTTP-клиент отдают его в `'error'`), ошибка резолвера — как есть. Своя функция резолвера — опция `resolve`.

Ограничение: хост-литерал (`http://10.0.0.1/`) `net` соединяет БЕЗ `lookup` — его проверяет `nonPublicHostReason` до запроса. Проверено на `http.Agent` с настоящим сервером на loopback: отказ до соединения (у сервера ноль подключений), контроль без защиты — 200.

### Готовые подключения клиентов (без зависимостей)

- **undici** — `createGuardedDispatcher(undici, { agent, connect, …политика })`: `Agent` с защищённым коннектором (литералы адресов тоже — их `net` соединяет без lookup). Модуль undici передаёт вызывающий. Поддерживаемые мажоры — 7 и 8 (необязательный peer `^7.10.0 || ^8.0.0`).
- **axios** — `axios.create(guardedAxiosConfig())`: пара агентов, `proxy: false`, `maxRedirects`, `maxContentLength`/`maxBodyLength`, `timeout`.
- **got** — `got.extend(guardedGotOptions())`: `agent: { http, https }`, `http2: false` (http2 got ведёт мимо агентов), `maxRedirects`, `timeout.request`. Потолка тела у got нет.
- axios и got проверены контрактом (форма настроек, агенты защищённые); на настоящих axios и got — **не проверялось** (их нет в зависимостях пакета).

```ts
// axios.create(axiosConfig): guarded agents, proxy: false, redirect, size and time limits.
export const axiosConfig = guardedAxiosConfig({ ...policy, timeoutMs: 10_000 });

// got.extend(gotOptions): guarded agents, http2: false (got's http2 bypasses agents).
export const gotOptions = guardedGotOptions(policy);
```

### Безопасный fetch

```ts
// Every connection of this Agent is checked, the first one and after each redirect.
const dispatcher = createGuardedDispatcher(undici, { agent: { keepAliveTimeout: 10_000 } });

// Redirects (≤ 5), body size (≤ 10 MiB) and total time (≤ 30 s) are capped; credentials do not follow
// a redirect to another origin.
const safeFetch = createSafeFetch({ dispatcher, fetch: undici.fetch, sensitiveHeaders: ['x-api-key'] });

export async function download(url: string): Promise<string | null> {
  try {
    const response = await safeFetch(url);
    return await response.text();
  } catch (error) {
    // URL checks (first URL and every redirect) throw BlockedDestinationError; a refused connection (a name that
    // resolves to an internal address) arrives as fetch's TypeError with the BlockedDestinationError in `cause`.
    const blocked = error instanceof BlockedDestinationError ? error : (error as { cause?: unknown }).cause;
    if (blocked instanceof BlockedDestinationError) {
      return null; // blocked.stage: host | address | empty-answer | port | scheme | socket-path
    }
    if ((error as { code?: unknown }).code === NET_GUARD_ERROR_CODE.responseTooLarge) {
      return null;
    }
    throw error;
  }
}
```


`createSafeFetch({ dispatcher, fetch, maxRedirects, maxResponseBytes, timeoutMs })` — `fetch`, в котором КАЖДЫЙ редирект проверяется до запроса (схема, порт, хост), редиректов не больше 5, тело не длиннее 10 МиБ (отказ сразу по `content-length` или при чтении — источник отменяется), весь запрос с редиректами и чтением тела не дольше 30 с. Учётные данные (`authorization`, `cookie`) на другой origin после редиректа не уходят; 303 и POST на 301/302 становятся GET без тела. `dispatcher` обязателен — защищённый (`createGuardedDispatcher`): проверка URL видит только форму хоста, а имя во внутренний адрес и DNS-ребиндинг закрывает коннектор. Отказы: `BlockedDestinationError`, `ERR_NET_GUARD_TOO_MANY_REDIRECTS`, `ERR_NET_GUARD_RESPONSE_TOO_LARGE`, `ERR_NET_GUARD_FETCH_TIMEOUT`.


### http2

`createGuardedHttp2Connect(policy)` — `http2.connect` с защитой: клиенты `node:http2` идут мимо агентов `http(s)`. Форма хоста, литерал и порт — исключение из вызова (подставной сокет с ошибкой не годится: сессия успевает сказать `'connect'`); имя, разрешившееся во внутренний адрес, — `'error'` сессии. Проверено против h2c-сервера на loopback: ноль TCP-соединений на каждый отказ.

```ts
// node:http2 bypasses http(s) agents: use the guarded connect.
const connect = createGuardedHttp2Connect({ ...policy, allowedPorts: [443, 8443] });
export const openSession = (authority: string) => connect(authority);

// Behind an HTTP proxy: the target is checked, the proxy gets CONNECT to the checked address literal.
export const proxied = createGuardedProxyAgents({ proxy: 'http://proxy.example:3128', ...policy });
```

### Прокси: проверка не должна переезжать с цели на прокси

С `HTTP_PROXY` (axios читает его сам) и с undici `ProxyAgent` клиент соединяется с ПРОКСИ: защищённый агент или коннектор видит адрес прокси, а цель уходит прокси строкой — её не проверяет никто, и прокси (у которого есть доступ во внутреннюю сеть) сходит на `169.254.169.254`. Молча.

- axios: `proxy: false` обязателен (`guardedAxiosConfig` его ставит).
- Если прокси нужен — **`createGuardedProxyAgents({ proxy })`** (node:http(s), axios, got) или **`proxy` у `createGuardedConnect`/`createGuardedDispatcher`** (undici). Цель проверяется как обычно (форма, порт, все адреса из DNS), прокси получает `CONNECT` на ПРОВЕРЕННЫЙ ЛИТЕРАЛ адреса — сам он имя не разрешает, и DNS-ребиндинг между проверкой и соединением закрыт; TLS к цели — поверх туннеля, с именем в SNI. Учётные данные — `http://user:pass@proxy:3128`. Обычный HTTP тоже идёт туннелем (`CONNECT адрес:80`); прокси, разрешающий CONNECT только на 443, ответит отказом — это ошибка `ERR_NET_GUARD_PROXY_TUNNEL_FAILED`, а не обход. Проверено против настоящего CONNECT-прокси на loopback (тест): у прокси ровно один `CONNECT 93.184.216.34:80` на разрешённую цель и ноль — на запрещённые. На внешнем корпоративном прокси не проверялось.

### Порты и схемы

`allowedPorts` (по умолчанию `[80, 443]`, `'any'` — без проверки) — у агентов, коннектора undici, http2, прокси, безопасного fetch и `nonPublicUrlReason`; `allowedSchemes` (по умолчанию `http:`/`https:`) — у URL-проверок. SSRF на внутренний порт публичного адреса (Redis на :6379, панель на :8080) — тот же класс, что внутренний адрес. Пустой список — исключение, а не «без ограничений».

### Резолвер: c-ares по умолчанию; почему не getaddrinfo

`dns.lookup` — это `getaddrinfo` в пуле потоков libuv, и таймаут пакета отпускал ВЫЗЫВАЮЩЕГО, но не поток: getaddrinfo доживал до своего таймаута (секунды) в пуле. libuv отдаёт getaddrinfo не больше половины пула (4 потока → 2), и в эту же очередь встаёт разрешение имён ВСЕГО процесса — драйвер БД, Redis, клиент облака. Файловый ввод-вывод и `crypto` не страдают (у них своя квота).

Замер на Linux (`node:24-bookworm-slim`, контейнер без сети, DNS — неотвечающий сервер на 127.0.0.1), `lookupTimeoutMs: 1000`, затем `dns.lookup('localhost')` того же процесса:

| зависших поисков через net-guard | 0.5.0 | 0.6.0, c-ares (по умолчанию) | 0.6.0, `resolver: 'system'` |
|---|---|---|---|
| 0 | 15 мс | 12 мс | 10 мс |
| 1 | 7 мс | 12 мс | 7 мс |
| 2 | **8 821 мс** | 11 мс | 7 мс (второй — отказ `BUSY` за 6 мс) |
| 4 | **18 838 мс** | 11 мс | 6 мс (три — отказ `BUSY`) |

В версии 0.5.0 пакет во всех точках отдавал `ETIMEOUT` через ~1 с — то есть таймаут создавал впечатление, что проблема закрыта. Воспроизведение: `pnpm build && sh scripts/bench-dns-docker.sh [dist прежней версии]` (нужен docker; код 1 — DNS процесса задержан хоть в одной точке; на 0.5.0 — красный по этой причине).

Как устроено:

- **`resolver: 'c-ares'` по умолчанию** — `dns.Resolver`: запросы идут сокетами в цикле событий, пул потоков не занимают, и таймаут ОТМЕНЯЕТ запрос (`resolver.cancel()`). Серверы — `dns.getServers()` (то есть и `dns.setServers()` потребителя). Резолвер — на один поиск (отмена у c-ares снимает все запросы резолвера), завершённые переиспользуются.
- **`resolver: 'system'`** — getaddrinfo, только явно. Нужен, если имена берутся из `/etc/hosts`, nsswitch, mDNS или `search`-доменов resolv.conf: **c-ares их не читает**. У системного резолвера — общий на процесс потолок одновременных поисков: на единицу меньше медленной квоты libuv (`UV_THREADPOOL_SIZE` 4 → 1, 8 → 3, 64 → 31), чтобы хоть один поток квоты всегда оставался остальному процессу. Слот освобождается на НАСТОЯЩЕМ ответе getaddrinfo, а не на таймауте; сверх потолка поиск ждёт слота в очереди пакета (не в пуле libuv) до `lookupTimeoutMs`; ждущих больше 1024 — отказ `ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY`. Счётчик общий для всех копий пакета в процессе (ключ в `globalThis`).
- `nonPublicResolvedReason` по умолчанию — тот же c-ares (`resolver` в настройках); свой `lookup` вторым аргументом отменить нельзя — таймаут его только отпускает.
- `netGuardStats().systemLookups` — `{ inFlight, limit, waiting, refused }`: сколько getaddrinfo сейчас в пуле (в том числе тех, от которых вызывающий уже ушёл), сколько ждут слота и сколько отказано.

### Каталог служб метаданных облаков

`CLOUD_METADATA_ENDPOINTS` — AWS, GCP, Azure, Yandex Cloud, Alibaba, Oracle, DigitalOcean, Tencent, OpenStack: имена, IPv4, IPv6. Тест сверяет, что каждая запись закрыта встроенной политикой; для этого во встроенные списки добавлены **Azure WireServer `168.63.129.16/32`** (публичный диапазон) и имя **`metadata.tencentyun.com`** (публичная зона, внутри облака — link-local).

### Аудит

`onBlocked(event)` — у lookup, агентов, коннектора, http2, прокси и безопасного fetch: `{ stage, target, reason, address }` на каждый отказ. Исключение хука отказ не отменяет — оно становится предупреждением процесса. `netGuardStats().blocked` — счётчики отказов по шагам (`host`, `address`, `empty-answer`, `port`, `scheme`, `socket-path`) для метрики. `BlockedDestinationError.stage` — тот же шаг.

```ts
const onBlocked: OnBlocked = (event) => console.warn('blocked', event.stage, event.target, event.reason);

// Your own internal networks and zones on top of the built-in lists (they can only narrow).
const policy = {
  extraBlockedSubnets: ['10.200.0.0/16', '2a02:6b8:c00::/40'],
  extraBlockedNameSuffixes: ['corp.example'],
  onBlocked,
};
```

## Предел

Замер `bench/capacity.cjs` (`pnpm build && node bench/capacity.cjs`; сеть не нужна, резолвер подставной), Node 24 на ноутбуке, одно ядро:

| проверка | встроенная политика | с доп. подсетями и зонами |
|---|---|---|
| `isBlockedIp` | 0.9 млн/с (1.1 мкс) | 0.42 млн/с (2.4 мкс) |
| `nonPublicHostReason` | 1.7 млн/с (0.6 мкс) | 0.45 млн/с (2.2 мкс) |
| `nonPublicResolvedReason`, 3 адреса | 3.1 мкс | 3.8 мкс |
| `createGuardedLookup` поверх резолвера | — | +1.5 мкс к резолверу (14.1 против 12.6) |

- Агент платит за проверку только на НОВОМ соединении (keep-alive переиспользует проверенное) — микросекунды против миллисекунд DNS и TCP: предела, достижимого раньше сети, у библиотеки нет.
- Функции без созданного заранее объекта разбирают настройки на каждом вызове: с дополнительными списками вызов вдвое–вчетверо дороже. Это сознательно (кэш по объекту настроек не увидел бы правки массива после первого вызова) и заметно только на горячем пути с сотнями тысяч проверок в секунду — там создайте `createGuardedLookup`/агент один раз.

## Гарантии и ограничения

- **Проверка — в момент соединения:** с агентами, коннектором, dispatcher и http2 клиент соединяется только с одобренным адресом, на каждом НОВОМ соединении.
- **Строковые проверки сами по себе DNS-ребиндинг не закрывают** — `nonPublicResolvedReason` разрешает имя отдельно от клиента: это ранняя проверка ввода, а не единственная защита.
- **Проверено против настоящих серверов на loopback:** `http.Agent`, undici 7 и 8 (коннектор, dispatcher, fetch), настоящий CONNECT-прокси, h2c-сервер; батарея обходов SSRF — в контейнере без сети на Node 24 и 26 через агент, безопасный fetch, axios и http2: ни одного запроса до сервера на loopback.
- **Не проверялось:** настоящие axios и got (только форма настроек и защищённость агентов — их нет в зависимостях), внешний корпоративный прокси.
- **c-ares не читает `/etc/hosts`, nsswitch, mDNS и `search`-домены** — для них `resolver: 'system'` или свой `resolve`.
- **Тексты причин и ошибок — по-русски.** Коды (`code`, `stage`), константы и контракт «`null` — можно» стабильны; разбирать текст не нужно.

## Поведение при отказах

«Не смогли определить» — значит «запрещено»: неразборный адрес или хост, ошибка и таймаут резолвера, пустой ответ DNS, хоть один непубличный адрес в ответе, IPv6 вне `2000::/3`. Опечатка в настройках (пустой список портов или схем, подсеть без префикса, зона с `*`, нецелый потолок, `agent.connect` или `socketPath`) — исключение при создании, а не «без ограничений». Безопасный fetch без dispatcher — исключение при создании.

## Совместимость

| | поддерживается и проверено |
|---|---|
| Node.js | ≥ 24 (батарея обходов — ещё и на Node 26) |
| undici | 7.10.0, последняя 7, 8.0.0, последняя 8 (матрица потребителей) |
| TypeScript потребителя | 6.0 и 7 на собранном пакете (ESM); сам пакет собирается 5.9 |
| Клиенты | `node:http`, `node:https`, `node:http2`, undici, глобальный `fetch`; axios и got — объектами настроек |

## Проверка и разработка

```sh
pnpm install
pnpm run typecheck       # src и examples/
pnpm run lint            # biome
pnpm test                # группами jest-groups; сеть и docker не нужны
pnpm run test:consumers  # собранный пакет с undici 7/8, нужен доступ к реестру npm
pnpm run build
pnpm run bench:dns       # по желанию: замер голодания DNS, нужен docker
```

`pnpm test` — группы ≤ 300 тестов, ≤ 2 воркера, последовательно, с `jest-assert-no-skipped`. Всё на loopback: серверы HTTP, h2c и CONNECT, подставной DNS для c-ares, дифференциальная сверка разборщика IPv6 с `net.isIPv6`/`BlockList` (20 000 записей, детерминированный сид) и `isBlockedIp` с `node:net` BlockList (40 000 случайных адресов и границы каждой подсети), корпус форм хоста (замер libcurl: `2130706433`, `0x7f.1`, `0177.0.0.1`, `[::ffff:127.0.0.1]` доставляют запрос на loopback). Каждая правка проверена мутацией по числу упавших тестов — подробности по версиям в [CHANGELOG](./CHANGELOG.md).

## Лицензия

[MIT](./LICENSE) © 2026 Hoshino Tatsuya
