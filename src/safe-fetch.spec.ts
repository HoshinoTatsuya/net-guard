import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildConnector, Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

import { BlockedDestinationError } from './blocked-destination.error';
import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { createGuardedDispatcher } from './guarded-dispatcher';
import { nonPublicUrlReason } from './non-public-url-reason';
import { createSafeFetch } from './safe-fetch';
import type { BlockedEvent } from './types/blocked-event.type';
import type { FetchLike } from './types/fetch-like.type';

/**
 * Безопасный fetch против настоящего undici и настоящего сервера на loopback.
 * Тестовый dispatcher соединяет ЛЮБОЕ имя с сервером (как если бы
 * `public.example` резолвился в него) — так проверяется логика редиректов и
 * потолков; защищённый dispatcher проверяется отдельно, в конце.
 */
// Без приведения: `fetch` undici принимается как есть (README).
const fetchImpl: FetchLike = undiciFetch;

describe('nonPublicUrlReason: схема, порт, хост', () => {
  it.each([
    ['https://example.com/', null],
    ['http://example.com:80/', null],
    ['http://example.com:6379/', 'порт 6379'],
    ['https://example.com:8443/', 'порт 8443'],
    ['file:///etc/passwd', 'схема file:'],
    ['gopher://example.com/', 'схема gopher:'],
    ['http://169.254.169.254/latest/', 'не публичный'],
    ['http://[::ffff:127.0.0.1]/', 'не публичный'],
    ['http://metadata.google.internal/', 'зоне .internal'],
    ['не url', 'не разбирается'],
  ])('%s → %p', (url, expected) => {
    const reason = nonPublicUrlReason(url);
    expect(reason === null ? null : expected !== null && reason.includes(expected) ? expected : reason).toBe(
      expected,
    );
  });

  it('свои порты и схемы; any — без проверки порта; пустые списки — исключение', () => {
    expect(nonPublicUrlReason('https://example.com:8443/', { allowedPorts: [443, 8443] })).toBeNull();
    expect(nonPublicUrlReason('http://example.com:6379/', { allowedPorts: 'any' })).toBeNull();
    expect(nonPublicUrlReason('http://example.com/', { allowedSchemes: ['https'] })).toContain('схема http:');
    expect(() => nonPublicUrlReason('https://example.com/', { allowedPorts: [] })).toThrow('allowedPorts');
    expect(() => nonPublicUrlReason('https://example.com/', { allowedSchemes: [] })).toThrow(
      'allowedSchemes',
    );
    expect(() => nonPublicUrlReason('https://example.com/', { allowedPorts: [0] })).toThrow('allowedPorts');
  });
});

describe('createSafeFetch', () => {
  let server: Server;
  let port = 0;
  let requests: Array<{
    url: string;
    method: string;
    authorization: string | undefined;
    host: string | undefined;
  }> = [];
  let dispatcher: UndiciAgent;
  let routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push({
        url: req.url ?? '',
        method: req.method ?? '',
        authorization: req.headers.authorization,
        host: req.headers.host,
      });
      const route = routes[(req.url ?? '').split('?')[0] ?? ''];
      if (route === undefined) {
        res.statusCode = 404;
        res.end('нет');
        return;
      }
      route(req, res);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
    // Любое имя → сервер на loopback: так «публичные» имена доходят до фикстуры.
    dispatcher = new UndiciAgent({
      connect: {
        lookup: (
          _host: string,
          options: { all?: boolean | undefined },
          callback: (...args: unknown[]) => void,
        ) =>
          options.all
            ? callback(null, [{ address: '127.0.0.1', family: 4 }])
            : callback(null, '127.0.0.1', 4),
      } as never,
    });
  });

  afterAll(async () => {
    // destroy, а не close: close ждёт ответов, которые сервер-молчун не даст никогда.
    await dispatcher.destroy();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(() => {
    requests = [];
    routes = {};
  });

  const base = (host = 'public.example') => `http://${host}:${port}`;
  const safe = (options: Partial<Parameters<typeof createSafeFetch>[0]> = {}) =>
    createSafeFetch({ dispatcher, fetch: fetchImpl, allowedPorts: 'any', ...options });
  const redirect =
    (status: number, location: () => string) => (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(status, { location: location() });
      res.end();
    };

  it('простой ответ: тело, url, redirected=false', async () => {
    routes['/ok'] = (_req, res) => res.end('привет');
    const response = await safe()(`${base()}/ok`);
    expect({ text: await response.text(), url: response.url, redirected: response.redirected }).toEqual({
      text: 'привет',
      url: `${base()}/ok`,
      redirected: false,
    });
  });

  it('цепочка редиректов проходится, итоговый url и redirected переносятся', async () => {
    routes['/r1'] = redirect(302, () => `${base()}/r2`);
    routes['/r2'] = redirect(301, () => '/ok');
    routes['/ok'] = (_req, res) => res.end('финиш');
    const response = await safe()(`${base()}/r1`);
    expect({
      text: await response.text(),
      url: response.url,
      redirected: response.redirected,
      paths: requests.map(({ url }) => url),
    }).toEqual({ text: 'финиш', url: `${base()}/ok`, redirected: true, paths: ['/r1', '/r2', '/ok'] });
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'host'],
    ['http://[::ffff:a9fe:a9fe]/', 'host'],
    ['file:///etc/passwd', 'scheme'],
  ])('редирект на %s — отказ ДО запроса, событие аудита', async (target, stage) => {
    routes['/r'] = redirect(302, () => target);
    const events: BlockedEvent[] = [];
    const failure = await safe({ onBlocked: (event) => events.push(event) })(`${base()}/r`).catch(
      (e: unknown) => e,
    );
    expect({
      error: failure instanceof BlockedDestinationError ? failure.stage : String(failure),
      requests: requests.map(({ url }) => url),
      events: events.map((event) => event.stage),
    }).toEqual({ error: stage, requests: ['/r'], events: [stage] });
  });

  it('редирект на внутренний порт публичного хоста — отказ по порту (allowedPorts)', async () => {
    routes['/r'] = redirect(302, () => 'http://public.example:6379/');
    const failure = await safe({ allowedPorts: [port] })(`${base()}/r`).catch((e: unknown) => e);
    expect((failure as BlockedDestinationError).stage).toBe('port');
    expect(requests.map(({ url }) => url)).toEqual(['/r']);
  });

  it('бесконечные редиректы — отказ после maxRedirects, запросов ровно maxRedirects + 1', async () => {
    routes['/loop'] = redirect(302, () => `${base()}/loop?n=${requests.length}`);
    const failure = await safe({ maxRedirects: 3 })(`${base()}/loop`).catch((e: unknown) => e);
    expect({ code: (failure as { code?: string }).code, requests: requests.length }).toEqual({
      code: NET_GUARD_ERROR_CODE.tooManyRedirects,
      requests: 4,
    });
  });

  it('maxRedirects: 0 — первый же редирект отказ', async () => {
    routes['/r'] = redirect(302, () => '/ok');
    const failure = await safe({ maxRedirects: 0 })(`${base()}/r`).catch((e: unknown) => e);
    expect((failure as { code?: string }).code).toBe(NET_GUARD_ERROR_CODE.tooManyRedirects);
  });

  it('тело больше потолка с content-length — отказ сразу; без него (chunked) — при чтении', async () => {
    const big = Buffer.alloc(64 * 1024, 1);
    routes['/declared'] = (_req, res) => {
      res.setHeader('content-length', big.length);
      res.end(big);
    };
    routes['/chunked'] = (_req, res) => {
      res.write(big.subarray(0, 40_000));
      res.end(big.subarray(40_000));
    };
    const fetchCapped = safe({ maxResponseBytes: 50_000 });
    const declared = await fetchCapped(`${base()}/declared`).catch((e: unknown) => e);
    const chunked = await fetchCapped(`${base()}/chunked`);
    const read = await chunked.arrayBuffer().catch((e: unknown) => e);
    expect([(declared as { code?: string }).code, (read as { code?: string }).code]).toEqual([
      NET_GUARD_ERROR_CODE.responseTooLarge,
      NET_GUARD_ERROR_CODE.responseTooLarge,
    ]);
  });

  it('тело ровно в потолок — проходит (граница)', async () => {
    routes['/exact'] = (_req, res) => {
      res.write(Buffer.alloc(30_000, 2));
      res.end(Buffer.alloc(20_000, 2));
    };
    const response = await safe({ maxResponseBytes: 50_000 })(`${base()}/exact`);
    expect((await response.arrayBuffer()).byteLength).toBe(50_000);
  });

  it('сервер молчит — отказ ERR_NET_GUARD_FETCH_TIMEOUT; тело тянется — тоже', async () => {
    routes['/silent'] = () => undefined;
    routes['/slow-body'] = (_req, res) => {
      res.write('начало');
    };
    const fetchQuick = safe({ timeoutMs: 100 });
    const silent = await fetchQuick(`${base()}/silent`).catch((e: unknown) => e);
    const slow = await fetchQuick(`${base()}/slow-body`);
    const body = await slow.text().catch((e: unknown) => e);
    expect([(silent as { code?: string }).code, (body as { code?: string }).code]).toEqual([
      NET_GUARD_ERROR_CODE.fetchTimeout,
      NET_GUARD_ERROR_CODE.fetchTimeout,
    ]);
  });

  it('учётные данные не уходят на другой origin после редиректа; на тот же — уходят', async () => {
    routes['/same'] = redirect(302, () => `${base()}/landing`);
    routes['/cross'] = redirect(302, () => `${base('other.example')}/landing`);
    routes['/landing'] = (_req, res) => res.end('ok');
    const fetchWithAuth = safe();
    await (await fetchWithAuth(`${base()}/same`, { headers: { authorization: 'Bearer t' } })).text();
    await (await fetchWithAuth(`${base()}/cross`, { headers: { authorization: 'Bearer t' } })).text();
    expect(requests.map(({ url, authorization }) => `${url}:${authorization ?? '-'}`)).toEqual([
      '/same:Bearer t',
      '/landing:Bearer t',
      '/cross:Bearer t',
      '/landing:-',
    ]);
  });

  it('303 на POST — следующий запрос GET без тела', async () => {
    routes['/form'] = redirect(303, () => '/done');
    routes['/done'] = (_req, res) => res.end('ok');
    await (await safe()(`${base()}/form`, { method: 'POST', body: 'a=1' })).text();
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual(['POST /form', 'GET /done']);
  });

  it("redirect: 'manual' — редирект отдаётся как есть", async () => {
    routes['/r'] = redirect(302, () => 'http://169.254.169.254/');
    const response = await safe()(`${base()}/r`, { redirect: 'manual' });
    expect({ status: response.status, requests: requests.length }).toEqual({ status: 302, requests: 1 });
  });

  it('без dispatcher и с опечаткой в потолках — исключение при создании', () => {
    expect(() => createSafeFetch({ dispatcher: undefined })).toThrow('защищённый dispatcher');
    expect(() => createSafeFetch({ dispatcher, maxRedirects: -1 })).toThrow('maxRedirects');
    expect(() => createSafeFetch({ dispatcher, maxResponseBytes: 0 })).toThrow('maxResponseBytes');
    expect(() => createSafeFetch({ dispatcher, timeoutMs: 1.5 })).toThrow('timeoutMs');
  });

  it('с защищённым dispatcher: имя, разрешающееся в loopback, — отказ в коннекторе, сервер запроса не получил', async () => {
    const guarded = createGuardedDispatcher({ Agent: UndiciAgent, buildConnector } as never, {
      allowedPorts: 'any',
      resolve: (_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
    });
    try {
      const failure = await createSafeFetch({ dispatcher: guarded, fetch: fetchImpl, allowedPorts: 'any' })(
        `${base()}/ok`,
      ).catch((e: unknown) => e);
      expect({
        cause: ((failure as { cause?: unknown }).cause as BlockedDestinationError | undefined)?.address,
        requests: requests.length,
      }).toEqual({ cause: '127.0.0.1', requests: 0 });
    } finally {
      await (guarded as UndiciAgent).close();
    }
  });
});
