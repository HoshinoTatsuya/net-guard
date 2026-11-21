import { LIBUV_THREADPOOL } from './constants/libuv-threadpool.constant';

/**
 * Сколько системных поисков (`getaddrinfo`) пакет держит в пуле libuv
 * одновременно. libuv отдаёт «медленной» работе — а getaddrinfo она и есть —
 * не больше `(потоков + 1) / 2` потоков (4 → 2); остальные поиски процесса
 * (драйвер БД, Redis, клиент облака зовут тот же `dns.lookup`) ждут в той же
 * очереди. Пакет берёт на единицу меньше квоты: хоть один поток медленной
 * квоты всегда остаётся процессу. Пул из одного-двух потоков — потолок 1
 * (меньше нельзя — поиск не пошёл бы вовсе).
 *
 * Размер пула libuv читает из `UV_THREADPOOL_SIZE` один раз, при первом
 * использовании пула; здесь — то же значение из окружения.
 */
export function systemLookupLimit(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.UV_THREADPOOL_SIZE);
  const pool =
    Number.isInteger(parsed) && parsed >= 1
      ? Math.min(parsed, LIBUV_THREADPOOL.maxSize)
      : LIBUV_THREADPOOL.defaultSize;
  const slowQuota = Math.floor((pool + 1) / 2);
  return Math.max(1, slowQuota - 1);
}
