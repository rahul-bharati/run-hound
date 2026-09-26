/**
 * Keeps a browser context on targets the safety gate approves.
 *
 * Three layers, because Chromium does not let us route a redirect hop or see its own DNS answers in advance:
 *  1. Every navigation request (top level, iframe or popup) is checked before it is sent and aborted
 *     when the gate refuses its host, so link clicks, form posts and scripted navigations can never
 *     carry data off the target.
 *  2. A server redirect that lands on a refused host cannot be stopped in flight, so the guard records
 *     it and closes the whole context: the run stops instead of quietly testing somebody else's site.
 *  3. Only the run's target host is pinned to the address the gate approved (safety.ts pinArgs); Chromium looks up
 *     any other host name itself. A name the gate approved because it resolved to a private address could resolve
 *     to a public one for Chromium (DNS rebinding), so the guard checks the address every navigation to such a name
 *     was answered from and closes the context, like layer 2, when it is not private. That one request has already
 *     been sent by then, as with a redirect. Requests that are not navigations (fetch, scripts, images) are not guarded.
 *
 * It also answers the target's HTTP authentication with the user name and password the person wrote into the target
 * URL (rememberCredentials), for that origin only.
 */
import type { BrowserContext, Request, Response } from "playwright";
import type { TargetCredentials } from "./errors.js";
import { checkTarget, isPrivateAddress, type SafetyOptions, type TargetCheck } from "./safety.js";

export interface NavigationGuard {
  /** Navigations that were refused before they were sent, as "<method> <url>". */
  readonly blocked: string[];
  /**
   * Navigations that left the allowed targets anyway (a redirect to a refused host, or a host that answered from a
   * public address); the context is closed when this happens.
   */
  readonly escaped: string[];
}

/** Schemes a page may navigate to without asking the gate: they never reach the network. */
const LOCAL_SCHEMES = new Set(["about:", "data:", "blob:", "javascript:"]);

/**
 * User names and passwords people wrote into a target URL (errors.ts splitTargetUrl), by origin. Kept in memory
 * while Run Hound runs, the way a browser remembers them, so planning the same target again (a rerun) still gets
 * past the password; never written anywhere.
 */
const credentialsByOrigin = new Map<string, TargetCredentials>();

/** Every context guarded from now on answers the HTTP authentication of `url`'s origin with these credentials. */
export function rememberCredentials(url: string, credentials: TargetCredentials): void {
  credentialsByOrigin.set(new URL(url).origin, credentials);
}

export async function guardContext(context: BrowserContext, options: SafetyOptions = {}): Promise<NavigationGuard> {
  const blocked: string[] = [];
  const escaped: string[] = [];
  const decisions = new Map<string, Promise<TargetCheck | null>>();

  // Sent only to the origin they were given for, and only when it asks (a 401 with WWW-Authenticate).
  const known = [...credentialsByOrigin].map(([origin, credentials]) => ({ ...credentials, origin }));
  if (known.length > 0) await context.setHTTPCredentials(known);

  /** How the gate approved the URL's host (asked once per origin), or null when it refuses it. */
  const decide = (url: string): Promise<TargetCheck | null> => {
    let origin: string;
    try {
      const parsed = new URL(url);
      if (LOCAL_SCHEMES.has(parsed.protocol)) return Promise.resolve({ host: "", addresses: [], resolved: false });
      origin = parsed.origin;
    } catch {
      return Promise.resolve(null);
    }
    let decision = decisions.get(origin);
    if (!decision) {
      decision = checkTarget(url, options).catch(() => null);
      decisions.set(origin, decision);
    }
    return decision;
  };

  /** Records a navigation that left the allowed targets and closes the context, once per navigation. */
  const escape = async (what: string, url: string) => {
    if (escaped.includes(what)) return;
    escaped.push(what);
    await context.close({ reason: `Run Hound stopped: the page went to ${url}` }).catch(() => undefined);
  };

  await context.route("**/*", async (route, request) => {
    if (!request.isNavigationRequest()) return route.fallback();
    if (await decide(request.url())) return route.fallback();
    blocked.push(`${request.method()} ${request.url()}`);
    await route.abort("blockedbyclient").catch(() => undefined);
  });

  // Redirect hops are never routed, so watch for one that already left the allowed targets.
  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest() || !request.redirectedFrom()) return;
    void decide(request.url()).then(async (check) => {
      if (!check) await escape(request.url(), request.url());
    });
  };
  context.on("request", onRequest);

  // Where a host name the gate approved by DNS really answered from (layer 3). localhost, IP literals and hosts in
  // allowedHosts are not resolved by the gate, so they are not checked.
  const onResponse = (response: Response) => {
    const request = response.request();
    if (!request.isNavigationRequest()) return;
    void decide(request.url()).then(async (check) => {
      if (!check?.resolved) return;
      const server = await response.serverAddr().catch(() => null);
      const address = server?.ipAddress.replace(/^\[|\]$/g, "");
      if (!address || isPrivateAddress(address)) return;
      await escape(`${request.url()} (answered from ${address}, not a private address)`, request.url());
    });
  };
  context.on("response", onResponse);

  return { blocked, escaped };
}

/** One line a report or a note can show for what the guard saw, or null when nothing was refused. */
export function guardSummary(guard: NavigationGuard): string | null {
  if (guard.escaped.length > 0) {
    return `Stopped: the page left the target and went to ${guard.escaped.join(", ")}, which Run Hound is not allowed to test.`;
  }
  if (guard.blocked.length > 0) return `Blocked ${guard.blocked.length} navigation(s) off the target: ${guard.blocked.join(", ")}`;
  return null;
}
