/**
 * A real browser page on a different *site* from the target, for the csrf check (0.5.0, docs/v2-spec.md "`csrf`"). Run
 * Hound serves a blank attacker page from a local origin that is a different site from the target (localhost is a
 * different site from 127.0.0.1, and the other way round), opens it in Account A's browser context, and sends the
 * forged request from it. The browser decides for itself which cookies to attach (SameSite), which is the whole point:
 * unlike CheckContext.request, a real cross-site page can't send a SameSite=Lax cookie or add a credential header.
 *
 * The attacker page is served from a real loopback HTTP server, not a routed/fulfilled response: a fulfilled page has
 * no IP address space, so Chromium's Private Network Access checks treat it as public and block its request to the
 * loopback target. A page served over real loopback shares the target's "local" address space, so the request goes
 * through. Only requests a cross-site page can send without a CORS preflight are sent (a form post, form-encoded or
 * multipart, or a text/plain body). A JSON body with a real content-type is sent only after the app's own server
 * answered a real preflight (sent by the caller, outside the browser) for the attacker origin with credentials allowed:
 * Run Hound's request interception makes Playwright answer the browser's preflight itself, so the browser's own
 * preflight can't decide. Every forge waits up to FORGE_WAIT_MS for the app's answer (forgeWaitMs: a test may shorten it).
 *
 * The attacker page is always plain http, whatever the target's scheme: http://127.0.0.1 and http://localhost are
 * potentially trustworthy, so a `SameSite=None; Secure` cookie of an https target still rides along.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page, Request, Response } from "playwright";
import type { CheckContext } from "../../core/types.js";

/**
 * How long a forge waits for the app's answer, whatever its encoding: a form or multipart post into a frame, and the
 * text/plain and JSON fetches (aborted in the page after it). A slow save that stores the forge and answers within it is
 * seen; an answer later than it (or none) is "no answer", which never makes a pass.
 */
export const FORGE_WAIT_MS = 30_000;

let forgeWait = FORGE_WAIT_MS;

/** How long a forge waits for the app's answer now: FORGE_WAIT_MS, unless a test shortened it (setForgeWaitMs). */
export function forgeWaitMs(): number {
  return forgeWait;
}

/**
 * For tests only: shortens the forge's wait to `ms` (so an answer later than it, the "late" branch, is seen in seconds),
 * or, with no argument, puts FORGE_WAIT_MS back. Never called by Run Hound itself.
 */
export function setForgeWaitMs(ms?: number): void {
  forgeWait = ms ?? FORGE_WAIT_MS;
}

/**
 * Failures after which the request never reached the app: the browser couldn't connect or refused to send it. Any
 * other failure (the connection closed or reset with no answer, an abort) may come after the request went out.
 */
const NEVER_SENT = /ERR_(?:CONNECTION_REFUSED|CONNECTION_FAILED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_INVALID|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR|NETWORK_ACCESS_DENIED|UNSAFE_PORT|SSL_|CERT_)/;

/** After an in-page fetch settled, how long its answer may still take to reach Playwright's network events. */
const SETTLE_MS = 5_000;

/**
 * How long after the wait an in-page fetch is aborted, so it never hangs the page: later than the wait for the answer,
 * so a forge with no answer in time is "late", never "failed" by Run Hound's own abort.
 */
const ABORT_AFTER_MS = 1_000;

/**
 * How a forged body is encoded on the wire. "form" (form-encoded), "multipart" (a multipart form) and "text" (a
 * text/plain body) need no preflight; "json" is sent only after a real one allowed it.
 */
export type ForgeEncoding = "form" | "multipart" | "text" | "json";

/** One request the cross-site page is asked to send to the app's own origin. */
export interface ForgedRequest {
  method: string;
  url: string;
  /** For "form"/"multipart" the fields as a URL-encoded `a=1&b=2` string; for "text" and "json" the JSON string. */
  body: string;
  encoding: ForgeEncoding;
}

/** How a forge went: whether the browser sent it, and the status the app answered when it could be read. */
export interface ForgeOutcome {
  /**
   * False only when Run Hound knows the request never reached the app: it failed the way a request that never went out
   * does (`failure`: the connection was refused, the host didn't resolve, the browser blocked it). True for an
   * answered forge, a late one (it went out and was waited on), and one whose connection closed with no answer.
   */
  sent: boolean;
  /**
   * The status the app answered, as the browser's network layer saw it (a form post into an iframe, or a no-cors
   * text/plain fetch, is opaque to the page but not to the network), or null when no answer arrived.
   */
  status: number | null;
  /**
   * Why there is no answer, when status is null: "late" when none arrived within the wait, "failed" when the
   * request failed (the connection closed with no answer, or it was never sent). The app may still store such a forge.
   */
  unanswered?: "late" | "failed";
  /** The browser's reason for a "failed" forge (net::ERR_EMPTY_RESPONSE, net::ERR_CONNECTION_REFUSED …), when it gave one. */
  failure?: string;
  /** The Location the app redirected the forge to, for a 3xx answer. */
  location?: string;
  /** Why the browser did not send it (a blocked preflight), when it didn't. */
  blocked?: string;
  /**
   * The names (never the values) of the cookies the browser attached to it; empty when it sent none, and also empty
   * when Run Hound never saw the app's answer (see cookiesSeen).
   */
  cookies: string[];
  /**
   * True when the request's headers were read with the app's answer, so `cookies` is what the browser attached. False
   * when no answer arrived in time: Playwright only knows the Cookie header a request really carried once its answer
   * arrives, so then nothing is known about the cookies, and an empty `cookies` never means "no cookie attached".
   */
  cookiesSeen: boolean;
}

/** A cookie the browser holds for the target: its name and SameSite only, never its value. */
export interface TargetCookie {
  name: string;
  sameSite: string;
}

export interface CrossSitePage {
  /** The attacker origin (a different site from the target). */
  origin: string;
  /** Every cookie the browser holds for the target's host, by name and SameSite ("None"/"Lax"/"Strict"). */
  targetCookies(): Promise<TargetCookie[]>;
  /** Sends one cross-site request from the attacker page to the app; the browser attaches cookies as it sees fit. */
  forge(request: ForgedRequest): Promise<ForgeOutcome>;
  dispose(): Promise<void>;
}

/** The host that is a different site from `host`, or null when no loopback swap makes one (a private name or IP). */
function crossSiteHost(host: string): string | null {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  // localhost and 127.0.0.1/::1 are different sites (one is a domain, the other an IP literal), so each can host the
  // attacker page for the other. Every other host (a private IP, or a private name from RUNHOUND_ALLOWED_HOSTS) has no
  // such twin: another port is the same site, and Run Hound may not reach out to a new host.
  if (h === "localhost" || h.endsWith(".localhost")) return "127.0.0.1";
  if (h === "127.0.0.1" || h === "::1") return "localhost";
  return null;
}

/**
 * Sets up the cross-site page for `target`, or explains why it can't. Starts a loopback HTTP server on the twin host
 * that serves a blank page, opens a page in Account A's browser context (so the browser holds A's cookies), and
 * navigates it there. The attacker page runs no app code; it only sends the one forged request Run Hound asks for.
 */
export async function crossSitePage(ctx: CheckContext, target: string): Promise<CrossSitePage | { inconclusive: string }> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { inconclusive: `Run Hound couldn't read the target URL (${target}), so it can't set up a cross-site page.` };
  }
  const twin = crossSiteHost(parsed.hostname);
  if (!twin) {
    return {
      inconclusive:
        `The target's host (${parsed.hostname.replace(/^\[|\]$/g, "")}) has no cross-site twin Run Hound can serve a page from: ` +
        "only localhost and 127.0.0.1 are different sites of each other on this machine, and Run Hound may not reach out to any other host. " +
        "CSRF can't be tested here without a truly cross-site origin.",
    };
  }

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html lang=\"en\"><head><title>Run Hound cross-site test</title></head><body></body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, twin, resolve);
  });
  // Always http: the server is plain HTTP (an https target's page would never load), and a loopback http origin is
  // still potentially trustworthy, so the browser attaches a Secure cookie to its request to an https target.
  const origin = `http://${twin}:${(server.address() as AddressInfo).port}`;

  const closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  let cookieContext: import("playwright").BrowserContext;
  let page: Page;
  try {
    const opened = await ctx.openPage({ as: "self" });
    cookieContext = opened.context;
    page = opened.page;
    ctx.step("Opening a page on another site", page);
    await page.goto(`${origin}/`, { waitUntil: "load" });
  } catch (err) {
    await closeServer();
    throw err;
  }

  return {
    origin,
    async targetCookies() {
      // All cookies, filtered by host: cookies(url) drops a Secure cookie on an http URL, which is exactly the
      // SameSite=None case this check reports, so it would hide the cookie that matters.
      const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const all = await cookieContext.cookies().catch(() => []);
      const forHost = all.filter((c) => {
        const domain = c.domain.replace(/^\./, "").toLowerCase();
        return domain === host || host.endsWith(`.${domain}`);
      });
      return forHost.map((c) => ({ name: c.name, sameSite: c.sameSite }));
    },
    forge(request) {
      return forgeFrom(page, request);
    },
    async dispose() {
      await closeServer();
    },
  };
}

/**
 * Sends one request from the already-open attacker `page` and waits for the app's answer (up to forgeWaitMs(), or until
 * the request fails), so the write is committed before the caller re-reads. A "form" body goes through a hidden <form>
 * submitted into an off-screen iframe (a cross-site POST with no custom headers, so no preflight, and never a top-level
 * navigation); a "multipart" body the same way with enctype="multipart/form-data". A "text" body goes through a no-cors
 * text/plain fetch (CORS-safelisted, so also no preflight: the classic JSON-sent-as-text vector); the page can't read
 * the answer, but the network layer sees its status, and the cookies the browser attached, as for a form post. A "json"
 * body goes through a fetch with a real JSON content-type; the caller sends it only when the app's own preflight answer
 * allowed the attacker origin with credentials. The verdict is always the re-read; the response is awaited to order the
 * write before it, to learn which cookies (by name) the browser attached, and to tell an answer from none (`unanswered`).
 * Throws when the page can't run the request (it was closed or navigated away). Exported for its unit test, which
 * orders the network events itself (cross-site-forge.test.ts).
 */
export async function forgeFrom(page: Page, request: ForgedRequest): Promise<ForgeOutcome> {
  const method = request.method.toUpperCase();
  const wait = forgeWaitMs();
  const isForge = (r: Request) => r.url() === request.url && r.method().toUpperCase() === method;
  // The request failed (the connection closed with no answer, or the fetch was aborted): no answer is coming, unless
  // the browser got one and then dropped it (a no-cors answer Chromium's Opaque Response Blocking blocks still arrived).
  let onFailed: (r: Request) => void = () => undefined;
  const failed = new Promise<{ failed: Request }>((resolve) => {
    onFailed = (r) => {
      if (isForge(r)) resolve({ failed: r });
    };
    page.on("requestfailed", onFailed);
  });
  // The app's answer to the forged request, whatever frame it comes from; "late" when none arrived in time.
  const response = page.waitForResponse((r) => isForge(r.request()), { timeout: wait }).then(
    (r) => ({ response: r }),
    () => "late" as const,
  );
  const read = async (r: Response) => {
    const headers = await r.request().allHeaders().catch(() => null);
    const location = r.status() >= 300 && r.status() < 400 ? r.headers()["location"] : undefined;
    return { status: r.status(), cookies: cookieNames(headers?.["cookie"]), cookiesSeen: headers !== null, ...(location ? { location } : {}) };
  };
  const answered = Promise.race([response, failed])
    .then(async (first) => {
      if (first === "late") return first;
      if ("response" in first) return read(first.response);
      const got = await first.failed.response().catch(() => null);
      return got ? read(got) : { failed: first.failed.failure()?.errorText ?? "" };
    })
    .finally(() => page.off("requestfailed", onFailed));
  const outcome = async (extra: Partial<ForgeOutcome> = {}, settled = false): Promise<ForgeOutcome> => {
    // After an in-page fetch settled, its answer (or failure) is already on its way to the network events: wait for
    // it a little, never the whole wait again.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = settled
      ? await Promise.race([answered, new Promise<"quiet">((resolve) => (timer = setTimeout(() => resolve("quiet"), Math.min(SETTLE_MS, wait))))]).finally(() =>
          clearTimeout(timer),
        )
      : await answered;
    // A late forge went out and was waited on. A fetch that settled with no network event after it went out too,
    // unless the page's fetch threw (`blocked`): then the browser may never have sent it. A failed one went out unless
    // its failure says it never could.
    if (answer === "late" || answer === "quiet") {
      return { sent: answer === "late" || !extra.blocked, status: null, unanswered: "late", cookies: [], cookiesSeen: false, ...extra };
    }
    if ("failed" in answer) {
      return {
        sent: !NEVER_SENT.test(answer.failed),
        status: null,
        unanswered: "failed",
        ...(answer.failed ? { failure: answer.failed } : {}),
        cookies: [],
        cookiesSeen: false,
        ...extra,
      };
    }
    return {
      sent: true,
      status: answer.status,
      cookies: answer.cookies,
      cookiesSeen: answer.cookiesSeen,
      ...(answer.location ? { location: answer.location } : {}),
      ...extra,
    };
  };

  if (request.encoding === "json") {
    const dispatch = await page.evaluate(
      async ({ url, m, body, wait }) => {
        try {
          await fetch(url, { method: m, credentials: "include", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(wait) });
          return { blocked: undefined as string | undefined };
        } catch (err) {
          // A failed CORS read of the answer also throws; the request itself was sent (the re-read decides).
          return { blocked: err instanceof Error ? err.message : String(err) };
        }
      },
      { url: request.url, m: method, body: request.body, wait: wait + ABORT_AFTER_MS },
    );
    return outcome(dispatch.blocked ? { blocked: dispatch.blocked } : {}, true);
  }

  if (request.encoding === "text") {
    await page.evaluate(
      async ({ url, m, body, wait }) => {
        // no-cors: a simple request whose answer is opaque to the page, as a real attacker page sends it. The browser's
        // network layer still sees the answer (its status and the cookies attached), which a CORS-mode fetch the app
        // answers without CORS headers never reports.
        await fetch(url, { method: m, mode: "no-cors", credentials: "include", headers: { "content-type": "text/plain" }, body, signal: AbortSignal.timeout(wait) }).catch(
          () => undefined,
        );
      },
      { url: request.url, m: method, body: request.body, wait: wait + ABORT_AFTER_MS },
    );
    return outcome({}, true);
  }

  // A form can only send GET or POST; the save this forges is always a POST (a create), so a form fits. The page
  // can't see the frame's answer; the network events do (up to the wait).
  await page.evaluate(
    ({ url, body, multipart }) => {
      const iframe = document.createElement("iframe");
      iframe.name = `rh_${Math.random().toString(36).slice(2)}`;
      iframe.style.display = "none";
      document.body.appendChild(iframe);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = url;
      form.target = iframe.name;
      if (multipart) form.enctype = "multipart/form-data";
      for (const [name, value] of new URLSearchParams(body)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    },
    { url: request.url, body: request.body, multipart: request.encoding === "multipart" },
  );
  return outcome();
}

/** The names in a Cookie request header ("a=1; b=2" → ["a", "b"]); the values are never kept. */
function cookieNames(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => part.split("=")[0]!.trim())
    .filter(Boolean);
}
