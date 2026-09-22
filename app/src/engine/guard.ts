/**
 * Keeps a browser context on targets the safety gate approves.
 *
 * Two layers, because Chromium does not let us route a redirect hop:
 *  1. Every navigation request (top level, iframe or popup) is checked before it is sent and aborted
 *     when the gate refuses its host, so link clicks, form posts and scripted navigations can never
 *     carry data off the target.
 *  2. A server redirect that lands on a refused host cannot be stopped in flight, so the guard records
 *     it and closes the whole context: the run stops instead of quietly testing somebody else's site.
 */
import type { BrowserContext, Request } from "playwright";
import { isAllowedUrl, type SafetyOptions } from "./safety.js";

export interface NavigationGuard {
  /** Navigations that were refused before they were sent, as "<method> <url>". */
  readonly blocked: string[];
  /** Refused hosts a redirect reached anyway; the context is closed when this happens. */
  readonly escaped: string[];
}

/** Schemes a page may navigate to without asking the gate: they never reach the network. */
const LOCAL_SCHEMES = new Set(["about:", "data:", "blob:", "javascript:"]);

export async function guardContext(context: BrowserContext, options: SafetyOptions = {}): Promise<NavigationGuard> {
  const blocked: string[] = [];
  const escaped: string[] = [];
  const decisions = new Map<string, Promise<boolean>>();

  const allowed = (url: string): Promise<boolean> => {
    let origin: string;
    try {
      const parsed = new URL(url);
      if (LOCAL_SCHEMES.has(parsed.protocol)) return Promise.resolve(true);
      origin = parsed.origin;
    } catch {
      return Promise.resolve(false);
    }
    let decision = decisions.get(origin);
    if (!decision) {
      decision = isAllowedUrl(url, options);
      decisions.set(origin, decision);
    }
    return decision;
  };

  await context.route("**/*", async (route, request) => {
    if (!request.isNavigationRequest()) return route.fallback();
    if (await allowed(request.url())) return route.fallback();
    blocked.push(`${request.method()} ${request.url()}`);
    await route.abort("blockedbyclient").catch(() => undefined);
  });

  // Redirect hops are never routed, so watch for one that already left the allowed targets.
  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest() || !request.redirectedFrom()) return;
    void allowed(request.url()).then(async (ok) => {
      if (ok || escaped.includes(request.url())) return;
      escaped.push(request.url());
      await context.close({ reason: `Run Hound stopped: the page redirected to ${request.url()}` }).catch(() => undefined);
    });
  };
  context.on("request", onRequest);

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
