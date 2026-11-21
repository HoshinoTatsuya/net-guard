/**
 * Разрешение имени во ВСЕ адреса — форма `dns.promises.lookup(host, { all: true })`.
 * Порт, чтобы проверку можно было гонять без сети и подставить свой резолвер.
 */
export type HostLookup = (host: string) => Promise<ReadonlyArray<{ readonly address: string }>>;
