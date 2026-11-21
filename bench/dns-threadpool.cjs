'use strict';
/**
 * Замер: держит ли зависший DNS пул потоков libuv, то есть разрешение имён
 * ВСЕГО процесса (БД, Redis, облако), после того как net-guard отдал отказ по
 * таймауту. Гоняется на Linux в контейнере без сети (`scripts/bench-dns-docker.sh`),
 * DNS — неотвечающий сервер на 127.0.0.1:53 (`dns-blackhole.cjs`).
 *
 * На каждую точку — отдельный процесс (свежий пул): N поисков через net-guard
 * к неотвечающему DNS с таймаутом 1 с, затем, когда net-guard уже отдал отказы,
 * — `dns.lookup('localhost')` (getaddrinfo, /etc/hosts) и чтение файла. Ответ
 * `localhost` за миллисекунды — пул свободен; за секунды — пул держат поиски,
 * от которых вызывающий давно ушёл.
 *
 * Запуск точки: `node bench/dns-threadpool.cjs point <dist> <resolver> <n>`.
 * Без аргументов — вся сетка; `--assert` — отказ (код 1), если с текущей
 * сборкой `localhost` ждал дольше потолка хоть в одной точке.
 */
const { execFileSync } = require('node:child_process');
const dns = require('node:dns');
const fs = require('node:fs');
const path = require('node:path');

const GUARD_TIMEOUT_MS = 1_000;
/** Пауза до проверки здоровья: дольше таймаута net-guard, то есть вызывающий уже получил отказ. */
const PROBE_AFTER_MS = 1_200;
/** Потолок ожидания `localhost` в режиме `--assert`: пул свободен — это миллисекунды. */
const HEALTHY_CEILING_MS = 500;

function point(dist, resolver, n) {
  const guard = require(path.resolve(dist, 'index.js'));
  const options = { lookupTimeoutMs: GUARD_TIMEOUT_MS };
  if (resolver !== 'legacy') {
    options.resolver = resolver;
  }
  const lookup = guard.createGuardedLookup(options);
  const started = Date.now();
  const outcomes = [];
  for (let i = 0; i < n; i++) {
    lookup(`hung-${i}.example.com`, { all: true }, (error) => {
      outcomes.push({ ms: Date.now() - started, code: error ? error.code : null });
    });
  }
  setTimeout(() => {
    const probe = Date.now();
    let fileMs = null;
    fs.readFile(__filename, () => {
      fileMs = Date.now() - probe;
    });
    dns.lookup('localhost', (error) => {
      const stats = typeof guard.netGuardStats === 'function' ? guard.netGuardStats().systemLookups : null;
      process.stdout.write(
        `${JSON.stringify({
          resolver,
          hung: n,
          healthyLocalhostMs: Date.now() - probe,
          localhostError: error ? error.code : null,
          readFileMs: fileMs,
          guardOutcomes: outcomes,
          systemLookups: stats,
        })}\n`,
      );
      process.exit(0);
    });
  }, PROBE_AFTER_MS);
}

function grid(assert) {
  const builds = [
    ['before', process.env.NET_GUARD_BEFORE_DIST, ['legacy']],
    ['after', path.resolve(__dirname, '..', 'dist'), ['c-ares', 'system']],
  ].filter(([, dist]) => dist && fs.existsSync(path.join(dist, 'index.js')));
  const failures = [];
  for (const [label, dist, resolvers] of builds) {
    for (const resolver of resolvers) {
      for (const n of [0, 1, 2, 4]) {
        const line = execFileSync(process.execPath, [__filename, 'point', dist, resolver, String(n)], {
          encoding: 'utf8',
          timeout: 120_000,
        }).trim();
        const result = JSON.parse(line);
        process.stdout.write(`${label} ${line}\n`);
        if (label === 'after' && result.healthyLocalhostMs > HEALTHY_CEILING_MS) {
          failures.push(`${resolver}, висящих ${n}: localhost ${result.healthyLocalhostMs} мс`);
        }
      }
    }
  }
  if (assert && !builds.some(([label]) => label === 'after')) {
    failures.push('нет сборки dist — нечего проверять');
  }
  if (assert && failures.length > 0) {
    process.stderr.write(`DNS процесса задержан зависшими поисками:\n  ${failures.join('\n  ')}\n`);
    process.exit(1);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'point') {
  const [dist, resolver, n] = rest;
  point(dist, resolver, Number(n));
} else {
  grid(process.argv.includes('--assert'));
}
