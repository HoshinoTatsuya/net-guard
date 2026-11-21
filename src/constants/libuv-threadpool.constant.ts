/** Пул потоков libuv: размер по умолчанию и верхняя граница `UV_THREADPOOL_SIZE`. */
export const LIBUV_THREADPOOL = {
  defaultSize: 4,
  maxSize: 1024,
} as const;
