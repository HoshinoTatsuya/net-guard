import type { FetchResponseLike } from './fetch-response-like.type';

/** Функция формы `fetch` (глобальный или из undici). */
export type FetchLike = (input: string | URL, init?: Record<string, unknown>) => Promise<FetchResponseLike>;
