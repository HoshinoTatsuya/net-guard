import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

import { createSafeFetch } from './safe-fetch';
import type { FetchLike } from './types/fetch-like.type';
import type { FetchResponseLike } from './types/fetch-response-like.type';

/**
 * Края безопасного fetch: ответы без тела, спрятанный редирект, тело-поток на
 * 307, заголовки на другой origin, таймер после отдачи ответа. Настоящий undici
 * и сервер на loopback (любое имя ведёт на него), плюс подделки fetch там, где
 * поведение принадлежит реализации, а не серверу.
 */
describe('createSafeFetch: края', () => {
  let server: Server;
  let port = 0;
  let dispatcher: UndiciAgent;
  let seen: Array<{ url: string; host: string | undefined; apiKey: string | undefined; body: string }> = [];
  let routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({
          url: req.url ?? '',
          host: req.headers.host,
          apiKey: req.headers['x-api-key'] as string,
          body,
        });
        const route = routes[req.url ?? ''];
        if (route === undefined) {
          res.end('ok');
          return;
        }
        route(req, res);
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
    dispatcher = new UndiciAgent({
      connect: {
        lookup: (_h: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
          options.all
            ? callback(null, [{ address: '127.0.0.1', family: 4 }])
            : callback(null, '127.0.0.1', 4),
      } as never,
    });
  });

  afterAll(async () => {
    await dispatcher.destroy();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(() => {
    seen = [];
    routes = {};
  });

  const base = (host = 'public.example') => `http://${host}:${port}`;
  const safe = (options: Partial<Parameters<typeof createSafeFetch>[0]> = {}) =>
    createSafeFetch({ dispatcher, fetch: undiciFetch, allowedPorts: 'any', ...options });
  /** Подделка fetch: один и тот же ответ на любой запрос. */
  const fakeFetch =
    (response: FetchResponseLike): FetchLike =>
    async () =>
      response;
  const emptyStream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

  it.each([204, 205, 304])(
    'статус %p, а реализация отдала пустой ПОТОК вместо null — ответ без тела, а не TypeError конструктора',
    async (status) => {
      const response = await createSafeFetch({
        dispatcher: {},
        allowedPorts: 'any',
        fetch: fakeFetch({ status, statusText: 'x', headers: new Headers(), body: emptyStream() }),
      })('http://public.example/');
      expect({ status: response.status, body: response.body, url: response.url }).toEqual({
        status,
        body: null,
        url: 'http://public.example/',
      });
    },
  );

  it('HEAD и 304 с content-length больше потолка — ответ без тела, а не «тело слишком большое»', async () => {
    routes['/big'] = (_req, res) => {
      res.writeHead(200, { 'content-length': String(64 * 1024 * 1024) });
      res.end();
    };
    routes['/not-modified'] = (_req, res) => {
      res.writeHead(304, { 'content-length': String(64 * 1024 * 1024) });
      res.end();
    };
    const capped = safe({ maxResponseBytes: 1024 });
    const head = await capped(`${base()}/big`, { method: 'HEAD' }).then(
      (r) => r.status,
      (e: { code?: string }) => e.code,
    );
    const notModified = await capped(`${base()}/not-modified`).then(
      (r) => r.status,
      (e: { code?: string }) => e.code,
    );
    expect({ head, notModified }).toEqual({ head: 200, notModified: 304 });
  });

  it('HEAD, а реализация отдала пустой поток и content-length больше потолка — ответ без тела', async () => {
    const response = await createSafeFetch({
      dispatcher: {},
      allowedPorts: 'any',
      maxResponseBytes: 1024,
      fetch: fakeFetch({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': String(64 * 1024 * 1024) }),
        body: emptyStream(),
      }),
    })('http://public.example/', { method: 'HEAD' }).then(
      (r) => ({ status: r.status, body: r.body }),
      (e: { code?: string }) => e.code,
    );
    expect(response).toEqual({ status: 200, body: null });
  });

  it('редирект на ответ без тела: url — последний адрес, redirected — true', async () => {
    routes['/r'] = (_req, res) => {
      res.writeHead(302, { location: '/empty' });
      res.end();
    };
    routes['/empty'] = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    const response = await safe()(`${base()}/r`);
    expect({ status: response.status, url: response.url, redirected: response.redirected }).toEqual({
      status: 204,
      url: `${base()}/empty`,
      redirected: true,
    });
  });

  it('спрятанный редирект (opaqueredirect, статус 0) — TypeError, а не пустой ответ; manual — как есть', async () => {
    const opaque = fakeFetch({
      status: 0,
      type: 'opaqueredirect',
      statusText: '',
      headers: new Headers(),
      body: null,
    });
    const failure = await createSafeFetch({ dispatcher: {}, allowedPorts: 'any', fetch: opaque })(
      'http://public.example/',
    ).catch((e: unknown) => e);
    const manual = await createSafeFetch({ dispatcher: {}, allowedPorts: 'any', fetch: opaque })(
      'http://public.example/',
      { redirect: 'manual' },
    );
    expect({
      failure: failure instanceof TypeError && /opaqueredirect/.test(failure.message),
      manual: manual.status,
    }).toEqual({ failure: true, manual: 0 });
  });

  it('307 с телом-потоком — понятный TypeError до второго запроса; 307 с телом-строкой — тело уходит повторно', async () => {
    routes['/307'] = (_req, res) => {
      res.writeHead(307, { location: '/landing' });
      res.end();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('тело'));
        controller.close();
      },
    });
    const failure = await safe()(`${base()}/307`, { method: 'POST', body: stream, duplex: 'half' }).catch(
      (e: unknown) => e,
    );
    const afterStream = seen.map(({ url }) => url);
    seen = [];
    await (await safe()(`${base()}/307`, { method: 'POST', body: 'строка' })).text();
    expect({
      failure: failure instanceof TypeError && /тело-поток|поток, уже прочитанный/.test(failure.message),
      afterStream,
      replayed: seen.map(({ url, body }) => `${url}:${body}`),
    }).toEqual({ failure: true, afterStream: ['/307'], replayed: ['/307:строка', '/landing:строка'] });
  });

  it('на другой origin не уходят заголовки из sensitiveHeaders (настоящий undici); на тот же — уходят', async () => {
    routes['/cross'] = (_req, res) => {
      res.writeHead(302, { location: `${base('other.example')}/landing` });
      res.end();
    };
    routes['/same'] = (_req, res) => {
      res.writeHead(302, { location: '/landing' });
      res.end();
    };
    const fetchWithKey = safe({ sensitiveHeaders: ['X-Api-Key'] });
    await (await fetchWithKey(`${base()}/cross`, { headers: { 'x-api-key': 'k1' } })).text();
    await (await fetchWithKey(`${base()}/same`, { headers: { 'x-api-key': 'k1' } })).text();
    expect(seen.map(({ url, apiKey }) => `${url} key=${apiKey ?? '-'}`)).toEqual([
      '/cross key=k1',
      '/landing key=-',
      '/same key=k1',
      '/landing key=k1',
    ]);
  });

  it('host исходного запроса не уходит на другой origin (undici host сам заменяет — проверка того, что передаёт safeFetch)', async () => {
    const passed: Array<string | null> = [];
    const recording: FetchLike = async (_url, init) => {
      passed.push(new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]).get('host'));
      return passed.length === 1
        ? {
            status: 302,
            statusText: '',
            headers: new Headers({ location: 'http://other.example/' }),
            body: null,
          }
        : { status: 200, statusText: '', headers: new Headers(), body: null };
    };
    await createSafeFetch({ dispatcher: {}, allowedPorts: 'any', fetch: recording })(
      'http://public.example/',
      {
        headers: { host: 'internal.corp' },
      },
    );
    expect(passed).toEqual(['internal.corp', null]);
  });

  it('sensitiveHeaders: не имя заголовка — исключение при создании', () => {
    expect(() => safe({ sensitiveHeaders: ['плохое имя'] })).toThrow('sensitiveHeaders');
  });

  it('таймер timeoutMs держит процесс до ответа и отпускает после: брошенное тело не мешает выйти', async () => {
    // Таймеры с задержкой ровно timeoutMs: у undici свои таймеры, их здесь не считаем.
    const TIMEOUT_MS = 4_321;
    const timers: NodeJS.Timeout[] = [];
    const original = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
      const timer = original(handler, ms);
      if (ms === TIMEOUT_MS) {
        timers.push(timer);
      }
      return timer;
    }) as never);
    routes['/slow-body'] = (_req, res) => {
      res.write('начало');
    };
    const response = await safe({ timeoutMs: TIMEOUT_MS })(`${base()}/slow-body`);
    const [timer] = timers;
    expect({ status: response.status, timers: timers.length, holdsProcess: timer?.hasRef() }).toEqual({
      status: 200,
      timers: 1,
      holdsProcess: false,
    });
    await response.body?.cancel();
  });
});
