#!/usr/bin/env bash
# Матрица потребителей undici: собранный пакет (npm pack) ставится в одноразовые
# ESM-проекты с разными мажорами undici. В каждом:
#   - tsc: модуль undici потребителя принимается `createGuardedDispatcher`,
#     его `buildConnector` — `createGuardedConnect`, его `fetch` — `createSafeFetch`
#     (типы undici настоящие, без приведений);
#   - рантайм против сервера на loopback: контроль без защиты получает 200;
#     защищённые dispatcher, коннектор и безопасный fetch отказывают литералу
#     127.0.0.1 и имени localhost кодом защиты; разрешённое имя проходит до
#     сервера, а имя, разрешающееся во внутренний адрес, — нет. Число запросов у
#     сервера — ровно число разрешённых.
#
# Разрешённый путь без выхода в сеть: `buildConnector` потребителя обёрнут —
# сначала спрашивается защищённый lookup (вердикт защиты), и только ОДОБРЕННЫЙ
# ответ подменяется адресом сервера на loopback. Отказ защиты проходит как есть.
#
# Проверенные мажоры undici — `UNDICI_VERSIONS` ниже; peerDependencies.undici
# обязан покрывать каждый из них (проверяет src/undici-peer.spec.ts).
#
# Запуск: scripts/consumer-matrix.sh. Каталоги — из mkdtemp, удаляются в конце.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/net-guard-consumers-XXXXXX")"
cleanup() {
  case "${WORK}" in
    "${TMPDIR:-/tmp}"/net-guard-consumers-*) rm -rf "${WORK}" ;;
  esac
}
trap cleanup EXIT

UNDICI_VERSIONS=(7.10.0 7.30.2 8.0.0 8.12.4)

(cd "${ROOT}" && pnpm build >/dev/null && npm pack --silent --pack-destination "${WORK}" >/dev/null)
TARBALL="$(ls "${WORK}"/hoshinotatsuya-net-guard-*.tgz)"

CONSUMER_TS="import * as undici from 'undici';
import { createGuardedConnect, createGuardedDispatcher, createSafeFetch } from '@hoshinotatsuya/net-guard';

// skipLibCheck прячет ошибки в декларациях пакета, а нерезолвящийся импорт в них
// молча становится any. Утверждение ниже не компилируется, если экспорт стал any.
type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : true;
export const typed: [
  NotAny<typeof createGuardedDispatcher>, NotAny<typeof createGuardedConnect>, NotAny<typeof createSafeFetch>,
] = [true, true, true];

export const dispatcher = createGuardedDispatcher(undici, { agent: { keepAliveTimeout: 10_000 } });
export const agent = new undici.Agent({ connect: createGuardedConnect(undici.buildConnector) });
export const safeFetch = createSafeFetch({ dispatcher, fetch: undici.fetch });
"

RUNTIME_MJS="import * as undici from 'undici';
import { createServer } from 'node:http';
import { createGuardedConnect, createGuardedDispatcher, createSafeFetch } from '@hoshinotatsuya/net-guard';

// Потолок прогона: зависший запрос обязан стать отказом, а не держать матрицу.
setTimeout(() => { console.error('потолок 60 с: прогон завис'); process.exit(2); }, 60_000).unref();
const GUARD_CODE = 'ERR_NET_GUARD_BLOCKED_DESTINATION';
let requests = 0;
const server = createServer((_req, res) => { requests += 1; res.end('ok'); });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();

// Имена без сети: публичное → документированный публичный адрес, второе → внутренний.
const table = { 'public.example': '93.184.215.14', 'evil.example': '10.1.2.3' };
const resolve = (host, _options, callback) => {
  const address = table[host];
  if (address === undefined) { callback(Object.assign(new Error('ENOTFOUND ' + host), { code: 'ENOTFOUND' }), []); return; }
  callback(null, [{ address, family: 4 }]);
};
// Вердикт — у защищённого lookup; одобренный ответ уводится на сервер фикстуры.
const loopbackConnector = (options) => undici.buildConnector({
  ...options,
  lookup: (host, lookupOptions, callback) => options.lookup(host, lookupOptions, (error, address, family) => {
    if (error) { callback(error); return; }
    if (lookupOptions && lookupOptions.all) { callback(null, [{ address: '127.0.0.1', family: 4 }]); return; }
    callback(null, '127.0.0.1', 4);
  }),
});

const results = {};
const failures = [];
const guardCode = (error) => {
  for (let e = error; e; e = e.cause) { if (e.code === GUARD_CODE) return GUARD_CODE; }
  return 'другая ошибка: ' + String(error && (error.cause?.code ?? error.message));
};
const expectStatus = async (name, run) => {
  try { const response = await run(); await response.text(); results[name] = response.status; }
  catch (error) { results[name] = 'ОТКАЗ ' + guardCode(error); }
  if (results[name] !== 200) failures.push(name);
};
const expectBlocked = async (name, run) => {
  try { const response = await run(); results[name] = 'ПРОШЁЛ ' + response.status; }
  catch (error) { results[name] = guardCode(error); }
  if (results[name] !== GUARD_CODE) failures.push(name);
};
const url = (host) => 'http://' + host + ':' + port + '/';

const control = new undici.Agent();
await expectStatus('контроль без защиты', () => undici.fetch(url('127.0.0.1'), { dispatcher: control }));

const dispatcher = createGuardedDispatcher(undici, { allowedPorts: 'any' });
await expectBlocked('dispatcher: литерал 127.0.0.1', () => undici.fetch(url('127.0.0.1'), { dispatcher }));
await expectBlocked('dispatcher: имя localhost', () => undici.fetch(url('localhost'), { dispatcher }));

const routed = createGuardedDispatcher({ Agent: undici.Agent, buildConnector: loopbackConnector }, { allowedPorts: 'any', resolve });
await expectStatus('dispatcher: разрешённое имя', () => undici.fetch(url('public.example'), { dispatcher: routed }));
await expectBlocked('dispatcher: имя во внутренний адрес', () => undici.fetch(url('evil.example'), { dispatcher: routed }));

const connected = new undici.Agent({ connect: createGuardedConnect(loopbackConnector, { allowedPorts: 'any', resolve }) });
await expectStatus('connect: разрешённое имя', () => undici.fetch(url('public.example'), { dispatcher: connected }));
await expectBlocked('connect: литерал 127.0.0.1', () => undici.fetch(url('127.0.0.1'), { dispatcher: connected }));

const safeFetch = createSafeFetch({ dispatcher: routed, fetch: undici.fetch, allowedPorts: 'any' });
await expectStatus('safeFetch: разрешённое имя', () => safeFetch(url('public.example')));
await expectBlocked('safeFetch: литерал 127.0.0.1', () => safeFetch(url('127.0.0.1')));
await expectBlocked('safeFetch: имя во внутренний адрес', () => safeFetch(url('evil.example')));

// Ровно разрешённые запросы дошли до сервера: контроль и три разрешённых имени.
results['запросов у сервера'] = requests;
if (requests !== 4) failures.push('запросов у сервера');

for (const closable of [control, dispatcher, routed, connected]) await closable.destroy();
server.closeAllConnections();
server.close();
console.log(JSON.stringify({ undici: (await import('undici/package.json', { with: { type: 'json' } })).default.version, results, failures }, null, 1));
process.exit(failures.length === 0 ? 0 : 1);
"

failures=0
run_case() {
  local undici_version="$1" typescript="$2"
  local label="undici-${undici_version}-ts-${typescript}"
  local dir="${WORK}/${label}"
  mkdir -p "${dir}/src"
  cat >"${dir}/package.json" <<JSON
{
  "name": "consumer-${label}",
  "private": true,
  "type": "module",
  "dependencies": {
    "@hoshinotatsuya/net-guard": "file:${TARBALL}",
    "undici": "${undici_version}"
  },
  "devDependencies": {
    "@types/node": "24.0.15",
    "typescript": "${typescript}"
  }
}
JSON
  cat >"${dir}/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2024",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src"]
}
JSON
  printf '%s' "${CONSUMER_TS}" >"${dir}/src/consumer.ts"
  printf '%s' "${RUNTIME_MJS}" >"${dir}/runtime.mjs"
  (cd "${dir}" && pnpm install --prefer-offline --silent >"${dir}/install.log" 2>&1) || {
    echo "${label}: установка не прошла"; tail -5 "${dir}/install.log"; failures=$((failures + 1)); return
  }
  if (cd "${dir}" && node_modules/.bin/tsc -p tsconfig.json >"${dir}/tsc.log" 2>&1); then
    echo "${label}: tsc — зелёный"
  else
    echo "${label}: tsc — КРАСНЫЙ"; head -8 "${dir}/tsc.log"; failures=$((failures + 1))
  fi
  if (cd "${dir}" && node runtime.mjs >"${dir}/runtime.log" 2>&1); then
    echo "${label}: рантайм — зелёный"
  else
    echo "${label}: рантайм — КРАСНЫЙ"; head -30 "${dir}/runtime.log"; failures=$((failures + 1))
  fi
}

for version in "${UNDICI_VERSIONS[@]}"; do
  run_case "${version}" 6.0.3
done
# TypeScript 7 — на последнем undici.
run_case 8.12.4 7.0.2

if [[ "${failures}" -gt 0 ]]; then
  echo "матрица потребителей: красных ${failures}"
  exit 1
fi
echo "матрица потребителей: все зелёные"
