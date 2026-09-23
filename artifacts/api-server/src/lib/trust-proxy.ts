/**
 * How many reverse proxies stand between the internet and this process.
 *
 * Express uses it twice, and both uses are wrong in a way nobody notices when
 * the number is wrong:
 *
 *   - `req.ip`, which the rate limiter keys on. Count one hop too few and
 *     every visitor looks like the innermost proxy, so one family's retries
 *     throttle every director on the platform.
 *   - `req.secure`, read from X-Forwarded-Proto. Count too few and the API
 *     believes a TLS connection is plain HTTP.
 *
 * Count one too many and the opposite happens: the client's own
 * X-Forwarded-For is believed, and anybody can pick the address the rate
 * limiter sees by sending a header.
 *
 * The default of 1 is Replit's router, or the nginx in front of the API with
 * nothing in front of it. The docker-compose stack puts Caddy in front of
 * nginx for TLS and sets 2.
 */
export function trustProxyHops(
  raw: string | undefined = process.env["TRUST_PROXY_HOPS"],
): number {
  const value = raw?.trim();
  if (!value) return 1;

  if (!/^\d+$/.test(value) || Number(value) > 10) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a whole number of proxies (0-10), not "${raw}". ` +
        "It is the count of reverse proxies in front of this server: 1 for " +
        "nginx alone, 2 for Caddy in front of nginx.",
    );
  }

  return Number(value);
}
