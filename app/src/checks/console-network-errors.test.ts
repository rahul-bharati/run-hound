import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { discoverAndPlan, runPlan } from "../engine/runner.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { check, DEV_SERVER_NOISE } from "./console-network-errors.js";

const ID = "console-network-errors" as const;
const servers: BookingServer[] = [];
const others: FixtureServer[] = [];
const dirs: string[] = [];

async function app(client: ClientOptions = {}, api: ApiOptions = {}) {
  const s = await startBookingApp(client, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await Promise.all(others.map((s) => s.close()));
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  await closeBrowser();
});

describe("console-network-errors: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario for a form", () => {
    expectPlan(check, sampleForm(), "golden");
  });
});

describe("console-network-errors: GOOD", () => {
  it("passes a clean page and completes the golden path with valid data (the booking is created)", async () => {
    // The server validates strictly; a check that submits junk would cause its own 400 and blame the app.
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.api.bookings.length).toBeGreaterThanOrEqual(1);
  });

  it("passes a page that declares no favicon (headless Chromium asks for none)", async () => {
    const s = await app({ replaceHtml: [['<link rel="icon" href="data:,">', ""]] });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("ignores console.log / info / warn / debug (only errors count)", async () => {
    const s = await app({
      extraScript: [
        'console.log("app booted");',
        'console.info("build 1.2.3");',
        'console.warn("Deprecated prop `size` used");',
        'console.debug("debug detail");',
      ].join("\n"),
    });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("ignores errors the app catches and handles without a failed request (no console error, no page error)", async () => {
    const s = await app({
      extraScript: 'try { JSON.parse("{not json"); } catch (e) { /* handled */ }\nPromise.reject(new Error("handled")).catch(function () {});',
    });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });
});

describe("console-network-errors: BAD", () => {
  it("fails when the page requests an undefined env-var URL (undefined/api/availability -> 404) (F05)", async () => {
    const s = await app({ availabilityUrl: "undefined/api/availability" });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("undefined/api/availability");
    expect(evidenceText(findings)).toMatch(/404/);
  });

  it("fails on an uncaught page error and lists its message as evidence", async () => {
    const s = await app({
      extraScript: 'setTimeout(function () { throw new Error("availability widget crashed"); }, 0);',
    });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("availability widget crashed");
  });

  it("fails on a console.error even when every request succeeds", async () => {
    const s = await app({ extraScript: 'console.error("Warning: Each child in a list should have a unique key");' });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["low", "medium", "high"]);
    expect(evidenceText(findings)).toContain("unique key");
  });

  it("fails on a 5xx that only happens during the golden path (after submitting)", async () => {
    // Load is clean; GET /api/bookings answers 500 only once a booking exists.
    const s = await app({}, { failListAfterCreate: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("/api/bookings");
    expect(evidenceText(findings)).toMatch(/500/);
  });
});

describe("console-network-errors: dev-server plumbing is not the app", () => {
  it("DEV_SERVER_NOISE matches hot-reload sockets and pings of common dev servers, not app URLs", () => {
    for (const noise of [
      "http://localhost:3000/_next/webpack-hmr",
      "WebSocket connection to 'ws://host.docker.internal:3000/_next/webpack-hmr' failed:",
      "http://localhost:5173/@vite/client",
      "[vite] failed to connect to websocket.",
      "http://localhost:8080/sockjs-node/info?t=1",
      "Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from \"host.docker.internal\".",
    ]) {
      expect(DEV_SERVER_NOISE.test(noise), noise).toBe(true);
    }
    for (const app of ["http://localhost:3000/api/bookings", "http://localhost:5173/src/main.tsx", "Uncaught TypeError: x is undefined"]) {
      expect(DEV_SERVER_NOISE.test(app), app).toBe(false);
    }
  });

  it("GOOD: a failing hot-reload request (and its console line) on an otherwise clean page passes", async () => {
    const s = await app({ extraScript: 'fetch("/_next/webpack-hmr?id=1").catch(() => {});' });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });
});

describe("console-network-errors: requests Run Hound itself blocked are not app failures (CHK-1)", () => {
  it("GOOD: an embedded video from another site, which the navigation guard blocks, passes and is named in the notes", async () => {
    // The guard refuses every navigation off the target, iframes included: the embed never loads because of Run Hound.
    const s = await app({ replaceHtml: [["</main>", '<iframe title="Intro video" src="https://video.example.invalid/embed/intro"></iframe></main>']] });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(results[0]!.notes).toContain("https://video.example.invalid/embed/intro");
    expect(results[0]!.notes).toMatch(/not tested/i);
  });

  it("GOOD: a form that posts straight to a form service on another site passes; the blocked post is named in the notes", async () => {
    const page = `<!doctype html><html lang="en"><head><title>Contact</title><link rel="icon" href="data:,"></head><body><main>
<h1>Contact us</h1>
<form action="https://forms.example.invalid/f/abc123" method="post">
  <label for="name">Name</label><input id="name" name="name" required>
  <label for="email">Email</label><input id="email" name="email" type="email" required>
  <button type="submit">Send</button>
</form></main></body></html>`;
    const server = await startFixtureServer({ pages: { "/contact": page } });
    others.push(server);
    const { results } = await runCheck(check, `${server.url}/contact`);
    expectCleanPass(results, ID);
    expect(results[0]!.notes).toContain("POST https://forms.example.invalid/f/abc123");
  });

  it("BAD: a failed request of the app's own is still reported next to a blocked embed", async () => {
    const s = await app({
      availabilityUrl: "undefined/api/availability",
      replaceHtml: [["</main>", '<iframe title="Map" src="https://maps.example.invalid/embed"></iframe></main>']],
    });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["medium", "high"]);
    expect(evidenceText(findings)).toContain("undefined/api/availability");
    expect(evidenceText(findings)).not.toContain("maps.example.invalid");
  });
});

describe("console-network-errors: a page-load error is reported once per page, not once per form (CHK-10)", () => {
  const PAGE = `<!doctype html><html lang="en"><head><title>Hello</title><link rel="icon" href="data:,"></head><body><main>
<img src="/img/hero.png" alt="Hero">
<h1 id="t">Contact us</h1>
<form id="contact" aria-labelledby="t" novalidate>
  <label for="name">Name</label><input id="name" name="name" required>
  <label for="msg">Message</label><textarea id="msg" name="message" required></textarea>
  <button id="send">Send</button><p role="status" id="st"></p>
</form></main>
<footer><h2 id="n">Newsletter</h2><form id="news" aria-labelledby="n" novalidate><label for="news-email">Email</label><input id="news-email" name="email" type="email" required><button>Subscribe</button></form></footer>
<script>
const $ = (id) => document.getElementById(id);
$("contact").addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("name").value, message: $("msg").value }) });
  $("st").textContent = "Sent.";
});
$("news").addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: $("news-email").value }) });
});
</script></body></html>`;

  it("a broken hero image on a page with two forms is one finding, from the main form's scenario", async () => {
    const server = await startFixtureServer({
      pages: { "/": PAGE },
      routes: {
        "POST /api/messages": (_req, res) => json(res, 201, {}),
        "POST /api/subscribe": (_req, res) => json(res, 201, {}),
      },
    });
    others.push(server);
    const plan = await discoverAndPlan(`${server.url}/`, { checks: [check] });
    const ids = plan.scenarios.map((s) => s.id);
    expect(ids).toEqual(["golden-path", "golden-path@form-2"]);
    const runsDir = await mkdtemp(join(tmpdir(), "rh-cne-"));
    dirs.push(runsDir);
    const { report } = await runPlan(plan, { checks: [check], approved: ids, runsDir, log: () => undefined });
    const detail = JSON.stringify(report.results.map((r) => [r.scenarioId, r.status, r.notes]));
    expect(report.findings, detail).toHaveLength(1);
    expect(report.findings[0]!.id).toMatch(/golden-path-/);
    expect(evidenceText(report.findings)).toContain("/img/hero.png");
    const second = report.results.find((r) => r.scenarioId === "golden-path@form-2")!;
    expect(second.status, detail).toBe("pass");
    // The second form's scenario says where the page's load errors went, so nothing looks silently dropped.
    expect(second.notes).toMatch(/while loading.*main form/i);
  }, 120_000);

  it("still reports an error that only happens after submitting the second form", async () => {
    const server = await startFixtureServer({
      pages: { "/": PAGE.replace('<img src="/img/hero.png" alt="Hero">', "") },
      routes: {
        "POST /api/messages": (_req, res) => json(res, 201, {}),
        "POST /api/subscribe": (_req, res) => json(res, 500, { error: "down" }),
      },
    });
    others.push(server);
    const plan = await discoverAndPlan(`${server.url}/`, { checks: [check] });
    const runsDir = await mkdtemp(join(tmpdir(), "rh-cne-"));
    dirs.push(runsDir);
    const { report } = await runPlan(plan, { checks: [check], approved: plan.scenarios.map((s) => s.id), runsDir, log: () => undefined });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.id).toMatch(/golden-path@form-2/);
    expect(evidenceText(report.findings)).toContain("/api/subscribe");
  }, 120_000);
});
