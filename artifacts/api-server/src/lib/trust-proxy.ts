import { BlockList, isIP } from "node:net";
import type { RequestHandler } from "express";
import { logger } from "./logger";

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

/*
 * Too few is the failure that says nothing, so the API watches for it.
 *
 * A proxy's address is a private one -- Docker's network, a cloud's, the
 * loopback -- and a visitor's, as a server on the internet sees it, never
 * is. So a request whose `req.ip` is private while X-Forwarded-For holds a
 * public address further back than the hops trusted reach is the setting
 * caught in the act: that public address is the visitor, and the rate
 * limits are counting the proxy instead.
 *
 * What it cannot see: a proxy in front whose own address is public (a CDN's
 * edge) and the hops counted short of it. Then req.ip is public, and looks
 * like anyone. Nor too many, which is the forgeable direction; DEPLOY.md
 * says how to count them.
 */

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

const LINK_LOCAL = new BlockList();
LINK_LOCAL.addSubnet("169.254.0.0", 16, "ipv4");
LINK_LOCAL.addSubnet("fe80::", 10, "ipv6");

/** Private networks, and the shared space carriers and some clouds use (RFC 6598). */
const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addAddress("::", "ipv6");

export type AddressKind = "public" | "private" | "loopback" | "link-local" | "unparseable";

/**
 * What kind of address this is, which is all the warning below may say of
 * one: an address in a log is somebody's.
 */
export function addressKind(raw: string): AddressKind {
  let address = raw.trim();
  // How proxies write a port beside one: [2001:db8::1]:443, 203.0.113.7:443.
  address = /^\[([^\]]+)\](?::\d+)?$/.exec(address)?.[1] ?? address;
  address = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(address)?.[1] ?? address;
  // An IPv4 client on a dual-stack socket arrives as ::ffff:a.b.c.d.
  address = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;

  const family = isIP(address);
  if (family === 0) return "unparseable";
  const type = family === 4 ? "ipv4" : "ipv6";
  if (LOOPBACK.check(address, type)) return "loopback";
  if (LINK_LOCAL.check(address, type)) return "link-local";
  if (PRIVATE.check(address, type)) return "private";
  return "public";
}

export type TooFewHops = {
  /** What req.ip is: never public, or this would not be a sign. */
  seenAs: AddressKind;
  /** X-Forwarded-For's entries, counted by kind. */
  forwardedFor: Partial<Record<AddressKind, number>>;
  /**
   * The hops it takes to reach the nearest public address in the chain: the
   * least the setting can be. Only proxies append to the header, so nothing
   * a client writes into it can raise this.
   */
  atLeast: number;
};

/** The evidence that `hops` is too few, from one request, or null. */
export function tooFewProxyHops(
  hops: number,
  ip: string | undefined,
  forwardedFor: string | undefined,
): TooFewHops | null {
  if (!ip || !forwardedFor) return null;
  const seenAs = addressKind(ip);
  if (seenAs === "public" || seenAs === "unparseable") return null;

  const kinds = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(addressKind);
  const nearestPublic = kinds.lastIndexOf("public");
  if (nearestPublic === -1) return null;

  // X-Forwarded-For lists the nearest hop last, so the public address is
  // this many hops away.
  const atLeast = kinds.length - nearestPublic;
  if (atLeast <= hops) return null;

  const counted: Partial<Record<AddressKind, number>> = {};
  for (const kind of kinds) counted[kind] = (counted[kind] ?? 0) + 1;
  return { seenAs, forwardedFor: counted, atLeast };
}

/** Long enough not to fill a log; short enough to be read the next morning. */
const QUIET_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * Says so, once and then not for a day, when a request shows the hops
 * trusted are too few. Counts and kinds of address only, never one.
 */
export function proxyHopsCheck(hops: number, now: () => number = Date.now): RequestHandler {
  let quietUntil = -Infinity;

  return (req, _res, next) => {
    if (now() < quietUntil) {
      next();
      return;
    }
    const tooFew = tooFewProxyHops(hops, req.ip, req.get("x-forwarded-for"));
    if (tooFew) {
      quietUntil = now() + QUIET_FOR_MS;
      logger.warn(
        { trustProxyHops: hops, ...tooFew },
        `TRUST_PROXY_HOPS is ${hops}, which looks too few: a request reached the ` +
          `API from a ${tooFew.seenAs} address with a public one ${tooFew.atLeast} ` +
          "hops back in X-Forwarded-For, so the rate limits are counting a proxy, " +
          "and every visitor behind it shares one limit. Set TRUST_PROXY_HOPS to " +
          `the number of reverse proxies in front of the API: at least ` +
          `${tooFew.atLeast}, going by this request (DEPLOY.md, "Using your own ` +
          'load balancer instead of Caddy"). Not said again for a day.',
      );
    }
    next();
  };
}
