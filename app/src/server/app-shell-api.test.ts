import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Category, Check, CheckId, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { RUN_HOUND_VERSION } from "../engine/runner.js";
import { createApp } from "./app.js";

/**
 * JSON API behind the app shell (docs/app-ui-spec.md): runs list, past runs after a restart, stop, re-run, settings.
 *
 * Contract these tests pin down:
 * - GET /api/runs -> {runs: RunSummary[]}, newest first (by startedAt), in-memory runs and finished runs found on
 *   disk (runsDir/<id>/report.json) merged without duplicates. RunSummary = {runId, target, formName, status,
 *   startedAt, finishedAt?, durationMs?, summary?, completed, total}; finishedAt/durationMs/summary once done.
 * - GET /api/runs/:id serves a run written before a restart: status "done" with its report.
 * - POST /api/runs/:id/stop -> 202 while running (the run ends with report.stopped === true, the scenario in
 *   progress and the rest "skipped" with notes "Stopped by you"); 409 once the run has ended; 404 unknown run.
 * - POST /api/runs/:id/rerun -> 202 {runId}: a new run of the same target approving the same scenario ids; 404 unknown.
 * - GET /api/settings -> {version, runsDir, allowedHosts, serverHosts}.
 * - GET /api/runs/:id/live includes `browser` (string once known, e.g. "Chromium 153.0...", or null).
 * - The Host and Origin guards cover the new endpoints.
 */

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Shell API fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

/** Holds the gated check until the test releases it (a stopped run must end without it being released). */
let gate: { promise: Promise<void>; release: () => void };
function newGate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

function fakeCheck(id: CheckId, category: Category, scenarioId: string, options: { gated?: boolean } = {}): Check {
  return {
    id,
    title: `Fake ${id}`,
    category,
    plan: () => [scenario(id, scenarioId)],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      ctx.step(`Checking ${s.id}`, page);
      if (options.gated) await gate.promise;
      return { checkId: id, scenarioId: s.id, status: "pass", findings: [], durationMs: 5 };
    },
  };
}

// Run order: accessibility (a11y:quick), features (feat:gated), security (sec:after).
const fakeChecks: Check[] = [
  fakeCheck("focus-visible", "accessibility", "a11y:quick"),
  fakeCheck("dead-control", "broken-feature", "feat:gated", { gated: true }),
  fakeCheck("credential-fields", "security", "sec:after"),
];

interface RunSummary {
  runId: string;
  target: string;
  formName: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: Report["summary"];
  completed: number;
  total: number;
}

interface RunStatus {
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  startedAt: string;
  durationMs?: number;
  report?: Report;
  error?: string;
}

let site: FixtureServer;
let runsDir: string;
let app: Hono;

/** A finished run from "before a restart": only its report.json exists. */
const PAST_RUN_ID = "20200101-090000-abc123";

function pastReport(target: string): Report {
  const plan: Plan = {
    target,
    form: { url: target, selector: "#booking", name: "Past booking form", fields: [], controls: [] },
    scenarios: [scenario("focus-visible", "a11y:quick")],
    groups: [{ id: "accessibility", label: "Accessibility", scenarioIds: ["a11y:quick"] }],
  };
  const result: CheckResult = { checkId: "focus-visible", scenarioId: "a11y:quick", status: "pass", findings: [], durationMs: 42 };
  return {
    runId: PAST_RUN_ID,
    target,
    startedAt: "2020-01-01T09:00:00.000Z",
    finishedAt: "2020-01-01T09:00:07.000Z",
    durationMs: 7000,
    groups: [{ id: "accessibility", label: "Accessibility", scenarioIds: ["a11y:quick"], passed: 1, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 42 }],
    runHoundVersion: "0.1.0",
    plan,
    approved: ["a11y:quick"],
    results: [result],
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: 1, failed: 0, errored: 0, skipped: 0 },
    notVisible: [],
    pagesVisited: [{ url: target, scenarioIds: ["a11y:quick"] }],
    browser: "Chromium 999.0.0.1",
  };
}

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-server-shell-"));
  await mkdir(join(runsDir, PAST_RUN_ID), { recursive: true });
  await writeFile(join(runsDir, PAST_RUN_ID, "report.json"), JSON.stringify(pastReport(`${site.url}/old`)));
  app = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false, maxConcurrentRuns: 10 });
});

afterAll(async () => {
  gate?.release();
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

beforeEach(() => {
  gate = newGate();
});

afterEach(() => {
  gate.release();
});

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}, target: Hono = app) {
  return target.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function createPlan(): Promise<string> {
  const res = await post("/api/plan", { url: `${site.url}/book` });
  expect(res.status).toBe(200);
  return ((await res.json()) as { planId: string }).planId;
}

async function startRun(approved: string[]): Promise<string> {
  const res = await post("/api/runs", { planId: await createPlan(), approved });
  expect(res.status).toBe(202);
  return ((await res.json()) as { runId: string }).runId;
}

async function runStatus(runId: string, target: Hono = app): Promise<RunStatus> {
  const res = await target.request(`/api/runs/${runId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as RunStatus;
}

async function live(runId: string, target: Hono = app): Promise<Record<string, unknown>> {
  const res = await target.request(`/api/runs/${runId}/live`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function listRuns(target: Hono = app): Promise<RunSummary[]> {
  const res = await target.request("/api/runs");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  const body = (await res.json()) as { runs: RunSummary[] };
  expect(Array.isArray(body.runs)).toBe(true);
  return body.runs;
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last value: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const waitForDone = (runId: string, target: Hono = app) =>
  until(() => runStatus(runId, target), (s) => s.status !== "running", "the run to finish", 45_000);

const waitForScenario = (runId: string, scenarioId: string) =>
  until(() => live(runId), (l) => l.scenarioId === scenarioId, `scenario ${scenarioId} to start`);

const isIso = (at: unknown) => typeof at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(at) && !Number.isNaN(Date.parse(at));

describe("GET /api/runs", () => {
  it("lists in-memory and on-disk runs newest first with their summaries", async () => {
    const finishedId = await startRun(["a11y:quick"]);
    await waitForDone(finishedId);
    const runningId = await startRun(["feat:gated"]);
    await waitForScenario(runningId, "feat:gated");

    const runs = await listRuns();
    const ids = runs.map((r) => r.runId);
    expect(ids).toContain(PAST_RUN_ID);
    expect(ids).toContain(finishedId);
    expect(ids).toContain(runningId);
    expect(new Set(ids).size).toBe(ids.length);
    // Newest first.
    const started = runs.map((r) => Date.parse(r.startedAt));
    expect(started).toEqual([...started].sort((a, b) => b - a));
    expect(ids.indexOf(runningId)).toBeLessThan(ids.indexOf(finishedId));
    expect(ids.indexOf(finishedId)).toBeLessThan(ids.indexOf(PAST_RUN_ID));

    const past = runs.find((r) => r.runId === PAST_RUN_ID)!;
    expect(past).toMatchObject({
      target: `${site.url}/old`,
      formName: "Past booking form",
      status: "done",
      startedAt: "2020-01-01T09:00:00.000Z",
      finishedAt: "2020-01-01T09:00:07.000Z",
      durationMs: 7000,
      completed: 1,
      total: 1,
    });
    expect(past.summary).toMatchObject({ passed: 1, failed: 0 });

    const finished = runs.find((r) => r.runId === finishedId)!;
    expect(finished.status).toBe("done");
    expect(finished.target).toBe(`${site.url}/book`);
    expect(finished.formName).toBe("Book a sitter");
    expect(isIso(finished.startedAt)).toBe(true);
    expect(isIso(finished.finishedAt)).toBe(true);
    expect(typeof finished.durationMs).toBe("number");
    expect(finished.summary).toMatchObject({ passed: 1 });
    expect(finished).toMatchObject({ completed: 1, total: 1 });

    const running = runs.find((r) => r.runId === runningId)!;
    expect(running.status).toBe("running");
    expect(running.target).toBe(`${site.url}/book`);
    expect(running.formName).toBe("Book a sitter");
    expect(running).toMatchObject({ completed: 0, total: 1 });
    expect(running.finishedAt).toBeUndefined();
    expect(running.summary).toBeUndefined();

    gate.release();
    await waitForDone(runningId);
  });

  it("lists runs from disk after a restart (fresh createApp)", async () => {
    const runId = await startRun(["a11y:quick"]);
    await waitForDone(runId);
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const ids = (await listRuns(fresh)).map((r) => r.runId);
    expect(ids).toContain(PAST_RUN_ID);
    expect(ids).toContain(runId);
    expect(ids.indexOf(runId)).toBeLessThan(ids.indexOf(PAST_RUN_ID));
  });
});

describe("GET /api/runs/:id for a run from before a restart", () => {
  it("serves the on-disk report with status done", async () => {
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    const status = await runStatus(PAST_RUN_ID, fresh);
    expect(status.status).toBe("done");
    expect(status.report?.runId).toBe(PAST_RUN_ID);
    expect(status.report?.target).toBe(`${site.url}/old`);
    expect(status).toMatchObject({ completed: 1, total: 1, durationMs: 7000 });
  });

  it("serves the report's browser in the live state", async () => {
    const fresh = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
    expect((await live(PAST_RUN_ID, fresh)).browser).toBe("Chromium 999.0.0.1");
  });
});

describe("POST /api/runs/:id/stop", () => {
  it("stops a running run: 202, then the report says stopped and the rest is skipped", async () => {
    const runId = await startRun(["a11y:quick", "feat:gated", "sec:after"]);
    await waitForScenario(runId, "feat:gated");

    const res = await post(`/api/runs/${runId}/stop`);
    expect(res.status).toBe(202);

    // The gate is never released: stopping must abandon the scenario in progress.
    const done = await waitForDone(runId);
    expect(done.status).toBe("done");
    expect(done.report?.stopped).toBe(true);
    const byId = new Map((done.report?.results ?? []).map((r) => [r.scenarioId, r]));
    expect(byId.get("a11y:quick")?.status).toBe("pass");
    for (const id of ["feat:gated", "sec:after"]) {
      expect(byId.get(id)?.status).toBe("skipped");
      expect(byId.get(id)?.notes).toMatch(/Stopped by you/);
    }

    const again = await post(`/api/runs/${runId}/stop`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error?: unknown }).error).toEqual(expect.any(String));
  });

  it("refuses a finished run with 409", async () => {
    const runId = await startRun(["a11y:quick"]);
    await waitForDone(runId);
    expect((await post(`/api/runs/${runId}/stop`)).status).toBe(409);
    expect((await post(`/api/runs/${PAST_RUN_ID}/stop`)).status).toBe(409);
  });

  it("returns 404 for an unknown run", async () => {
    const res = await post("/api/runs/20990101-000000-ffffff/stop");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: unknown }).error).toEqual(expect.any(String));
  });
});

describe("POST /api/runs/:id/rerun", () => {
  it("starts a new run of the same target approving the same scenario ids", async () => {
    const firstId = await startRun(["a11y:quick", "sec:after"]);
    const first = await waitForDone(firstId);
    expect(first.status).toBe("done");

    const res = await post(`/api/runs/${firstId}/rerun`);
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    expect(typeof runId).toBe("string");
    expect(runId).not.toBe(firstId);

    const second = await waitForDone(runId);
    expect(second.status).toBe("done");
    expect(second.report?.target).toBe(first.report?.target);
    expect([...(second.report?.approved ?? [])].sort()).toEqual(["a11y:quick", "sec:after"]);
    expect(second.report?.results.map((r) => r.scenarioId).sort()).toEqual(["a11y:quick", "sec:after"]);
    expect((await listRuns()).map((r) => r.runId)).toContain(runId);
  });

  it("returns 404 for an unknown run", async () => {
    expect((await post("/api/runs/20990101-000000-ffffff/rerun")).status).toBe(404);
  });
});

describe("GET /api/runs/:id/live browser", () => {
  it("includes browser: present while running, the Chromium version once known", async () => {
    const runId = await startRun(["feat:gated"]);
    await waitForScenario(runId, "feat:gated");
    const running = await live(runId);
    expect(running).toHaveProperty("browser");
    expect(running.browser === null || typeof running.browser === "string").toBe(true);
    gate.release();
    const done = await waitForDone(runId);
    expect(done.report?.browser).toMatch(/^Chromium \d+/);
    expect((await live(runId)).browser).toBe(done.report?.browser);
  });
});

describe("GET /api/settings", () => {
  it("returns version, runsDir, allowedHosts and serverHosts", async () => {
    const configured = createApp({
      checks: fakeChecks,
      runsDir,
      canShowBrowser: false,
      allowedHosts: ["staging.example.test"],
      serverHosts: ["hound.example.test"],
    });
    const res = await configured.request("/api/settings");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe(RUN_HOUND_VERSION);
    expect(body.runsDir).toBe(resolve(runsDir));
    expect(body.allowedHosts).toEqual(["staging.example.test"]);
    expect(body.serverHosts).toEqual(["hound.example.test"]);
  });
});

describe("Host and Origin guards on the new endpoints", () => {
  it("refuses a cross-site POST to stop and rerun with 403", async () => {
    const runId = await startRun(["feat:gated"]);
    await waitForScenario(runId, "feat:gated");
    const evil = { origin: "https://evil.example" };
    expect((await post(`/api/runs/${runId}/stop`, {}, evil)).status).toBe(403);
    expect((await post(`/api/runs/${runId}/rerun`, {}, evil)).status).toBe(403);
    expect((await runStatus(runId)).status).toBe("running");
    gate.release();
    await waitForDone(runId);
  });

  it("refuses a foreign Host on the list and settings endpoints", async () => {
    expect((await app.request("http://rebind.example/api/runs")).status).toBe(403);
    expect((await app.request("http://rebind.example/api/settings")).status).toBe(403);
    expect((await app.request(`http://rebind.example/api/runs/${PAST_RUN_ID}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  });
});
