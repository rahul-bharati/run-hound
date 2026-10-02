/**
 * paywall-trust against other app shapes (0.6.0 review, round 1): the loads a page makes outside its frame — a
 * speculation rule, a Speculation-Rules header or a link rel=prefetch that names the app's own billing portal start —
 * must never reach a payment provider. Driven through createCheckContext like paywall-trust.test.ts, against small
 * fixture apps built per test.
 *
 * Split out of paywall-trust-shapes.test.ts: this file and paywall-trust-frames.test.ts share the same describe
 * title and the same it.each body (byte-identical, including the MANAGE const), each covering half of the original's
 * speculation-rule shapes, to keep both files under the suite's per-file time budget. See that file,
 * paywall-trust-shapes.test.ts and paywall-trust-shapes-trial.test.ts for the rest of the original file's coverage.
 * Shares test-support/paywall-harness.ts's fixture-app, discovery and browser/sink setup.
 */
import { describe, expect, it } from "vitest";
import { app, page, pathOf, runOn, send, SHOW, signedIn, sinkHits, SUCCESS_LINK, usePaywallHarness, WHO } from "../../test-support/paywall-harness.js";

usePaywallHarness({ tmpPrefix: "rh-paywall-shapes-" });

describe("paywall-trust: loads a page makes outside its frame never reach a payment provider", () => {
  // The app's own "Manage billing" link: a billing portal start the check never opens itself.
  const MANAGE = `<a href="/billing/portal">Manage billing</a>`;
  it.each([
    ["document rules, immediate prerender", `<script type="speculationrules">{"prerender":[{"source":"document","where":{"href_matches":"/*"},"eagerness":"immediate"}]}</script>`, ""],
    ["a Speculation-Rules header", "", "/speculation.json"],
    ["link rel=prefetch", `<link rel="prefetch" href="/billing/portal">`, ""],
  ])("speculation rules on the page under test (%s) never load the app's portal start", async (_name, head, header) => {
    const server = await app({
      pages: {
        "/app/billing": page("Billing", `<p id="plan">Loading…</p>`, SHOW),
        "/app/upgraded": page("Your upgrade", `<p>We couldn't find a payment.</p>`),
      },
      routes: {
        "GET /app": (_req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(header ? { "speculation-rules": `"${header}"` } : {}) });
          res.end(page("Dashboard", `<p id="plan">Loading…</p>${SUCCESS_LINK} ${MANAGE}`, SHOW, head));
        },
        "GET /speculation.json": (_req, res) => {
          res.writeHead(200, { "content-type": "application/speculationrules+json" });
          res.end(JSON.stringify({ prerender: [{ source: "list", urls: ["/billing/portal"] }] }));
        },
        "GET /api/me": (req, res) => (signedIn(req) ? send(res, 200, { ...WHO, plan: "free" }) : send(res, 401, {})),
        // A billing portal start: the app's server creates a portal session at the provider and redirects there.
        "GET /billing/portal": (_req, res) => {
          res.writeHead(303, { location: "https://billing.stripe.com/p/session/test_portal" });
          res.end();
        },
      },
    });
    const result = await runOn(server);
    await new Promise((r) => setTimeout(r, 1000));
    expect(server.requests.filter((r) => pathOf(r) === "/billing/portal")).toEqual([]);
    expect(sinkHits).toEqual([]);
    expect(result.status).not.toBe("error");
    if (_name === "link rel=prefetch") expect(result.notes).toMatch(/prefetch or prerender \/billing\/portal/);
  }, 120_000);
});
