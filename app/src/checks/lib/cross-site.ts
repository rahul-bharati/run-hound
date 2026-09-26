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
 * through. Only requests a cross-site page can send without a CORS preflight are sent (a form post, or a text/plain
 * body). A JSON body with a real content-type is sent only after the app's own server answered a real preflight (sent
 * by the caller, outside the browser) for the attacker origin with credentials allowed: Run Hound's request
 * interception makes Playwright answer the browser's preflight itself, so the browser's own preflight can't decide.
 *
 * The attacker page is always plain http, whatever the target's scheme: http://127.0.0.1 and http://localhost are
 * potentially trustworthy, so a `SameSite=None; Secure` cookie of an https target still rides along.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import type { CheckContext } from "../../core/types.js";

/** How a forged body is encoded on the wire. "form"/"text" need no preflight; "json" only after a real one allowed it. */
export type ForgeEncoding = "form" | "text" | "json";

/** One request the cross-site page is asked to send to the app's own origin. */
export interface ForgedRequest {
  method: string;
  url: string;
  /** For "form"/"text" a URL-encoded `a=1&b=2` body; for "json" a JSON string. */
  body: string;
  encoding: ForgeEncoding;
}

/** How a forge went: whether the browser sent it, and the status the app answered when it could be read. */
export interface ForgeOutcome {
  /** True when the browser sent the request (a form post always is; a preflighted JSON fetch may be blocked first). */
  sent: boolean;
  /** The status the app answered, when the response could be read (a form post or a text/plain fetch is opaque, so null). */
  status: number | null;
  /** Why the browser did not send it (a blocked preflight), when it didn't. */
  blocked?: string;
  /** The names (never the values) of the cookies the browser attached to it; empty when it sent none. */
  cookies: string[];
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
 * Sends one request from the already-open attacker `page` and waits for the app's response, so the write is committed
 * before the caller re-reads. A "form" body goes through a hidden <form> submitted into an off-screen iframe (a
 * cross-site POST with no custom headers, so no preflight, and never a top-level navigation). A "text" body goes
 * through a text/plain fetch (CORS-safelisted, so also no preflight: the classic JSON-sent-as-text vector); reading the
 * response back is blocked without CORS headers, but the server still processed the request. A "json" body goes
 * through a fetch with a real JSON content-type; the caller sends it only when the app's own preflight answer allowed
 * the attacker origin with credentials. The verdict is always the re-read; the response is awaited only to order the
 * write before it, and to learn which cookies (by name) the browser attached. Throws when the page can't run the
 * request (it was closed or navigated away).
 */
async function forgeFrom(page: Page, request: ForgedRequest): Promise<ForgeOutcome> {
  const method = request.method.toUpperCase();
  // The app's answer to the forged request, whatever frame it comes from; timing out means it never arrived.
  const answered = page
    .waitForResponse((r) => r.url() === request.url && r.request().method() === method, { timeout: 5_000 })
    .then(
      async (r) => {
        const headers = await r.request().allHeaders().catch(() => ({}) as Record<string, string>);
        return { status: r.status(), cookies: cookieNames(headers["cookie"]) };
      },
      () => null,
    );
  const outcome = async (extra: Partial<ForgeOutcome> = {}): Promise<ForgeOutcome> => {
    const answer = await answered;
    return { sent: answer !== null, status: answer?.status ?? null, cookies: answer?.cookies ?? [], ...extra };
  };

  if (request.encoding === "json") {
    const dispatch = await page.evaluate(
      async ({ url, m, body }) => {
        try {
          await fetch(url, { method: m, credentials: "include", headers: { "content-type": "application/json" }, body });
          return { blocked: undefined as string | undefined };
        } catch (err) {
          // A failed CORS read of the answer also throws; the request itself was sent (the re-read decides).
          return { blocked: err instanceof Error ? err.message : String(err) };
        }
      },
      { url: request.url, m: method, body: request.body },
    );
    return outcome(dispatch.blocked ? { blocked: dispatch.blocked } : {});
  }

  if (request.encoding === "text") {
    await page.evaluate(
      async ({ url, m, body }) => {
        // A simple cross-origin request is dispatched and processed by the server even when the CORS read fails.
        await fetch(url, { method: m, credentials: "include", headers: { "content-type": "text/plain" }, body }).catch(() => undefined);
      },
      { url: request.url, m: method, body: request.body },
    );
    return outcome();
  }

  // A form can only send GET or POST; the save this forges is always a POST (a create), so a form fits.
  await page.evaluate(
    ({ url, body }) => {
      const iframe = document.createElement("iframe");
      iframe.name = `rh_${Math.random().toString(36).slice(2)}`;
      iframe.style.display = "none";
      document.body.appendChild(iframe);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = url;
      form.target = iframe.name;
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
    { url: request.url, body: request.body },
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
