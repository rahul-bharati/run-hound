import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { TargetNotAllowedError } from "./errors.js";

export interface SafetyOptions {
  /** Hostnames allowed in addition to loopback/private addresses (RUNHOUND_ALLOWED_HOSTS). */
  allowedHosts?: string[];
  /** DNS lookup, injectable for tests. Defaults to node:dns/promises lookup (all addresses). */
  lookup?: (hostname: string) => Promise<string[]>;
}

/** Parses dotted IPv4 into a 32-bit unsigned number, or null. */
function parseIPv4(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** Parses IPv6 (including "::" and an embedded dotted IPv4 tail) into 8 16-bit groups, or null. */
function parseIPv6(ip: string): number[] | null {
  const bare = ip.replace(/%.*$/, ""); // drop a zone id such as fe80::1%eth0
  if (isIP(bare) !== 6) return null;
  let text = bare;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = parseIPv4(dotted[1]!)!;
    text = `${text.slice(0, -dotted[1]!.length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  const groups = tail === undefined ? left : [...left, ...zeros, ...right];
  return groups.length === 8 ? groups : null;
}

function isPrivateIPv4(n: number): boolean {
  const inRange = (base: string, bits: number) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((parseIPv4(base)! & mask) >>> 0);
  };
  return (
    inRange("127.0.0.0", 8) || // loopback
    inRange("10.0.0.0", 8) || // RFC 1918
    inRange("172.16.0.0", 12) ||
    inRange("192.168.0.0", 16) ||
    inRange("169.254.0.0", 16) // link-local
  );
}

/** True for loopback, RFC 1918, RFC 4193 (fc00::/7), link-local (169.254/16, fe80::/10) and IPv4-mapped forms of those. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4 !== null) return isPrivateIPv4(v4);

  const g = parseIPv6(ip);
  if (!g) return false;
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPrivateIPv4(((g[6]! << 16) | g[7]!) >>> 0);
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => r.address);
}

export interface TargetCheck {
  /** Hostname as the URL parser normalised it (lowercase, no brackets). */
  host: string;
  /** Addresses the gate approved. Empty unless the host was resolved through DNS. */
  addresses: string[];
  /** True when the decision came from a DNS lookup, so the browser should be pinned to `addresses`. */
  resolved: boolean;
}

/** Hostnames safe to write into a Chromium --host-resolver-rules rule (no separators it would re-parse). */
const PINNABLE_HOST = /^[a-z0-9._-]+$/;

/**
 * The safety gate. Returns how the target was approved, or throws TargetNotAllowedError.
 * Approved when the URL is http(s) and the host is localhost, an explicitly allowed host, or resolves
 * ONLY to private addresses (loopback, RFC 1918, RFC 4193, link-local).
 */
export async function checkTarget(url: string, options: SafetyOptions = {}): Promise<TargetCheck> {
  const refuse = (reason: string) => new TargetNotAllowedError(url, reason);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refuse("not a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw refuse(`only http and https targets are supported, not ${parsed.protocol}`);
  }

  // WHATWG URL already lowercases, strips userinfo and normalises numeric IPv4 forms; IPv6 keeps brackets.
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw refuse("the URL has no host");
  if (host === "localhost" || host.endsWith(".localhost")) return { host, addresses: [], resolved: false };

  const allowed = (options.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(host)) return { host, addresses: [], resolved: false };

  if (isIP(host)) {
    if (host === "0.0.0.0" || host === "::") {
      const port = parsed.port ? `:${parsed.port}` : "";
      throw refuse(`${host} means "every address of this machine" and is not an address to test; use http://localhost${port} instead`);
    }
    if (!isPrivateAddress(host)) {
      throw refuse(
        `${host} is not a private address; Run Hound only tests localhost, private addresses or hosts listed in RUNHOUND_ALLOWED_HOSTS`,
      );
    }
    return { host, addresses: [host], resolved: false };
  }

  if (!PINNABLE_HOST.test(host)) throw refuse(`${host} is not a host name Run Hound can safely pin to one address`);

  let addresses: string[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(host);
  } catch (err) {
    throw refuse(`could not resolve ${host}: ${(err as Error).message}`);
  }
  if (addresses.length === 0) throw refuse(`${host} did not resolve to any address`);

  const publicAddresses = addresses.filter((a) => !isPrivateAddress(a));
  if (publicAddresses.length > 0) {
    throw refuse(
      `${host} resolves to a public address (${publicAddresses.join(", ")}); Run Hound only tests localhost, ` +
        "private addresses or hosts listed in RUNHOUND_ALLOWED_HOSTS",
    );
  }
  return { host, addresses, resolved: true };
}

/**
 * Throws TargetNotAllowedError unless the URL is http(s) and EVERY address its host resolves to is private,
 * or the hostname is in allowedHosts. "localhost" is always allowed.
 */
export async function assertAllowedTarget(url: string, options: SafetyOptions = {}): Promise<void> {
  await checkTarget(url, options);
}

/** The same decision as a boolean, for places that ask about many URLs (the navigation guard). */
export async function isAllowedUrl(url: string, options: SafetyOptions = {}): Promise<boolean> {
  return checkTarget(url, options).then(
    () => true,
    () => false,
  );
}

/**
 * Chromium launch arguments that pin a DNS-resolved target host to the address the gate approved, so a
 * second lookup (DNS rebinding) can't send the browser somewhere else. Empty for localhost, IP literals
 * and explicitly allowed hosts, which are never resolved here.
 */
export function pinArgs(check: TargetCheck): string[] {
  const address = check.addresses[0];
  if (!check.resolved || !address) return [];
  const literal = isIP(address) === 6 ? `[${address}]` : address;
  return [`--host-resolver-rules=MAP ${check.host} ${literal}`];
}
