/**
 * Host allow-list: loopback names (localhost, *.localhost), loopback addresses (127.0.0.0/8, ::1) and the
 * unspecified 0.0.0.0 / :: are always accepted. Anything else must appear in the configured `extraHosts`
 * (RUNHOUND_SERVER_HOSTS, the host of RUNHOUND_PUBLIC_URL, or the specific bound address). The middleware
 * also refuses cross-site POST/PUT requests whose Origin header is not the same as the request's origin.
 */
import { BlockList, isIP } from "node:net";

/** Addresses that only ever reach this machine: loopback (IPv4-mapped too) and the unspecified 0.0.0.0 / ::. */
const THIS_MACHINE = new BlockList();
THIS_MACHINE.addSubnet("127.0.0.0", 8, "ipv4");
THIS_MACHINE.addAddress("::1", "ipv6");
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);

/** A host name or address as the URL parser writes it, without IPv6 brackets: "LOCALHOST" -> "localhost". */
export function hostKey(host: string): string {
  const name = host
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (isIP(name) !== 6) return name;
  try {
    return new URL(`http://[${name}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return name;
  }
}

/**
 * Hosts the UI and API answer to without being listed: loopback names and addresses, and 0.0.0.0 / :: (the address
 * `serve --host 0.0.0.0` prints; connecting to it only ever reaches this machine). Any other IP address is refused,
 * so a container on the same network can't use the API by the server's address, and a DNS rebinding attack, which
 * always arrives under a NAME the attacker controls, is refused too.
 */
export function isDefaultHost(host: string): boolean {
  const name = hostKey(host);
  if (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    UNSPECIFIED.has(name)
  )
    return true;
  const family = isIP(name);
  return (
    family !== 0 && THIS_MACHINE.check(name, family === 6 ? "ipv6" : "ipv4")
  );
}

/** The host of a URL, or null when it doesn't parse. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return hostKey(new URL(url).hostname) || null;
  } catch {
    return null;
  }
}

/**
 * Build the extra hosts accepted besides loopback: RUNHOUND_SERVER_HOSTS, the host of the address people open
 * (RUNHOUND_PUBLIC_URL) and the specific address `serve --host` bound to. Loopback names and wildcards add nothing.
 * `serverHosts` falls back to RUNHOUND_SERVER_HOSTS when omitted; `publicUrl` falls back to RUNHOUND_PUBLIC_URL.
 */
export function extraHostsOf(options: {
  serverHosts?: string[];
  publicUrl?: string;
  boundHost?: string;
}): string[] {
  const bound = options.boundHost ? hostKey(options.boundHost) : "";
  const serverHosts =
    options.serverHosts ?? (process.env.RUNHOUND_SERVER_HOSTS ?? "").split(",");
  const publicUrl = options.publicUrl ?? process.env.RUNHOUND_PUBLIC_URL;
  return [
    ...new Set(
      [
        ...serverHosts.map(hostKey),
        hostOf(publicUrl) ?? "",
        UNSPECIFIED.has(bound) ? "" : bound,
      ].filter((h) => h && !isDefaultHost(h)),
    ),
  ];
}

/** Build the host-allow predicate from the configured extra hosts (uses isDefaultHost for loopback names). */
export function hostAllowedOf(extraHosts: string[]): (host: string) => boolean {
  return (host: string) =>
    isDefaultHost(host) || extraHosts.includes(hostKey(host));
}

/**
 * Hono middleware factory: refuses requests whose Host isn't allowed and refuses cross-site POST/PUT requests
 * whose Origin header doesn't match the request's origin. Tests and the real Hono app pass the same options bag.
 */
export function hostAllow(hostAllowed: (host: string) => boolean) {
  return async (
    c: { req: { url: string; method: string; header: (name: string) => string | undefined }; json: (body: unknown, status: number) => Response },
    next: () => Promise<void>,
  ) => {
    const { hostname, origin } = new URL(c.req.url);
    if (!hostAllowed(hostname)) {
      return c.json(
        {
          error: `Run Hound does not answer to the host name "${hostname}". Set RUNHOUND_SERVER_HOSTS=${hostname} if you meant to use it.`,
        },
        403,
      );
    }
    const sent = c.req.header("origin");
    if (
      sent &&
      sent !== origin &&
      c.req.method !== "GET" &&
      c.req.method !== "HEAD"
    ) {
      return c.json({ error: "Cross-site requests are not allowed." }, 403);
    }
    await next();
  };
}
