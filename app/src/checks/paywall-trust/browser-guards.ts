/**
 * Browser/context guards for paywall-trust: page hardening, browser DevTools session (shared workers, Speculation-Rules),
 * page DevTools block (payment providers, off-app loads, redirect hops), local-origin response capture, openAsSelf.
 * `heldByFn` is passed in by the orchestrator to read active holds without coupling to page-navigation.
 */
import type { Browser, BrowserContext, Page } from "playwright";
import { isLocalOrigin, isSameOrigin } from "../../core/saves.js";
import type { CheckContext } from "../../core/types.js";
import { actsWhenLoaded } from "../lib/acting-links.js";
import { PROVIDER_PATTERNS, SHARED_WORKER_REFUSED, SPECULATION_RULES_HEADER } from "../../constants/paywall-trust-constants.js";
import { sendsWrite, speculative } from "./paywall-trust.helpers.js";
import { MAX_LOCAL_BODY, MAX_LOCAL_READS } from "../../config/paywall-trust.js";
import {
  hostOf,
  isPaymentProvider,
  leavesTheApp,
  listed,
  ofTheApp,
  pathOf,
  placeOf,
  startsFrom,
} from "./urls.js";
import { PAGE_HARDENING } from "./page-scripts.js";
import type { ProviderLog, PaywallSession, LocalReads } from "../../interfaces/paywall-trust.js";
import { parseJson as parseJsonBody } from "../lib/record-state.js";

/** The redirects in `log` (from the `from`th on) that really reached a provider: not stopped by the DevTools block. */
export function reachedProvider(log: ProviderLog, from = 0): ProviderLog["reached"] {
  return log.reached.slice(from).filter((r) => !log.stoppedUrls.has(r.url));
}

/** Contexts that already have PAGE_HARDENING (openAsSelf's early hook, and again once the page is open). */
const hardenedContexts = new WeakSet<BrowserContext>();

/** Adds PAGE_HARDENING to `context` once, and counts the shared workers it refuses. */
export function harden(context: BrowserContext, log: ProviderLog): Promise<void> {
  if (hardenedContexts.has(context)) return Promise.resolve();
  hardenedContexts.add(context);
  context.on("console", (message) => {
    if (message.text() === SHARED_WORKER_REFUSED) log.sharedWorkers += 1;
  });
  return context.addInitScript(PAGE_HARDENING).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * A browser-level DevTools session for the time of the scenario (0.6.0 review, round 1), for what no route and no
 * tab-level block sees:
 * - **Shared workers**, the second layer under PAGE_HARDENING (a page can reach a constructor the init script never
 *   saw, from a frame's first empty document): it hears of every shared worker the browser creates and closes those of
 *   Account A's contexts (`own` names a context by one of its pages; one created before its context was named is closed
 *   then). Best effort: a worker may run briefly before it is closed.
 * - **The Speculation-Rules response header** is dropped from every document: its rules would prefetch or prerender
 *   pages no interception sees (a billing portal start, followed to the payment provider). A tab's own DevTools block
 *   is attached too late to see the answer of its first page load, so this is done at the browser, which sees every
 *   tab's documents from the first one. Scenarios run one at a time, so no other context loads meanwhile.
 * - **Every request to a payment provider** (PAYMENT_PROVIDERS, the hop of a server redirect included) is stopped at
 *   the browser too (0.6.0 review, round 2), recorded like the tab's block records one: a request a new window sent
 *   before its own block was attached (window.open("") and its address set at once) is never paused by that block, nor
 *   are its redirect hops, but the browser's session, on since the scenario started, sees them.
 * Null when the browser has no such session (not Chromium).
 */
export async function watchBrowser(browser: Browser, log: ProviderLog): Promise<{ own: (page: Page) => Promise<void>; stop: () => Promise<void> } | null> {
  let session: Awaited<ReturnType<Browser["newBrowserCDPSession"]>>;
  try {
    session = await browser.newBrowserCDPSession();
  } catch {
    return null;
  }
  const ours = new Set<string>();
  /** Shared workers of contexts not (yet) named as Account A's: target id → context id. */
  const others = new Map<string, string>();
  const close = (targetId: string) => {
    log.sharedWorkers += 1;
    session.send("Target.closeTarget", { targetId }).catch(() => undefined);
  };
  session.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type !== "shared_worker") return;
    const contextId = targetInfo.browserContextId ?? "";
    if (ours.has(contextId)) close(targetInfo.targetId);
    else others.set(targetInfo.targetId, contextId);
  });
  session.on("Target.targetDestroyed", ({ targetId }) => void others.delete(targetId));
  session.on("Fetch.requestPaused", (event) => {
    const { requestId } = event;
    if (event.responseStatusCode === undefined && event.responseErrorReason === undefined) {
      // The request stage: only an address that may be a payment provider's is paused there (PROVIDER_PATTERNS).
      const url = event.request.url;
      const provider = isPaymentProvider(url);
      if (provider) {
        log.blocked.push(hostOf(url));
        if (event.resourceType === "Document") log.blockedNav.push(hostOf(url));
        log.stoppedUrls.add(url);
      }
      const stop = provider
        ? session.send("Fetch.failRequest", { requestId, errorReason: event.resourceType === "Document" ? "Aborted" : "BlockedByClient" })
        : session.send("Fetch.continueRequest", { requestId });
      stop.catch(() => undefined);
      return;
    }
    const headers = event.responseHeaders ?? [];
    const kept = headers.filter((h) => !SPECULATION_RULES_HEADER.test(h.name));
    const answer =
      event.responseStatusCode === undefined || kept.length === headers.length
        ? session.send("Fetch.continueRequest", { requestId })
        : session.send("Fetch.continueResponse", {
            requestId,
            responseCode: event.responseStatusCode,
            ...(event.responseStatusText ? { responsePhrase: event.responseStatusText } : {}),
            responseHeaders: kept,
          });
    answer.catch(() => undefined);
  });
  try {
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }, ...PROVIDER_PATTERNS.map((urlPattern) => ({ urlPattern, requestStage: "Request" as const }))],
    });
    await session.send("Target.setDiscoverTargets", { discover: true, filter: [{ type: "shared_worker" }, { exclude: true }] });
  } catch {
    await session.detach().catch(() => undefined);
    return null;
  }
  return {
    own: async (page: Page) => {
      const own = await page.context().newCDPSession(page);
      try {
        const { targetInfo } = await own.send("Target.getTargetInfo");
        const contextId = targetInfo.browserContextId;
        if (!contextId) return;
        ours.add(contextId);
        for (const [targetId, of] of others) {
          if (of !== contextId) continue;
          others.delete(targetId);
          close(targetId);
        }
      } finally {
        await own.detach().catch(() => undefined);
      }
    },
    stop: () => session.detach().catch(() => undefined),
  };
}

/** Contexts whose redirect hops are already watched (blockPaymentProviders may be called twice for one context). */
const watchedContexts = new WeakSet<BrowserContext>();

/** Pages the DevTools block is attached to (or being attached to), with the attach. */
const browserBlocks = new WeakMap<Page, Promise<void>>();
/** Pages whose DevTools block is on (its Fetch.enable answered): a request of one sent since is seen at every hop. */
const blockedPages = new WeakSet<Page>();
/** Each watched context's first page: the one Run Hound opened (openPage opens one page per context). */
const firstPages = new WeakMap<BrowserContext, Page>();

/**
 * Stops every request `page`'s tab sends to a payment provider through a DevTools session of its own (Fetch
 * interception), the hop of a server redirect included: a same-origin checkout, billing portal, cancel or success page
 * that answers with a redirect to the provider. Playwright's routes never see a redirect hop (it lets those go on its
 * own), so without this the browser would follow it to the provider. The session sees each request before Playwright
 * does, so a request it stops never reaches Playwright's routes or events, nor the navigation guard (which would take
 * the redirect for the page leaving the app and close the context): it is recorded here, as "blocked (payment
 * provider)". Every other page load that would leave the app (leavesTheApp: another site, whatever its host, so a
 * checkout host PAYMENT_PROVIDERS doesn't name is never reached either), a first hop or any hop of a server redirect, is
 * stopped the same way and recorded in `offApp`: the navigation guard only refuses a first hop, and can only close the
 * context once a redirect hop was sent. A navigation is failed as aborted, so the page that tried it stays on screen. It
 * also stops what a hold in force names (activeHolds: a navigation, the hop of a server redirect to a same-origin
 * checkout or portal start included, or a write, a beacon included), recorded by that hold. Attached once per page;
 * every caller gets the same attach.
 */
export function blockAtBrowser(
  page: Page,
  log: ProviderLog,
  heldByFn: (context: BrowserContext, url: string, kind: "navigation" | "write") => boolean,
): Promise<void> {
  let attached = browserBlocks.get(page);
  if (!attached) {
    attached = (async () => {
      const session = await page.context().newCDPSession(page);
      session.on("Fetch.requestPaused", (event) => {
        const { request, requestId, resourceType } = event;
        if (resourceType === "Prefetch" || speculative(request.headers)) {
          // A prefetch or prerender the browser makes for the page (a <link rel=prefetch>, speculation rules that got
          // through): never needed, and a prerendered page runs its scripts out of sight. Stopped, and named when it
          // was a start of the app.
          if (ofTheApp(request.url, log.target) && startsFrom(log.target)(request.url)) log.speculative.push(placeOf(request.url, log.target));
          session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
          return;
        }
        const provider = isPaymentProvider(request.url);
        if (provider) {
          log.blocked.push(hostOf(request.url));
          if (resourceType === "Document") log.blockedNav.push(hostOf(request.url));
          log.stoppedUrls.add(request.url);
        }
        const leaves = !provider && resourceType === "Document" && leavesTheApp(request.url, log.target);
        if (leaves) log.offApp.push({ host: hostOf(request.url), from: log.current ?? "" });
        const stop = provider || leaves;
        const kind = resourceType === "Document" ? "navigation" : sendsWrite(resourceType, request.method) ? "write" : null;
        const held = !stop && kind !== null && heldByFn(page.context(), request.url, kind);
        const answer = stop || held
          ? session.send("Fetch.failRequest", { requestId, errorReason: resourceType === "Document" || held ? "Aborted" : "BlockedByClient" })
          : session.send("Fetch.continueRequest", { requestId });
        answer.catch(() => undefined);
      });
      await session.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      blockedPages.add(page);
    })();
    browserBlocks.set(page, attached);
  }
  return attached;
}

/**
 * Stops every request to a payment provider in `context` before it is sent, and records its host; records a server
 * redirect that reached one anyway. Every page of the context (a popup too) gets the DevTools block (blockAtBrowser),
 * which also stops a redirect hop, before any navigation of it goes out: the route holds each navigation of the page
 * Run Hound opened until that page's block is attached. A new window's first load comes before the window is a page
 * (request.frame() throws) and before the "page" event, so its block can't be attached first: that load is never sent
 * (a same-origin address that answers with a redirect to a provider would get there), and the window is named in the
 * notes. So is any other navigation of a new window that comes before its block is on (0.6.0 review, round 2: a window
 * opened blank with window.open("") and sent on at once): the block never sees a request sent before it was attached,
 * nor its redirect hops. A WebSocket to a provider is refused too (context.routeWebSocket: no route or DevTools block
 * sees its handshake), and listed as "blocked (payment provider)". The
 * route runs before every route registered earlier (the navigation guard's), so a provider navigation is listed too; a
 * provider navigation stopped by the guard's route (during the first load, before this route is added again after it)
 * is listed from the request event. A first hop that would leave the app for another site is stopped here too, and
 * recorded like the DevTools block records one (whichever sees it first).
 */
export async function blockPaymentProviders(
  context: BrowserContext,
  log: ProviderLog,
  heldByFn: (context: BrowserContext, url: string, kind: "navigation" | "write") => boolean,
): Promise<void> {
  let sockets: Promise<unknown> = Promise.resolve();
  if (!watchedContexts.has(context)) {
    watchedContexts.add(context);
    const opened = context.pages()[0];
    if (opened) firstPages.set(context, opened);
    context.on("page", (page) => {
      if (!firstPages.has(context)) firstPages.set(context, page);
      void blockAtBrowser(page, log, heldByFn).catch(() => undefined);
    });
    for (const page of context.pages()) void blockAtBrowser(page, log, heldByFn).catch(() => undefined);
    sockets = context
      .routeWebSocket(
        (url) => isPaymentProvider(url.href),
        (ws) => {
          log.blocked.push(hostOf(ws.url()));
          void ws.close().catch(() => undefined);
        },
      )
      .catch(() => undefined);
    context.on("request", (request) => {
      if (!request.isNavigationRequest() || !isPaymentProvider(request.url())) return;
      // A first hop is routed, so it is stopped (by this block or, before openAsSelf adds it again, by the navigation
      // guard, whose route then runs first): listed as blocked either way. providerNote lists each host once.
      if (!request.redirectedFrom()) {
        log.blocked.push(hostOf(request.url()));
        log.blockedNav.push(hostOf(request.url()));
        return;
      }
      let first = request.redirectedFrom()!;
      while (first.redirectedFrom()) first = first.redirectedFrom()!;
      const via = pathOf(first.url());
      log.reached.push({ url: request.url(), host: hostOf(request.url()), from: log.current ?? via, via });
    });
  }
  await context.route("**/*", async (route, request) => {
    const url = request.url();
    if (!isPaymentProvider(url)) {
      if (!request.isNavigationRequest()) return route.fallback();
      // Attached once per page (the attach is shared), so this waits only on a page's first navigation.
      let page: Page | null = null;
      try {
        page = request.frame().page();
      } catch {
        page = null;
      }
      // A new window's navigation that came before its block was on is never sent (see the function comment).
      const early = page !== null && firstPages.get(context) !== page && !blockedPages.has(page);
      const attached = page === null || early ? false : await blockAtBrowser(page, log, heldByFn).then(() => true, () => false);
      if (attached && !leavesTheApp(url, log.target)) return route.fallback();
      if (attached) log.offApp.push({ host: hostOf(url), from: log.current ?? "" });
      if (page === null || early) log.unopened.push({ url, from: log.current ?? "" });
      return route.abort("aborted").catch(() => undefined);
    }
    log.blocked.push(hostOf(url));
    if (request.isNavigationRequest()) log.blockedNav.push(hostOf(url));
    // A navigation is aborted without an error page, so the page that tried it stays on screen (and in the evidence).
    await route.abort(request.isNavigationRequest() ? "aborted" : "blockedbyclient").catch(() => undefined);
  });
  await sockets;
}

/** Keeps the JSON answers of the app's own GETs (fetch/XHR) to another local origin, at most MAX_LOCAL_READS. */
export function keepLocalReads(
  context: BrowserContext,
  targetUrl: string,
  local: LocalReads,
  maxLocalReads: number = MAX_LOCAL_READS,
  maxLocalBody: number = MAX_LOCAL_BODY,
  jsonParser: (body: string) => unknown = parseJsonBody,
): void {
  context.on("response", (response) => {
    if (local.closed || local.reads.length >= maxLocalReads) return;
    const request = response.request();
    const url = request.url();
    const status = response.status();
    if (request.method().toUpperCase() !== "GET" || !["fetch", "xhr"].includes(request.resourceType())) return;
    if (status < 200 || status >= 300 || isSameOrigin(url, targetUrl) || !isLocalOrigin(url, targetUrl)) return;
    // A GET that acts when loaded (/invites/7/accept, ?action=delete) is never taken as the entitlement to re-read.
    if (actsWhenLoaded(url)) return;
    const type = response.headers()["content-type"] ?? "";
    if (type !== "" && !/json|text\//i.test(type)) return;
    const at = local.reads.push(null) - 1;
    local.pending.push(
      response.text().then(
        (body) => {
          if (body.length <= maxLocalBody) local.reads[at] = { method: "GET", url, status, json: jsonParser(body) };
        },
        () => undefined,
      ),
    );
  });
}

/**
 * Account A's page, opened on the page under test with payment providers blocked from its very first request: the
 * block is added the moment the browser creates the context (Browser "context" event), before openPage installs the
 * guard and loads the page, so a page that loads a provider's script on its first load never reaches the provider.
 * Scenarios run one at a time, so no other scenario's context is created meanwhile. Once open, the block is added
 * again so it runs before the guard's route and a provider navigation is listed as well, and nothing more is opened
 * until the page's DevTools block (which also stops a redirect hop to a provider) is attached: when it can't be, this
 * throws, so no page is opened without it. With `local`, the answers of the app's GETs to its API on another local
 * origin are kept too (see LocalReads).
 */
export async function openAsSelf(
  ctx: CheckContext,
  log: ProviderLog,
  heldByFn: (context: BrowserContext, url: string, kind: "navigation" | "write") => boolean,
  local?: LocalReads,
  workers?: Awaited<ReturnType<typeof watchBrowser>>,
): Promise<PaywallSession> {
  const early = (context: BrowserContext) => {
    void harden(context, log);
    void blockPaymentProviders(context, log, heldByFn).catch(() => undefined);
    if (local) keepLocalReads(context, ctx.targetUrl, local);
  };
  ctx.browser.on("context", early);
  let session: PaywallSession;
  try {
    session = await ctx.openPage({ as: "self" });
  } finally {
    ctx.browser.off("context", early);
  }
  await harden(session.context, log);
  await blockPaymentProviders(session.context, log, heldByFn);
  try {
    await blockAtBrowser(session.page, log, heldByFn);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    throw new Error(`Run Hound couldn't set up its payment-provider block in the browser (${reason}), so it opened no success page.`);
  }
  await workers?.own(session.page).catch(() => undefined);
  return session;
}

/** A note listing what was stopped (provider hosts, off-app hosts) and what reached a provider anyway. */
export function providerNote(log: ProviderLog): string {
  const notes: string[] = [];
  const offApp = [...new Map(log.offApp.filter((o) => o.host).map((o) => [`${o.host} ${o.from}`, o])).values()];
  const stopped = [
    ...[...new Set(log.blocked.filter(Boolean))].map((h) => `${h}: blocked (payment provider)`),
    ...offApp.map((o) => `${o.host}: another site (${o.from || "a page of the app"} headed there)`),
  ];
  if (stopped.length > 0) {
    const shownStops = stopped.slice(0, 12);
    notes.push(
      `Stopped before they left the browser: ${shownStops.join("; ")}${stopped.length > shownStops.length ? `; and ${stopped.length - shownStops.length} more` : ""}.`,
    );
  }
  const reached = [...new Map(reachedProvider(log).map((r) => [`${r.from} ${r.via} ${r.host}`, r])).values()];
  for (const r of reached.slice(0, 5)) {
    notes.push(
      r.via === r.from
        ? `${r.from} redirected the browser to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`
        : `${r.from} sent the browser to ${r.via}, which redirected it to ${r.host} (payment provider): a server redirect is followed before Run Hound can stop it, so that request reached the provider.`,
    );
  }
  const where = (url: string) => (isSameOrigin(url, log.target) ? pathOf(url) : `${hostOf(url)}${pathOf(url)}`);
  const unopened = [...new Map(log.unopened.map((u) => [`${u.from} ${where(u.url)}`, u])).values()];
  for (const u of unopened.slice(0, 5)) {
    notes.push(`${u.from || "A page"} opened a new window at ${where(u.url)}, which Run Hound didn't load.`);
  }
  const speculative = [...new Set(log.speculative)];
  if (speculative.length > 0) {
    notes.push(`A page asked the browser to prefetch or prerender ${listed(speculative.slice(0, 5))} (a checkout or billing portal start), which Run Hound stopped.`);
  }
  if (log.sharedWorkers > 0) {
    notes.push("A page tried to start a shared worker, which Run Hound blocked: its requests can't be watched for payment providers.");
  }
  return notes.join(" ");
}