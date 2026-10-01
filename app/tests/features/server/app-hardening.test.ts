import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { headerProblems } from "../checks/security-headers.js";
import type { Check, CheckId, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

/**
 * Hardening of the local server (0.4.0 audit):
 * - Host: the UI and API answer only requests addressed to loopback (localhost, *.localhost, 127.0.0.0/8, ::1, and the
 *   unspecified 0.0.0.0 / :: that only ever reach this machine), to names and addresses in serverHosts
 *   (RUNHOUND_SERVER_HOSTS), to the host of publicUrl (RUNHOUND_PUBLIC_URL) and to the specific address `serve --host`
 *   was bound to (boundHost; never a wildcard). Any other IP literal is refused with 403, so another container on the
 *   same network can't reach the API by the server's address.
 * - Headers: every response has X-Content-Type-Options: nosniff, X-Frame-Options: DENY, a Referrer-Policy and a CSP
 *   with frame-ancestors 'none'. The UI's CSP allows only its own inline script and style (by hash), images from
 *   itself and data: URIs, and requests to itself; report.html gets a CSP with no scripts at all and `sandbox`.
 * - Re-run of a run read back from disk: keeps allowDestructive (report.options when the report records it, else
 *   whether a destructive approved scenario really ran), and refuses a target whose secret was redacted on disk
 *   instead of planning the wrong URL.
 * - GET /api/runs parses a report.json from disk once per change (keyed by its mtime and size), not on every poll.
 */

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Hardening fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

const pass = (checkId: CheckId) => async (_ctx: unknown, s: Scenario): Promise<CheckResult> => ({ checkId, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 });

const fakeChecks: Check[] = [
  { id: "dead-control", title: "Fake dead control", category: "broken-feature", plan: () => [scenario("dead-control", "dc:controls")], run: pass("dead-control") },
  {
    id: "client-only-validation",
    title: "Fake destructive",
    category: "validation",
    plan: () => [scenario("client-only-validation", "cov:replay", { destructive: true, defaultSelected: false })],
    run: pass("client-only-validation"),
  },
];

let site: FixtureServer;
let runsDir: string;
let app: Hono;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-server-hardening-"));
  app = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, maxConcurrentRuns: 10 });
});

afterAll(async () => {
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

const json = { "content-type": "application/json" };

interface RunStatus {
  status: "running" | "done" | "error";
  report?: Report;
  error?: string;
}

async function waitForRun(target: Hono, runId: string, timeoutMs = 45_000): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await target.request(`/api/runs/${runId}`)).json()) as RunStatus;
    if (body.status !== "running") return body;
    if (Date.now() > deadline) throw new Error(`run ${runId} still running after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A finished run as it is on disk (target and plan redacted the way runPlan writes them). */
function diskReport(runId: string, target: string, over: { approved?: string[]; results?: CheckResult[]; destructive?: boolean; extra?: Record<string, unknown> } = {}): Report {
  const scenarios = [scenario("dead-control", "dc:controls"), scenario("client-only-validation", "cov:replay", { destructive: over.destructive ?? true, defaultSelected: false })];
  const plan: Plan = {
    target,
    form: { url: target, selector: "#booking", name: "Book a sitter", fields: [], controls: [] },
    scenarios,
    groups: [{ id: "features", label: "Features", scenarioIds: ["dc:controls", "cov:replay"] }],
  };
  const results = over.results ?? [
    { checkId: "dead-control", scenarioId: "dc:controls", status: "pass", findings: [], durationMs: 5 },
    { checkId: "client-only-validation", scenarioId: "cov:replay", status: "pass", findings: [], durationMs: 5 },
  ];
  const count = (st: CheckResult["status"]) => results.filter((r) => r.status === st).length;
  return {
    runId,
    target,
    startedAt: "2021-02-03T04:05:06.000Z",
    finishedAt: "2021-02-03T04:05:16.000Z",
    durationMs: 10_000,
    groups: [],
    runHoundVersion: "0.3.0",
    plan,
    approved: over.approved ?? ["dc:controls", "cov:replay"],
    results,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: count("pass"), failed: count("fail"), errored: count("error"), skipped: count("skipped") },
    notVisible: [],
    ...(over.extra ?? {}),
  } as Report;
}

async function writeDiskRun(runId: string, report: Report): Promise<string> {
  const dir = join(runsDir, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "report.json"), JSON.stringify(report));
  await writeFile(join(dir, "report.html"), "<!doctype html><title>r</title><p>report</p>");
  return dir;
}

describe("Host: only loopback, configured names and the bound address", () => {
  it.each([
    "http://localhost:4000/",
    "http://LOCALHOST:4000/",
    "http://run-hound.localhost:4000/",
    "http://127.0.0.1:4000/",
    "http://127.3.2.1:4000/",
    "http://[::1]:4000/",
    "http://[::ffff:127.0.0.1]:4000/",
    // `serve --host 0.0.0.0` prints this address; connecting to it only ever reaches this machine.
    "http://0.0.0.0:4000/",
  ])("serves the UI addressed to %s", async (base) => {
    expect((await app.request(new URL("/", base).toString())).status).toBe(200);
  });

  it.each(["http://10.89.1.9:4000", "http://172.17.0.3:4000", "http://192.168.1.20:4000", "http://[fd00::5]:4000", "http://8.8.8.8:4000"])(
    "refuses other IP addresses (%s): another container can't read runs, start runs or change the AI settings",
    async (base) => {
      const before = await (await app.request("/api/ai", { headers: { "x-run-hound": "1" } })).json();
      const page = await app.request(`${base}/`);
      expect(page.status).toBe(403);
      expect(((await page.json()) as { error: string }).error).toMatch(/RUNHOUND_SERVER_HOSTS=/);
      expect((await app.request(`${base}/api/runs`)).status).toBe(403);
      expect((await app.request(`${base}/api/ai`, { headers: { "x-run-hound": "1" } })).status).toBe(403);
      const put = await app.request(`${base}/api/ai`, {
        method: "PUT",
        headers: { ...json, "x-run-hound": "1" },
        body: JSON.stringify({ enabled: true, provider: "openai-compatible", baseUrl: "https://attacker.example/v1", model: "x", allowRemote: true }),
      });
      expect(put.status).toBe(403);
      const plan = await app.request(`${base}/api/plan`, { method: "POST", headers: json, body: JSON.stringify({ url: `${site.url}/book` }) });
      expect(plan.status).toBe(403);
      // Nothing changed.
      expect(await (await app.request("/api/ai", { headers: { "x-run-hound": "1" } })).json()).toEqual(before);
    },
  );

  it("answers to addresses and names listed in serverHosts (RUNHOUND_SERVER_HOSTS), IPv6 with or without brackets", async () => {
    const custom = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: ["10.89.1.9", "fd00::5", "[fd00::6]", "Hound.LAN"] });
    expect((await custom.request("http://10.89.1.9:4000/")).status).toBe(200);
    expect((await custom.request("http://[fd00::5]:4000/")).status).toBe(200);
    expect((await custom.request("http://[fd00::6]:4000/")).status).toBe(200);
    expect((await custom.request("http://hound.lan:4000/")).status).toBe(200);
    expect((await custom.request("http://10.89.1.10:4000/")).status).toBe(403);
  });

  it("answers to the host of publicUrl (RUNHOUND_PUBLIC_URL) and lists it with the server host names", async () => {
    const custom = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: [], publicUrl: "http://hound.example.test:4000/" });
    expect((await custom.request("http://hound.example.test:4000/")).status).toBe(200);
    expect((await custom.request("http://10.89.1.9:4000/")).status).toBe(403);
    const settings = (await (await custom.request("/api/settings")).json()) as { serverHosts: string[] };
    expect(settings.serverHosts).toEqual(["hound.example.test"]);
  });

  it("reads RUNHOUND_PUBLIC_URL from the environment; the compose default (localhost) adds nothing", async () => {
    const saved = process.env.RUNHOUND_PUBLIC_URL;
    try {
      process.env.RUNHOUND_PUBLIC_URL = "http://192.168.7.7:4400";
      const fromEnv = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: [] });
      expect((await fromEnv.request("http://192.168.7.7:4400/")).status).toBe(200);
      process.env.RUNHOUND_PUBLIC_URL = "http://localhost:4000";
      const compose = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: [] });
      expect((await compose.request("http://localhost:4000/")).status).toBe(200);
      expect((await compose.request("http://127.0.0.1:4000/")).status).toBe(200);
      expect((await compose.request("http://10.89.1.9:4000/")).status).toBe(403);
      expect(((await (await compose.request("/api/settings")).json()) as { serverHosts: string[] }).serverHosts).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.RUNHOUND_PUBLIC_URL;
      else process.env.RUNHOUND_PUBLIC_URL = saved;
    }
  });

  it("answers to the specific address it was bound to, but a wildcard bind adds nothing", async () => {
    const lan = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: [], boundHost: "192.168.1.20" });
    expect((await lan.request("http://192.168.1.20:4000/")).status).toBe(200);
    expect((await lan.request("http://192.168.1.21:4000/")).status).toBe(403);
    for (const wildcard of ["0.0.0.0", "::", "[::]"]) {
      const any = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, serverHosts: [], boundHost: wildcard });
      expect((await any.request("http://10.89.1.9:4000/")).status).toBe(403);
      expect((await any.request("http://localhost:4000/")).status).toBe(200);
    }
  });
});

describe("security headers", () => {
  const lower = (res: Response) => Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));

  it("the UI: a strict CSP (its own inline script and style by hash), no framing, nosniff, a referrer policy", async () => {
    const res = await app.request("/");
    const headers = lower(res);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).toMatch(/img-src 'self' data:/);
    // Run Hound's own security-headers check finds nothing to report.
    expect(headerProblems(headers, false)).toEqual([]);
  });

  it("the CSP hashes match the page's inline script and style", async () => {
    const { createHash } = await import("node:crypto");
    const res = await app.request("/");
    const html = await res.text();
    const csp = res.headers.get("content-security-policy") ?? "";
    const hash = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    expect(styles.length).toBeGreaterThan(0);
    for (const s of scripts) expect(csp).toContain(hash(s));
    for (const s of styles) expect(csp).toContain(hash(s));
  });

  it("report.html: no scripts at all, sandboxed, not framable; API responses are nosniff and not framable", async () => {
    const runId = "20210203-040506-aaa111";
    await writeDiskRun(runId, diskReport(runId, `${site.url}/book`));
    const html = await app.request(`/api/runs/${runId}/report.html`);
    expect(html.status).toBe(200);
    const headers = lower(html);
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/(^|;)\s*sandbox(;|$| )/);
    expect(csp).not.toMatch(/script-src/);
    expect(csp).toMatch(/img-src 'self' data:/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headerProblems(headers, false)).toEqual([]);

    for (const path of ["/api/runs", `/api/runs/${runId}`, `/api/runs/${runId}/report.json`, "/api/nope"]) {
      const res = await app.request(path);
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("content-security-policy") ?? "", path).toMatch(/default-src 'none'.*frame-ancestors 'none'|frame-ancestors 'none'.*default-src 'none'/);
    }
    // Refused requests carry them too.
    const refused = await app.request("http://10.89.1.9:4000/");
    expect(refused.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("re-run of a run read back from disk", () => {
  afterEach(async () => {
    // Let runs started by a test finish before the next one.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("keeps allowDestructive when a destructive scenario really ran (reports without run options)", async () => {
    const runId = "20210203-040506-bbb222";
    await writeDiskRun(runId, diskReport(runId, `${site.url}/book`));
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const res = await fresh.request(`/api/runs/${runId}/rerun`, { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(202);
    const { runId: newId } = (await res.json()) as { runId: string };
    const done = await waitForRun(fresh, newId);
    const replay = done.report!.results.find((r) => r.scenarioId === "cov:replay")!;
    expect(replay.status, replay.notes).toBe("pass");
  });

  it("keeps allowDestructive from report.options, even when the destructive scenario was stopped before it ran", async () => {
    const runId = "20210203-040506-ccc333";
    const results: CheckResult[] = [
      { checkId: "dead-control", scenarioId: "dc:controls", status: "pass", findings: [], durationMs: 5 },
      { checkId: "client-only-validation", scenarioId: "cov:replay", status: "skipped", findings: [], durationMs: 0, notes: "Stopped by you" },
    ];
    await writeDiskRun(runId, diskReport(runId, `${site.url}/book`, { results, extra: { stopped: true, options: { allowDestructive: true, headed: false } } }));
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const res = await fresh.request(`/api/runs/${runId}/rerun`, { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(202);
    const done = await waitForRun(fresh, ((await res.json()) as { runId: string }).runId);
    expect(done.report!.results.find((r) => r.scenarioId === "cov:replay")!.status).toBe("pass");
  });

  it("still skips the destructive scenario when the original run skipped it for lack of the opt-in", async () => {
    const runId = "20210203-040506-ddd444";
    const results: CheckResult[] = [
      { checkId: "dead-control", scenarioId: "dc:controls", status: "pass", findings: [], durationMs: 5 },
      { checkId: "client-only-validation", scenarioId: "cov:replay", status: "skipped", findings: [], durationMs: 0, notes: "Destructive scenario; run again with --allow-destructive to include it." },
    ];
    await writeDiskRun(runId, diskReport(runId, `${site.url}/book`, { results }));
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const res = await fresh.request(`/api/runs/${runId}/rerun`, { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(202);
    const done = await waitForRun(fresh, ((await res.json()) as { runId: string }).runId);
    expect(done.report!.results.find((r) => r.scenarioId === "cov:replay")!.status).toBe("skipped");
  });

  it("refuses to re-plan a target whose secret was redacted on disk, with a plain reason, and opens nothing", async () => {
    const runId = "20210203-040506-eee555";
    const redacted = `${site.url}/book?t=[REDACTED:github-token]`;
    await writeDiskRun(runId, diskReport(runId, redacted));
    const before = site.requests.length;
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const res = await fresh.request(`/api/runs/${runId}/rerun`, { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/secret.*(hidden|redacted).*new run/i);
    expect(site.requests.length).toBe(before);
  });
});

describe("GET /api/runs reads each report from disk once per change", () => {
  it("serves a cached summary while report.json's mtime and size are unchanged, and re-reads it once they change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-server-cache-"));
    try {
      const own = createApp({ checks: fakeChecks, runsDir: dir, canShowBrowser: false });
      const runId = "20210203-040506-fff666";
      const runDir = join(dir, runId);
      await mkdir(runDir);
      const file = join(runDir, "report.json");
      await writeFile(file, JSON.stringify(diskReport(runId, `${site.url}/book`)));
      // A whole-second mtime, so setting it again restores exactly the same value.
      const mtime = new Date("2021-02-03T04:05:16.000Z");
      await utimes(file, mtime, mtime);
      const list = async () => ((await (await own.request("/api/runs")).json()) as { runs: { runId: string; summary?: Report["summary"] }[] }).runs;
      expect((await list()).find((r) => r.runId === runId)!.summary!.passed).toBe(2);

      // Same size, same mtime: served from the cache, so the edit is not seen.
      const text = await readFile(file, "utf8");
      await writeFile(file, text.replace('"passed":2', '"passed":7'));
      await utimes(file, mtime, mtime);
      expect((await list()).find((r) => r.runId === runId)!.summary!.passed).toBe(2);

      // A newer mtime: read again.
      const later = new Date(mtime.getTime() + 5000);
      await utimes(file, later, later);
      expect((await list()).find((r) => r.runId === runId)!.summary!.passed).toBe(7);

      // A deleted run folder leaves the list.
      await rm(runDir, { recursive: true });
      expect((await list()).some((r) => r.runId === runId)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
