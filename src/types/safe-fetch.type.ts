/** Безопасный fetch: форма глобального `fetch`. */
export type SafeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
