import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { CheckResult, DiscoveredForm, FlowStep, Scenario } from "../core/types.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./ai-flow.js";
import { explainPrompt } from "../ai/explain.js";

/**
 * ai-flow runs the steps of an AI-suggested scenario (Scenario.flow) against the discovered form and decides each
 * `expect` deterministically. See the JSDoc in ./ai-flow.ts and FlowExpectation in core/types.ts.
 *
 * Interpretations pinned here:
 * - "press" acts on whatever has focus; after a "fill" the filled field has focus, so Enter submits the form.
 *   Enter is only pressed while focus is on a field of the scenario's form; Escape anywhere; Tab and Space never
 *   (they can reach and activate a destructive control) → "skipped". Focus landing on a destructive control after
 *   any step, without allowDestructive, stops the flow → "skipped".
 * - An unknown field key or an out-of-range control index is a step that can't be performed → status "error" with
 *   notes naming the problem, no findings.
 * - A destructive control without allowDestructive → "skipped" before anything is clicked, notes name the control.
 */

interface AppOptions {
  /** Status /api/save answers with. Default 200. */
  status?: number;
  /** Clear every input when the save fails (field-kept must fail). */
  clearOnError?: boolean;
  /** Throw an uncaught error in the submit handler (after the request). */
  throwOnSubmit?: boolean;
  /** pushState to /done?saved=1 after a successful save. */
  navigateOnSuccess?: boolean;
  /** Put the "Delete account" button right after the email field, so one Tab from email reaches it. */
  deleteNextToEmail?: boolean;
  /** Move focus to "Delete account" whenever the email field is typed into. */
  focusDeleteOnInput?: boolean;
}

function formPage(o: AppOptions): string {
  return `<!doctype html><html lang="en"><head><title>Profile</title></head><body>
<main>
<form id="profile" novalidate>
  <h1>Your profile</h1>
  <label for="name">Full name</label><input id="name" name="name" autocomplete="name">
  <label for="email">Email</label><input id="email" name="email" type="email">
  ${o.deleteNextToEmail ? '<button type="button" id="delete">Delete account</button>' : ""}
  <label for="plan">Plan</label>
  <select id="plan" name="plan"><option value="">Choose…</option><option value="basic">Basic</option><option value="pro">Pro</option></select>
  <button type="submit" id="save">Save</button>
  ${o.deleteNextToEmail ? "" : '<button type="button" id="delete">Delete account</button>'}
  <p id="status" role="status"></p>
</form>
</main>
<script>
  var $ = function (id) { return document.getElementById(id); };
  var form = $("profile");
  var statusEl = $("status");
  document.getElementById("delete").addEventListener("click", function () {
    fetch("/api/delete", { method: "POST" }).then(function () { statusEl.textContent = "Account deleted"; });
  });
  ${o.focusDeleteOnInput ? '$("email").addEventListener("input", function () { $("delete").focus(); });' : ""}
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var body = JSON.stringify({ name: $("name").value, email: $("email").value, plan: $("plan").value });
    fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: body }).then(function (res) {
      if (res.ok) {
        statusEl.textContent = "Saved! Plan: " + ($("plan").value || "none");
        ${o.navigateOnSuccess ? 'history.pushState({}, "", "/done?saved=1");' : ""}
      } else {
        statusEl.textContent = "Something went wrong";
        ${o.clearOnError ? '$("name").value = ""; $("email").value = "";' : ""}
      }
      ${o.throwOnSubmit ? 'setTimeout(function () { throw new Error("submit handler exploded"); }, 0);' : ""}
    });
  });
</script>
</body></html>`;
}

const servers: FixtureServer[] = [];

async function app(o: AppOptions = {}): Promise<FixtureServer & { saves: () => number; deletes: () => number }> {
  const s = await startFixtureServer({
    pages: { "/profile": formPage(o) },
    routes: {
      "POST /api/save": (_req, res) => json(res, o.status ?? 200, o.status && o.status >= 400 ? { error: "nope" } : { ok: true }),
      "POST /api/delete": (_req, res) => json(res, 200, { ok: true }),
    },
  });
  servers.push(s);
  return {
    ...s,
    saves: () => s.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/save")).length,
    deletes: () => s.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/delete")).length,
  };
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await closeBrowser();
});

function flowScenario(flow: FlowStep[] | undefined, extra: Partial<Scenario> = {}): Scenario {
  return {
    id: "ai-flow:1",
    checkId: "ai-flow",
    title: "Save a profile with a plan",
    description: "Fills the profile and saves it.",
    kind: "golden",
    priority: "medium",
    destructive: false,
    defaultSelected: false,
    scope: "form",
    formIndex: 0,
    scopeLabel: "Your profile form",
    ai: { rationale: "Saving the profile is the page's main job.", recommended: true, suggested: true },
    ...(flow ? { flow } : {}),
    ...extra,
  };
}

/** Index of the control named `name` in the discovered form. */
function controlIndex(form: DiscoveredForm, name: RegExp): number {
  const i = form.controls.findIndex((c) => name.test(c.accessibleName ?? "") || name.test(c.text));
  if (i < 0) throw new Error(`fixture: no control ${name}`);
  return i;
}

/**
 * Discovers the page, builds the flow with the discovered form (so control indexes are real), runs ai-flow and
 * reports which evidence files existed before the artifacts were removed.
 */
async function runFlow(
  url: string,
  build: (form: DiscoveredForm) => FlowStep[] | undefined,
  options: { allowDestructive?: boolean; extra?: Partial<Scenario> } = {},
): Promise<{ result: CheckResult; form: DiscoveredForm; filesExist: boolean[] }> {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const discovered = await discoverPage(page);
  await page.close();
  const form = discovered.forms[0]!;
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-ai-flow-"));
  const ctx = createCheckContext({
    browser: b,
    form,
    discoveredPage: discovered,
    targetUrl: url,
    artifactsDir,
    allowDestructive: options.allowDestructive ?? false,
    runToken: "t3st",
  });
  try {
    const result = await check.run(ctx, flowScenario(build(form), options.extra));
    const filesExist = result.findings.flatMap((f) => f.evidence.filter((e) => e.path).map((e) => existsSync(join(artifactsDir, e.path!))));
    return { result, form, filesExist };
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

const fillAndSave = (form: DiscoveredForm, expectation: FlowStep): FlowStep[] => [
  { action: "fill", field: "name", value: "Rex Barker" },
  { action: "fill", field: "email", value: "rex@example.com" },
  { action: "click", control: controlIndex(form, /^\s*save\s*$/i) },
  expectation,
];

describe("ai-flow: contract", () => {
  it("has the right id, category and scope", () => {
    expect(check.id).toBe("ai-flow");
    expect(check.category).toBe("broken-feature");
    expect(check.scope ?? "form").toBe("form");
  });

  it("plans nothing itself", () => {
    const form: DiscoveredForm = { url: "http://x/", selector: "form", name: null, fields: [], controls: [] };
    expect(check.plan(form)).toEqual([]);
  });
});

describe("ai-flow: request-ok", () => {
  it("passes when the save reaches the app and gets a 2xx", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "request-ok", text: null }));
    expect(result.checkId).toBe("ai-flow");
    expect(result.scenarioId).toBe("ai-flow:1");
    expect(result.status, result.notes).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes ?? "").not.toBe("");
    expect(s.saves()).toBe(1);
    // Every step was reported for the live view and the reproduction steps.
    expect(result.steps?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("fails with one advisory, medium finding with a GIF, a frame and a spec when the app answers 500", async () => {
    const s = await app({ status: 500 });
    const { result, filesExist } = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "request-ok", text: null }));
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.checkId).toBe("ai-flow");
    expect(f.severity).toBe("medium");
    expect(f.category).toBe("broken-feature");
    expect(f.confidence).toBe("advisory");
    expect(f.title).toBe("AI-suggested flow failed: Save a profile with a plan");
    expect(f.meaning).toMatch(/500|request/i);
    const kinds = f.evidence.map((e) => e.kind);
    expect(kinds).toContain("gif");
    expect(kinds).toContain("frame");
    expect(filesExist.length).toBeGreaterThanOrEqual(2);
    expect(filesExist.every(Boolean)).toBe(true);
    // The facts list each step.
    const facts = f.evidence.flatMap((e) => e.facts ?? []).map((x) => `${x.label}: ${x.value}`).join("\n");
    expect(facts).toMatch(/Rex Barker|Full name|name/i);
    // The spec reproduces the steps.
    expect(f.spec?.filename).toMatch(/\.spec\.ts$/);
    expect(f.spec?.source).toMatch(/@playwright\/test/);
    expect(f.spec?.source).toContain("Rex Barker");
    expect(f.spec?.source).toMatch(/Save/);
  });
});

describe("ai-flow: typed values stay out of the finding text (Rule 4)", () => {
  it("labels typing steps 'Step N (typed)', keeps values out of meaning and fix, and a remote explain prompt carries none", async () => {
    const s = await app({ status: 500 });
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      { action: "fill", field: "name", value: "Zanzibar Quokka" },
      { action: "fill", field: "email", value: "quokka77@private-mail.example" },
      { action: "click", control: controlIndex(f, /^\s*save\s*$/i) },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status).toBe("fail");
    const f = result.findings[0]!;
    const facts = f.evidence.flatMap((e) => e.facts ?? []);
    // The full steps (with values) stay in the report's evidence, recognisably labelled.
    expect(facts.find((x) => x.label === "Step 1 (typed)")?.value).toContain("Zanzibar Quokka");
    expect(facts.find((x) => x.label === "Step 3")?.value).toMatch(/Save/);
    for (const text of [f.meaning, f.fix, f.impact]) {
      expect(text).not.toContain("Zanzibar");
      expect(text).not.toContain("quokka77");
    }
    expect(f.meaning).toMatch(/Full name/);
    const { user } = explainPrompt(f, { remote: true, runToken: "t3st" });
    expect(user).not.toContain("Zanzibar");
    expect(user).not.toContain("quokka77");
  });
});

describe("ai-flow: other expectations", () => {
  it("text-visible passes when the text shows and fails when it does not", async () => {
    const s = await app();
    const ok = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "text-visible", text: "Saved!" }));
    expect(ok.result.status, ok.result.notes).toBe("pass");
    const bad = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "text-visible", text: "Welcome aboard" }));
    expect(bad.result.status).toBe("fail");
    expect(bad.result.findings).toHaveLength(1);
    expect(bad.result.findings[0]!.meaning).toContain("Welcome aboard");
  });

  it("text-absent fails when the text is on the page", async () => {
    const s = await app({ status: 500 });
    const { result } = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "text-absent", text: "Something went wrong" }));
    expect(result.status).toBe("fail");
    expect(result.findings[0]!.confidence).toBe("advisory");
  });

  it("text-absent passes when the text never shows", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "text-absent", text: "Something went wrong" }));
    expect(result.status, result.notes).toBe("pass");
  });

  it("url-changes passes after pushState and fails when the URL stays", async () => {
    const moving = await app({ navigateOnSuccess: true });
    const ok = await runFlow(`${moving.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "url-changes", text: null }));
    expect(ok.result.status, ok.result.notes).toBe("pass");
    const still = await app();
    const bad = await runFlow(`${still.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "url-changes", text: null }));
    expect(bad.result.status).toBe("fail");
  });

  it("no-errors fails when the page throws on submit and passes when it does not", async () => {
    const throwing = await app({ throwOnSubmit: true });
    const bad = await runFlow(`${throwing.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "no-errors", text: null }));
    expect(bad.result.status).toBe("fail");
    expect(bad.result.findings[0]!.meaning).toMatch(/exploded|error/i);
    const clean = await app();
    const ok = await runFlow(`${clean.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "no-errors", text: null }));
    expect(ok.result.status, ok.result.notes).toBe("pass");
  });

  it("field-kept fails when the form clears what was typed after a failed save", async () => {
    const clearing = await app({ status: 500, clearOnError: true });
    const bad = await runFlow(`${clearing.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "field-kept", text: null }));
    expect(bad.result.status).toBe("fail");
    expect(bad.result.findings).toHaveLength(1);
    expect(bad.result.findings[0]!.meaning).toMatch(/Full name|Email|name|email/i);
    const keeping = await app({ status: 500 });
    const ok = await runFlow(`${keeping.url}/profile`, (f) => fillAndSave(f, { action: "expect", expect: "field-kept", text: null }));
    expect(ok.result.status, ok.result.notes).toBe("pass");
  });

  it("the first failing expect ends the flow with one finding", async () => {
    const s = await app({ status: 500 });
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      ...fillAndSave(f, { action: "expect", expect: "request-ok", text: null }),
      { action: "expect", expect: "text-visible", text: "Saved!" },
    ]);
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
  });
});

describe("ai-flow: choose and press", () => {
  it("chooses an option on a select", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      { action: "fill", field: "name", value: "Rex Barker" },
      { action: "choose", field: "plan", option: "Pro" },
      { action: "click", control: controlIndex(f, /^\s*save\s*$/i) },
      { action: "expect", expect: "text-visible", text: "Plan: pro" },
    ]);
    expect(result.status, result.notes).toBe("pass");
    const saved = s.requests.find((r) => r.url.startsWith("/api/save"));
    expect(JSON.parse(saved!.body).plan).toBe("pro");
  });

  it("pressing Enter in a filled field submits the form", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, () => [
      { action: "fill", field: "name", value: "Rex Barker" },
      { action: "press", key: "Enter" },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status, result.notes).toBe("pass");
    expect(s.saves()).toBe(1);
  });
});

describe("ai-flow: the keyboard can't reach a destructive control", () => {
  it("refuses fill email → Tab → Space next to a Delete account button, and nothing is deleted", async () => {
    const s = await app({ deleteNextToEmail: true });
    const { result } = await runFlow(`${s.url}/profile`, () => [
      { action: "fill", field: "email", value: "rex@example.com" },
      { action: "press", key: "Tab" },
      { action: "press", key: "Space" },
      { action: "expect", expect: "text-absent", text: "Account deleted" },
    ]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Tab/);
    expect(result.findings).toEqual([]);
    expect(s.deletes()).toBe(0);
  });

  it("refuses Space on its own", async () => {
    const s = await app({ deleteNextToEmail: true });
    const { result } = await runFlow(`${s.url}/profile`, () => [
      { action: "fill", field: "email", value: "rex@example.com" },
      { action: "press", key: "Space" },
      { action: "expect", expect: "no-errors", text: null },
    ]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Space/);
    expect(s.deletes()).toBe(0);
  });

  it("stops when the page moves focus onto a destructive control, before Enter can activate it", async () => {
    const s = await app({ focusDeleteOnInput: true });
    const { result } = await runFlow(`${s.url}/profile`, () => [
      { action: "fill", field: "email", value: "rex@example.com" },
      { action: "press", key: "Enter" },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Delete account/);
    expect(s.deletes()).toBe(0);
    expect(s.saves()).toBe(0);
  });

  it("does not press Enter when focus is on a button rather than a field", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      { action: "fill", field: "name", value: "Rex Barker" },
      { action: "click", control: controlIndex(f, /^\s*save\s*$/i) },
      { action: "press", key: "Enter" },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Enter/);
    expect(s.saves()).toBe(1);
  });

  it("presses Escape anywhere", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, () => [
      { action: "fill", field: "name", value: "Rex Barker" },
      { action: "press", key: "Escape" },
      { action: "expect", expect: "field-kept", text: null },
    ]);
    expect(result.status, result.notes).toBe("pass");
  });
});

/** A "Delete your account" form: typing the email to confirm and pressing Enter submits it, which deletes the account. */
const DELETE_PAGE = `<!doctype html><html lang="en"><head><title>Account</title></head><body>
<main>
<form id="close" novalidate>
  <h1>Delete your account</h1>
  <label for="confirm">Type your email to confirm</label><input id="confirm" name="confirm" type="email">
  <button type="submit" id="go">Delete account</button>
  <p id="status" role="status"></p>
</form>
</main>
<script>
  document.getElementById("close").addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("/api/delete", { method: "POST" }).then(function () { document.getElementById("status").textContent = "Account deleted"; });
  });
</script>
</body></html>`;

describe("ai-flow: Enter can't submit a destructive form", () => {
  async function deleteApp() {
    const s = await startFixtureServer({ pages: { "/account": DELETE_PAGE }, routes: { "POST /api/delete": (_req, res) => json(res, 200, { ok: true }) } });
    servers.push(s);
    return { ...s, deletes: () => s.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/delete")).length };
  }
  const enterFlow = (): FlowStep[] => [
    { action: "fill", field: "confirm", value: "rex@example.com" },
    { action: "press", key: "Enter" },
    { action: "expect", expect: "text-absent", text: "Account deleted" },
  ];

  it("skips pressing Enter when the form's submit control is destructive, even if the plan did not mark the flow destructive", async () => {
    const s = await deleteApp();
    const { result } = await runFlow(`${s.url}/account`, enterFlow, { extra: { destructive: false } });
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Enter/);
    expect(result.notes).toMatch(/Delete account/);
    expect(result.findings).toEqual([]);
    expect(s.deletes()).toBe(0);
  });

  it("presses Enter there with allowDestructive", async () => {
    const s = await deleteApp();
    const { result } = await runFlow(`${s.url}/account`, enterFlow, { allowDestructive: true, extra: { destructive: true } });
    expect(result.status).toBe("fail");
    expect(s.deletes()).toBe(1);
  });
});

describe("ai-flow: steps that can't run", () => {
  it("an unknown field key is an error", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      { action: "fill", field: "nickname", value: "Rex" },
      { action: "click", control: controlIndex(f, /^\s*save\s*$/i) },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/nickname/);
    expect(s.saves()).toBe(0);
  });

  it("a control index out of range is an error", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, (f) => [
      { action: "fill", field: "name", value: "Rex" },
      { action: "click", control: f.controls.length + 3 },
      { action: "expect", expect: "request-ok", text: null },
    ]);
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes ?? "").not.toBe("");
  });

  it("a destructive control is skipped without allowDestructive, naming it, and nothing is clicked", async () => {
    const s = await app();
    const { result } = await runFlow(
      `${s.url}/profile`,
      (f) => [
        { action: "click", control: controlIndex(f, /delete account/i) },
        { action: "expect", expect: "text-visible", text: "Account deleted" },
      ],
      { extra: { destructive: true } },
    );
    expect(result.status).toBe("skipped");
    expect(result.notes).toMatch(/Delete account/);
    expect(s.deletes()).toBe(0);
  });

  it("the destructive control runs with allowDestructive", async () => {
    const s = await app();
    const { result } = await runFlow(
      `${s.url}/profile`,
      (f) => [
        { action: "click", control: controlIndex(f, /delete account/i) },
        { action: "expect", expect: "text-visible", text: "Account deleted" },
      ],
      { allowDestructive: true, extra: { destructive: true } },
    );
    expect(result.status, result.notes).toBe("pass");
    expect(s.deletes()).toBe(1);
  });

  it("a missing flow is an error", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, () => undefined);
    expect(result.status).toBe("error");
    expect(result.notes ?? "").not.toBe("");
  });

  it("an empty flow is an error", async () => {
    const s = await app();
    const { result } = await runFlow(`${s.url}/profile`, () => []);
    expect(result.status).toBe("error");
  });
});
