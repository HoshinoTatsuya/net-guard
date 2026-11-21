# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the package uses
[semantic versioning](https://semver.org/) with the pre-1.0 convention that a
minor version may break the API (each such version has a **Migration** section).

## [0.7.2] - 2026-11-21

First public release as `@hoshinotatsuya/net-guard`, MIT; documentation in English and Russian; no functional changes.

### Changed
- The process-wide state key follows the new package name: `Symbol.for('@hoshinotatsuya/net-guard.state.v1')`. Copies of the package older than 0.7.2 in the same process no longer share the system-lookup counter with this one.
- README examples live in `examples/` and are type-checked by `pnpm run typecheck`; a test keeps the README snippets identical to them. Test fixtures use synthetic host names and private addresses.
- Development tooling: `@hoshinotatsuya/arch-gates` ^0.12.2, `@hoshinotatsuya/jest-groups` ^0.7.2. CI moved to GitHub Actions; releases are published from version tags with npm provenance.

## [0.7.1] - 2026-11-21

### Fixed
- Building a refusal text never throws on a value without a prototype or with a throwing `toString` / `Symbol.toPrimitive`: an `onBlocked` hook throwing such a value, a resolver rejecting with one, `nonPublicUrlReason` on such a target, a connection port outside `allowedPorts`, and typos in settings now give the usual refusal and text (the value shown by its object tag) instead of a `TypeError`.
- A settings list that cannot be serialised (`allowedPorts: 443n`, a cycle, a throwing `toJSON`) is shown as text in the error instead of failing with "Do not know how to serialize a BigInt".

## [0.7.0] - 2026-11-17

An external audit: 17 claims checked by running them against the code, nine fixed; an SSRF bypass battery (decimal/octal/hex addresses, IPv4-mapped and IPv4-compatible IPv6, NAT64 and local NAT64, 6to4, Teredo, `localhost.`, percent-encoding and full-width digits, cloud metadata, DNS rebinding, mixed DNS answers with happy eyeballs, unavailable DNS) ran in a network-less container on Node 24 and 26 through the `node:http` agent, the safe fetch on undici, axios and http2: no request reached the loopback server.

### Changed (breaking)
- `resolver: 'system'`: above the cap a lookup **waits** for a slot (in the package's queue, not in the libuv pool) instead of failing immediately; `ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY` only when more than 1024 are waiting. `netGuardStats().systemLookups.waiting`.
- c-ares honours the process's address order (`--dns-result-order`, `dns.setDefaultResultOrder`) and `ADDRCONFIG`: a family is queried only if the machine has a non-loopback address of it.
- Safe fetch: responses without a body (204, 205, 304, HEAD) are handled before the `content-length` check; a redirect to such a response reports `redirected` and the final `url`; `host` does not go to another origin; new option `sensitiveHeaders`; 307/308 with a stream body fail with a clear `TypeError`; an implementation that hides redirects (`opaqueredirect`) is a `TypeError`; the timeout timer no longer keeps the process alive.

### Fixed
- Proxy: a byte after the `CONNECT` response header hung the process in a synchronous loop.
- Proxy: if the proxy refuses the tunnel to the first address, the next address of the same checked answer is tried.
- `createGuardedProxyAgents`: `createConnection` without a callback now throws instead of opening an orphan tunnel.
- The tunnel socket is handed to the agent synchronously (an early error could crash the process on Node 24.11).

### Migration
- If you treated `ERR_NET_GUARD_SYSTEM_LOOKUP_BUSY` as "retry later": the lookup now waits up to `lookupTimeoutMs` itself; a hung `getaddrinfo` gives `ETIMEOUT`.
- Put your own credential headers into `sensitiveHeaders`.

## [0.6.1] - 2026-11-17

### Added
- `undici` is an optional peer `^7.10.0 || ^8.0.0`; a consumer matrix checks the packed tarball with undici 7.10.0, latest 7, 8.0.0 and latest 8 on TypeScript 6 and 7.

### Fixed
- `createSafeFetch({ fetch: undici.fetch })` compiles: `FetchLike` returns a structural `FetchResponseLike` instead of the global `Response`.

## [0.6.0] - 2026-11-15

### Added
- c-ares resolver by default (`resolver: 'c-ares'`): no libuv thread, a timeout cancels the query. `resolver: 'system'` with a process-wide cap on concurrent `getaddrinfo` calls. Measured: with 0.5.0, two hung lookups delayed the process's own DNS by 8.8 s, four by 18.8 s; with c-ares 11–12 ms.
- `createSafeFetch` — every redirect checked, caps on redirects, body size and total time, credentials not sent to another origin.
- `createGuardedDispatcher` (undici), `guardedAxiosConfig`, `guardedGotOptions`, `createGuardedHttp2Connect`, `createGuardedProxyAgents` and `proxy` for the undici connector (`CONNECT` to the checked address literal).
- `allowedPorts` (default 80 and 443) and `allowedSchemes`; `nonPublicUrlReason`.
- `CLOUD_METADATA_ENDPOINTS`; Azure WireServer `168.63.129.16/32` and `metadata.tencentyun.com` added to the built-in policy.
- `onBlocked` audit hook, `netGuardStats()`, `BlockedDestinationError.stage`.

### Fixed
- A synchronous resolver exception left a timer and called the callback twice.
- The normalised name (lower case, punycode) is passed to the resolver, not the raw string; address literals never reach the resolver.
- `socketPath` in the undici connector options is rejected.

### Migration
- A target port other than 80/443 is now refused: set `allowedPorts: [443, 8443]` or `'any'`.
- Names from `/etc/hosts`, nsswitch or `search` domains are not seen by c-ares: use `resolver: 'system'` or your own `resolve`.
- `nonPublicResolvedReason(host, lookup?, options?)` defaults to c-ares; `createGuardedHttp2Connect` throws on a forbidden host form.

## [0.5.0] - 2026-11-15

### Changed (breaking)
- `exports` map: files under `dist/*` outside the declared entry points are not importable.
- Exported dictionaries are deep-frozen.

## [0.4.0] - 2026-11-15

### Added
- `createGuardedConnect(buildConnector)` — an undici connector that checks the host of every connection, including after redirects to address literals.
- `createGuardedAgents()` → `{ http, https }`.
- `extraNat64Prefixes`; `lookupTimeoutMs` (10 s) for the guarded lookup and `nonPublicResolvedReason`.

### Changed (breaking)
- IPv6 outside global unicast `2000::/3` is non-public (unallocated space used to pass as public).
- The built-in lists are frozen.
- An organisation-specific internal zone was removed from the built-in name list: the built-in list covers only generic zones.

### Migration
- Add your internal zone with `extraBlockedNameSuffixes: ['your-zone']`.

## [0.3.0] - 2026-11-14

### Added
- `createGuardedHttpAgent` / `createGuardedHttpsAgent`: `new http.Agent({ lookup: guardedLookup })` does not protect against address literals; the agents check literals in `createConnection` and refuse `socketPath`.
- `allowPort: false` refuses a port in any form, including `[IPv6]:port`.

### Changed (breaking)
- A subnet with garbage (`10.0.0.0/8/extra`, `10.0.0.0/`, `/0x8`) throws instead of being read loosely.

## [0.2.0] - 2026-11-14

### Added
- `guardedLookup` / `createGuardedLookup` — `dns.lookup`-shaped, refuses if any address is non-public.
- `extraBlockedSubnets`, `extraBlockedNameSuffixes` on top of the built-in lists; IPv6 zones; `allowPort: true`; bare IPv6 in `nonPublicResolvedReason`.

## [0.1.2] - 2026-11-14

### Fixed
- An IPv4 octet with a leading zero (`012.0.0.1`) is unparseable and therefore refused (libcurl reads it as octal).

## [0.1.1] - 2026-11-10

### Fixed
- `3fff::/20` (documentation, RFC 9637) and `5f00::/16` (SRv6 SIDs, RFC 9602) are blocked.

## [0.1.0] - 2026-11-10

First version: `isBlockedIp`, `nonPublicHostReason`, `nonPublicResolvedReason`.
