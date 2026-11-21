// undici and fetch: a guarded dispatcher and a fetch that checks every redirect.
import {
  BlockedDestinationError,
  createGuardedConnect,
  createGuardedDispatcher,
  createSafeFetch,
  NET_GUARD_ERROR_CODE,
} from '@hoshinotatsuya/net-guard';
import * as undici from 'undici';

// Every connection of this Agent is checked, the first one and after each redirect.
const dispatcher = createGuardedDispatcher(undici, { agent: { keepAliveTimeout: 10_000 } });

// Redirects (≤ 5), body size (≤ 10 MiB) and total time (≤ 30 s) are capped; credentials do not follow
// a redirect to another origin.
const safeFetch = createSafeFetch({ dispatcher, fetch: undici.fetch, sensitiveHeaders: ['x-api-key'] });

export async function download(url: string): Promise<string | null> {
  try {
    const response = await safeFetch(url);
    return await response.text();
  } catch (error) {
    // URL checks (first URL and every redirect) throw BlockedDestinationError; a refused connection (a name that
    // resolves to an internal address) arrives as fetch's TypeError with the BlockedDestinationError in `cause`.
    const blocked = error instanceof BlockedDestinationError ? error : (error as { cause?: unknown }).cause;
    if (blocked instanceof BlockedDestinationError) {
      return null; // blocked.stage: host | address | empty-answer | port | scheme | socket-path
    }
    if ((error as { code?: unknown }).code === NET_GUARD_ERROR_CODE.responseTooLarge) {
      return null;
    }
    throw error;
  }
}

// The same protection as a connector for your own Agent.
export const agent = new undici.Agent({ connect: createGuardedConnect(undici.buildConnector) });
