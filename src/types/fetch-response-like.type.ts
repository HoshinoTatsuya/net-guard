/**
 * Ответ `fetch`, который читает безопасный fetch: статус, заголовки и тело.
 * Структурно, а не глобальный `Response`: у `undici.fetch` свой класс `Response`,
 * и его типы расходятся с глобальным (с DOM-библиотекой TypeScript, с
 * `Symbol.dispose` у итераторов заголовков), так что `fetch: undici.fetch` не
 * компилировался ни на одном мажоре undici. Тело в рантайме — WHATWG
 * `ReadableStream` байтов (так у undici и глобального fetch).
 */
export interface FetchResponseLike {
  readonly status: number;
  readonly statusText: string;
  /** Тип ответа по спецификации fetch; `'opaqueredirect'` — редирект без статуса и `Location`. */
  readonly type?: string;
  readonly headers: { get(name: string): string | null };
  readonly body: { cancel(reason?: unknown): Promise<void> } | null;
}
