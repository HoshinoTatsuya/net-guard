/**
 * Что делать с портом в хосте (`example.com:8080`, `[::1]:443`).
 *
 * - `legacy` — опция `allowPort` не задана: порт у имени и IPv4 — отказ,
 *   `[IPv6]:порт` снимается (так разбирал WHATWG URL до 0.2.0);
 * - `forbid` — `allowPort: false`: порт — отказ в любой форме, включая `[IPv6]:порт`;
 * - `strip` — `allowPort: true`: порт снимается в любой форме.
 */
export const HOST_PORT_MODE = {
  legacy: 'legacy',
  forbid: 'forbid',
  strip: 'strip',
} as const;

export type HostPortMode = (typeof HOST_PORT_MODE)[keyof typeof HOST_PORT_MODE];
