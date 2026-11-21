// Other clients: axios, got, node:http2, HTTP proxies; extra rules; audit and metrics.
import {
  createGuardedHttp2Connect,
  createGuardedProxyAgents,
  guardedAxiosConfig,
  guardedGotOptions,
  netGuardStats,
  type OnBlocked,
} from '@hoshinotatsuya/net-guard';

const onBlocked: OnBlocked = (event) => console.warn('blocked', event.stage, event.target, event.reason);

// Your own internal networks and zones on top of the built-in lists (they can only narrow).
const policy = {
  extraBlockedSubnets: ['10.200.0.0/16', '2a02:6b8:c00::/40'],
  extraBlockedNameSuffixes: ['corp.example'],
  onBlocked,
};

// axios.create(axiosConfig): guarded agents, proxy: false, redirect, size and time limits.
export const axiosConfig = guardedAxiosConfig({ ...policy, timeoutMs: 10_000 });

// got.extend(gotOptions): guarded agents, http2: false (got's http2 bypasses agents).
export const gotOptions = guardedGotOptions(policy);

// node:http2 bypasses http(s) agents: use the guarded connect.
const connect = createGuardedHttp2Connect({ ...policy, allowedPorts: [443, 8443] });
export const openSession = (authority: string) => connect(authority);

// Behind an HTTP proxy: the target is checked, the proxy gets CONNECT to the checked address literal.
export const proxied = createGuardedProxyAgents({ proxy: 'http://proxy.example:3128', ...policy });

export function metrics(): void {
  const stats = netGuardStats();
  console.log(stats.blocked, stats.systemLookups);
}
