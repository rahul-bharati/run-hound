/**
 * The request log: every request a page makes, with when it was made (before or after the load event, or while the
 * reader scrolled), its type, transferred size and which of GSAP's core, ScrollTrigger and DrawSVG a script holds
 * (recognised as the build guards recognise them, scripts/lib/chunk-patterns.mjs). Specs use it for the lazy-JS
 * budgets, "no motion chunk under reduced motion", "a visit that never scrolls downloads no ScrollTrigger and no
 * DrawSVG" (§4.6 #11), the search dialog's cost and the first viewport's prefetches (gate: at most 10 requests and
 * 120 KB). Ported from site-design/judge-eng/judge-measure.mjs and site-research/scripts/measure-prefetch.mjs.
 */
import { gzipSync } from "node:zlib";
import { chunkPatterns } from "../../lib/chunk-patterns.mjs";

/** Which motion libraries a script's text holds: { gsap (the core), scrollTrigger, drawSVG }. */
export function librariesOf(text) {
  return { gsap: chunkPatterns.gsap.test(text), scrollTrigger: chunkPatterns.scrollTrigger.test(text), drawSVG: chunkPatterns.drawSVG.test(text) };
}

/**
 * Starts recording; returns { requests, phase(name) } where phase() labels the requests made from then on. A request
 * keeps the phase it was made in, not the one it finished in: a lazy chunk asked for after load and answered once the
 * approach began is an after-load download. A request that fails (aborted, refused, cut off by a navigation) is logged
 * too, with `failed` set to the browser's error text (null for one that finished) and no size.
 */
export function recordRequests(page) {
  const log = { phase: "load", requests: [] };
  const phaseOf = new WeakMap();
  page.on("load", () => {
    if (log.phase === "load") log.phase = "after-load";
  });
  page.on("request", (request) => phaseOf.set(request, log.phase));
  const entryOf = (request, failed) => {
    const url = new URL(request.url());
    return {
      phase: phaseOf.get(request) ?? log.phase,
      path: url.pathname + (url.search ? url.search : ""),
      type: request.resourceType(),
      rsc: request.headers().rsc === "1" || url.searchParams.has("_rsc"),
      prefetch: Boolean(request.headers()["next-router-prefetch"] || request.headers()["next-router-segment-prefetch"]),
      failed,
      /** Transferred (encoded) body bytes, as the prefetch budget counts them; decodedBytes is the body itself. */
      bytes: 0,
      decodedBytes: 0,
      gzip: 0,
      gsap: false,
      scrollTrigger: false,
      drawSVG: false,
    };
  };
  page.on("requestfailed", (request) => {
    log.requests.push(entryOf(request, request.failure()?.errorText ?? "failed"));
  });
  page.on("requestfinished", async (request) => {
    const entry = entryOf(request, null);
    log.requests.push(entry);
    try {
      const response = await request.response();
      const body = response ? await response.body() : Buffer.alloc(0);
      entry.decodedBytes = body.length;
      entry.bytes = (await request.sizes()).responseBodySize;
      if (entry.type === "script") {
        entry.gzip = gzipSync(body, { level: 9 }).length;
        Object.assign(entry, librariesOf(body.toString("latin1")));
      }
    } catch {
      // The page navigated away; the size stays 0.
    }
  });
  return {
    get requests() {
      return log.requests;
    },
    phase(name) {
      log.phase = name;
    },
  };
}

/** The route prefetches (RSC) among the requests: their count and transferred bytes. */
export function prefetches(requests) {
  const list = requests.filter((r) => r.rsc || r.prefetch);
  return { count: list.length, bytes: list.reduce((sum, r) => sum + r.bytes, 0), paths: list.map((r) => r.path) };
}

/**
 * The scripts requested in a phase: how many (and how many failed), their gzip size and whether any holds GSAP's core,
 * ScrollTrigger or DrawSVG.
 */
export function scriptsIn(requests, phase) {
  const list = requests.filter((r) => r.type === "script" && r.phase === phase);
  return {
    count: list.length,
    failed: list.filter((r) => r.failed).length,
    gzip: list.reduce((sum, r) => sum + r.gzip, 0),
    gsap: list.some((r) => r.gsap),
    scrollTrigger: list.some((r) => r.scrollTrigger),
    drawSVG: list.some((r) => r.drawSVG),
    paths: list.map((r) => r.path),
  };
}
