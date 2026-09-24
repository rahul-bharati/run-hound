import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

/** A form page that keeps repainting, so the screencast keeps sending frames. */
const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Live server fixture</title>
<style>@keyframes spin { to { transform: rotate(360deg); } } .spinner { width: 40px; height: 40px; background: #F5B642; animation: spin 0.5s linear infinite; }</style>
</head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
<div class="spinner"></div><p>Tick <span id="tick">0</span></p>
<script>let n = 0; setInterval(() => { document.getElementById("tick").textContent = String(++n); }, 40);</script>
</body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

/** Holds the fake check on a live page until the test releases it. */
let gate: { promise: Promise<void>; release: () => void };
function newGate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

const STEP_BURST = 150;

const fakeChecks: Check[] = [
  {
    id: "dead-control",
    title: "Fake live check",
    category: "broken-feature",
    plan: () => [scenario("dead-control", "dc:live")],
    async run(ctx, s) {
      const { page } = await ctx.openPage();
      for (let i = 0; i < STEP_BURST; i++) ctx.step(`Burst step ${i}`, page);
      ctx.step("Waiting for the test", page);
      await gate.promise;
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  },
];

let site: FixtureServer;
let runsDir: string;
let app: Hono;
let uiBrowser: Browser | undefined;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-server-live-"));
  app = createApp({ checks: fakeChecks, runsDir });
});

afterAll(async () => {
  gate?.release();
  await uiBrowser?.close();
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

beforeEach(() => {
  gate = newGate();
});

afterEach(() => {
  gate.release();
  vi.restoreAllMocks();
});

function post(path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function createPlan(): Promise<string> {
  const res = await post("/api/plan", { url: `${site.url}/book` });
  expect(res.status).toBe(200);
  return ((await res.json()) as { planId: string }).planId;
}

async function startRun(body: Record<string, unknown>): Promise<string> {
  const res = await post("/api/runs", body);
  expect(res.status).toBe(202);
  return ((await res.json()) as { runId: string }).runId;
}

interface LiveState {
  status: "running" | "done" | "error";
  scenarioId: string | null;
  scenarioTitle: string | null;
  step: string | null;
  url: string | null;
  frameSeq: number;
  updatedAt: string;
  steps: { scenarioId: string; label: string; url: string; at: string }[];
  pagesVisited: string[];
}

async function live(runId: string): Promise<LiveState> {
  const res = await app.request(`/api/runs/${runId}/live`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  return (await res.json()) as LiveState;
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

async function waitForDone(runId: string): Promise<void> {
  await until(
    async () => ((await (await app.request(`/api/runs/${runId}`)).json()) as { status: string }).status,
    (s) => s !== "running",
    "the run to finish",
    45_000,
  );
}

const isIso = (at: unknown) => typeof at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(at) && !Number.isNaN(Date.parse(at));

describe("GET /api/runs/:id/live", () => {
  it("reports the scenario, step, URL, step log and pages while the run is in progress", async () => {
    const planId = await createPlan();
    const runId = await startRun({ planId, approved: ["dc:live"] });

    // Straight after starting, the shape is already there (no browser yet).
    const first = await live(runId);
    expect(first.status).toBe("running");
    expect(typeof first.frameSeq).toBe("number");
    expect(isIso(first.updatedAt)).toBe(true);
    expect(Array.isArray(first.steps)).toBe(true);
    expect(Array.isArray(first.pagesVisited)).toBe(true);

    const state = await until(() => live(runId), (s) => s.step === "Waiting for the test", "the check to reach its waiting step");
    expect(state.status).toBe("running");
    expect(state.scenarioId).toBe("dc:live");
    expect(state.scenarioTitle).toBe("Fake dc:live");
    expect(state.url).toBe(`${site.url}/book`);
    expect(isIso(state.updatedAt)).toBe(true);
    expect(state.pagesVisited).toContain(`${site.url}/book`);
    expect(new Set(state.pagesVisited).size).toBe(state.pagesVisited.length);

    // The step log keeps the last 100 steps, oldest first.
    expect(state.steps.length).toBe(100);
    const last = state.steps.at(-1)!;
    expect(last).toMatchObject({ scenarioId: "dc:live", label: "Waiting for the test", url: `${site.url}/book` });
    expect(isIso(last.at)).toBe(true);
    expect(state.steps.at(-2)!.label).toBe(`Burst step ${STEP_BURST - 1}`);
    expect(state.steps.map((s) => s.label)).not.toContain("Burst step 0");

    // frameSeq counts frames and only goes up while the page repaints.
    const a = await until(() => live(runId), (s) => s.frameSeq > 0, "a first frame");
    const b = await until(() => live(runId), (s) => s.frameSeq > a.frameSeq, "frameSeq to increase");
    expect(b.frameSeq).toBeGreaterThan(a.frameSeq);
    expect(Date.parse(b.updatedAt)).toBeGreaterThanOrEqual(Date.parse(a.updatedAt));

    gate.release();
    await waitForDone(runId);
    const done = await live(runId);
    expect(done.status).toBe("done");
    expect(done.pagesVisited).toContain(`${site.url}/book`);
  });

  it("returns 404 for an unknown run", async () => {
    expect((await app.request("/api/runs/no-such-run/live")).status).toBe(404);
    expect((await app.request("/api/runs/no-such-run/live.jpg")).status).toBe(404);
  });
});

describe("GET /api/runs/:id/live.jpg", () => {
  it("is 404 before the first frame, then the latest frame as an uncached JPEG", async () => {
    const planId = await createPlan();
    const runId = await startRun({ planId, approved: ["dc:live"] });

    // The browser has not even launched yet.
    const early = await app.request(`/api/runs/${runId}/live.jpg`);
    expect(early.status).toBe(404);

    const res = await until(async () => app.request(`/api/runs/${runId}/live.jpg`), (r) => r.status === 200, "a live frame");
    expect(res.headers.get("content-type")).toMatch(/^image\/jpeg/);
    expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(100);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    gate.release();
    await waitForDone(runId);
  });
});

describe("live endpoints keep the server's Host and Origin rules", () => {
  it("refuses a rebound host name on /live and /live.jpg", async () => {
    const planId = await createPlan();
    const runId = await startRun({ planId, approved: ["dc:live"] });
    expect((await app.request(`http://attacker.example:4000/api/runs/${runId}/live`)).status).toBe(403);
    expect((await app.request(`http://attacker.example:4000/api/runs/${runId}/live.jpg`)).status).toBe(403);
    // The same requests on a loopback host work.
    expect((await app.request(`http://localhost:4000/api/runs/${runId}/live`)).status).toBe(200);
    gate.release();
    await waitForDone(runId);
  });

  it("refuses a cross-site POST that asks for a headed run", async () => {
    const planId = await createPlan();
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://attacker.example" },
      body: JSON.stringify({ planId, headed: true }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/runs headed", () => {
  /** Records launch options but always launches headless, so the test never opens a window. */
  function spyLaunch() {
    const original = chromium.launch.bind(chromium);
    return vi.spyOn(chromium, "launch").mockImplementation((options?: LaunchOptions) => original({ ...options, headless: true }));
  }

  it("passes headed: true to the runner (a visible browser)", async () => {
    const planId = await createPlan();
    const launch = spyLaunch();
    const runId = await startRun({ planId, approved: ["dc:live"], headed: true });
    await until(async () => launch.mock.calls.length, (n) => n > 0, "the runner to launch a browser");
    gate.release();
    await waitForDone(runId);
    expect(launch.mock.calls.some(([opts]) => opts?.headless === false)).toBe(true);
  });

  it("stays headless without headed", async () => {
    const planId = await createPlan();
    const launch = spyLaunch();
    const runId = await startRun({ planId, approved: ["dc:live"] });
    await until(async () => launch.mock.calls.length, (n) => n > 0, "the runner to launch a browser");
    gate.release();
    await waitForDone(runId);
    for (const [opts] of launch.mock.calls) expect(opts?.headless).not.toBe(false);
  });
});

describe("UI live panel", () => {
  it("serves an accessible live panel and a 'Show the browser window' option", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    // The UI polls the live endpoints and can ask for a headed run.
    expect(html).toContain("/live.jpg");
    expect(html).toMatch(/\/live\b/);
    expect(html).toContain("headed");

    uiBrowser ??= await chromium.launch();
    const page = await uiBrowser.newPage();
    try {
      // Block the UI's own API calls; only the markup matters here.
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html);

      const panel = page.locator("#live");
      expect(await panel.count()).toBe(1);
      // URL of the page being tested.
      expect(await panel.locator("#live-url").count()).toBe(1);
      // Latest frame, with alt text.
      const img = panel.locator("img");
      expect(await img.count()).toBeGreaterThanOrEqual(1);
      expect(((await img.first().getAttribute("alt")) ?? "").trim().length).toBeGreaterThan(0);
      // Current step, announced politely.
      expect(await panel.locator('[role="status"]').count()).toBeGreaterThanOrEqual(1);
      // Step log and pages tested.
      expect(await panel.locator("ol").count()).toBeGreaterThanOrEqual(1);
      expect(await panel.locator("ul").count()).toBeGreaterThanOrEqual(1);
      expect(await panel.textContent()).toMatch(/pages tested/i);

      // "Show the browser window" is a labelled checkbox.
      const headed = page.getByLabel("Show the browser window");
      expect(await headed.count()).toBe(1);
      expect(await headed.getAttribute("type")).toBe("checkbox");
    } finally {
      await page.close();
    }
  });
});

describe("UI report evidence", () => {
  /** A check that finds one problem and backs it with an annotated frame, like the real checks do. */
  const evidenceChecks: Check[] = [
    {
      id: "persistence",
      title: "Fake evidence check",
      category: "broken-feature",
      plan: () => [scenario("persistence", "p:evidence")],
      async run(ctx, s) {
        const { page } = await ctx.openPage();
        const frame = await ctx.capture(page, "Pet name after reload", {
          step: "After reload",
          highlights: [{ selector: "#petName", label: "Not found after reload" }],
          facts: [{ label: "Canary", value: "t3st-canary" }],
        });
        return {
          checkId: "persistence",
          scenarioId: s.id,
          status: "fail",
          durationMs: 1,
          findings: [
            {
              checkId: "persistence",
              id: "persistence#1",
              title: "Pet name is not saved",
              severity: "high",
              category: "broken-feature",
              confidence: "confirmed",
              meaning: "m",
              impact: "i",
              fix: "f",
              evidence: [frame],
            },
          ],
        };
      },
    },
  ];

  it("shows each finding's frame inline, linked to the file, with step, page, time and its facts", async () => {
    const evidenceApp = createApp({ checks: evidenceChecks, runsDir });
    const planRes = await evidenceApp.request("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${site.url}/book` }) });
    const { planId } = (await planRes.json()) as { planId: string };
    const runRes = await evidenceApp.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId, approved: ["p:evidence"] }) });
    expect(runRes.status).toBe(202);
    const { runId } = (await runRes.json()) as { runId: string };
    await until(
      async () => ((await (await evidenceApp.request(`/api/runs/${runId}`)).json()) as { status: string }).status,
      (st) => st !== "running",
      "the run to finish",
      45_000,
    );

    uiBrowser ??= await chromium.launch();
    const page = await uiBrowser.newPage();
    try {
      // The page talks to the app through this proxy, so no port is opened.
      await page.route("http://127.0.0.1:9/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const res = await evidenceApp.request(url.pathname + url.search, { method: request.method(), headers: { "content-type": "application/json" }, body: request.postData() ?? undefined });
        await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
      });
      await page.goto(`http://127.0.0.1:9/#run=${runId}`);
      await page.locator("#report-section").waitFor({ state: "visible", timeout: 30_000 });
      const figure = page.locator("#report .evidence figure").first();
      await figure.waitFor();
      const img = figure.locator("img");
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      expect(await img.getAttribute("alt")).toMatch(/Pet name after reload/);
      expect(await figure.locator("a").getAttribute("href")).toMatch(new RegExp(`/api/runs/${runId}/artifacts/\\d{3}-pet-name-after-reload\\.png$`));
      const caption = (await figure.locator("figcaption").textContent()) ?? "";
      expect(caption).toContain("Step: After reload");
      expect(caption).toContain(`Page: ${site.url}/book`);
      expect(caption).toMatch(/Captured: \d{4}-\d{2}-\d{2}T/);
      await figure.locator("summary").click();
      expect(await figure.locator("dl").textContent()).toContain("t3st-canary");
    } finally {
      await page.close();
    }
  });
});
