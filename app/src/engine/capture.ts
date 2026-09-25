import type { Page, Request } from "playwright";
import { isLocalOrigin, isWrite } from "../core/saves.js";
import type { Capture } from "../core/types.js";
import { secretSpans } from "./redact.js";

/** Largest response body kept, in characters. */
const MAX_BODY = 64 * 1024;
const TEXTUAL = /json|^text\/|javascript|xml/i;

type CapturedRequest = Capture["requests"][number];

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Cuts `body` to MAX_BODY characters, never in the middle of a secret: a value that straddles the
 * limit is dropped whole, so half a key can never survive in an artifact.
 */
function truncate(body: string): string {
  if (body.length <= MAX_BODY) return body;
  let cut = MAX_BODY;
  for (const span of secretSpans(body)) {
    if (span.start < cut && span.end > cut) cut = span.start;
  }
  return `${body.slice(0, cut)}…[truncated ${body.length - cut} chars]`;
}

/**
 * Starts recording requests, responses, console messages and page errors for the page.
 * The returned object is live: it keeps filling as the page runs. Response bodies are kept only for same-origin
 * text/JSON responses, and for writes (POST, PUT, ...) to another origin on this machine or the local network (an
 * API on another port), truncated to 64 KB.
 * Response headers (all of them, set-cookie included) are kept for responses from the page's origin and other local
 * origins. "Same origin" means the origin of the page's latest top-level navigation.
 */
export function attachCapture(page: Page): Capture {
  const capture: Capture = { requests: [], console: [], pageErrors: [] };
  const entries = new WeakMap<Request, CapturedRequest>();
  let pageOrigin: string | null = originOf(page.url());

  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      pageOrigin = originOf(request.url()) ?? pageOrigin;
    }
    const entry: CapturedRequest = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      postData: request.postData(),
      status: null,
      failure: null,
      responseBody: null,
    };
    entries.set(request, entry);
    capture.requests.push(entry);
  });

  page.on("response", async (response) => {
    const entry = entries.get(response.request());
    if (!entry) return;
    entry.status = response.status();

    const contentType = response.headers()["content-type"] ?? "";
    const sameOrigin = pageOrigin !== null && originOf(entry.url) === pageOrigin;
    // Headers of the app's own responses (this origin, or another origin on this machine or network) feed the
    // header, cookie and CORS checks. allHeaders() includes set-cookie, which headers() leaves out.
    if (sameOrigin || isLocalOrigin(entry.url, page.url())) {
      try {
        entry.responseHeaders = await response.allHeaders();
      } catch {
        // The page navigated or closed first; leave the headers out.
      }
    }
    // A write to another origin on this machine or network (the app's API on another port) is the form being saved:
    // its answer is kept like a same-origin one. Reads from other origins, and anything from the internet, are not.
    const ownApiWrite =
      !sameOrigin && isWrite(entry) && ["fetch", "xhr"].includes(entry.resourceType) && isLocalOrigin(entry.url, page.url());
    // Redirects have no body to read.
    if ((!sameOrigin && !ownApiWrite) || !TEXTUAL.test(contentType) || (entry.status >= 300 && entry.status < 400)) return;
    try {
      entry.responseBody = truncate(await response.text());
    } catch {
      // The page navigated or closed before the body could be read; leave it null.
    }
  });

  page.on("requestfailed", (request) => {
    const entry = entries.get(request);
    if (entry) entry.failure = request.failure()?.errorText || "request failed";
  });

  page.on("console", (message) => {
    const url = message.location()?.url;
    capture.console.push({ type: message.type(), text: message.text(), ...(url ? { url } : {}) });
  });

  page.on("pageerror", (error) => {
    capture.pageErrors.push(error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message);
  });

  return capture;
}
