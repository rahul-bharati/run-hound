import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createCheckContext } from "../engine/context.js";
import { discoverForm } from "../engine/discover.js";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/pii-leak/variants.js";
import { canaries } from "./lib/a11y-form.js";
import { appBackends, check, isOwnApiSave, thirdPartyRequests } from "./pii-leak.js";

const servers: FixtureServer[] = [];
let analytics: FixtureServer;

beforeEach(async () => {
  // Second fixture server on its own random port = a different origin = a third party.
  analytics = await startFixtureServer({
    routes: {
      "GET /collect": (_req, res) => { res.writeHead(204); res.end(); },
      "POST /collect": (_req, res) => { res.writeHead(204); res.end(); },
    },
  });
  servers.push(analytics);
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { scenarios, results } = await runCheck(check, `${server.url}/book`);
  const booking = app.created.at(-1) as { ownerEmail?: string; phone?: string } | undefined;
  return { scenarios, results, findings: allFindings(results), server, booking };
}

/** The canary email the check submitted, read back from what the target's own API received. */
function submittedEmail(booking: { ownerEmail?: string } | undefined): string {
  expect(booking?.ownerEmail, "the check submitted the form with a canary email").toEqual(expect.any(String));
  return booking!.ownerEmail!;
}

function expectLeakFinding(findingsText: string) {
  // Evidence names the third-party origin that received the data.
  expect(findingsText).toContain(new URL(analytics.url).host);
}

describe("pii-leak check", () => {
  it("is registered under its id as a security check", () => {
    expect(check.id).toBe("pii-leak");
    expect(check.category).toBe("security");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: email only goes to the same-origin API; third party gets an event name -> pass", async () => {
    const { scenarios, results, findings, booking } = await run(fixtures.good(analytics.url));
    expectPlanShape(scenarios, "pii-leak");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // Sanity: the check really submitted a canary (containing the run token) and the third party was contacted.
    expect(submittedEmail(booking)).toContain("t3st");
    expect(analytics.requests.some((r) => r.url.includes("event=booking_created"))).toBe(true);
  });

  it("BAD (S03): canary email in a third-party query string -> high security finding", async () => {
    const { results, findings, booking } = await run(fixtures.emailInQuery(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", severity: bug("S03").severity, confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    // Sanity: the leak really happened in this run.
    const email = submittedEmail(booking);
    expect(analytics.requests.some((r) => decodeURIComponent(r.url).includes(email))).toBe(true);
    expect(`${f.title} ${f.meaning}`).toMatch(/email/i);
  });

  it("BAD: SHA-256 of the canary email sent to a third party is still a leak", async () => {
    const { results, findings, booking } = await run(fixtures.hashedEmail(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    const email = submittedEmail(booking);
    const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    expect(analytics.requests.some((r) => r.url.includes(hash))).toBe(true);
    expect(findingText(f)).toMatch(/sha-?256|hash/i);
  });

  it("BAD: canary phone in a third-party POST body -> finding", async () => {
    const { results, findings, booking } = await run(fixtures.phoneInBody(analytics.url));
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, { checkId: "pii-leak", category: "security", confidence: "confirmed" });
    expectLeakFinding(findingText(f));
    expect(booking?.phone, "the check filled the phone field with a canary").toEqual(expect.any(String));
    expect(analytics.requests.some((r) => r.method === "POST" && r.body.includes(booking!.phone!))).toBe(true);
    expect(`${f.title} ${f.meaning}`).toMatch(/phone/i);
  });
});

describe("isOwnApiSave: the form's own API on another origin is not a third party", () => {
  const values = canaries("t3st");
  const TARGET = "http://localhost:5173/rsvp";
  const post = (over: Partial<Parameters<typeof isOwnApiSave>[0]> = {}) => ({
    method: "POST",
    resourceType: "fetch",
    url: "http://localhost:5174/api/rsvps",
    postData: JSON.stringify({ name: values.name, email: values.email }),
    ...over,
  });

  it("is the form's save when a write to a local origin carries two or more of the typed values", () => {
    expect(isOwnApiSave(post(), TARGET, values)).toBe(true);
    expect(isOwnApiSave(post({ url: "http://127.0.0.1:9000/save", postData: `email=${encodeURIComponent(values.email)}&phone=${values.phone}` }), TARGET, values)).toBe(true);
  });

  it("is a third party: only the email, a read, a URL-only leak, or a host on the internet", () => {
    expect(isOwnApiSave(post({ postData: JSON.stringify({ email: values.email, event: "signup" }) }), TARGET, values)).toBe(false);
    expect(isOwnApiSave(post({ method: "GET", postData: null, url: `http://localhost:5174/collect?email=${values.email}&name=${values.name}` }), TARGET, values)).toBe(false);
    expect(isOwnApiSave(post({ url: "https://crm.example.com/api/leads" }), TARGET, values)).toBe(false);
    expect(isOwnApiSave(post({ resourceType: "image" }), TARGET, values)).toBe(false);
  });
});

describe("appBackends: the app's own backend is not a third party, wherever it is hosted (CHK-9)", () => {
  const values = canaries("t3st");
  const TARGET = "http://localhost:5173/signup";
  type Req = Parameters<typeof appBackends>[0][number];
  const req = (over: Partial<Req>): Req => ({ method: "POST", resourceType: "fetch", url: "http://localhost:5173/api", postData: null, ...over });
  const lead = JSON.stringify({ name: values.name, email: values.email, phone: values.phone });
  const hosts = (requests: Req[]) => appBackends(requests, TARGET, values).map((b) => [new URL(b.origin).host, b.why]);
  const sha256 = createHash("sha256").update(values.email).digest("hex");

  it("a Supabase project is the app's backend; an analytics call with the email's hash is still a third party", () => {
    const supabase = req({ url: "https://abcdefghijkl.supabase.co/rest/v1/leads", postData: lead });
    const analytics = req({ method: "GET", resourceType: "fetch", url: `https://analytics.example.com/collect?em=${sha256}` });
    expect(hosts([supabase, analytics])).toEqual([["abcdefghijkl.supabase.co", "hosted-backend"]]);
    expect(thirdPartyRequests([supabase, analytics], TARGET, values)).toEqual([analytics]);
  });

  it("Firebase (Firestore, Auth) and a form service are backends even when they receive only the email", () => {
    const firestore = req({ url: "https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?database=projects%2Fx", postData: `req0___data__=${encodeURIComponent(values.email)}` });
    const auth = req({ url: "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaFake", postData: JSON.stringify({ email: values.email, password: values.password }) });
    const formspree = req({ url: "https://formspree.io/f/xyzabcd", postData: JSON.stringify({ email: values.email }) });
    expect(hosts([firestore, auth, formspree]).map(([h]) => h)).toEqual(["firestore.googleapis.com", "identitytoolkit.googleapis.com", "formspree.io"]);
  });

  it("a form that posts to another site itself (<form action>) sends its data there by design", () => {
    const post = req({ resourceType: "document", url: "https://forms.example.org/f/abc", postData: `email=${encodeURIComponent(values.email)}` });
    expect(hosts([post])).toEqual([["forms.example.org", "form-action"]]);
  });

  it("the app's configured API: the one origin that received the form, when nothing on this machine or a known backend did", () => {
    const api = req({ url: "https://api.myapp.example.com/v1/leads", postData: lead });
    const pixel = req({ method: "GET", resourceType: "image", url: `https://pixel.example.net/p?email=${encodeURIComponent(values.email)}` });
    expect(hosts([api, pixel])).toEqual([["api.myapp.example.com", "app-api"]]);
    expect(thirdPartyRequests([api, pixel], TARGET, values)).toEqual([pixel]);
  });

  it("is still a third party: a second origin receiving a copy of the form, an analytics host, or a lone email", () => {
    const own = req({ url: "http://localhost:5173/api/leads", postData: lead });
    const copy = req({ url: "https://crm.example.com/api/leads", postData: lead });
    // With the app's own save on this machine, another origin receiving the whole form is a copy sent elsewhere.
    expect(thirdPartyRequests([own, copy], TARGET, values)).toEqual([copy]);
    // A known analytics host is never taken for the app's API, even when it is the only one receiving the form.
    const identify = req({ url: "https://api.segment.io/v1/identify", postData: lead });
    expect(thirdPartyRequests([identify], TARGET, values)).toEqual([identify]);
    // Two unknown origins both receiving the form: Run Hound cannot tell which is the app's, so neither is exempt.
    const other = req({ url: "https://hooks.example.net/lead", postData: lead });
    expect(thirdPartyRequests([copy, other], TARGET, values)).toEqual([copy, other]);
    // The app writes to its own origin (even one typed value): nothing on the internet is taken for its API.
    const subscribe = req({ url: "http://localhost:5173/api/subscribe", postData: JSON.stringify({ email: values.email }) });
    expect(thirdPartyRequests([subscribe, copy], TARGET, values)).toEqual([copy]);
    // An email alone in a write to an unknown host is not the form being saved.
    const lone = req({ url: "https://tracker.example.io/e", postData: JSON.stringify({ email: values.email }) });
    expect(thirdPartyRequests([lone], TARGET, values)).toEqual([lone]);
  });

  it("S03 stays caught: the email in an analytics URL next to the app's own save", () => {
    const own = req({ url: "http://localhost:5173/api/bookings", postData: lead });
    const s03 = req({ method: "GET", url: `http://127.0.0.1:9999/collect?event=booking_created&email=${encodeURIComponent(values.email)}` });
    expect(thirdPartyRequests([own, s03], TARGET, values)).toEqual([s03]);
  });
});

describe("pii-leak with a hosted backend (CHK-9)", () => {
  it("a form saved to Supabase is not reported; the analytics call carrying the email is", async () => {
    const supabase = await startFixtureServer({
      routes: {
        "POST /rest/v1/leads": (_req, res) => {
          res.writeHead(201, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end("[]");
        },
      },
    });
    servers.push(supabase);
    const port = new URL(supabase.url).port;
    const page = `<!doctype html><html lang="en"><head><title>Join</title><link rel="icon" href="data:,"></head><body><main>
<h1 id="t">Join the waitlist</h1>
<form id="join" aria-labelledby="t" novalidate>
  <label for="name">Name</label><input id="name" name="name" required>
  <label for="email">Email</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <button id="send">Join</button><p role="status" id="st"></p>
</form></main>
<script>
document.getElementById("join").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const r = await fetch("http://abcdefghijkl.supabase.co:${port}/rest/v1/leads", { method: "POST", body: JSON.stringify(data) });
  fetch(${JSON.stringify(analytics.url)} + "/collect?event=join&email=" + encodeURIComponent(data.email), { mode: "no-cors" });
  document.getElementById("st").textContent = r.ok ? "You're on the list." : "Could not join.";
});
</script></body></html>`;
    const site = await startFixtureServer({ pages: { "/join": page } });
    servers.push(site);
    const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP abcdefghijkl.supabase.co 127.0.0.1"] });
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-pii-"));
    try {
      const url = `${site.url}/join`;
      const discovery = await browser.newPage();
      await discovery.goto(url, { waitUntil: "networkidle" });
      const form = await discoverForm(discovery);
      await discovery.close();
      const ctx = createCheckContext({ browser, form, targetUrl: url, artifactsDir, runToken: "t3st" });
      try {
        const [scenario] = check.plan(form);
        const result = await check.run(ctx, scenario!);
        // Sanity: the form really was saved to the "Supabase" project, with the typed email.
        expect(supabase.requests.some((r) => r.method === "POST" && r.body.includes(canaries("t3st").email))).toBe(true);
        expect(result.findings.map((f) => f.title)).toEqual([`Customer email address sent to a third party (${new URL(analytics.url).host})`]);
        expect(result.notes).toContain(`abcdefghijkl.supabase.co:${port}`);
        // The exported spec leaves the backend out too, so it passes once only the analytics call is fixed.
        expect(result.findings[0]!.spec!.source).toContain(`"http://abcdefghijkl.supabase.co:${port}"`);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await browser.close();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
