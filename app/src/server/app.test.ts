import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, Plan, Report, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Server fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

const NO_FORM_PAGE = `<!doctype html><html lang="en"><head><title>Nothing</title></head><body><p>No form here.</p></body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

const fakeChecks: Check[] = [
  {
    id: "dead-control",
    title: "Fake dead control",
    category: "broken-feature",
    plan: () => [scenario("dead-control", "dc:controls")],
    run: async (_ctx, s) => ({ checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 }),
  },
  {
    id: "double-submit",
    title: "Fake double submit",
    category: "broken-feature",
    plan: () => [scenario("double-submit", "ds:dblclick")],
    run: async (_ctx, s) => ({
      checkId: "double-submit",
      scenarioId: s.id,
      status: "fail",
      durationMs: 1,
      findings: [
        {
          checkId: "double-submit",
          id: "double-submit#1",
          title: "Fake double booking",
          severity: "high",
          category: "broken-feature",
          confidence: "confirmed",
          meaning: "Two bookings from one double click.",
          impact: "Duplicate bookings.",
          fix: "Disable the button while pending.",
          evidence: [],
          spec: { filename: "double-submit-1.spec.ts", source: "// fake double-submit spec\n" },
        },
      ],
    }),
  },
  {
    id: "client-only-validation",
    title: "Fake destructive",
    category: "validation",
    plan: () => [scenario("client-only-validation", "cov:replay", { destructive: true })],
    run: async (_ctx, s) => ({ checkId: "client-only-validation", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 }),
  },
];

let site: FixtureServer;
let runsDir: string;
let app: Hono;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE, "/empty": NO_FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-server-"));
  app = createApp({ checks: fakeChecks, runsDir });
});

afterAll(async () => {
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

function post(path: string, body: unknown, raw = false) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function createPlan(): Promise<{ planId: string; plan: Plan }> {
  const res = await post("/api/plan", { url: `${site.url}/book` });
  expect(res.status).toBe(200);
  return (await res.json()) as { planId: string; plan: Plan };
}

interface RunStatus {
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  report?: Report;
  error?: string;
}

async function waitForRun(runId: string, timeoutMs = 45_000): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.request(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunStatus;
    expect(["running", "done", "error"]).toContain(body.status);
    if (body.status !== "running") return body;
    if (Date.now() > deadline) throw new Error(`run ${runId} still running after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function startRun(body: Record<string, unknown>): Promise<string> {
  const res = await post("/api/runs", body);
  expect(res.status).toBe(202);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId).toEqual(expect.any(String));
  return runId;
}

describe("GET /", () => {
  it("serves the HTML UI with a labelled URL input", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html>");

    const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
    const urlInput = inputs.find((tag) => /type=["']?url\b/i.test(tag) || /(name|id)=["']?[\w-]*url\b/i.test(tag));
    expect(urlInput, "expected an <input> for the target URL").toBeDefined();

    const attr = (name: string) => urlInput!.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
    const id = attr("id");
    const labelled =
      Boolean(attr("aria-label")) ||
      Boolean(attr("aria-labelledby")) ||
      (id !== undefined && new RegExp(`<label\\b[^>]*\\bfor=["']${id}["']`, "i").test(html)) ||
      new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*${urlInput!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(html);
    expect(labelled, "the URL input needs a label").toBe(true);
  });
});

describe("POST /api/plan", () => {
  it("returns a plan id and the plan for a local form", async () => {
    const { planId, plan } = await createPlan();
    expect(planId).toEqual(expect.any(String));
    expect(planId.length).toBeGreaterThan(0);
    expect(plan.target).toBe(`${site.url}/book`);
    expect(plan.form.fields.map((f) => f.key)).toEqual(["petName"]);
    expect(plan.scenarios.map((s) => s.id)).toEqual(["dc:controls", "ds:dblclick", "cov:replay"]);
    expect(plan.scenarios.find((s) => s.id === "cov:replay")!.defaultSelected).toBe(false);
  });

  it("gives each plan a different id", async () => {
    const a = await createPlan();
    const b = await createPlan();
    expect(a.planId).not.toBe(b.planId);
  });

  it.each([
    ["missing url", {}],
    ["empty url", { url: "" }],
    ["non-string url", { url: 42 }],
    ["invalid url", { url: "not a url" }],
    ["non-http scheme", { url: "file:///etc/passwd" }],
    ["public target", { url: "http://8.8.8.8/" }],
  ])("returns 400 for %s", async (_name, body) => {
    const res = await post("/api/plan", body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toEqual(expect.any(String));
    expect(json.error.length).toBeGreaterThan(0);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await post("/api/plan", "{ not json", true);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toEqual(expect.any(String));
  });

  it("returns 400 when the page has no form", async () => {
    const res = await post("/api/plan", { url: `${site.url}/empty` });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/form/i);
  });
});

describe("runs", () => {
  let runId: string;
  let finished: RunStatus;

  beforeAll(async () => {
    const { planId } = await createPlan();
    runId = await startRun({ planId, approved: ["dc:controls", "ds:dblclick"] });
    finished = await waitForRun(runId);
  });

  it("finishes with a report", () => {
    expect(finished.status).toBe("done");
    expect(finished.total).toBe(2);
    expect(finished.completed).toBe(2);
    expect(finished.report).toBeDefined();
    expect(finished.report!.approved.sort()).toEqual(["dc:controls", "ds:dblclick"]);
    expect(finished.report!.findings.map((f) => f.id)).toEqual(["double-submit#1"]);
  });

  it("serves report.json", async () => {
    const res = await app.request(`/api/runs/${runId}/report.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const report = (await res.json()) as Report;
    expect(report.runId).toBe(finished.report!.runId);
    expect(report.findings).toHaveLength(1);
  });

  it("serves report.md", async () => {
    const res = await app.request(`/api/runs/${runId}/report.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/(markdown|plain)/);
    expect(await res.text()).toContain("Fake double booking");
  });

  it("serves report.html", async () => {
    const res = await app.request(`/api/runs/${runId}/report.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(await res.text()).toContain("Fake double booking");
  });

  it("serves exported spec files", async () => {
    const res = await app.request(`/api/runs/${runId}/specs/double-submit-1.spec.ts`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("// fake double-submit spec\n");
  });

  it("returns 404 for an unknown spec file", async () => {
    const res = await app.request(`/api/runs/${runId}/specs/nope.spec.ts`);
    expect(res.status).toBe(404);
  });

  it("does not serve files outside the run's specs folder", async () => {
    for (const path of [
      `/api/runs/${runId}/specs/..%2Freport.json`,
      `/api/runs/${runId}/specs/..%2F..%2F..%2Fpackage.json`,
      `/api/runs/${runId}/specs/%2E%2E%2Freport.json`,
    ]) {
      const res = await app.request(path);
      expect([400, 404], path).toContain(res.status);
    }
  });

  it("does not run destructive scenarios unless allowDestructive is set", async () => {
    const { planId } = await createPlan();
    const id = await startRun({ planId, approved: ["cov:replay"] });
    const status = await waitForRun(id);
    expect(status.status).toBe("done");
    const result = status.report!.results.find((r) => r.scenarioId === "cov:replay");
    expect(result?.status).toBe("skipped");
  });

  it("runs destructive scenarios with allowDestructive", async () => {
    const { planId } = await createPlan();
    const id = await startRun({ planId, approved: ["cov:replay"], allowDestructive: true });
    const status = await waitForRun(id);
    expect(status.status).toBe("done");
    expect(status.report!.results.find((r) => r.scenarioId === "cov:replay")?.status).toBe("pass");
  });
});

describe("404s", () => {
  it("POST /api/runs with an unknown plan id", async () => {
    const res = await post("/api/runs", { planId: "no-such-plan", approved: [] });
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId for an unknown run", async () => {
    expect((await app.request("/api/runs/no-such-run")).status).toBe(404);
  });

  it.each(["report.json", "report.md", "report.html", "specs/x.spec.ts"])("GET /api/runs/unknown/%s", async (file) => {
    expect((await app.request(`/api/runs/no-such-run/${file}`)).status).toBe(404);
  });

  it("unknown routes", async () => {
    expect((await app.request("/api/nope")).status).toBe(404);
  });
});

describe("DNS rebinding and cross-site protection", () => {
  const json = { "content-type": "application/json" };

  it.each([
    "http://localhost/",
    "http://127.0.0.1:4000/",
    "http://[::1]:4000/",
    "http://run-hound.localhost:4000/",
    "http://192.168.1.20:4000/", // reaching the machine (or a container) by address is fine
  ])("serves requests addressed to %s", async (base) => {
    const res = await app.request(new URL("/", base).toString());
    expect(res.status).toBe(200);
  });

  it("refuses requests whose Host is not a loopback name (a rebound public domain)", async () => {
    const page = await app.request("http://attacker.example:4000/");
    expect(page.status).toBe(403);
    const plan = await app.request("http://attacker.example:4000/api/plan", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ url: `${site.url}/book` }),
    });
    expect(plan.status).toBe(403);
    const status = await app.request("http://attacker.example:4000/api/runs/anything");
    expect(status.status).toBe(403);
  });

  it("accepts extra host names from serverHosts (e.g. a LAN name you chose to expose)", async () => {
    const custom = createApp({ checks: fakeChecks, runsDir, serverHosts: ["hound.lan"] });
    expect((await custom.request("http://hound.lan:4000/")).status).toBe(200);
    expect((await custom.request("http://other.lan:4000/")).status).toBe(403);
  });

  it("refuses a POST whose Origin is another site", async () => {
    const res = await app.request("/api/plan", {
      method: "POST",
      headers: { ...json, origin: "http://attacker.example" },
      body: JSON.stringify({ url: `${site.url}/book` }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts a POST from its own origin", async () => {
    const res = await app.request("/api/plan", {
      method: "POST",
      headers: { ...json, origin: "http://localhost" },
      body: JSON.stringify({ url: `${site.url}/book` }),
    });
    expect(res.status).toBe(200);
  });
});

describe("secrets never leave through the API", () => {
  const SECRET = "sk-proj-FAKEFAKEapi1234567890abcdefGHIJKL";

  it("redacts secrets in the plan it returns", async () => {
    const res = await post("/api/plan", { url: `${site.url}/book?key=${SECRET}` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[REDACTED:openai-key]");
  });

  it("redacts secrets in error messages", async () => {
    const res = await post("/api/plan", { url: `http://8.8.8.8/?key=${SECRET}` });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(SECRET);
  });
});

describe("POST /api/runs refuses runs that would look like a clean pass", () => {
  it("400 for an empty approval", async () => {
    const { planId } = await createPlan();
    const res = await post("/api/runs", { planId, approved: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/at least one/i);
  });

  it("400 for scenario ids the plan doesn't have", async () => {
    const { planId } = await createPlan();
    const res = await post("/api/runs", { planId, approved: ["nope"] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("nope");
  });

  it("400 for a flag that is not true or false", async () => {
    const { planId } = await createPlan();
    const res = await post("/api/runs", { planId, approved: ["dc:controls"], allowDestructive: "yes" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/plan extras", () => {
  it("returns the check titles for the plan's groups", async () => {
    const res = await post("/api/plan", { url: `${site.url}/book` });
    const body = (await res.json()) as { checks: Record<string, string> };
    expect(body.checks["dead-control"]).toBe("Fake dead control");
  });

  it("accepts a URL typed without http://", async () => {
    const res = await post("/api/plan", { url: `${site.url.replace(/^http:\/\//, "")}/book` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plan: Plan }).plan.target).toBe(`${site.url}/book`);
  });
});

describe("finished runs survive a restart", () => {
  it("serves a run's status and report from disk when this process never saw it", async () => {
    const { planId } = await createPlan();
    const runId = await startRun({ planId, approved: ["dc:controls"] });
    expect((await waitForRun(runId)).status).toBe("done");
    const fresh = createApp({ checks: fakeChecks, runsDir });
    const status = await fresh.request(`/api/runs/${runId}`);
    expect(status.status).toBe(200);
    expect(((await status.json()) as RunStatus).status).toBe("done");
    expect((await fresh.request(`/api/runs/${runId}/report.html`)).status).toBe(200);
    expect((await fresh.request(`/api/runs/..%2F..%2Fetc/report.json`)).status).toBe(404);
  });
});

describe("tester-release extras", () => {
  it("disables 'Show the browser window' and says why when there is no display (as in a container)", async () => {
    const headless = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const html = await (await headless.request("/")).text();
    expect(html).toMatch(/<input id="headed" type="checkbox" disabled>/);
    expect(html).toMatch(/Not available here: the machine running Run Hound has no display/);
    const withDisplay = await (await createApp({ checks: fakeChecks, runsDir, canShowBrowser: true }).request("/")).text();
    expect(withDisplay).toMatch(/<input id="headed" type="checkbox">/);
    expect(withDisplay).not.toMatch(/__HEADED_/);
  });

  it("refuses a headed run with a plain reason when there is no display", async () => {
    const headless = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const planRes = await headless.request("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${site.url}/book` }) });
    const { planId } = (await planRes.json()) as { planId: string };
    const res = await headless.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId, approved: ["dc:controls"], headed: true }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/no display/);
  });

  it("returns plan warnings: none for the page asked for, one when the form is on a page it redirected to", async () => {
    const plain = (await (await post("/api/plan", { url: `${site.url}/book` })).json()) as { warnings: string[] };
    expect(plain.warnings).toEqual([]);
    const redirecting = await startFixtureServer({
      pages: { "/login": FORM_PAGE },
      routes: {
        "GET /account": (_req, res) => {
          res.writeHead(302, { location: "/login" });
          res.end();
        },
      },
    });
    try {
      const body = (await (await post("/api/plan", { url: `${redirecting.url}/account` })).json()) as { warnings: string[] };
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0]).toMatch(/redirected to .*\/login.*sign-in page/);
    } finally {
      await redirecting.close();
    }
  });
});
