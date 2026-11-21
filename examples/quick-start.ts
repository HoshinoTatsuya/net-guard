// Quick start: refuse outbound requests to anything that is not a public destination.
import { get } from 'node:https';
import {
  createGuardedAgents,
  isBlockedIp,
  nonPublicHostReason,
  nonPublicResolvedReason,
  nonPublicUrlReason,
} from '@hoshinotatsuya/net-guard';

// Agents check every NEW connection: address literals, names (every DNS answer), ports, unix sockets.
const agents = createGuardedAgents({ keepAlive: true });

export function fetchWebhook(url: string): void {
  get(url, { agent: agents.https }, (response) => response.resume()).on('error', (error) => {
    // A refused destination arrives here: BlockedDestinationError, code ERR_NET_GUARD_BLOCKED_DESTINATION.
    console.warn(String(error));
  });
}

export async function validateUserInput(url: string, host: string): Promise<void> {
  console.log(nonPublicUrlReason(url)); // scheme, port and host of the whole URL; null = allowed
  console.log(nonPublicHostReason('0x7f.1')); // the reason text: 127.0.0.1 is not public
  console.log(nonPublicHostReason('example.com')); // null
  console.log(await nonPublicResolvedReason(host)); // checks EVERY address from DNS; a DNS failure is a refusal
}

export function checkConnectedPeer(remoteAddress: string): boolean {
  // The address of an established connection (closes DNS rebinding for your own sockets).
  return isBlockedIp(remoteAddress);
}
