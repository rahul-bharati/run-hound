/**
 * Which cookies of a page opened as an identity may not be in that identity's replays (0.6.0 close-out round 3).
 *
 * write-access reads the identity's own anti-CSRF token from a page opened as it (a browser context), but sends the
 * replay through ctx.request, a separate request context. Both start from the identity's saved session, and only the
 * page's gets what the page load set: a fresh csrftoken on every render (a token per page), or one the saved session
 * never held (Spring Security's deferred XSRF-TOKEN, cleared at sign-in). A token read from such a page no longer
 * matches the cookie the replay carries, so the app's refusal may be its CSRF check, not an ownership check.
 */
import type { Page } from "playwright";
import type { Capture } from "../../core/types.js";

/** Up to how many of its latest requests page.requests() keeps (Playwright 1.63: "currently 100"). */
const KEPT_REQUESTS = 100;

/** `url` as a request carries it: normalised (a bare origin gets its "/"), without a #fragment. */
function asRequested(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/** The name=value pairs of a Cookie request header. */
function cookiePairs(header: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) pairs.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return pairs;
}

/**
 * The cookies `page` (opened as an identity at `openedAt`) holds at a value its saved session didn't, or no longer
 * holds, by name. The saved session is what the page's first request carried (its Cookie header, page.requests()):
 * a cookie the page now holds at another value, one the saved session lacked, and one the page dropped all count. So
 * does a cookie any of the page's answers set (Set-Cookie in `capture`) to a value other than the saved session's,
 * which also covers a first request that can no longer be read: then every cookie an answer set counts, whatever its
 * value, and a cookie a script set may be missed.
 */
export async function cookieDrift(page: Page, capture: Capture, openedAt: string): Promise<Set<string>> {
  const drift = new Set<string>();
  let saved: Map<string, string> | null = null;
  let firstUrl = openedAt;
  try {
    const requests = await page.requests();
    const first = requests[0];
    if (first && requests.length < KEPT_REQUESTS && first.isNavigationRequest() && first.redirectedFrom() === null && asRequested(first.url()) === asRequested(openedAt)) {
      saved = cookiePairs((await first.allHeaders())["cookie"] ?? "");
      firstUrl = first.url();
    }
  } catch {
    saved = null;
  }
  if (saved) {
    const now = await page
      .context()
      .cookies(firstUrl)
      .catch(() => null);
    if (now === null) saved = null;
    else {
      for (const c of now) if (saved.get(c.name) !== c.value) drift.add(c.name);
      for (const name of saved.keys()) if (!now.some((c) => c.name === name)) drift.add(name);
    }
  }
  for (const r of capture.requests) {
    const set = r.responseHeaders?.["set-cookie"];
    if (!set) continue;
    for (const line of set.split("\n")) {
      const m = /^\s*([^=;\s]+)=([^;]*)/.exec(line);
      if (m && (!saved || saved.get(m[1]!) !== m[2]!.trim())) drift.add(m[1]!);
    }
  }
  return drift;
}
