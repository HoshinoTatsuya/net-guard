#!/bin/sh
# Замер «зависший DNS и пул потоков libuv» на Linux (база: node:24-bookworm-slim).
# Контейнер без сети (--network none): DNS — неотвечающий сервер на 127.0.0.1:53
# внутри контейнера, наружу не уходит ни одного пакета. Нужна сборка: pnpm build.
#
#   sh scripts/bench-dns-docker.sh [каталог-dist-прежней-версии]
#
# Второй аргумент — dist прежней версии для сравнения «до» (необязателен).
# Код возврата 1 — DNS процесса задержан зависшими поисками хоть в одной точке.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${NET_GUARD_BENCH_IMAGE:-node:24-bookworm-slim}
BEFORE_MOUNT=""
BEFORE_ENV=""
if [ "${1:-}" != "" ]; then
  BEFORE_MOUNT="-v $(cd "$1" && pwd):/before-dist:ro"
  BEFORE_ENV="-e NET_GUARD_BEFORE_DIST=/before-dist"
fi
test -f "$ROOT/dist/index.js" || { echo "нет $ROOT/dist — сначала pnpm build" >&2; exit 2; }
# shellcheck disable=SC2086
exec docker run --rm --network none -v "$ROOT:/net-guard:ro" $BEFORE_MOUNT $BEFORE_ENV -w /net-guard "$IMAGE" \
  sh -c 'echo "nameserver 127.0.0.1" > /etc/resolv.conf \
    && (node bench/dns-blackhole.cjs &) \
    && sleep 1 \
    && node bench/dns-threadpool.cjs --assert'
