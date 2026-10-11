/**
 * Testing briefs on the New run page (A2, docs/agent-spec.md "Briefs"), driven in real Chromium against createApp
 * served on a random port, with a fake model behind it (the saved AI settings point at tests/support/fake-llm.ts).
 *
 * Structure pinned here (the spec names the pieces; the labels are this file's reading of it):
 * - Without the agent (createApp({ agent: false })): no "Describe what to test" card, no brief editor, and the page
 *   never sends a request to /api/briefs. With it: a card (role region named "Describe what to test", with a Preview
 *   badge) holding a goal textarea, a ticket textarea, a feature input and a "Draft a brief" button; it uses the Page
 *   URL field and the "Sign in as" choice already on the page.
 * - Drafting: a polite status line while the model works; errors in a role=alert line (a 409 points to Settings);
 *   focus lands on the "Testing brief" heading.
 * - The editor (#brief-editor): warnings, then open questions (option buttons, or a text input; "Answer" and "Skip"),
 *   then the goal, start page, areas to stay in, expectations (tag "You said" for source supplied, "Assumed" for
 *   inferred, both as the server sent them), account, test data, permissions, and "Save changes" and "Approve brief".
 * - Approval shows "Approved", the time and the first 12 characters of the hash; an edit after it clears it.
 * - No console error and no CSP violation, at 1280 px and at 375 px (no horizontal scroll).
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { saveAiConfig } from "../../../src/ai/config.js";
import type { BriefDraft } from "../../../src/interfaces/agent.js";
import { createApp } from "../../../src/server/app.js";
import type { ServerOptions } from "../../../src/interfaces/server.js";


const norm = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();

/** What a person would see of a locator, polled until it holds (the page answers after a fetch, so nothing is instant). */
function look(loc: Locator) {
  return {
    toBeVisible: () => expect.poll(() => loc.isVisible()).toBe(true),
    toBeHidden: () => expect.poll(() => loc.isVisible()).toBe(false),
    toBeEnabled: () => expect.poll(() => loc.isEnabled()).toBe(true),
    toBeDisabled: () => expect.poll(() => loc.isDisabled()).toBe(true),
    toBeChecked: () => expect.poll(() => loc.isChecked()).toBe(true),
    toBeUnchecked: () => expect.poll(() => loc.isChecked()).toBe(false),
    toBeFocused: () => expect.poll(() => loc.evaluate((el) => el === document.activeElement)).toBe(true),
    toBeEmpty: () => expect.poll(async () => norm(await loc.textContent())).toBe(""),
    toHaveCount: (n: number) => expect.poll(() => loc.count()).toBe(n),
    toHaveText: (t: string | RegExp) => (t instanceof RegExp ? expect.poll(async () => norm(await loc.textContent())).toMatch(t) : expect.poll(async () => norm(await loc.textContent())).toBe(t)),
    toHaveTexts: (list: string[]) => expect.poll(async () => (await loc.allTextContents()).map(norm)).toEqual(list),
    toContainText: (t: string) => expect.poll(async () => norm(await loc.textContent())).toContain(t),
    toHaveValue: (v: string) => expect.poll(() => loc.inputValue()).toBe(v),
    toHaveAttribute: (name: string, value: string) => expect.poll(() => loc.getAttribute(name)).toBe(value),
  };
}

const TARGET = "http://127.0.0.1:5173/app";
const GOAL = "A signed-in user can add a task, and it is still there after reloading.";
const TICKET = ["Acceptance criteria:", "- A new task shows up in the list", "- The task is still there after a reload"].join("\n");
const MODEL_EXPECTATION = "A task that is added appears once in the list";

/** What the fake model answers for a brief: the shape of BRIEF_DRAFT_SCHEMA. */
interface ModelAnswer {
  expectations: string[];
  scopePaths: string[];
  testData: { name: string; value: string }[];
  questions: { kind: string; text: string; options: string[]; dataName: string | null }[];
}
const answer = (extra: Partial<ModelAnswer> = {}): ModelAnswer => ({
  expectations: [MODEL_EXPECTATION],
  scopePaths: ["/tasks"],
  testData: [{ name: "task title", value: "Buy milk" }],
  questions: [],
  ...extra,
});
const ACCOUNT_Q = { kind: "account", text: "Which account should the agent use?", options: ["a", "b", "signed-out"], dataName: null };
const PERMISSION_Q = { kind: "permission", text: "May the agent change tasks that already exist?", options: ["yes", "no"], dataName: null };
const EXPECTATION_Q = { kind: "expectation", text: "What should happen when a task has no title?", options: [] as string[], dataName: null };

let fake: FakeLlm;
let browser: Browser;
let configDir: string;
let savedConfigDir: string | undefined;
let servers: ServerType[] = [];

beforeAll(async () => {
  fake = await startFakeLlm({ models: [{ id: "fake-model:9b", parameterSize: "9.0B", quantization: "Q4_K_M", capabilities: ["completion"] }] });
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await fake?.close();
});

beforeEach(async () => {
  savedConfigDir = process.env.RUNHOUND_CONFIG_DIR;
  configDir = await mkdtemp(join(tmpdir(), "rh-brief-config-"));
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  fake.calls.length = 0;
  fake.reply(answer());
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  if (savedConfigDir === undefined) delete process.env.RUNHOUND_CONFIG_DIR;
  else process.env.RUNHOUND_CONFIG_DIR = savedConfigDir;
  for (const key of Object.keys(process.env)) if (key.startsWith("RUNHOUND_ACCOUNT")) delete process.env[key];
  await rm(configDir, { recursive: true, force: true });
});

/** Serves createApp on a random port; the fake model is the saved AI setting unless `ai` is false. */
async function start(options: ServerOptions, ai = true): Promise<string> {
  if (ai) await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "fake-model:9b" });
  const app = createApp({ canShowBrowser: false, ...options });
  const port = await new Promise<number>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
    servers.push(server);
  });
  return `http://127.0.0.1:${port}`;
}

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  status?: number;
  json?: unknown;
}
interface Watched {
  page: Page;
  base: string;
  calls: Call[];
  violations: string[];
  errors: string[];
}

/** A page that records every /api/briefs call (with its answer) and every console error and CSP violation. */
async function watched(base: string, width = 1280): Promise<Watched> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const calls: Call[] = [];
  const violations: string[] = [];
  const errors: string[] = [];
  await page.exposeFunction("__cspViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolation(v: string): void }).__cspViolation(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`);
    });
  });
  page.on("console", (m) => {
    // The 4xx answers this file provokes on purpose are logged by Chromium as failed resource loads; they are not page errors.
    if (m.type() === "error" && !/Failed to load resource: the server responded with a status of (400|404|409)/.test(m.text())) errors.push(m.text());
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const byRequest = new Map<unknown, Call>();
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/briefs")) return;
    const call: Call = { method: req.method(), path, headers: req.headers(), body: req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null };
    byRequest.set(req, call);
    calls.push(call);
  });
  page.on("response", async (res) => {
    const call = byRequest.get(res.request());
    if (!call) return;
    call.status = res.status();
    call.json = await res.json().catch(() => undefined);
  });
  await page.goto(`${base}/#/new`);
  await page.getByRole("heading", { name: "New run" }).waitFor();
  return { page, base, calls, violations, errors };
}

const expectClean = (w: Watched) => {
  expect(w.violations).toEqual([]);
  expect(w.errors).toEqual([]);
};

/** Fills the page's URL and the describe form, then asks for the draft. */
async function draft(w: Watched, fields: { goal?: string; ticket?: string; feature?: string; url?: string } = {}) {
  const { page } = w;
  await page.getByLabel("Page URL").fill(fields.url ?? TARGET);
  await page.getByLabel("What do you want to test?").fill(fields.goal ?? GOAL);
  if (fields.ticket !== undefined) await page.getByLabel("Ticket text or acceptance criteria").fill(fields.ticket);
  if (fields.feature !== undefined) await page.getByLabel("Feature").fill(fields.feature);
  await page.getByRole("button", { name: "Draft a brief" }).click();
}

const editor = (w: Watched) => w.page.locator("#brief-editor");
const question = (w: Watched, id: string) => w.page.locator(`[data-question-id="${id}"]`);
const expectationRows = (w: Watched) => w.page.locator("#brief-expectations > li");
const sourceTag = (row: Locator) => row.locator(".tag");
/** The server's own copy of the brief, read directly (not through the page). */
async function serverDraft(w: Watched, id: string): Promise<BriefDraft> {
  const res = await fetch(`${w.base}/api/briefs/${id}`, { headers: { "x-run-hound": "1" } });
  expect(res.status).toBe(200);
  return (await res.json()) as BriefDraft;
}
const draftId = async (w: Watched): Promise<string> => {
  await expect.poll(() => w.calls.find((c) => c.method === "POST" && c.path === "/api/briefs")?.json).toBeTruthy();
  return (w.calls.find((c) => c.method === "POST" && c.path === "/api/briefs")!.json as BriefDraft).id;
};

describe("without the agent", () => {
  it("shows nothing about briefs and never calls /api/briefs", async () => {
    const base = await start({ agent: false });
    const w = await watched(base);
    await w.page.getByLabel("Page URL").fill(TARGET);
    await look(w.page.getByRole("heading", { name: "Target" })).toBeVisible();
    expect(await w.page.locator("#brief-section, #brief-editor, #brief-form").count()).toBe(0);
    expect(await w.page.locator("body").innerText()).not.toMatch(/Describe what to test|Draft a brief|Testing brief/);
    // The other views load as before, and nothing reached for the brief routes.
    await w.page.goto(`${base}/#/settings`);
    await w.page.getByRole("heading", { name: "Settings" }).waitFor();
    await w.page.goto(`${base}/#/new`);
    await w.page.getByRole("heading", { name: "Target" }).waitFor();
    expect(w.calls).toEqual([]);
    // The routes aren't there either: an unknown path answers the plain "Not found".
    const res = await fetch(`${base}/api/briefs/anything`, { headers: { "x-run-hound": "1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
    expectClean(w);
    await w.page.close();
  });
});

describe("Describe what to test", () => {
  it("is a section with a Preview badge, labelled fields and limits, on the New run page", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    const section = page.getByRole("region", { name: /Describe what to test/ });
    await look(section).toBeVisible();
    await look(section.locator(".badge")).toHaveText("Preview");
    const goal = page.getByLabel("What do you want to test?");
    await look(goal).toHaveAttribute("maxlength", "2000");
    await look(goal).toHaveAttribute("required", "");
    await look(page.getByLabel("Ticket text or acceptance criteria")).toHaveAttribute("maxlength", "8000");
    await look(page.getByLabel("Feature")).toHaveAttribute("maxlength", "80");
    await look(page.getByRole("button", { name: "Draft a brief" })).toBeEnabled();
    // The editor stays out of sight until there is a draft; nothing was requested.
    await look(editor(w)).toBeHidden();
    expect(w.calls).toEqual([]);
    expectClean(w);
    await page.close();
  });

  it("asks for a goal and a URL before it calls the server", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await page.getByRole("button", { name: "Draft a brief" }).click();
    await look(page.locator("#brief-error")).toHaveText("Describe what to test.");
    await look(page.getByLabel("What do you want to test?")).toBeFocused();
    await look(page.getByLabel("What do you want to test?")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("What do you want to test?").fill(GOAL);
    await page.getByRole("button", { name: "Draft a brief" }).click();
    await look(page.locator("#brief-error")).toContainText("Page URL");
    await look(page.getByLabel("Page URL")).toBeFocused();
    expect(w.calls).toEqual([]);
    expectClean(w);
    await page.close();
  });

  it("shows progress while drafting, then the brief: the ticket's line as 'You said', the model's as 'Assumed'", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    // Hold the answer back a moment so the progress line can be looked at.
    await page.route("**/api/briefs", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await draft(w, { ticket: TICKET, feature: "Tasks" });
    await look(page.locator("#brief-progress")).toContainText("draft the brief");
    await look(page.locator("#brief-progress")).toHaveAttribute("role", "status");
    await look(page.getByRole("button", { name: "Drafting…" })).toBeDisabled();
    await look(editor(w)).toBeVisible();
    await look(page.locator("#brief-progress")).toBeEmpty();
    await look(page.getByRole("button", { name: "Draft a brief" })).toBeEnabled();

    // Focus moved to the brief's heading.
    await look(page.getByRole("heading", { name: "Testing brief" })).toBeFocused();

    // What the page sent: JSON with the marker header, and only what was typed.
    const post = w.calls.find((c) => c.method === "POST" && c.path === "/api/briefs")!;
    expect(post.headers["x-run-hound"]).toBe("1");
    expect(post.headers["content-type"]).toContain("application/json");
    expect(post.body).toEqual({ goal: GOAL, url: TARGET, ticketContext: TICKET, feature: "Tasks" });
    expect(post.status).toBe(201);

    // The expectations: the ticket's two lines are the user's, the model's one is an assumption.
    await look(expectationRows(w)).toHaveCount(3);
    const rows = expectationRows(w);
    await look(rows.nth(0).locator("textarea")).toHaveValue("A new task shows up in the list");
    await look(sourceTag(rows.nth(0))).toHaveText("You said");
    await look(rows.nth(1).locator("textarea")).toHaveValue("The task is still there after a reload");
    await look(sourceTag(rows.nth(1))).toHaveText("You said");
    await look(rows.nth(2).locator("textarea")).toHaveValue(MODEL_EXPECTATION);
    await look(sourceTag(rows.nth(2))).toHaveText("Assumed");
    // The tag is also the field's description, so it is read with the field.
    expect(await rows.nth(2).locator("textarea").evaluate((el) => document.getElementById(el.getAttribute("aria-describedby")!)!.textContent)).toBe("Assumed");

    // The other fields, from the server's brief.
    await look(page.getByLabel("Goal", { exact: true })).toHaveValue(GOAL);
    await look(page.getByLabel("Start page")).toHaveValue("/app");
    await look(page.locator("#brief-start-origin")).toHaveText("http://127.0.0.1:5173");
    await look(page.locator("#brief-areas input")).toHaveValue("/tasks");
    await look(page.getByLabel("Test value 1 name")).toHaveValue("task title");
    await look(page.getByLabel("Test value 1 value")).toHaveValue("Buy milk");
    await look(page.getByLabel("Account", { exact: true })).toHaveValue("");
    await look(page.getByLabel("Account", { exact: true }).locator("option:checked")).toHaveText("Signed out");
    // Permissions: the two fixed ones are checked and cannot be changed; changing existing records is off.
    for (const name of ["Look around and read pages", "Create test data"]) {
      await look(page.getByRole("checkbox", { name })).toBeChecked();
      await look(page.getByRole("checkbox", { name })).toBeDisabled();
    }
    await look(page.getByRole("checkbox", { name: "Change records that existed before the run" })).toBeUnchecked();
    await look(editor(w)).toContainText("Deleting records, changing passwords and writing to other sites are never allowed.");
    await look(page.locator("#brief-state")).toHaveText("Not approved");
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await look(page.getByRole("button", { name: "Approve brief" })).toBeEnabled();
    // One call to the model, which was shown what the user typed.
    expect(fake.calls).toHaveLength(1);
    expectClean(w);
    await page.close();
  });

  it("shows the draft's warnings as a notice", async () => {
    // A model that answers nonsense leaves a draft with the ticket's lines and a warning.
    fake.reply({ raw: "not json" });
    const w = await watched(await start({ agent: true }));
    await draft(w, { ticket: TICKET });
    const notice = w.page.locator("#brief-warnings");
    await look(notice).toContainText("couldn't draft the brief");
    await look(expectationRows(w)).toHaveCount(2);
    await look(sourceTag(expectationRows(w).first())).toHaveText("You said");
    expectClean(w);
    await w.page.close();
  });

  it("sends no account when 'Not signed in' is chosen, and names the accounts that are not set up", async () => {
    const w = await watched(await start({ agent: true }));
    await draft(w);
    await look(editor(w)).toBeVisible();
    expect(w.calls[0]!.body).not.toHaveProperty("signInAs");
    // The editor's account list names both accounts; a slot that isn't set up cannot be picked.
    const options = w.page.getByLabel("Account", { exact: true }).locator("option");
    await look(options).toHaveTexts(["Account A · Set it up in Settings", "Account B · Set it up in Settings", "Signed out"]);
    await look(options.nth(0)).toBeDisabled();
    expectClean(w);
    await w.page.close();
  });

  it("drafts as the account chosen under 'Sign in as', and offers its name in the editor and the questions", async () => {
    process.env.RUNHOUND_ACCOUNT_A_LOGIN_URL = "http://127.0.0.1:5173/login";
    process.env.RUNHOUND_ACCOUNT_A_USERNAME = "alex@fernway.test";
    process.env.RUNHOUND_ACCOUNT_A_PASSWORD = "a-test-only-password";
    process.env.RUNHOUND_ACCOUNT_A_LABEL = "Alex";
    fake.reply(answer({ questions: [ACCOUNT_Q] }));
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await page.getByLabel("Sign in as").selectOption("a");
    await draft(w);
    await look(editor(w)).toBeVisible();
    expect(w.calls[0]!.body).toMatchObject({ signInAs: "a" });
    // The editor's account is the one drafted for.
    await look(page.getByLabel("Account", { exact: true })).toHaveValue("a");
    await look(page.getByLabel("Account", { exact: true }).locator("option:checked")).toHaveText("Alex (Account A)");
    // The question offers the ready account, and not the one that isn't set up.
    const q1 = question(w, "q1");
    await look(q1.getByRole("button", { name: "Alex (Account A)" })).toBeEnabled();
    await look(q1.getByRole("button", { name: "Account B · not set up" })).toBeDisabled();
    await q1.getByRole("button", { name: "Signed out" }).click();
    await q1.getByRole("button", { name: "Answer" }).click();
    await look(page.getByLabel("Account", { exact: true })).toHaveValue("");
    expectClean(w);
    await page.close();
  });

  it("is still there after going to Runs and back", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    await look(editor(w)).toBeVisible();
    await page.getByRole("link", { name: "Runs", exact: true }).click();
    await page.getByRole("heading", { name: "Runs" }).waitFor();
    await page.getByRole("link", { name: "New Run", exact: true }).click();
    await look(editor(w)).toBeVisible();
    await look(expectationRows(w)).toHaveCount(3);
    await look(page.getByLabel("What do you want to test?")).toHaveValue(GOAL);
    expectClean(w);
    await page.close();
  });
});

describe("refusals while drafting", () => {
  it("points to Settings when no model can be used (409)", async () => {
    const w = await watched(await start({ agent: true }, false));
    const { page } = w;
    await draft(w);
    const alert = page.locator("#brief-error");
    await look(alert).toContainText("none can be used");
    await look(alert).toHaveAttribute("role", "alert");
    const link = alert.getByRole("link", { name: "Open Settings" });
    await look(link).toHaveAttribute("href", "#/settings");
    await look(editor(w)).toBeHidden();
    expect(w.calls[0]!.status).toBe(409);
    // The page is usable again.
    await look(page.getByRole("button", { name: "Draft a brief" })).toBeEnabled();
    await link.click();
    await look(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    expectClean(w);
    await page.close();
  });

  it("shows the server's reason for a target it refuses (400)", async () => {
    const w = await watched(await start({ agent: true }));
    await draft(w, { url: "http://8.8.8.8/app" });
    await expect.poll(async () => norm(await w.page.locator("#brief-error").textContent())).not.toBe("");
    await look(editor(w)).toBeHidden();
    expect(w.calls[0]!.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    expectClean(w);
    await w.page.close();
  });
});

describe("questions", () => {
  it("answers one by its options, dismisses another, and answers a free-text one", async () => {
    fake.reply(answer({ questions: [ACCOUNT_Q, PERMISSION_Q, EXPECTATION_Q] }));
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    await look(editor(w)).toBeVisible();

    // Open questions come first, before the goal.
    const firstQuestionY = (await question(w, "q1").boundingBox())!.y;
    expect(firstQuestionY).toBeLessThan((await page.locator("#brief-goal-edit").boundingBox())!.y);
    await look(page.locator(".brief-q")).toHaveCount(3);

    // Account answers carry the account's name, and an account that isn't set up cannot be picked.
    const q1 = question(w, "q1");
    await look(q1.getByRole("button", { name: "Account A · not set up" })).toBeDisabled();
    await look(q1.getByRole("button", { name: "Account B · not set up" })).toBeDisabled();
    await look(q1.getByRole("button", { name: "Answer" })).toBeDisabled();
    const signedOut = q1.getByRole("button", { name: "Signed out" });
    await signedOut.click();
    await look(signedOut).toHaveAttribute("aria-pressed", "true");
    await q1.getByRole("button", { name: "Answer" }).click();
    await look(question(w, "q1")).toHaveCount(0);
    await look(page.locator(".q-done")).toContainText("Which account should the agent use?");
    await look(page.locator(".q-done")).toContainText("Signed out");

    // Permission answers are written out.
    const q2 = question(w, "q2");
    await look(q2.getByRole("button", { name: "Yes, it may change existing records" })).toBeVisible();
    await look(q2.getByRole("button", { name: "No", exact: true })).toBeVisible();
    // The page asks for the next question first, keyboard focus on it.
    await look(q2).toBeFocused();

    // Skip sends null and leaves what the question would have changed alone.
    await q2.getByRole("button", { name: "Skip" }).click();
    await look(question(w, "q2")).toHaveCount(0);
    await look(page.locator(".q-done")).toContainText("Skipped");
    await look(page.getByRole("checkbox", { name: "Change records that existed before the run" })).toBeUnchecked();

    // A free-text question has an input named by the question, and Answer waits for text.
    const q3 = question(w, "q3");
    const input = q3.getByLabel("What should happen when a task has no title?");
    await look(q3.getByRole("button", { name: "Answer" })).toBeDisabled();
    await input.fill("It says the title is required and adds nothing");
    await input.press("Enter");
    await look(question(w, "q3")).toHaveCount(0);
    await look(page.locator(".brief-q")).toHaveCount(0);
    // The answer became the user's own expectation.
    await look(expectationRows(w)).toHaveCount(4);
    await look(expectationRows(w).nth(3).locator("textarea")).toHaveValue("It says the title is required and adds nothing");
    await look(sourceTag(expectationRows(w).nth(3))).toHaveText("You said");

    // What went to the server: the answers by question id, null for the skipped one.
    const puts = w.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.body)).toEqual([
      { answers: { q1: "signed-out" } },
      { answers: { q2: null } },
      { answers: { q3: "It says the title is required and adds nothing" } },
    ]);
    for (const put of puts) expect(put.headers["x-run-hound"]).toBe("1");
    const stored = await serverDraft(w, await draftId(w));
    expect(stored.questions.map((q) => [q.id, q.settled, q.answer])).toEqual([
      ["q1", true, "signed-out"],
      ["q2", true, null],
      ["q3", true, "It says the title is required and adds nothing"],
    ]);
    expectClean(w);
    await page.close();
  });

  it("answering 'Yes, it may change existing records' ticks the permission", async () => {
    fake.reply(answer({ questions: [PERMISSION_Q] }));
    const w = await watched(await start({ agent: true }));
    await draft(w);
    const q1 = question(w, "q1");
    await q1.getByRole("button", { name: "Yes, it may change existing records" }).click();
    await q1.getByRole("button", { name: "Answer" }).click();
    await look(w.page.getByRole("checkbox", { name: "Change records that existed before the run" })).toBeChecked();
    expect(w.calls.find((c) => c.method === "PUT")!.body).toEqual({ answers: { q1: "yes" } });
    expectClean(w);
    await w.page.close();
  });

  it("keeps edits that were not saved yet when a question is answered", async () => {
    fake.reply(answer({ questions: [PERMISSION_Q] }));
    const w = await watched(await start({ agent: true }));
    await draft(w);
    await w.page.getByLabel("Goal", { exact: true }).fill("Adding a task works");
    await question(w, "q1").getByRole("button", { name: "No", exact: true }).click();
    await question(w, "q1").getByRole("button", { name: "Answer" }).click();
    await look(w.page.locator(".brief-q")).toHaveCount(0);
    await look(w.page.getByLabel("Goal", { exact: true })).toHaveValue("Adding a task works");
    expect(w.calls.find((c) => c.method === "PUT")!.body).toEqual({ goal: "Adding a task works", answers: { q1: "no" } });
    expectClean(w);
    await w.page.close();
  });

  it("shows the server's reason beside a question it cannot apply, and changes nothing", async () => {
    fake.reply(answer({ questions: [{ kind: "start-path", text: "Which page should the testing start on?", options: [], dataName: null }] }));
    const w = await watched(await start({ agent: true }));
    await draft(w);
    const q1 = question(w, "q1");
    await q1.getByLabel("Which page should the testing start on?").fill("tasks/new");
    await q1.getByRole("button", { name: "Answer" }).click();
    await look(q1.getByRole("alert")).toContainText("answer with a path");
    await look(q1).toBeVisible();
    await look(w.page.getByLabel("Start page")).toHaveValue("/app");
    expect(w.calls.find((c) => c.method === "PUT")!.status).toBe(400);
    // Fixing it works.
    await q1.getByLabel("Which page should the testing start on?").fill("/tasks/new");
    await q1.getByRole("button", { name: "Answer" }).click();
    await look(w.page.getByLabel("Start page")).toHaveValue("/tasks/new");
    expectClean(w);
    await w.page.close();
  });
});

describe("editing", () => {
  it("rewording an 'Assumed' expectation makes it 'You said' once saved, and the tag comes from the server", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    const assumed = expectationRows(w).nth(2);
    await look(sourceTag(assumed)).toHaveText("Assumed");
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await assumed.locator("textarea").fill("A task that is added appears exactly once in the list");
    // Unsaved, the page does not claim a source of its own: it says the text was edited.
    await look(sourceTag(assumed)).toHaveText("Edited");
    await look(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    // Putting the old words back is no change: the server's tag returns.
    await assumed.locator("textarea").fill(MODEL_EXPECTATION);
    await look(sourceTag(assumed)).toHaveText("Assumed");
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await assumed.locator("textarea").fill("A task that is added appears exactly once in the list");
    await page.getByRole("button", { name: "Save changes" }).click();
    await look(page.locator("#brief-edit-status")).toContainText("Saved at");
    await look(sourceTag(expectationRows(w).nth(2))).toHaveText("You said");
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    // The ticket's lines were sent as they were, so they keep their source; the page sent text only.
    const put = w.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ expectations: ["A new task shows up in the list", "The task is still there after a reload", "A task that is added appears exactly once in the list"] });
    const stored = await serverDraft(w, await draftId(w));
    expect(stored.brief.expectations.map((e) => e.source)).toEqual(["supplied", "supplied", "supplied"]);
    expectClean(w);
    await page.close();
  });

  it("removes and adds expectations, areas and test data, and saves them together", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    await look(expectationRows(w)).toHaveCount(3);

    await page.getByRole("button", { name: "Remove expectation 3" }).click();
    await look(expectationRows(w)).toHaveCount(2);
    // A new expectation: typed into the add input; Enter adds it. It is marked New until the server has seen it.
    await page.getByLabel("Add an expectation").fill("Deleting a task removes it from the list");
    await page.getByLabel("Add an expectation").press("Enter");
    await look(expectationRows(w)).toHaveCount(3);
    await look(sourceTag(expectationRows(w).nth(2))).toHaveText("New");
    // Areas
    await page.getByRole("button", { name: "Remove area 1" }).click();
    await page.getByLabel("Add an area").fill("/app/tasks");
    await page.getByRole("button", { name: "Add area" }).click();
    await look(page.locator("#brief-areas input")).toHaveValue("/app/tasks");
    // Test data: a new row, and the old one removed.
    await page.getByRole("button", { name: "Remove test value 1" }).click();
    await page.getByRole("button", { name: "Add test value" }).click();
    await look(page.getByLabel("Test value 1 name")).toBeFocused();
    await page.getByLabel("Test value 1 name").fill("task title");
    await page.getByLabel("Test value 1 value").fill("Water the plants {canary}");
    // The start page and the account.
    await page.getByLabel("Start page").fill("/app/tasks");

    await page.getByRole("button", { name: "Save changes" }).click();
    await look(page.locator("#brief-edit-status")).toContainText("Saved at");
    await look(sourceTag(expectationRows(w).nth(2))).toHaveText("You said");

    const put = w.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      startPath: "/app/tasks",
      scopePaths: ["/app/tasks"],
      expectations: ["A new task shows up in the list", "The task is still there after a reload", "Deleting a task removes it from the list"],
      testData: { "task title": "Water the plants {canary}" },
    });
    const stored = (await serverDraft(w, await draftId(w))).brief;
    expect(stored.target.startPath).toBe("/app/tasks");
    expect(stored.scopePaths).toEqual(["/app/tasks"]);
    expect(stored.testData).toEqual({ "task title": "Water the plants {canary}" });
    expectClean(w);
    await page.close();
  });

  it("saves text left in an add box, so nothing typed is lost", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await page.getByLabel("Add an expectation").fill("A second task does not replace the first");
    await look(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await page.getByRole("button", { name: "Save changes" }).click();
    await look(expectationRows(w)).toHaveCount(2);
    await look(page.getByLabel("Add an expectation")).toHaveValue("");
    expectClean(w);
    await page.close();
  });

  it("ticking 'Change records that existed before the run' is saved and kept", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    const box = page.getByRole("checkbox", { name: "Change records that existed before the run" });
    await box.check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await look(page.locator("#brief-edit-status")).toContainText("Saved at");
    await look(box).toBeChecked();
    expect(w.calls.find((c) => c.method === "PUT")!.body).toEqual({ allowModification: true });
    const stored = (await serverDraft(w, await draftId(w))).brief;
    expect(stored.mutationPermissions.modifyExisting).toBe(true);
    expect(stored.permittedActions).toEqual(["observation", "test-data-creation", "modification"]);
    // Deleting, credentials and external writes are not offered, so they stay off.
    expect(stored.mutationPermissions).toMatchObject({ delete: false, changeCredentials: false, externalWrite: false });
    // It survives going to Runs and back.
    await page.getByRole("link", { name: "Runs", exact: true }).click();
    await page.getByRole("link", { name: "New Run", exact: true }).click();
    await look(page.getByRole("checkbox", { name: "Change records that existed before the run" })).toBeChecked();
    expectClean(w);
    await page.close();
  });

  it("shows a refused save in the alert line and changes nothing else (400)", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    await page.getByLabel("Start page").fill("not a path");
    await page.getByLabel("Goal", { exact: true }).fill("Adding a task works");
    await page.getByRole("button", { name: "Save changes" }).click();
    const alert = page.locator("#brief-edit-error");
    await look(alert).toContainText("The start page must be a path on the target");
    await look(alert).toHaveAttribute("role", "alert");
    // The form keeps what was typed, the tags stay, and nothing was applied on the server.
    await look(page.getByLabel("Start page")).toHaveValue("not a path");
    await look(page.getByLabel("Goal", { exact: true })).toHaveValue("Adding a task works");
    await look(sourceTag(expectationRows(w).nth(2))).toHaveText("Assumed");
    await look(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    const stored = (await serverDraft(w, await draftId(w))).brief;
    expect(stored.goal).toBe(GOAL);
    expect(stored.target.startPath).toBe("/app");
    // Fixing the field clears the alert on the next save.
    await page.getByLabel("Start page").fill("/app/tasks");
    await page.getByRole("button", { name: "Save changes" }).click();
    await look(page.locator("#brief-edit-status")).toContainText("Saved at");
    await look(alert).toBeEmpty();
    expectClean(w);
    await page.close();
  });
});

describe("approval", () => {
  it("approves: shows 'Approved', the time and the first 12 characters of the hash, and the note", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w, { ticket: TICKET });
    await page.getByRole("button", { name: "Approve brief" }).click();
    const banner = page.locator("#brief-approved");
    await look(banner).toBeVisible();
    await look(banner).toBeFocused();
    await look(banner).toContainText("Approved at");
    await look(banner.locator("time")).toHaveText(/^\d\d:\d\d:\d\d$/);
    await look(banner).toContainText("Agent runs arrive in a later version. This brief is kept until Run Hound restarts.");
    await look(page.locator("#brief-state")).toHaveText("Approved");

    const id = await draftId(w);
    const stored = await serverDraft(w, id);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.brief.approval).toMatchObject({ by: "self" });
    await look(banner.locator("code")).toHaveText(stored.hash!.slice(0, 12));
    await look(banner.locator("time")).toHaveAttribute("datetime", stored.brief.approval!.at);
    // Nothing was pending, so only the approval was sent; the button now says so.
    expect(w.calls.map((c) => `${c.method} ${c.path.replace(id, ":id")}`)).toEqual(["POST /api/briefs", "POST /api/briefs/:id/approve"]);
    await look(page.getByRole("button", { name: "Approved" })).toBeDisabled();
    expectClean(w);
    await page.close();
  });

  it("saves what is pending before it approves", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    await page.getByLabel("Goal", { exact: true }).fill("Adding and editing tasks works");
    await page.getByLabel("Add an expectation").fill("Editing a task keeps its position in the list");
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-approved")).toBeVisible();
    const id = await draftId(w);
    expect(w.calls.map((c) => `${c.method} ${c.path.replace(id, ":id")}`)).toEqual(["POST /api/briefs", "PUT /api/briefs/:id", "POST /api/briefs/:id/approve"]);
    const stored = await serverDraft(w, id);
    expect(stored.brief.goal).toBe("Adding and editing tasks works");
    expect(stored.brief.expectations.map((e) => [e.text, e.source])).toContainEqual(["Editing a task keeps its position in the list", "supplied"]);
    expect(stored.hash).not.toBeNull();
    await look(page.getByLabel("Goal", { exact: true })).toHaveValue("Adding and editing tasks works");
    expectClean(w);
    await page.close();
  });

  it("shows the brief as not approved again after a later edit", async () => {
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-approved")).toBeVisible();

    await page.getByLabel("Goal", { exact: true }).fill("Adding a task works, even with a long title");
    // Unsaved, the server still holds the approval; Approve is offered again because the form changed.
    await look(page.getByRole("button", { name: "Approve brief" })).toBeEnabled();
    await page.getByRole("button", { name: "Save changes" }).click();
    await look(page.locator("#brief-edit-status")).toContainText("The approval was cleared");
    await look(page.locator("#brief-approved")).toHaveCount(0);
    await look(page.locator("#brief-state")).toHaveText("Not approved");
    const stored = await serverDraft(w, await draftId(w));
    expect(stored.hash).toBeNull();
    expect(stored.brief.approval).toBeNull();

    // And approving again gives a new hash.
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-approved")).toBeVisible();
    const again = await serverDraft(w, await draftId(w));
    expect(again.hash).toMatch(/^[0-9a-f]{64}$/);
    await look(page.locator("#brief-approved code")).toHaveText(again.hash!.slice(0, 12));
    expectClean(w);
    await page.close();
  });

  it("refuses to approve while a question is open, names why, and changes nothing", async () => {
    fake.reply(answer({ questions: [PERMISSION_Q] }));
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    await page.getByRole("button", { name: "Approve brief" }).click();
    const alert = page.locator("#brief-edit-error");
    await look(alert).toContainText("Answer or dismiss");
    await look(alert).toContainText("May the agent change tasks that already exist?");
    await look(page.locator("#brief-approved")).toHaveCount(0);
    await look(page.locator("#brief-state")).toHaveText("Not approved");
    await look(question(w, "q1")).toBeVisible();
    expect(w.calls.at(-1)).toMatchObject({ method: "POST", status: 400 });
    // Dismissing the question and approving works, and clears the alert.
    await question(w, "q1").getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-approved")).toBeVisible();
    await look(alert).toBeEmpty();
    expectClean(w);
    await page.close();
  });

  it("explains that there is nothing to approve without an expectation", async () => {
    fake.reply(answer({ expectations: [] }));
    const w = await watched(await start({ agent: true }));
    await draft(w);
    await look(expectationRows(w)).toHaveCount(0);
    await w.page.getByRole("button", { name: "Approve brief" }).click();
    await look(w.page.locator("#brief-edit-error")).toContainText("Add at least one expectation");
    await look(w.page.locator("#brief-approved")).toHaveCount(0);
    expectClean(w);
    await w.page.close();
  });

  it("tells an approval that failed after saving that the changes were saved", async () => {
    fake.reply(answer({ expectations: [] }));
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await draft(w);
    // Pending text in the goal, but still no expectation: the save works, the approval does not.
    await page.getByLabel("Goal", { exact: true }).fill("Adding a task works");
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-edit-error")).toContainText("Add at least one expectation");
    await look(page.locator("#brief-edit-status")).toContainText("Your changes were saved");
    await look(page.getByLabel("Goal", { exact: true })).toHaveValue("Adding a task works");
    await look(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expectClean(w);
    await page.close();
  });
});

describe("keyboard and phone width", () => {
  it("can be drafted, answered and approved from the keyboard", async () => {
    fake.reply(answer({ questions: [PERMISSION_Q] }));
    const w = await watched(await start({ agent: true }));
    const { page } = w;
    await page.getByLabel("Page URL").fill(TARGET);
    await page.getByLabel("What do you want to test?").fill(GOAL);
    // A textarea takes Enter as a new line, so the button is what a keyboard user reaches.
    await page.getByRole("button", { name: "Draft a brief" }).focus();
    await page.keyboard.press("Enter");
    await look(page.getByRole("heading", { name: "Testing brief" })).toBeFocused();
    // The question's options are buttons; Space picks one, then Answer; the answer lands and focus moves on.
    await question(w, "q1").getByRole("button", { name: "No", exact: true }).focus();
    await page.keyboard.press("Space");
    await look(question(w, "q1").getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
    await question(w, "q1").getByRole("button", { name: "Answer" }).focus();
    await page.keyboard.press("Enter");
    await look(page.locator(".brief-q")).toHaveCount(0);
    await look(page.getByLabel("Goal", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Approve brief" }).focus();
    await page.keyboard.press("Enter");
    await look(page.locator("#brief-approved")).toBeFocused();
    expectClean(w);
    await page.close();
  });

  it("fits a 375 px screen: no horizontal scroll, with questions, a long ticket and the approval", async () => {
    fake.reply(answer({ questions: [ACCOUNT_Q, PERMISSION_Q] }));
    const w = await watched(await start({ agent: true }), 375);
    const { page } = w;
    const wide = [
      "- When a person saves a task whose title is two hundred characters long, the whole title is shown in the list without being cut off or pushing the page sideways",
      "- /app/tasks/with/a/very/long/path/that/keeps/going/and/going/and/going/without/a/single/space/in/it",
    ].join("\n");
    await draft(w, { ticket: wide, url: "http://192.168.100.200:5173/app/tasks/with/a/rather/long/path" });
    await look(editor(w)).toBeVisible();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await question(w, "q1").getByRole("button", { name: "Signed out" }).click();
    await question(w, "q1").getByRole("button", { name: "Answer" }).click();
    await question(w, "q2").getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: "Approve brief" }).click();
    await look(page.locator("#brief-approved")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    // Every control in the brief is at least as wide as a finger and inside the screen.
    const outside = await page.locator("#brief-editor input, #brief-editor textarea, #brief-editor select, #brief-editor button").evaluateAll((els) =>
      els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 || el.getBoundingClientRect().left < -0.5).map((el) => el.id || el.getAttribute("aria-label") || el.textContent),
    );
    expect(outside).toEqual([]);
    expectClean(w);
    await page.close();
  });
});
