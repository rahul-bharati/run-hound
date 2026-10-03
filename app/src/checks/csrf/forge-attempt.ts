/** Account-A re-read helpers for the csrf check: how the record endpoint is read as A, how writes are sent as A, and the CORS preflight. */

import { requestIO, snapshotFrom, type RecordIO, type RecordSnapshot } from "../lib/record-state.js";
import type { CheckContext } from "../../core/types.js";
import type { Page } from "playwright";
import type { Reread, ReadVia } from "../../types/csrf.js";

/** A record endpoint's answer as a Reread. */
function asReread(answer: { status: number; body: string } | null): Reread {
  if (!answer) return null;
  if (answer.status === 404 || answer.status === 410) return "gone";
  if (answer.status < 200 || answer.status >= 300) return null;
  try {
    return { json: JSON.parse(answer.body) as unknown };
  } catch {
    return null;
  }
}

/** GETs the record endpoint from Account A's own browser page. The re-read of a cookie session goes through the browser, not CheckContext.request: a SameSite=None cookie is Secure, and the request context does not send a Secure cookie over http to 127.0.0.1, while the browser does. */
export async function readInPage(page: Page, url: string): Promise<Reread> {
  const answer = await page
    .evaluate(async (u) => {
      const res = await fetch(u, { credentials: "include" });
      return { status: res.status, body: await res.text() };
    }, url)
    .catch(() => null);
  return asReread(answer);
}

/** GETs the record endpoint through CheckContext.request as Account A, which sends the credential headers the app's own pages sent (an Authorization: Bearer token). */
export async function readThroughRequest(ctx: CheckContext, url: string): Promise<Reread> {
  const answer = await ctx.request("self", { method: "GET", url }).catch(() => null);
  return asReread(answer);
}

/** Reads the record endpoint as Account A the way `via` says: through A's browser page, or through CheckContext.request. */
export const readAsA = (ctx: CheckContext, page: Page, url: string, via: ReadVia): Promise<Reread> =>
  via === "page" ? readInPage(page, url) : readThroughRequest(ctx, url);

/** Sends a write from Account A's own browser page (same origin, A's cookies): its status, or null when it failed. */
export async function sendInPage(page: Page, r: { method: string; url: string; contentType: string; body: string }): Promise<number | null> {
  return page
    .evaluate(async (x) => {
      const res = await fetch(x.url, { method: x.method, headers: { "content-type": x.contentType }, body: x.body, credentials: "include" });
      return res.status;
    }, r)
    .catch(() => null);
}

/** How the put-back reads and writes as Account A (record-state's RecordIO): reads the way every other read of this scenario is made (`via`); writes through CheckContext.request, and for a cookie session whose write that refuses, once more from Account A's own page. */
export function ioAsA(ctx: CheckContext, page: Page, via: ReadVia): RecordIO {
  const viaRequest = requestIO(ctx);
  return {
    read: (url) => readAsA(ctx, page, url, via),
    send: async (r) => {
      const status = await viaRequest.send(r);
      if (via !== "page" || status === null || (status >= 200 && status < 300)) return status;
      return (await sendInPage(page, r)) ?? status;
    },
  };
}

/** The first read of the record endpoint as Account A, and the snapshot of the test record in it. */
export async function firstRead(
  ctx: CheckContext,
  page: Page,
  url: string,
  testValues: string[],
): Promise<{ via: ReadVia; json: unknown; snap: RecordSnapshot } | null> {
  for (const via of ["page", "request"] as const) {
    const read = await readAsA(ctx, page, url, via);
    const snap = read && read !== "gone" ? snapshotFrom(url, read.json, testValues, ctx.runToken) : null;
    if (read && read !== "gone" && snap) return { via, json: read.json, snap };
  }
  return null;
}

/** True when the app's own server lets a page on `origin` send a credentialed JSON POST to `url`: a real CORS preflight, sent outside the browser (without cookies, as a browser sends one), answered 2xx with that exact origin, credentials allowed, and the content-type header allowed. */
export async function corsAllows(ctx: CheckContext, url: string, origin: string): Promise<boolean> {
  const answer = await ctx
    .request("signed-out", {
      method: "OPTIONS",
      url,
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    })
    .catch(() => null);
  if (!answer || answer.status < 200 || answer.status >= 300) return false;
  const h = answer.headers;
  const headers = (h["access-control-allow-headers"] ?? "").split(",").map((v) => v.trim().toLowerCase());
  return h["access-control-allow-origin"] === origin && (h["access-control-allow-credentials"] ?? "").toLowerCase() === "true" && headers.includes("content-type");
}