# @hoshinotatsuya/net-guard

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/net-guard.svg)](https://www.npmjs.com/package/@hoshinotatsuya/net-guard)
[![CI](https://github.com/HoshinoTatsuya/net-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/net-guard/actions/workflows/ci.yml)

[Русская версия](./README.ru.md) · [Changelog](./CHANGELOG.md)

**SSRF protection for Node.js.** When your service fetches a URL that a user, a webhook configuration or a crawled page gave it, the destination must be a *public* address — not your Redis, not an admin panel on the internal network, not the outgoing proxy and not the cloud metadata service at `169.254.169.254`.

A hand-written check usually fails in one of these ways: it parses only canonical addresses (`0x7f.1`, `2130706433`, `0177.0.0.1`, `[::ffff:127.0.0.1]` all reach loopback through libcurl and Node), it checks the name but the client connects to a different DNS answer (DNS rebinding), it checks the first URL but not the redirect to `http://169.254.169.254/`, or it protects the `lookup` while address literals connect without one. This package decides publicity in one place and enforces it **at connection time** in every common client:

- **checks** — `nonPublicHostReason`, `nonPublicUrlReason`, `nonPublicResolvedReason`, `isBlockedIp`;
- **enforcement** — guarded `http`/`https` agents, a guarded `lookup`, an undici connector and dispatcher, a safe `fetch` (every redirect re-checked, body/time/redirect caps), ready configs for axios and got, `http2.connect`, and HTTP `CONNECT` proxies that receive the already-checked address;
- **DNS that does not starve the process** — c-ares by default (sockets in the event loop; a timeout really cancels the query), or the system resolver behind a process-wide concurrency cap;
- **audit** — an `onBlocked` hook and per-stage counters.

When in doubt it refuses: an unparseable address, a resolver failure, an empty DNS answer, an address outside the IPv6 global unicast space.

## Install

```sh
npm install @hoshinotatsuya/net-guard
# only if you use the undici connector, dispatcher or safe fetch with undici's own fetch:
npm install undici
```

| Requirement | |
|---|---|
| Node.js | ≥ 24 |
| `undici` | `^7.10.0 \|\| ^8.0.0`, optional peer. The package never imports it: you pass the module in, so there is no runtime dependency at all |

The package is CommonJS with type declarations; it loads from ESM too.

## Quick start

```ts
import { get } from 'node:https';
import {
  createGuardedAgents,
  isBlockedIp,
  nonPublicHostReason,
  nonPublicResolvedReason,
  nonPublicUrlReason,
} from '@hoshinotatsuya/net-guard';
```

```ts
export async function validateUserInput(url: string, host: string): Promise<void> {
  console.log(nonPublicUrlReason(url)); // scheme, port and host of the whole URL; null = allowed
  console.log(nonPublicHostReason('0x7f.1')); // the reason text: 127.0.0.1 is not public
  console.log(nonPublicHostReason('example.com')); // null
  console.log(await nonPublicResolvedReason(host)); // checks EVERY address from DNS; a DNS failure is a refusal
}
```

All snippets in this README are excerpts from [`examples/`](./examples), which `pnpm run typecheck` compiles against the package source; a test (`src/readme-examples.spec.ts`) fails if a snippet here stops matching them.

## What counts as non-public

| | Refused |
|---|---|
| IPv4 | `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`, and Azure WireServer `168.63.129.16/32` (`BLOCKED_IPV4_SUBNETS`) |
| IPv6 | everything outside global unicast `2000::/3`, plus `::/96`, `::ffff:0:0:0/96`, `64:ff9b:1::/48`, `100::/64`, `2001::/23`, `2001:db8::/32`, `2002::/16`, `3fff::/20`, `5f00::/16`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8` (`BLOCKED_IPV6_SUBNETS`). IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`, plus your `extraNat64Prefixes`) are judged by the embedded IPv4. A zone (`fe80::1%eth0`) is parsed; `isBlockedIp` always refuses an address with a zone |
| address forms | every form libcurl/`inet_aton` accept: hex (`0x7f.1`), a single number (`2130706433`), short (`127.1`), trailing dot; an octet with a leading zero (`012.0.0.1`, octal for libcurl) is unparseable and therefore refused |
| names | names without a dot, `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.home.arpa`, `*.lan`, `*.corp`, `*.home`, `metadata.tencentyun.com` (`BLOCKED_NAME_SUFFIXES`) — refused before DNS; any other name is refused if **any** of its DNS answers is non-public |
| ports and schemes | by default only ports 80 and 443 and schemes `http:`/`https:` (agents, connector, http2, proxy, safe fetch, URL checks) |
| unix sockets | a `socketPath` in client options is refused |

`CLOUD_METADATA_ENDPOINTS` lists the metadata services of AWS, GCP, Azure, Yandex Cloud, Alibaba, Oracle, DigitalOcean, Tencent and OpenStack (names, IPv4, IPv6); a test checks that the built-in policy closes every entry. All exported lists are frozen.

**Your own rules** only narrow, never open: `extraBlockedSubnets` (CIDR, IPv4 and IPv6 mixed), `extraBlockedNameSuffixes` (zones; Unicode → punycode), `extraNat64Prefixes` (exactly `/96`). A typo (no prefix length, prefix longer than the address, `*.corp`, an empty zone, garbage after the prefix) throws instead of silently dropping the rule. These options are accepted by every function and factory below.

## Usage and API

### Checks

| Function | Returns | Notes |
|---|---|---|
| `nonPublicHostReason(host, options?)` | reason `string` or `null` | form of the host only, no DNS: literals, names, zones. `allowPort: true` strips a port (`example.com:8080`, `[::1]:443`); `false` refuses a port in any form; unset — a port on a name or IPv4 is refused, `[IPv6]:port` is stripped |
| `nonPublicUrlReason(url, options?)` | reason or `null` | scheme (`allowedSchemes`), port (`allowedPorts`, `'any'` to skip), host form. An unparseable URL is a reason, not an exception |
| `nonPublicResolvedReason(host, lookup?, options?)` | `Promise<reason \| null>` | the host form, then **every** address from DNS. Resolver failure, timeout (`lookupTimeoutMs`, default 10 s) and an empty answer are reasons. Does not close DNS rebinding by itself — use an agent or connector for the connection |
| `isBlockedIp(address, policy?)` | `boolean` | for an address you already have: `socket.remoteAddress`, libcurl's `PRIMARY_IP`. Unparseable → `true` |

The reasons are human-readable texts (in Russian, e.g. `адрес 127.0.0.1 не публичный`); for decisions compare with `null`.

### Agents for `node:http(s)`, axios and got

`createGuardedHttpAgent(options?)`, `createGuardedHttpsAgent(options?)`, `createGuardedAgents(options?)` → `{ http, https }`. Options are the usual `http.Agent`/`https.Agent` options plus the guard options: policy, `allowedPorts` (default `[80, 443]`, or `'any'`), `resolver` (`'c-ares'` default or `'system'`), `resolve` (your own resolver), `lookupTimeoutMs`, `onBlocked`. Address literals are checked in `createConnection` (Node connects literals without `lookup`), names through the guarded `lookup`; a `lookup` in request options cannot replace it. A refusal is an `'error'` on the request with `BlockedDestinationError`; no socket is created. Use the **pair**: clients pick the agent by the target's protocol, and a redirect to `http://` would otherwise leave through the global agent.

```ts
// axios.create(axiosConfig): guarded agents, proxy: false, redirect, size and time limits.
export const axiosConfig = guardedAxiosConfig({ ...policy, timeoutMs: 10_000 });

// got.extend(gotOptions): guarded agents, http2: false (got's http2 bypasses agents).
export const gotOptions = guardedGotOptions(policy);
```

- `guardedAxiosConfig(options?)` → `{ httpAgent, httpsAgent, proxy: false, maxRedirects, maxContentLength, maxBodyLength, timeout }` (`proxy: false` matters: axios reads `HTTP_PROXY` itself, and the check would move from the target to the proxy).
- `guardedGotOptions(options?)` → `{ agent: { http, https }, http2: false, maxRedirects, timeout: { request } }`; got has no body size cap.
- Limits: `maxRedirects` (5), `maxResponseBytes` (10 MiB), `timeoutMs` (30 s) — `NET_GUARD_DEFAULTS`.

### undici and fetch

```ts
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
```

- `createGuardedDispatcher(undici, { agent?, connect?, proxy?, proxyConnectTimeoutMs?, ...guard })` → an `undici.Agent` with the guarded connector (`agent.connect` is rejected — the connector is ours).
- `createGuardedConnect(buildConnector, options?)` → a connector for your own `Agent`: checks the host of **every** connection (the first one and after each redirect) before the socket; `connect.socketPath` is rejected.
- `createSafeFetch({ dispatcher, fetch?, maxRedirects, maxResponseBytes, timeoutMs, allowedPorts, allowedSchemes, sensitiveHeaders, onBlocked, ...policy })` → `(input, init?) => Promise<Response>`. `dispatcher` is **required** and must be a guarded one: the URL check sees only the host form, while names resolving to internal addresses and DNS rebinding are closed by the connector. Every redirect is checked before it is followed; `authorization`, `cookie`, `proxy-authorization`, `host` and your `sensitiveHeaders` do not go to another origin; 303, and POST on 301/302, become GET without a body; the body is capped by `content-length` and while reading (the source is cancelled); the total time includes redirects and reading the body; responses without a body (204, 205, 304, HEAD) are handled before the size check. Errors: `BlockedDestinationError`, `ERR_NET_GUARD_TOO_MANY_REDIRECTS`, `ERR_NET_GUARD_RESPONSE_TOO_LARGE`, `ERR_NET_GUARD_FETCH_TIMEOUT`.

### `lookup`, http2 and proxies

- `guardedLookup` / `createGuardedLookup(options?)` — the `dns.lookup` shape (callback, `all`, `family`, `hints`, `order`): resolves the name to **all** addresses and fails with `BlockedDestinationError` if any is non-public, so the client connects exactly to the checked answer. Alone it does not protect against address literals — prefer the agents and the connector.
- `createGuardedHttp2Connect(options?)` → an `http2.connect` replacement (`node:http2` bypasses `http(s)` agents). A forbidden host form, literal or port throws from the call; a name resolving to an internal address emits `'error'` on the session.
- `createGuardedProxyAgents({ proxy, proxyConnectTimeoutMs = 10 000, ...agentOptions })` → `{ http, https }` for `node:http(s)`, axios, got; for undici pass `proxy` to the connector or dispatcher. With an ordinary proxy the client connects to the **proxy**, and nobody checks the target. Here the target is checked as usual and the proxy receives `CONNECT <checked address literal>:<port>` — it never resolves the name, so DNS rebinding between check and connection is closed; TLS to the target runs inside the tunnel with SNI. Plain HTTP also goes through a tunnel (`CONNECT address:80`). A failed tunnel is `ERR_NET_GUARD_PROXY_TUNNEL_FAILED`.

```ts
// node:http2 bypasses http(s) agents: use the guarded connect.
const connect = createGuardedHttp2Connect({ ...policy, allowedPorts: [443, 8443] });
export const openSession = (authority: string) => connect(authority);

// Behind an HTTP proxy: the target is checked, the proxy gets CONNECT to the checked address literal.
export const proxied = createGuardedProxyAgents({ proxy: 'http://proxy.example:3128', ...policy });
```

### Resolver choice

| `resolver` | How | When |
|---|---|---|
| `'c-ares'` (default) | `dns.Resolver`: queries are sockets in the event loop, no libuv thread is used, a timeout cancels the query. Servers — `dns.getServers()` (your `dns.setServers()` applies) | default |
| `'system'` | `getaddrinfo` in the libuv pool, behind a process-wide cap one below the pool's slow-work quota (`UV_THREADPOOL_SIZE` 4 → 1, 8 → 3), so at least one thread is always left to the rest of the process. Excess lookups wait in the package's queue (not in the pool) until `lookupTimeoutMs`; more than 1024 waiting → `ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY` | names from `/etc/hosts`, nsswitch, mDNS or resolv.conf `search` domains — **c-ares reads none of them** |
| `resolve` option | your function | your own DNS, tests without network |

Why it matters: a timeout around `dns.lookup` releases the *caller* but not the thread — `getaddrinfo` keeps running for seconds, and libuv gives it at most half the pool. Measured in a container with an unresponsive DNS server: two hung lookups delayed the process's own `dns.lookup('localhost')` (database driver, Redis client) by **8.8 s**, four by **18.8 s**; with c-ares the delay stayed at 11–12 ms. The cap's counter is shared by all copies of the package in one process (a key in `globalThis`).

### Audit and metrics

```ts
const onBlocked: OnBlocked = (event) => console.warn('blocked', event.stage, event.target, event.reason);

// Your own internal networks and zones on top of the built-in lists (they can only narrow).
const policy = {
  extraBlockedSubnets: ['10.200.0.0/16', '2a02:6b8:c00::/40'],
  extraBlockedNameSuffixes: ['corp.example'],
  onBlocked,
};
```

- `onBlocked(event)` — on every refusal by lookup, agents, connector, http2, proxy and safe fetch: `{ stage, target, reason, address }`. An exception from the hook does not cancel the refusal; it becomes a process warning.
- `netGuardStats()` → `{ blocked: { [stage]: count }, systemLookups: { inFlight, limit, waiting, refused } }`.
- `BlockedDestinationError` — `code` `ERR_NET_GUARD_BLOCKED_DESTINATION`, `hostname`, `reason`, `address` (the non-public DNS answer, if any), `stage` (`BLOCK_STAGE`: `host`, `address`, `empty-answer`, `port`, `scheme`, `socket-path`). Compatible with `NodeJS.ErrnoException`, so sockets and HTTP clients pass it to `'error'` as is.
- Constants: `NET_GUARD_ERROR_CODE`, `NET_GUARD_DEFAULTS` (`lookupTimeoutMs` 10 000, `allowedPorts` `[80, 443]`, `allowedSchemes`, `maxRedirects` 5, `maxResponseBytes` 10 MiB, `fetchTimeoutMs` 30 000), `DNS_RESOLVER`, `BLOCK_STAGE`, the lists above.

## Guarantees and limits

- **Checked at connection time:** with the agents, the connector, the dispatcher and http2 the client connects only to an address the guard approved, for every new connection (keep-alive reuses an already checked one). The cost is microseconds per new connection (`isBlockedIp` ≈ 1.1 µs, `nonPublicHostReason` ≈ 0.6 µs on a laptop core, more with extra rules) — nothing next to DNS and TCP.
- **The string checks alone do not close DNS rebinding** — `nonPublicResolvedReason` resolves separately from your client. Use them for early validation (rejecting a form field), not as the only protection.
- **Verified against real servers on loopback:** `http.Agent`, undici 7 and 8 (connector, dispatcher, fetch), a real `CONNECT` proxy (exactly one `CONNECT 93.184.216.34:80` per allowed target, none for refused ones), an h2c server (zero TCP connections per refusal). An SSRF bypass battery (decimal/octal/hex, mapped and compatible IPv6, NAT64, 6to4, Teredo, `localhost.`, percent-encoding and full-width digits, metadata services, rebinding, mixed DNS answers, unavailable DNS) ran in a network-less container through the agent, safe fetch, axios and http2 on Node 24 and 26: no request reached the loopback server.
- **Not verified:** real axios and got (only the shape of the configs and that the agents are guarded — they are not dependencies of the package), an external corporate proxy.
- **c-ares does not read `/etc/hosts`, nsswitch, mDNS or `search` domains:** choose `resolver: 'system'` or your own `resolve` if you rely on them.
- **Functions called without a prebuilt object compile options on every call** (2–4× slower with extra rules); on a hot path create the lookup or agents once.
- **Messages:** refusal reasons and error messages are in Russian. Codes (`code`, `stage`), constants and the `null`/non-`null` contract are stable; do not parse the texts.

## Failure behavior

Fail closed — "could not determine" means "refused":

- an unparseable address or host, a resolver error, a timeout, an empty DNS answer → refused;
- a DNS answer with **one** non-public address among public ones → refused (also for happy eyeballs);
- an IPv6 address outside `2000::/3` (including unallocated IANA space) → refused;
- an empty `allowedPorts`/`allowedSchemes` list, a malformed subnet or zone, a non-integer limit, `agent.connect` or `socketPath` in client options → an exception at creation, not "no restriction";
- the safe fetch without a dispatcher → an exception at creation; an implementation that hides redirects (`opaqueredirect`) → `TypeError`, not an empty response.

## Compatibility

| | Supported and tested |
|---|---|
| Node.js | ≥ 24 (the bypass battery also ran on Node 26) |
| undici | 7.10.0, latest 7, 8.0.0, latest 8 (consumer matrix) |
| TypeScript (consumer) | 6.0 and 7 on the packed tarball (ESM); the package itself builds with 5.9 |
| Clients | `node:http`, `node:https`, `node:http2`, undici, global `fetch`; axios and got via config objects |

## Testing and development

```sh
pnpm install
pnpm run typecheck       # src and examples/
pnpm run lint            # biome
pnpm test                # jest in groups; no network and no docker needed
pnpm run test:consumers  # the packed tarball with undici 7/8; needs network access to the npm registry
pnpm run build
pnpm run bench:dns       # optional: the DNS starvation measurement, needs docker
```

`pnpm test` runs the suite through `jest-groups` (groups of at most 300 tests, at most 2 workers, one group after another) and fails if any test was skipped. Everything runs on loopback: HTTP, h2c and `CONNECT` servers, a fake DNS server for c-ares, a differential check of the IPv6 parser against `net.isIPv6`/`BlockList` (20 000 seeded cases) and of `isBlockedIp` against `node:net` `BlockList` (40 000 random addresses plus every subnet boundary). Benchmarks are in [`bench/`](./bench) (`pnpm build && node bench/capacity.cjs`).

## License

[MIT](./LICENSE) © 2026 Hoshino Tatsuya
