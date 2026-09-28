/**
 * The web UI's report view names the other account with what the run used it for (0.6.0 close-out), like the HTML and
 * Markdown reports (engine/report-other-account.test.ts): "can't read" for access-control's other-account scenario,
 * "can't change" for write-access's, "can't read or change" for both, and "change or delete" ("read, change or delete")
 * when write-access's other-account scenario sent the app's DELETE as Account B (its step "Sending DELETE <url> as
 * Account B"). Driven in real Chromium against renderUi's
 * document with every /api/* call answered by a stub.
 */
import { chromium, type Browser, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountRef, Report } from "../core/types.js";
import { renderUi } from "./ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.6.0", canShowBrowser: false });
const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

function scenario(id: string, checkId: string, scope: string) {
  return { id, checkId, title: id, description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: false, scope, ...(scope === "form" ? { formIndex: 0 } : {}) };
}

const SCENARIOS = [
  scenario("access-control:other-account", "access-control", "page"),
  scenario("write-access:other-account@form-2", "write-access", "form"),
  scenario("write-access:signed-out", "write-access", "form"),
];

function report(approved: string[], skipped: string[] = [], steps: Record<string, string[]> = {}): Report {
  const form = {
    url: "http://127.0.0.1:5173/app",
    index: 0,
    selector: "#new-task",
    name: "New task",
    fields: [{ key: "title", accessibleName: "Title", label: "Title", placeholder: null, type: "text", role: "textbox", required: true, selector: "#title" }],
    controls: [{ accessibleName: "Add task", text: "Add task", role: "button", tag: "button", selector: "#add", isSubmit: true }],
  };
  return {
    runId: "r1",
    target: form.url,
    startedAt: "2026-09-28T10:00:00Z",
    finishedAt: "2026-09-28T10:01:00Z",
    durationMs: 60_000,
    groups: [{ id: "security", label: "Security", scenarioIds: approved, passed: approved.length, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 1000 }],
    runHoundVersion: "0.6.0",
    plan: {
      target: form.url,
      form,
      page: { url: form.url, title: "App", forms: [form], controls: [], links: 2 },
      scenarios: SCENARIOS,
      groups: [{ id: "security", label: "Security", scenarioIds: SCENARIOS.map((s) => s.id) }],
      account: A,
    },
    approved,
    results: approved.map((id) => ({
      checkId: SCENARIOS.find((s) => s.id === id)!.checkId,
      scenarioId: id,
      status: skipped.includes(id) ? "skipped" : "pass",
      findings: [],
      durationMs: 1000,
      steps: (steps[id] ?? []).map((label) => ({ label, url: form.url, at: "2026-09-28T10:00:30Z" })),
    })),
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: approved.length, failed: 0, errored: 0, skipped: 0 },
    notVisible: [],
    accounts: { signedInAs: A, other: B },
  } as unknown as Report;
}

async function reportText(r: Report): Promise<{ text: string; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    if (url.pathname === "/api/runs") return json({ runs: [] });
    if (url.pathname === "/api/runs/r1") return json({ status: "done", report: r });
    if (url.pathname === "/api/runs/r1/live") return json({ scenarios: [] });
    if (url.pathname === "/api/ai") return json({ enabled: false, problem: "AI is off" });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/#/runs/r1`);
  await page.locator("#report").waitFor({ timeout: 15_000 });
  await expect.poll(() => page.locator("#report").innerText()).toContain("Signed in as Account A");
  const text = await page.locator(".report-account").innerText();
  await page.close();
  return { text, errors };
}

describe("the report view's other-account line", () => {
  it("says 'read' when only access-control's other-account scenario ran", async () => {
    const o = await reportText(report(["access-control:other-account"]));
    expect(o.text).toContain("used to check that it can't read Account A's data");
    expect(o.text).not.toContain("change");
    expect(o.errors).toEqual([]);
  });

  it("says 'change' when only write-access's other-account scenario ran", async () => {
    const o = await reportText(report(["write-access:other-account@form-2", "write-access:signed-out"]));
    expect(o.text).toContain("used to check that it can't change Account A's data");
    expect(o.errors).toEqual([]);
  });

  it("says 'read or change' when both ran", async () => {
    const o = await reportText(report(["access-control:other-account", "write-access:other-account@form-2"]));
    expect(o.text).toContain("used to check that it can't read or change Account A's data");
    expect(o.errors).toEqual([]);
  });

  it("counts only the other-account scenarios that ran: a skipped write-access one leaves 'read'", async () => {
    const o = await reportText(report(["access-control:other-account", "write-access:other-account@form-2"], ["write-access:other-account@form-2"]));
    expect(o.text).toContain("used to check that it can't read Account A's data");
    expect(o.text).not.toContain("change");
    expect(o.errors).toEqual([]);
  });

  it("falls back to the approved scenarios when every other-account scenario was skipped", async () => {
    const both = ["access-control:other-account", "write-access:other-account@form-2"];
    const o = await reportText(report(both, both));
    expect(o.text).toContain("used to check that it can't read or change Account A's data");
    expect(o.errors).toEqual([]);
  });
});

describe("the report view's other-account line when write-access sent the app's DELETE as Account B", () => {
  const WA = "write-access:other-account@form-2";
  const UPDATE = "Sending PATCH /api/tasks/2 as Account B";
  const DELETE = "Sending DELETE /api/tasks/2 as Account B";

  it("says 'change or delete' when write-access's other-account scenario sent a DELETE as Account B", async () => {
    const o = await reportText(report([WA, "write-access:signed-out"], [], { [WA]: [UPDATE, DELETE] }));
    expect(o.text).toContain("used to check that it can't change or delete Account A's data");
    expect(o.errors).toEqual([]);
  });

  it("says 'read, change or delete' when access-control's ran too", async () => {
    const o = await reportText(report(["access-control:other-account", WA], [], { [WA]: [UPDATE, DELETE] }));
    expect(o.text).toContain("used to check that it can't read, change or delete Account A's data");
    expect(o.errors).toEqual([]);
  });

  it("keeps 'change' when no DELETE was sent as Account B, and never counts a signed-out visitor's DELETE", async () => {
    const o = await reportText(
      report([WA, "write-access:signed-out"], [], { [WA]: [UPDATE], "write-access:signed-out": ["Sending DELETE /api/tasks/2 as a signed-out visitor"] }),
    );
    expect(o.text).toContain("used to check that it can't change Account A's data");
    expect(o.text).not.toContain("delete");
    expect(o.errors).toEqual([]);
  });

  it("never counts a DELETE that a skipped scenario names", async () => {
    const o = await reportText(report(["access-control:other-account", WA], [WA], { [WA]: [DELETE] }));
    expect(o.text).toContain("used to check that it can't read Account A's data");
    expect(o.text).not.toContain("delete");
    expect(o.errors).toEqual([]);
  });
});

describe("Settings → Test accounts, under 'A and B must not see each other's data'", () => {
  it("says the tick gates Account B reading or changing Account A's data (write-access's other-account scenario too)", () => {
    expect(HTML).toContain("Run Hound only checks that Account B can't read or change Account A's data when this is ticked.");
    expect(HTML).not.toContain("can't read Account A's data when this is ticked");
  });
});
