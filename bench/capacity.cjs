'use strict';
/**
 * Замер цены проверок. Запуск: `pnpm build && node bench/capacity.cjs`.
 * Сеть не нужна: резолвер подставной, меряется сама проверка.
 *
 * Главный вопрос — во что обходится вызов С НАСТРОЙКАМИ: функции без
 * созданного заранее объекта (`isBlockedIp`, `nonPublicHostReason`,
 * `nonPublicResolvedReason`) разбирают политику на каждом вызове.
 */
const { performance } = require('node:perf_hooks');
const {
  createGuardedLookup,
  isBlockedIp,
  nonPublicHostReason,
  nonPublicResolvedReason,
} = require('../dist/index.js');

const EXTRA = {
  extraBlockedNameSuffixes: ['corp.example', 'internal.example'],
  extraBlockedSubnets: ['198.51.100.0/24', '2001:db8:1::/48'],
};
const ADDRESSES = ['8.8.8.8', '10.1.2.3', '2a00:1450:4010:c05::71', '::ffff:127.0.0.1', '64:ff9b::a00:1'];
const HOSTS = ['example.com', 'api.service.corp.example', '127.0.0.1:8080', 'xn--e1afmkfd.xn--p1ai', '[::1]'];

function opsPerSecond(label, iterations, body) {
  for (let i = 0; i < Math.min(10_000, iterations); i++) {
    body(i);
  }
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    body(i);
  }
  const seconds = (performance.now() - started) / 1000;
  const rate = Math.round(iterations / seconds);
  console.log(`${label}: ${rate.toLocaleString('ru-RU')} оп/с, ${((seconds / iterations) * 1e6).toFixed(2)} мкс/оп`);
  return rate;
}

async function asyncOpsPerSecond(label, iterations, body) {
  for (let i = 0; i < 1_000; i++) {
    await body(i);
  }
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    await body(i);
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `${label}: ${Math.round(iterations / seconds).toLocaleString('ru-RU')} оп/с, ${((seconds / iterations) * 1e6).toFixed(2)} мкс/оп`,
  );
}

async function main() {
  console.log('## адрес');
  opsPerSecond('isBlockedIp, встроенная политика', 2_000_000, (i) => isBlockedIp(ADDRESSES[i % 5]));
  opsPerSecond('isBlockedIp, с доп. подсетями и зонами', 300_000, (i) => isBlockedIp(ADDRESSES[i % 5], EXTRA));

  console.log('## имя');
  opsPerSecond('nonPublicHostReason, встроенная', 1_000_000, (i) => nonPublicHostReason(HOSTS[i % 5]));
  opsPerSecond('nonPublicHostReason, с доп. подсетями и зонами', 300_000, (i) =>
    nonPublicHostReason(HOSTS[i % 5], EXTRA),
  );

  console.log('## имя + DNS (подставной резолвер, 3 адреса)');
  const lookup = async () => [{ address: '93.184.216.34' }, { address: '2606:2800:220:1::1' }, { address: '1.1.1.1' }];
  await asyncOpsPerSecond('nonPublicResolvedReason, встроенная', 200_000, () =>
    nonPublicResolvedReason('example.com', lookup),
  );
  await asyncOpsPerSecond('nonPublicResolvedReason, с доп. настройками', 200_000, () =>
    nonPublicResolvedReason('example.com', lookup, EXTRA),
  );

  console.log('## lookup агента (на каждое НОВОЕ соединение; политика разобрана один раз)');
  const resolve = (_host, _options, callback) =>
    setImmediate(() => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  const guarded = createGuardedLookup({ ...EXTRA, resolve });
  await asyncOpsPerSecond(
    'createGuardedLookup, с доп. настройками',
    200_000,
    () => new Promise((done, fail) => guarded('example.com', { all: true }, (error) => (error ? fail(error) : done()))),
  );
  await asyncOpsPerSecond(
    'тот же резолвер без проверки (база)',
    200_000,
    () => new Promise((done) => resolve('example.com', { all: true }, () => done())),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
