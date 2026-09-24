import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Category, Check, CheckId, CheckResult, Plan, Report, Scenario } from "../core/types.js";
import { createApp } from "./app.js";

/**
 * Groups and timing in the server and web UI (docs/v0-spec.md, "Groups and timing").
 *
 * Contract these tests pin down beyond core/types.ts:
 * - GET /api/runs/:id: `startedAt` (ISO) from the moment the run is accepted; when done, `durationMs` (number) and
 *   `report.groups`.
 * - GET /api/runs/:id/live: `startedAt` (ISO), `elapsedMs` (number, grows while running) and `group` (the current
 *   CheckGroup id, or null before the first scenario).
 * - UI plan: inside #scenarios, one heading per non-empty group ("Accessibility", "Features", "Security", in that
 *   order) whose accessible name includes the group's scenario count, and one labelled "select all" checkbox per
 *   group whose accessible name contains "select all" and the group label; indeterminate when partly selected.
 * - UI run: #live-elapsed shows the elapsed time, updated at least every second, and is not a live region (nor
 *   inside one). When done, the page says "Finished in <duration>" and #report has a per-group <table>.
 */

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Groups fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

/** Holds the Features check until the test releases it. */
let gate: { promise: Promise<void>; release: () => void };
function newGate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

function fakeCheck(
  id: CheckId,
  category: Category,
  scenarioId: string,
  status: CheckResult["status"],
  durationMs: number,
  options: { gated?: boolean; finding?: boolean } = {},
): Check {
  return {
    id,
    title: `Fake ${id}`,
    category,
    plan: () => [scenario(id, scenarioId)],
    async run(_ctx, s) {
      if (options.gated) await gate.promise;
      return {
        checkId: id,
        scenarioId: s.id,
        status,
        durationMs,
        findings: options.finding
          ? [
              {
                checkId: id,
                id: `${id}#1`,
                title: "No visible focus",
                severity: "medium",
                category,
                confidence: "confirmed",
                meaning: "m",
                impact: "i",
                fix: "f",
                evidence: [],
              },
            ]
          : [],
      };
    },
  };
}

// Deliberately not in run order: the plan must reorder them group by group, CHECK_IDS order inside a group.
const fakeChecks: Check[] = [
  fakeCheck("credential-fields", "security", "sec:cred", "pass", 11),
  fakeCheck("dead-control", "broken-feature", "feat:dead", "pass", 13, { gated: true }),
  fakeCheck("focus-visible", "accessibility", "a11y:focus", "fail", 17, { finding: true }),
  fakeCheck("client-only-validation", "validation", "feat:valid", "skipped", 19),
  fakeCheck("axe-states", "accessibility", "a11y:axe", "pass", 23),
];

const RUN_ORDER = ["a11y:axe", "a11y:focus", "feat:dead", "feat:valid", "sec:cred"];
const GROUPS = [
  { id: "accessibility", label: "Accessibility", scenarioIds: ["a11y:axe", "a11y:focus"] },
  { id: "features", label: "Features", scenarioIds: ["feat:dead", "feat:valid"] },
  { id: "security", label: "Security", scenarioIds: ["sec:cred"] },
] as const;

let site: FixtureServer;
let runsDir: string;
let app: Hono;
let uiBrowser: Browser | undefined;
let server: ServerType | undefined;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
  runsDir = await mkdtemp(join(tmpdir(), "rh-server-groups-"));
  app = createApp({ checks: fakeChecks, runsDir, canShowBrowser: false });
});

afterAll(async () => {
  gate?.release();
  await uiBrowser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

beforeEach(() => {
  gate = newGate();
});

afterEach(() => {
  gate.release();
});

function post(path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function createPlan(): Promise<{ planId: string; plan: Plan }> {
  const res = await post("/api/plan", { url: `${site.url}/book` });
  expect(res.status).toBe(200);
  return (await res.json()) as { planId: string; plan: Plan };
}

async function startRun(body: Record<string, unknown>): Promise<string> {
  const res = await post("/api/runs", body);
  expect(res.status).toBe(202);
  return ((await res.json()) as { runId: string }).runId;
}

interface RunStatus {
  status: "running" | "done" | "error";
  startedAt?: string;
  durationMs?: number;
  report?: Report;
  error?: string;
}

interface LiveGroupState {
  status: "running" | "done" | "error";
  scenarioId: string | null;
  startedAt?: string;
  elapsedMs?: number;
  group?: string | null;
}

async function runStatus(runId: string): Promise<RunStatus> {
  const res = await app.request(`/api/runs/${runId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as RunStatus;
}

async function live(runId: string): Promise<LiveGroupState> {
  const res = await app.request(`/api/runs/${runId}/live`);
  expect(res.status).toBe(200);
  return (await res.json()) as LiveGroupState;
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

const waitForDone = (runId: string) => until(() => runStatus(runId), (s) => s.status !== "running", "the run to finish", 45_000);

const isIso = (at: unknown) => typeof at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(at) && !Number.isNaN(Date.parse(at));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("POST /api/plan groups", () => {
  it("returns the scenarios in run order and plan.groups in CHECK_GROUPS order", async () => {
    const { plan } = await createPlan();
    expect(plan.scenarios.map((s) => s.id)).toEqual(RUN_ORDER);
    expect(plan.groups).toEqual(GROUPS.map((g) => ({ ...g, scenarioIds: [...g.scenarioIds] })));
  });
});

describe("run timing and groups in the API", () => {
  it("reports startedAt, a growing elapsedMs and the current group while running, then durationMs and report.groups", async () => {
    const { planId } = await createPlan();
    const before = Date.now();
    const runId = await startRun({ planId, approved: RUN_ORDER });

    const running = await runStatus(runId);
    expect(running.status).toBe("running");
    expect(isIso(running.startedAt)).toBe(true);
    expect(Date.parse(running.startedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(running.startedAt!)).toBeLessThanOrEqual(Date.now() + 1000);

    // The Features check holds the run; the live state says which group is running.
    const a = await until(() => live(runId), (s) => s.scenarioId === "feat:dead", "the Features scenario to start");
    expect(a.status).toBe("running");
    expect(a.group).toBe("features");
    expect(isIso(a.startedAt)).toBe(true);
    expect(a.startedAt).toBe(running.startedAt);
    expect(typeof a.elapsedMs).toBe("number");
    expect(a.elapsedMs!).toBeGreaterThanOrEqual(0);

    await sleep(400);
    const b = await live(runId);
    expect(typeof b.elapsedMs).toBe("number");
    expect(b.elapsedMs!).toBeGreaterThan(a.elapsedMs!);
    expect(b.elapsedMs! - a.elapsedMs!).toBeGreaterThanOrEqual(200);

    const heldFor = Date.now() - before;
    gate.release();
    const done = await waitForDone(runId);
    expect(done.status).toBe("done");
    expect(done.startedAt).toBe(running.startedAt);
    expect(typeof done.durationMs).toBe("number");
    expect(done.durationMs!).toBeGreaterThanOrEqual(heldFor - 1000);
    expect(done.durationMs!).toBeGreaterThanOrEqual(400);

    const report = done.report!;
    expect(report.durationMs).toBe(Date.parse(report.finishedAt) - Date.parse(report.startedAt));
    expect(report.groups.map((g) => g.id)).toEqual(["accessibility", "features", "security"]);
    expect(report.groups.map((g) => g.label)).toEqual(["Accessibility", "Features", "Security"]);
    expect(report.groups.map((g) => g.scenarioIds)).toEqual(GROUPS.map((g) => [...g.scenarioIds]));
    const counts = report.groups.map(({ passed, failed, errored, skipped, findings }) => ({ passed, failed, errored, skipped, findings }));
    expect(counts).toEqual([
      { passed: 1, failed: 1, errored: 0, skipped: 0, findings: 1 },
      { passed: 1, failed: 0, errored: 0, skipped: 1, findings: 0 },
      { passed: 1, failed: 0, errored: 0, skipped: 0, findings: 0 },
    ]);
    for (const g of report.groups) {
      const sum = report.results.filter((r) => g.scenarioIds.includes(r.scenarioId)).reduce((t, r) => t + r.durationMs, 0);
      expect(g.durationMs, `${g.id} duration`).toBe(sum);
    }

    const after = await live(runId);
    expect(after.status).toBe("done");
    expect(after.startedAt).toBe(running.startedAt);
  });

  it("leaves groups with no approved scenario out of report.groups", async () => {
    const { planId } = await createPlan();
    const runId = await startRun({ planId, approved: ["a11y:axe", "sec:cred"] });
    const done = await waitForDone(runId);
    expect(done.status).toBe("done");
    expect(done.report!.groups.map((g) => g.id)).toEqual(["accessibility", "security"]);
    expect(done.report!.groups[0]!.scenarioIds).toEqual(["a11y:axe"]);
  });
});

describe("UI groups and timing (served on a random port)", () => {
  let base: string;

  async function openUi(): Promise<Page> {
    if (!server) {
      const port = await new Promise<number>((resolve) => {
        server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
      });
      base = `http://127.0.0.1:${port}`;
    }
    uiBrowser ??= await chromium.launch();
    const page = await uiBrowser.newPage();
    await page.goto(`${base}/`);
    return page;
  }

  async function planInUi(page: Page): Promise<void> {
    await page.locator("#target-url").fill(`${site.url}/book`);
    await page.locator("#plan-button").click();
    await page.locator("#plan-section").waitFor({ state: "visible", timeout: 30_000 });
  }

  const scenarioBox = (page: Page, id: string) => page.locator(`#scenarios input[type="checkbox"][value="${id}"]`);
  const groupBox = (page: Page, label: string) =>
    page.locator("#scenarios").getByRole("checkbox", { name: new RegExp(`select all.*\\b${label}\\b|\\b${label}\\b.*select all`, "i") });

  /** Whether `a` comes before `b` in the document. */
  async function before(page: Page, a: string, b: string): Promise<boolean> {
    return page.evaluate(
      ([sa, sb]) => {
        const x = document.querySelector(sa!)!;
        const y = document.querySelector(sb!)!;
        return Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
      },
      [a, b],
    );
  }

  it("shows the plan under group headings with counts and a labelled, tri-state select-all checkbox per group", async () => {
    const page = await openUi();
    try {
      await planInUi(page);
      const box = page.locator("#scenarios");

      // One heading per group, in order, each naming its scenario count.
      const headings = box.getByRole("heading", { name: /^(Accessibility|Features|Security)\b/ });
      expect(await headings.count()).toBe(3);
      const names = await headings.allTextContents();
      expect(names[0]).toMatch(/^\s*Accessibility\b.*\b2\b/s);
      expect(names[1]).toMatch(/^\s*Features\b.*\b2\b/s);
      expect(names[2]).toMatch(/^\s*Security\b.*\b1\b/s);

      // Each scenario sits under its group's heading.
      await headings.nth(0).evaluate((h) => h.setAttribute("data-test-h", "0"));
      await headings.nth(1).evaluate((h) => h.setAttribute("data-test-h", "1"));
      await headings.nth(2).evaluate((h) => h.setAttribute("data-test-h", "2"));
      const at = (id: string) => `#scenarios input[value="${id}"]`;
      expect(await before(page, '[data-test-h="0"]', at("a11y:axe"))).toBe(true);
      expect(await before(page, at("a11y:focus"), '[data-test-h="1"]')).toBe(true);
      expect(await before(page, '[data-test-h="1"]', at("feat:dead"))).toBe(true);
      expect(await before(page, at("feat:valid"), '[data-test-h="2"]')).toBe(true);
      expect(await before(page, '[data-test-h="2"]', at("sec:cred"))).toBe(true);

      // A real, labelled checkbox per group.
      for (const g of GROUPS) {
        const all = groupBox(page, g.label);
        expect(await all.count(), `select all for ${g.label}`).toBe(1);
        expect(await all.getAttribute("type")).toBe("checkbox");
        expect(await all.isChecked()).toBe(true);
        expect(await all.evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(false);
      }
      // The select-all boxes are not scenarios: they don't carry scenario ids.
      const values = await box.locator('input[type="checkbox"]:checked').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      expect(values.filter((v) => RUN_ORDER.includes(v)).sort()).toEqual([...RUN_ORDER].sort());

      // Toggling it unchecks and rechecks the group's scenarios, and only those.
      const a11y = groupBox(page, "Accessibility");
      await a11y.click();
      expect(await scenarioBox(page, "a11y:axe").isChecked()).toBe(false);
      expect(await scenarioBox(page, "a11y:focus").isChecked()).toBe(false);
      expect(await scenarioBox(page, "feat:dead").isChecked()).toBe(true);
      expect(await scenarioBox(page, "sec:cred").isChecked()).toBe(true);
      expect(await a11y.isChecked()).toBe(false);
      await a11y.click();
      expect(await scenarioBox(page, "a11y:axe").isChecked()).toBe(true);
      expect(await scenarioBox(page, "a11y:focus").isChecked()).toBe(true);
      expect(await a11y.isChecked()).toBe(true);

      // Partly selected: indeterminate. Selecting the rest clears it.
      const features = groupBox(page, "Features");
      await scenarioBox(page, "feat:valid").click();
      expect(await features.evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(true);
      await scenarioBox(page, "feat:valid").click();
      expect(await features.evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(false);
      expect(await features.isChecked()).toBe(true);

      // All unchecked one by one: unchecked, not indeterminate.
      await scenarioBox(page, "feat:dead").click();
      await scenarioBox(page, "feat:valid").click();
      expect(await features.evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(false);
      expect(await features.isChecked()).toBe(false);
      // From indeterminate, the group box selects the whole group.
      await scenarioBox(page, "feat:dead").click();
      expect(await features.evaluate((i: HTMLInputElement) => i.indeterminate)).toBe(true);
      await features.click();
      expect(await scenarioBox(page, "feat:dead").isChecked()).toBe(true);
      expect(await scenarioBox(page, "feat:valid").isChecked()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it("ticks a silent elapsed-time counter while running, then shows the run's duration and a per-group table", async () => {
    const page = await openUi();
    try {
      await planInUi(page);
      await page.locator("#run-button").click();

      const elapsed = page.locator("#elapsed");
      await elapsed.waitFor({ state: "visible", timeout: 30_000 });
      // Not announced every tick: not a live region, nor inside one.
      const liveInfo = await elapsed.evaluate((e) => ({
        ariaLive: e.getAttribute("aria-live"),
        role: e.getAttribute("role"),
        inLiveRegion: Boolean(
          e.parentElement?.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'),
        ),
      }));
      expect([null, "off"]).toContain(liveInfo.ariaLive);
      expect(["status", "alert", "log"]).not.toContain(liveInfo.role);
      expect(liveInfo.inLiveRegion).toBe(false);

      // The run is held in the Features group; the counter keeps moving.
      await until(async () => (await live(await currentRunId(page))).scenarioId, (id) => id === "feat:dead", "the Features scenario to start");
      const first = ((await elapsed.textContent()) ?? "").trim();
      expect(first).toMatch(/\d/);
      await page.waitForTimeout(2200);
      const second = ((await elapsed.textContent()) ?? "").trim();
      expect(second).toMatch(/\d/);
      expect(second).not.toBe(first);

      gate.release();
      await page.locator("#report").waitFor({ state: "visible", timeout: 45_000 });
      // The summary line under the title ends with how long the whole run took.
      const summary = await page.locator("#report .summary").innerText();
      expect(summary).toMatch(/\b\d+ scenarios? run\b/);
      expect(summary).toMatch(/\d+(\.\d)? s\b|\bmin\b/);

      const table = page.locator("#report table").filter({ hasText: "Accessibility" });
      expect(await table.count()).toBe(1);
      expect(await table.locator("th").count()).toBeGreaterThan(0);
      const rows = table.locator("tr").filter({ hasText: /^\s*(Accessibility|Features|Security)\b/ });
      expect(await rows.count()).toBe(3);
      const rowText = await rows.allInnerTexts();
      expect(rowText[0]).toMatch(/^\s*Accessibility/);
      expect(rowText[1]).toMatch(/^\s*Features/);
      expect(rowText[2]).toMatch(/^\s*Security/);
      // Each row shows a duration ("0.0 s", "42 s", "1 min 12 s").
      for (const t of rowText) expect(t).toMatch(/\d+(\.\d)? s\b|\bmin\b|\bh\b/);
    } finally {
      await page.close();
    }
  }, 120_000);

  async function currentRunId(page: Page): Promise<string> {
    const hash = await until(async () => page.evaluate(() => location.hash), (h) => /^#\/runs\/[\w-]+$/.test(h), "the run id in the address");
    return decodeURIComponent(hash.slice("#/runs/".length));
  }
});
