import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { startFixtureServer } from "../../test-support/server.js";
import { createCheckContext } from "../engine/context.js";
import { discoverForm } from "../engine/discover.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { evidenceText, expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { startHangApp } from "../../test/fixtures/checks/hang-app.js";
import { check, replayAllowed } from "./verbose-errors.js";

const ID = "verbose-errors" as const;
const servers: BookingServer[] = [];

/**
 * The fixture form has no client-side length or format checks, so oversized and malformed values reach
 * the server whether the check types them into the form or sends them directly.
 * GOOD server: 400 { errors: { field: friendly message } }, or 400 { error } for a malformed body.
 * BAD server (stackOnBadInput): 500 { error, stack } with a Node stack trace and /srv/kennel/... paths.
 */
async function app(client: ClientOptions, api: ApiOptions) {
  const s = await startBookingApp(client, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("verbose-errors: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "security");
  });

  it("plans a danger, non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "danger");
  });
});

describe("verbose-errors: GOOD", () => {
  it("passes when bad input gets friendly field messages, even though they contain words like 'error' and 'at'", async () => {
    // The page also says "Sitters arrive at 9 am" and shows "... must be 50 characters or fewer." messages:
    // ordinary prose with "at" or "Error" is not a stack trace.
    const s = await app(
      { extraScript: 'document.querySelector(".help").insertAdjacentText("beforeend", " Error codes are listed at help.example.test.");' },
      {},
    );
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    // Sanity: the check really sent bad input and the server rejected it.
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
  });

  it("passes when the server answers 500 with a generic message and no internals", async () => {
    // A plain 500 is someone else's finding (console-network-errors / silent-failure), not a verbose error.
    const s = await app({}, { genericErrorOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.createRequests().length).toBeGreaterThanOrEqual(1);
  });
});

describe("verbose-errors: BAD", () => {
  it("fails when a server error shows a stack trace in the page (S04)", async () => {
    const s = await app({ showStack: true }, { stackOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "security", ["medium", "high"]);
    expect(evidenceText(findings)).toMatch(/validateBooking|\/srv\/kennel\/server\/bookings\.js/);
  });

  it("fails when the stack trace is only in the response body (the page shows a generic message)", async () => {
    const s = await app({ showStack: false }, { stackOnBadInput: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "security", ["medium", "high", "low"]);
    expect(evidenceText(findings)).toMatch(/validateBooking|\/srv\/kennel\/server\/bookings\.js/);
  });
});

describe("verbose-errors: the malformed replay only goes where the safety gate allows (CHK-7)", () => {
  const TARGET = "http://localhost:5173/book";
  const publicLookup = async () => ["104.18.38.10"];
  const privateLookup = async () => ["10.0.0.7"];

  it("allows the target's own host and addresses on this machine or the local network, without a lookup", async () => {
    const never = async (): Promise<string[]> => {
      throw new Error("no lookup expected");
    };
    expect(await replayAllowed("http://localhost:5173/api/bookings", TARGET, { lookup: never })).toBe(true);
    expect(await replayAllowed("http://localhost:8787/api/bookings", TARGET, { lookup: never })).toBe(true);
    expect(await replayAllowed("http://127.0.0.1:9000/save", TARGET, { lookup: never })).toBe(true);
    expect(await replayAllowed("http://192.168.1.20:3000/save", TARGET, { lookup: never })).toBe(true);
  });

  it("refuses what the gate refuses: a cloud backend, a public or CGNAT address, 0.0.0.0", async () => {
    expect(await replayAllowed("https://abcdefgh.supabase.co/rest/v1/leads", TARGET, { lookup: publicLookup })).toBe(false);
    expect(await replayAllowed("http://100.89.173.13:4717/save", TARGET, { lookup: publicLookup })).toBe(false);
    expect(await replayAllowed("http://0.0.0.0:4000/save", TARGET, { lookup: publicLookup })).toBe(false);
    expect(await replayAllowed("http://api.nowhere.invalid/save", TARGET, { lookup: async () => Promise.reject(new Error("ENOTFOUND")) })).toBe(false);
  });

  it("allows what the gate allows: a name that resolves only to private addresses, or one listed in RUNHOUND_ALLOWED_HOSTS", async () => {
    expect(await replayAllowed("http://api:4000/save", "http://web:3000/", { lookup: privateLookup })).toBe(true);
    expect(await replayAllowed("https://api.staging.example.com/save", TARGET, { lookup: publicLookup, allowedHosts: ["api.staging.example.com"] })).toBe(true);
  });

  it("never sends the malformed body to a save endpoint on a host the gate refuses, and says why", async () => {
    // The API answers on this machine, but under a name the gate refuses (it resolves nowhere for Node); only the
    // browser is told where it is, like a cloud backend the page talks to directly.
    const api = await startFixtureServer({
      routes: {
        "POST /api/leads": (_req, res) => {
          res.writeHead(201, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end("{}");
        },
      },
    });
    const apiPort = new URL(api.url).port;
    const page = `<!doctype html><html lang="en"><head><title>Leads</title><link rel="icon" href="data:,"></head><body><main>
<h1 id="t">Get in touch</h1>
<form id="lead" aria-labelledby="t" novalidate>
  <label for="name">Name</label><input id="name" name="name">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="notes">Notes</label><textarea id="notes" name="notes"></textarea>
  <button id="send">Send</button><p role="status" id="st"></p>
</form></main>
<script>
document.getElementById("lead").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = JSON.stringify(Object.fromEntries(new FormData(e.target)));
  const r = await fetch("http://api.refused.test:${apiPort}/api/leads", { method: "POST", body });
  document.getElementById("st").textContent = r.ok ? "Thanks!" : "Could not send.";
});
</script></body></html>`;
    const site = await startFixtureServer({ pages: { "/lead": page } });
    const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP api.refused.test 127.0.0.1"] });
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-verbose-"));
    try {
      const url = `${site.url}/lead`;
      const discovery = await browser.newPage();
      await discovery.goto(url, { waitUntil: "networkidle" });
      const form = await discoverForm(discovery);
      await discovery.close();
      const ctx = createCheckContext({ browser, form, targetUrl: url, artifactsDir, runToken: "t3st" });
      try {
        const [scenario] = check.plan(form);
        const result = await check.run(ctx, scenario!);
        // Sanity: the form's own save reached the API (the app did that, not Run Hound).
        expect(api.requests.some((r) => r.method === "POST" && r.body.includes("t3st"))).toBe(true);
        expect(api.requests.filter((r) => r.body === '{"broken": [1, 2,'), JSON.stringify(api.requests.map((r) => r.body.slice(0, 40)))).toEqual([]);
        expect(result.status).toBe("pass");
        expect(result.notes).toMatch(/not (sent|replayed)/i);
        expect(result.notes).toContain(`api.refused.test:${apiPort}`);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await browser.close();
      await rm(artifactsDir, { recursive: true, force: true });
      await api.close();
      await site.close();
    }
  }, 60_000);
});

describe("verbose-errors: a server that never answers the malformed replay (ENG-1)", () => {
  it("gives up on the replay after 10 seconds and still reports on the rest", async () => {
    const s = await startHangApp("malformed");
    try {
      const started = Date.now();
      const { results } = await runCheck(check, `${s.url}/contact`);
      expect(Date.now() - started, "the check finished on its own").toBeLessThan(30_000);
      expect(s.hung(), "the malformed replay reached the server and was never answered").toBeGreaterThan(0);
      expect(results[0]!.status, results[0]!.notes).toBe("pass");
    } finally {
      await s.close();
    }
  }, 45_000);
});
