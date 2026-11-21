import type { ClientHttp2Session, SecureClientSessionOptions } from 'node:http2';

/** `http2.connect` с защитой: та же сигнатура, без `createConnection` (он свой). */
export type GuardedHttp2Connect = (
  authority: string | URL,
  options?: Omit<SecureClientSessionOptions, 'createConnection' | 'lookup'>,
  listener?: (session: ClientHttp2Session) => void,
) => ClientHttp2Session;
