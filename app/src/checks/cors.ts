/**
 * cors (V1): repeat up to 5 of the page's own read requests (GET to the target's origin, or to the app's API on
 * another local origin) from a sandboxed frame, so the browser itself sends them with "Origin: null", the origin any
 * website can give a request by putting it in a sandboxed iframe. Fails when the app lets that origin read the answer
 * with the visitor's cookies (Access-Control-Allow-Origin: null, echoed, with Access-Control-Allow-Credentials: true:
 * high), and flags an echo without credentials (low, advisory). "*" without credentials is a public API: fine.
 *
 * Only GETs the page itself already made are repeated (never ones whose path acts, such as /logout or /unsubscribe),
 * without following redirects and with a 10 s limit each, so nothing is created or changed. The sandboxed frame lives in
 * a blank page Run Hound serves itself on 127.0.0.1 for the length of the scenario (a loopback page, so Chromium's
 * local network rules allow its requests to the app), in the same guarded, pinned browser context as the page.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserContext, Frame, Page } from "playwright";
import type { Check, Severity } from "../core/types.js";
import { isLocalOrigin } from "../core/saves.js";
import { checkResult, clip, FindingList, guarded, listOf, playwrightSpec, plural, scenarioFor } from "./lib/a11y-common.js";
import { DEV_SERVER_NOTE, looksLikeDevServer, requestLine, worst } from "./lib/http-checks.js";

const ID = "cors" as const;

/** The Origin a sandboxed iframe sends: any website can make one, so trusting it means trusting every website. */
export const PROBE_ORIGIN = "null";
const MAX_PROBES = 5;
const PROBE_TIMEOUT_MS = 10_000;
/** Paths that act instead of read (sign out, unsubscribe, delete…): repeating them could change something. */
const ACTION_PATH = /log-?out|sign-?out|logoff|unsubscribe|delete|remove|destroy|revoke|cancel|confirm|verify|activate|reset/i;
const PROBE_PAGE = '<!doctype html><title>Run Hound CORS probe</title><iframe sandbox="allow-scripts" srcdoc="<p>probe</p>"></iframe>';

export interface CorsAnswer {
  url: string;
  status: number;
  allowOrigin: string | null;
  allowCredentials: boolean;
}

/** How bad an answer to the probe origin is, or null when it doesn't let the probe origin read anything. */
export function corsVerdict(a: CorsAnswer): { severity: Severity; confidence: "confirmed" | "advisory"; problem: string } | null {
  const reflected = a.allowOrigin === PROBE_ORIGIN;
  if (reflected && a.allowCredentials) {
    return { severity: "high", confidence: "confirmed", problem: "lets any website read it with the visitor's cookies" };
  }
  if (reflected) return { severity: "low", confidence: "advisory", problem: "lets any website read it (without cookies)" };
  return null;
}

/** GET requests the page made that answered 2xx: same origin or the app's API on another local origin; unique URLs. */
function probeTargets(requests: { url: string; method: string; resourceType: string; status: number | null }[], targetUrl: string): string[] {
  const urls: string[] = [];
  for (const r of requests) {
    if (r.method !== "GET" || !["fetch", "xhr"].includes(r.resourceType) || r.status === null || r.status < 200 || r.status >= 300) continue;
    if (!isLocalOrigin(r.url, targetUrl) || urls.includes(r.url)) continue;
    try {
      if (ACTION_PATH.test(new URL(r.url).pathname)) continue;
    } catch {
      continue;
    }
    urls.push(r.url);
  }
  // The page itself last: an HTML page readable by any site with cookies leaks whatever it shows.
  if (!urls.includes(targetUrl)) urls.push(targetUrl);
  return urls.slice(0, MAX_PROBES);
}

/** Starts the blank probe page on 127.0.0.1 (random port). */
async function startProbeServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(PROBE_PAGE);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

/** Opens the probe page in `context` and returns its sandboxed frame. */
async function openProbe(context: BrowserContext, url: string): Promise<{ page: Page; frame: Frame }> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw new Error("The CORS probe frame did not load.");
  return { page, frame };
}

/**
 * Sends GET `url` from the sandboxed frame (Origin: null). When the browser lets the frame read the answer, returns the
 * CORS headers of that answer; when it blocks it (the fetch rejects: no CORS permission, or the request failed), the
 * answer is not readable and allowOrigin is null.
 */
async function probe(page: Page, frame: Frame, url: string): Promise<CorsAnswer> {
  const href = new URL(url).href;
  const answer = page.waitForResponse((r) => r.url() === href && r.request().method() === "GET", { timeout: 10_000 }).catch(() => null);
  const read = (await frame.evaluate(
    // No redirects (the probe never reaches a host the page didn't contact) and at most 10 s per request. An opaque
    // redirect is not readable.
    `fetch(${JSON.stringify(href)}, { credentials: "include", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(${PROBE_TIMEOUT_MS}) })
      .then((r) => ({ ok: r.type !== "opaqueredirect", status: r.status }), () => ({ ok: false, status: 0 }))`,
  )) as { ok: boolean; status: number };
  if (!read.ok) return { url, status: 0, allowOrigin: null, allowCredentials: false };
  const response = await answer;
  const headers = response ? await response.allHeaders() : {};
  return {
    url,
    status: read.status,
    allowOrigin: headers["access-control-allow-origin"] ?? null,
    allowCredentials: (headers["access-control-allow-credentials"] ?? "").trim().toLowerCase() === "true",
  };
}

export const check: Check = {
  id: ID,
  title: "Other websites can't read the app's data",
  category: "security",
  scope: "page",

  plan() {
    return [
      scenarioFor(ID, "foreign-origin", {
        title: "Ask the app's API whether other websites may read it",
        description: `Repeats up to ${MAX_PROBES} of the page's own read requests (GET) from a sandboxed frame, as any website could send them (Origin: null), and checks the answers don't let other websites read them with the visitor's cookies. Only requests the page already made are repeated; nothing is created or changed. On a dev server, findings are advisory.`,
        priority: "medium",
      }),
    ];
  },

  async run(ctx, scenario) {
    return guarded(ID, scenario, async (startedAt) => {
      const findings = new FindingList(ID, "security");
      const { context, page, capture } = await ctx.openPage();
      const dev = looksLikeDevServer(capture);
      const targets = probeTargets(capture.requests, ctx.targetUrl);
      const answers: CorsAnswer[] = [];
      const probeServer = await startProbeServer();
      try {
        const opened = await openProbe(context, probeServer.url);
        for (const url of targets) {
          ctx.step(`Sending ${requestLine("GET", url)} from a sandboxed frame (Origin: null)`, page);
          answers.push(await probe(opened.page, opened.frame, url));
        }
        await opened.page.close().catch(() => undefined);
      } finally {
        await new Promise<void>((resolve) => probeServer.server.close(() => resolve()));
      }
      const bad = answers.map((a) => ({ a, v: corsVerdict(a) })).filter((x): x is { a: CorsAnswer; v: NonNullable<ReturnType<typeof corsVerdict>> } => x.v !== null);
      const checked = `Sent ${plural(answers.length, "request")} from a sandboxed frame (${listOf(answers.map((a) => requestLine("GET", a.url)), 5, (s) => s)})`;
      if (bad.length === 0) return checkResult(ID, scenario, startedAt, [], `${checked}: the browser let other websites read none of them.`);

      const card = await ctx.captureCard("answers that other websites may read", {
        title: `GET from a sandboxed frame (Origin: ${PROBE_ORIGIN})`,
        subtitle: "Each request was sent by the browser from a sandboxed frame, as any website can send it",
        lines: answers.flatMap((a) => {
          const v = corsVerdict(a);
          return [
            { text: `${requestLine("GET", a.url)} → ${a.status === 0 ? "blocked by the browser (not readable)" : a.status}` },
            { text: `  access-control-allow-origin: ${a.allowOrigin ?? "(not sent)"}`, ...(v ? { mark: true } : {}) },
            { text: `  access-control-allow-credentials: ${a.allowCredentials ? "true" : "(not sent)"}`, ...(v && a.allowCredentials ? { mark: true } : {}) },
          ];
        }),
        facts: [
          { label: "Origin sent", value: PROBE_ORIGIN },
          { label: "Requests", value: String(answers.length) },
          { label: "Readable by any site", value: String(bad.length) },
          { label: "Dev server", value: dev ? "yes (advisory)" : "no" },
        ],
      });
      const withCookies = bad.filter((b) => b.a.allowCredentials);
      const first = bad[0]!;
      const f = findings.add({
        title:
          bad.length === 1
            ? `${requestLine("GET", first.a.url)} ${first.v.problem}`
            : `${bad.length} endpoints let any website read them${withCookies.length ? " with the visitor's cookies" : ""}`,
        severity: worst(bad.map((b) => b.v.severity)),
        confidence: dev || bad.every((b) => b.v.confidence === "advisory") ? "advisory" : "confirmed",
        location: requestLine("GET", first.a.url),
        locations: bad.map((b) => requestLine("GET", b.a.url)),
        meaning: `Asked from a sandboxed frame (Origin: null, which any website can produce), the app answered with Access-Control-Allow-Origin: ${first.a.allowOrigin}${withCookies.length ? " and Access-Control-Allow-Credentials: true" : ""}. The browser therefore lets every website read ${clip(bad.map((b) => requestLine("GET", b.a.url)).join(", "), 120)}.`,
        impact: withCookies.length
          ? `Any website a signed-in user visits can quietly call these endpoints with the user's cookies and read the answers: their data, their account details, anything the app returns.${dev ? ` ${DEV_SERVER_NOTE}` : ""}`
          : `Any website can read these answers from inside a visitor's browser. That matters when the app trusts the network (an intranet, a home network) instead of cookies.${dev ? ` ${DEV_SERVER_NOTE}` : ""}`,
        fix: `Ask your AI or developer: "Our CORS setup trusts the 'null' origin (it echoes the request's Origin${withCookies.length ? " with Access-Control-Allow-Credentials: true" : ""}). Only allow our own front-end origins (an explicit list), never echo the request's Origin, never allow 'null', and only send Access-Control-Allow-Credentials for origins on that list."`,
        evidence: [card],
      });
      f.spec = playwrightSpec(ID, 1, "the API doesn't trust unknown websites", ctx.targetUrl, [
        `// A request as a sandboxed frame on any website sends it.`,
        ...bad.map(
          (b) =>
            `{\n  const r = await page.request.get(${JSON.stringify(b.a.url)}, { headers: { Origin: ${JSON.stringify(PROBE_ORIGIN)} } });\n  expect(r.headers()["access-control-allow-origin"] ?? "", "must not trust the null origin").not.toBe(${JSON.stringify(PROBE_ORIGIN)});\n}`,
        ),
      ].join("\n"));
      return checkResult(ID, scenario, startedAt, findings.items, dev ? DEV_SERVER_NOTE : undefined);
    });
  },
};
