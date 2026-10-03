/**
 * Browser-level guards for sign-in (auth.ts): `stopUnrouted` opens a tab-level CDP session so requests that escape
 * the context's routes (redirects, page-leave beacons, fetchLater, image-from-pagehide) are checked; `guardSignInBrowser`
 * opens a browser-level CDP session so cross-frame / cross-tab / worker requests are checked, response headers that
 * would prefetch links (Speculation-Rules) are stripped, and uninvited tabs and shared workers are refused. No other
 * auth module reads CDP events. BrowserGuardOptions lives in `interfaces/auth.ts`.
 */
import type { Browser, Page } from "playwright";
import type { BrowserGuardOptions, Sent } from "../../interfaces/auth.js";
import { pausedSent } from "./password-detection.js";

/**
 * Checks every request `page`'s tab sends once more, after the context's routes, through a DevTools session of its
 * own, and fails the ones `stops` names. Playwright's routes never see a request that follows a redirect (a 307 re-sends
 * the POST body to wherever the answer points), nor one a document sends while it is being left (a beacon, a keepalive
 * fetch, fetchLater or an image from a pagehide handler): Playwright lets those go on its own. A second session's
 * interception still sees them. guardSignInBrowser checks them once more at the browser, for every tab.
 *
 * A dedicated worker the page starts (0.6.0 review, round 2: SIGN_IN_HARDENING's Worker override undone) is attached
 * to this session paused, and never let run: Chromium runs a new worker only once every session holding it lets it
 * go, and nothing else would see its WebSockets. It is reported with `refuse` ("a worker"). Only workers are attached:
 * a frame from another site would wait for this session too, and never load.
 */
export async function stopUnrouted(page: Page, stops: (sent: Sent) => boolean, refuse: (what: string) => void = () => undefined): Promise<void> {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", (event) => {
    let stop: boolean;
    try {
      stop = stops(pausedSent(event));
    } catch {
      stop = false;
    }
    const { requestId } = event;
    const answer = stop
      ? session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
      : session.send("Fetch.continueRequest", { requestId });
    answer.catch(() => undefined);
  });
  session.on("Target.attachedToTarget", ({ targetInfo }) => {
    if (targetInfo.type === "worker") refuse("a worker");
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await session.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "worker" }, { exclude: true }] });
}

/** The response header whose rule sets could prefetch a link the page adds (see guardSignInBrowser). */
export const SPECULATION_RULES_HEADER = /^speculation-rules$/i;

// BrowserGuardOptions lives in interfaces/auth.ts.

/**
 * A browser-level DevTools session for the time of a sign-in (0.6.0 review, round 2): the layer below the context's
 * routes and each tab's own interception (stopUnrouted), for what neither of them sees.
 *
 * - **Every request the browser sends** (every tab, frame and worker: Fetch at the browser target) is checked with
 *   `stops`, and the ones it names fail. That covers a new tab's redirect hops (Playwright reports a tab only once its
 *   first navigation has committed, after its redirects, so its own interception comes too late), a frame from another
 *   site, a worker's HTTP requests, and a request sent while a document is being left.
 * - **A Speculation-Rules response header is dropped** from every document: its document rules could prefetch a link
 *   the page adds with the password, and no interception sees a prefetch (SIGN_IN_HARDENING strips inline rules).
 * - **A new tab of the sign-in context is held before it runs** (auto-attached with waitForDebuggerOnStart) and closed,
 *   unless `admitTab` lets it run (Run Hound's own sessionStorage probe, and the page Playwright's storageState opens
 *   to read an origin no tab is on); every request of a tab being closed fails. A password sign-in never opens a tab.
 *   The tab is closed one round trip of this session after it is attached, not at once (0.6.0, the whole suite's
 *   load): Playwright holds a new tab too (waitForDebuggerOnStart), and lets it go with Runtime.runIfWaitingForDebugger
 *   in the setup it sends as soon as its Browser.getWindowForTarget returns (Playwright 1.63). A same-site popup shares
 *   the renderer of the page that opened it, and one closed before Playwright's release reached it could leave that
 *   renderer paused for good: the sign-in page stopped running, and signing in never returned. Playwright asks for the
 *   window as soon as it hears of the tab, before this session does, and the browser answers in order: this session's
 *   command comes back after Playwright's answer, so the close goes out after Playwright's release.
 * - **A shared worker of the sign-in context is closed** as soon as it is created, and reported with `refuse`. Nothing
 *   else sees its requests or WebSockets, and waitForDebuggerOnStart doesn't hold one (Playwright's own browser session
 *   detaches from it, and that lets it run).
 *
 * Other contexts' tabs and shared workers are let go at once. `stops` and the header drop apply to the whole browser:
 * Run Hound signs in before any other context of its browser does anything. Resolves to the function that ends it.
 */
export async function guardSignInBrowser(browser: Browser, page: Page, options: BrowserGuardOptions): Promise<() => Promise<void>> {
  const own = await page.context().newCDPSession(page);
  const { targetInfo: sign } = await own.send("Target.getTargetInfo");
  await own.detach().catch(() => undefined);
  const session = await browser.newBrowserCDPSession();
  /** Tabs and workers being closed: every request from one of them fails. */
  const refused = new Set<string>();
  /** Tabs whose close is on its way (see the attach handler): ending the guard waits for them. */
  const closing = new Set<Promise<unknown>>();
  session.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    let answer: Promise<unknown>;
    if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
      // A document's response: its Speculation-Rules header is dropped (Fetch.continueResponse needs the status then).
      const headers = event.responseHeaders ?? [];
      const kept = headers.filter((h) => !SPECULATION_RULES_HEADER.test(h.name));
      answer =
        event.responseStatusCode === undefined || kept.length === headers.length
          ? session.send("Fetch.continueRequest", { requestId })
          : session.send("Fetch.continueResponse", {
              requestId,
              responseCode: event.responseStatusCode,
              ...(event.responseStatusText ? { responsePhrase: event.responseStatusText } : {}),
              responseHeaders: kept,
            });
    } else {
      let stop = refused.has(event.frameId);
      if (!stop) {
        try {
          stop = options.stops(pausedSent(event));
        } catch {
          stop = false;
        }
      }
      answer = stop ? session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }) : session.send("Fetch.continueRequest", { requestId });
    }
    answer.catch(() => undefined);
  });
  session.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    const { targetId } = targetInfo;
    const letGo = () => void session.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    const close = () => session.send("Target.closeTarget", { targetId }).catch(() => undefined);
    if (targetInfo.browserContextId !== sign.browserContextId || targetId === sign.targetId) return letGo();
    if (targetInfo.type === "shared_worker") {
      // Playwright doesn't hold a shared worker (it detaches from one), so it is closed at once.
      refused.add(targetId);
      void close();
      options.refuse("a shared worker");
      return;
    }
    if (targetInfo.type !== "page" || options.admitTab?.({ opener: Boolean(targetInfo.openerId) })) return letGo();
    // Its requests fail from now on; it is closed once Playwright has let it go (one round trip: see above).
    refused.add(targetId);
    const closed = session.send("Target.getTargetInfo", { targetId }).catch(() => undefined).then(close);
    closing.add(closed);
    void closed.finally(() => closing.delete(closed));
    options.tabClosed?.();
  });
  try {
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }, { urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "page" }, { type: "shared_worker" }, { exclude: true }],
    });
  } catch (err) {
    await session.detach().catch(() => undefined);
    throw err;
  }
  return async () => {
    // A tab still waiting for its close would be let go by the detach, with no request of it failing any more.
    await Promise.all(closing);
    await session.detach().catch(() => undefined);
  };
}