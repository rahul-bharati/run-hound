/**
 * Which fields does the app itself refuse when they are empty (LOV-6, RH-08)? Schema-validated forms (react-hook-form +
 * zod) mark nothing in their markup; the page only says so after a submit, with aria-invalid or a message next to the
 * field. probeEmptySubmit submits the form empty with every write answered by Run Hound, so nothing reaches the app.
 *
 * And when a filled submit sends nothing, skip notes say why without blaming the app for what Run Hound didn't do
 * (RH-10): the fields Run Hound couldn't set, and the fields that showed an error.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../test-support/harness.js";
import { json, startFixtureServer } from "../../../test-support/server.js";
import { startSchemaFormApp, type SchemaFormApp } from "../../../test/fixtures/checks/schema-form.js";
import { projectForm, startWidgetApp, type WidgetApp } from "../../../test/fixtures/widgets/widget-app.js";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { createCheckContext } from "../../engine/context.js";
import { discoverForm } from "../../engine/discover.js";
import {
  armFieldErrors,
  canaryValues,
  fieldsShowingErrors,
  fillForm,
  noSaveReason,
  probeEmptySubmit,
  submitForm,
  type FillProblem,
} from "./functional-form.js";

const apps: { close(): Promise<void> }[] = [];
const pages: Page[] = [];
afterAll(async () => {
  await Promise.all(pages.map((p) => p.close().catch(() => undefined)));
  await Promise.all(apps.map((a) => a.close()));
  await closeBrowser();
});

async function schemaApp(options: Parameters<typeof startSchemaFormApp>[0] = {}): Promise<SchemaFormApp> {
  const app = await startSchemaFormApp(options);
  apps.push(app);
  return app;
}

async function discovered(url: string): Promise<DiscoveredForm> {
  const page = await (await getBrowser()).newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const form = await discoverForm(page);
  await page.close();
  return form;
}

async function probe(url: string, form: DiscoveredForm) {
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-probe-"));
  const ctx = createCheckContext({ browser: await getBrowser(), form, targetUrl: url, artifactsDir, runToken: "t3st" });
  try {
    return await probeEmptySubmit(ctx, form);
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

const keys = (fields: FormField[]) => fields.map((f) => f.key);

describe("probeEmptySubmit: the fields the app refuses when empty (LOV-6)", () => {
  it("finds every field a react-hook-form + zod form marks aria-invalid, and nothing reaches the app", async () => {
    const app = await startWidgetApp();
    apps.push(app as WidgetApp);
    const url = `${app.url}/projects`;
    const result = await probe(url, projectForm(url));
    expect(result.sent).toBe(false);
    expect(keys(result.refused)).toEqual(["name", "teamSize", "priority", "owner", "terms"]);
    expect(app.posts("/api/projects")).toEqual([]);
  });

  it("finds fields that only show a message next to them (no aria-invalid), and never an optional one", async () => {
    const app = await schemaApp({ errors: "text" });
    const result = await probe(app.formUrl, await discovered(app.formUrl));
    expect(result.sent).toBe(false);
    expect(keys(result.refused)).toEqual(["title", "email"]);
  });

  it("says the empty form was sent when the page checks nothing, and answers it itself (nothing is saved)", async () => {
    const app = await schemaApp({ validate: false, serverChecks: false });
    const result = await probe(app.formUrl, await discovered(app.formUrl));
    expect(result.sent).toBe(true);
    expect(result.refused).toEqual([]);
    expect(app.posts()).toEqual([]);
    expect(app.tasks).toEqual([]);
  });
});

/** A settings form that loads with the saved values in its fields; the page refuses an empty name or email. */
const PREFILLED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Profile</title><link rel="icon" href="data:,"></head><body><main>
<form id="profile" novalidate><h1>Profile</h1>
<div><label for="name">Display name</label><input id="name" name="displayName" value="Alex Rivera"><p id="name-msg"></p></div>
<div><label for="email">Email</label><input id="email" name="email" type="email" value="alex@example.test"><p id="email-msg"></p></div>
<div><label for="bio">Bio</label><textarea id="bio" name="bio">Designer</textarea></div>
<button type="submit">Save changes</button>
</form>
<script>
document.getElementById("profile").addEventListener("submit", async (e) => {
  e.preventDefault();
  let bad = false;
  for (const [id, text] of [["name", "Enter a display name"], ["email", "Enter your email"]]) {
    const el = document.getElementById(id);
    if (!el.value.trim()) { bad = true; el.setAttribute("aria-invalid", "true"); document.getElementById(id + "-msg").textContent = text; }
  }
  if (!bad) await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
});
</script></main></body></html>`;

describe("probeEmptySubmit on a form that loads with values (a settings form)", () => {
  it("empties the text fields first, so it learns which of them the page refuses empty", async () => {
    const server = await startFixtureServer({ pages: { "/profile": PREFILLED }, routes: { "PUT /api/profile": (_req, res) => json(res, 200, {}) } });
    apps.push(server);
    const url = `${server.url}/profile`;
    const result = await probe(url, await discovered(url));
    expect(result.sent).toBe(false);
    expect(keys(result.refused)).toEqual(["displayName", "email"]);
    expect(server.requests.filter((r) => r.method === "PUT")).toEqual([]);
  });
});

describe("fieldsShowingErrors after a filled submit that sent nothing (RH-10)", () => {
  it("names the field whose rule refused Run Hound's value, and only that one", async () => {
    const app = await schemaApp({ taskMinLength: 80 });
    const form = await discovered(app.formUrl);
    const page = await (await getBrowser()).newPage();
    pages.push(page);
    await page.goto(app.formUrl, { waitUntil: "networkidle" });
    expect(await fillForm(page, canaryValues(form, "t3st", "err"))).toEqual([]);
    await armFieldErrors(page);
    await submitForm(page, form);
    await page.waitForTimeout(300);
    expect(keys(await fieldsShowingErrors(page, form))).toEqual(["title"]);
    expect(app.posts()).toEqual([]);
  });

  it("counts nothing that was already on the page before the submit", async () => {
    const app = await schemaApp({ errors: "text" });
    const form = await discovered(app.formUrl);
    const page = await (await getBrowser()).newPage();
    pages.push(page);
    await page.goto(app.formUrl, { waitUntil: "networkidle" });
    await submitForm(page, form);
    await page.waitForTimeout(300);
    // The messages from the first (empty) submit are there before the second one is armed.
    await armFieldErrors(page);
    expect(keys(await fieldsShowingErrors(page, form))).toEqual([]);
  });
});

describe("noSaveReason: why a submit sent nothing, never blaming the app for what Run Hound didn't do (RH-10)", () => {
  const field = (key: string, name: string): FormField => ({ key, accessibleName: name, label: name, placeholder: null, type: "text", role: "textbox", required: false, selector: `#${key}` });
  const team = field("team", "Team size");
  const task = field("task", "Task");
  const news = field("news", "Newsletter");
  const problem = (f: FormField, why: string): FillProblem => ({ field: f, message: `Couldn't set ${f.accessibleName}: ${why}.` });

  it("names a field Run Hound could not set, and says the form showed an error on it", () => {
    const note = noSaveReason([task], [problem(team, "no options appeared after opening it")], [team]);
    expect(note).toBe("Run Hound could not set Team size (no options appeared after opening it), and the form showed an error on it.");
  });

  it("names a field Run Hound could not set that showed no error", () => {
    expect(noSaveReason([], [problem(team, "no options appeared after opening it")], [])).toBe(
      "Run Hound could not set Team size (no options appeared after opening it); the form may need it.",
    );
  });

  it("names a field whose rule refused Run Hound's value", () => {
    expect(noSaveReason([task], [], [task])).toBe('The form showed an error on "Task" after Run Hound filled it in, so one of its rules refused the test value there.');
  });

  it("names a field Run Hound left empty because nothing marks it as required", () => {
    expect(noSaveReason([task], [], [news])).toBe('The form showed an error on "Newsletter", which Run Hound left empty because nothing marks it as required.');
  });

  it("says plainly when nothing showed an error", () => {
    const note = noSaveReason([task], [], []);
    expect(note).toBe("No field showed an error, so Run Hound can't tell why the form sent nothing.");
  });

  it("never says the page refused Run Hound's test values", () => {
    for (const note of [noSaveReason([], [], []), noSaveReason([task], [problem(team, "x")], [team, task, news])]) {
      expect(note).not.toMatch(/may have refused/);
    }
  });
});
