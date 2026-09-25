/**
 * Test accounts in the web UI (docs/v2-spec.md "Test accounts" → Web UI), driven in real Chromium. The page is
 * renderUi's document and every /api/* call is answered by a stub (page.route), so these tests pin the client.
 *
 * Structure pinned here (the spec names the pieces; the roles and labels are this file's reading of it):
 * - Settings → a section (role region) named "Test accounts" holding:
 *   - one card per slot: a role=group named by the account's label (e.g. a fieldset whose legend is "Account A"), with
 *     inputs labelled "Label", "Sign-in page URL", "Username" and "Password" (type=password, never prefilled), a
 *     "saved" note and a "Remove" link or button when a password is saved, a button "Save…" and a button "Test sign-in";
 *   - the checkbox labelled "A and B must not see each other's data" (GET's `isolated`);
 *   - a short note on what the access checks do and that the accounts must be ones the user owns.
 *   Save sends PUT /api/accounts { accounts: { <slot>: { … } } } with that slot only; `password` only when one was
 *   typed, or "" after Remove. * Remove may save at once or on Save; the isolated box may save at once or with a Save.
 *   A slot's `problem` and a refused save's `error` are shown in its card. Test sign-in sends
 *   POST /api/accounts/test { id } and shows the answer's message in the card.
 * - New Run → a select labelled "Sign in as": "Not signed in" (selected by default), "Account A", "Account B"; a slot
 *   that isn't ready is a disabled option whose text includes "Set it up in Settings". Choosing A sends
 *   signInAs: "a" with POST /api/plan; "Not signed in" sends no account (no signInAs, or null). The plan header
 *   (#plan-section) says "Signed in as Account A" when plan.account is set.
 * - The report view (#report) says "Signed in as <label>" and names the other account when the run used it.
 * - Every /api/accounts* request carries X-Run-Hound: 1.
 */
import { chromium, type Browser, type Locator, type Page, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountId, AccountStatus, AccountsStatus } from "../accounts/types.js";
import type { AiStatus } from "../ai/types.js";
import type { AccountRef, Plan, Report } from "../core/types.js";
import { renderUi } from "./ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.4.0", canShowBrowser: false });
const LOGIN_URL = "http://127.0.0.1:5173/login";

function slot(id: AccountId, extra: Partial<AccountStatus> = {}): AccountStatus {
  return {
    id,
    label: id === "a" ? "Account A" : "Account B",
    loginUrl: "",
    username: "",
    hasPassword: false,
    ready: false,
    sources: { label: "default", loginUrl: "default", username: "default", password: "default" },
    problem: null,
    ...extra,
  };
}

const READY_A = slot("a", {
  loginUrl: LOGIN_URL,
  username: "alex@fernway.test",
  hasPassword: true,
  ready: true,
  sources: { label: "default", loginUrl: "file", username: "file", password: "file" },
});

function accounts(a: AccountStatus = READY_A, b: AccountStatus = slot("b"), isolated = true): AccountsStatus {
  return { isolated, isolatedSource: "default", accounts: { a, b }, file: "/home/me/.config/run-hound/accounts.json" };
}

const AI_OFF: AiStatus = {
  enabled: false,
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "",
  region: null,
  allowRemote: false,
  features: { review: true, suggest: true, explain: true },
  timeoutMs: 120_000,
  hasKey: false,
  remote: false,
  host: "127.0.0.1:11434",
  problem: "AI is off",
  sources: { enabled: "default", provider: "default", baseUrl: "default", model: "default", apiKey: "default", region: "default", allowRemote: "default", features: "default", timeoutMs: "default" },
  file: "/home/me/.config/run-hound/ai.json",
};

type Json = Record<string, unknown>;

interface Stub {
  /** What GET /api/accounts answers (may carry extra fields, to prove the page ignores them). */
  accounts: AccountsStatus;
  put: (body: Json, current: AccountsStatus) => { status: number; body: unknown };
  test: (body: Json) => unknown;
  plan: (body: Json) => unknown;
  report?: Report;
}

interface Opened {
  page: Page;
  errors: string[];
  calls: { method: string; path: string; body: Json | null; headers: Record<string, string> }[];
}

/** Applies a patch the way the server would, for the default PUT stub. */
function applyPatch(current: AccountsStatus, body: Json): AccountsStatus {
  const next: AccountsStatus = JSON.parse(JSON.stringify(current)) as AccountsStatus;
  if (typeof body.isolated === "boolean") next.isolated = body.isolated;
  const patch = (body.accounts ?? {}) as Partial<Record<AccountId, Record<string, string>>>;
  for (const id of ["a", "b"] as const) {
    const p = patch[id];
    if (!p) continue;
    const s = next.accounts[id];
    if (typeof p.label === "string") s.label = p.label || (id === "a" ? "Account A" : "Account B");
    if (typeof p.loginUrl === "string") s.loginUrl = p.loginUrl;
    if (typeof p.username === "string") s.username = p.username;
    if (typeof p.password === "string") s.hasPassword = p.password !== "";
    s.ready = Boolean(s.loginUrl && s.username && s.hasPassword);
  }
  return next;
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(hash: string, stub: Partial<Stub>, width = 1280): Promise<Opened> {
  const s: Stub = {
    accounts: accounts(),
    put: (body, current) => ({ status: 200, body: applyPatch(current, body) }),
    test: () => ({ id: "a", ok: true, landedOn: "/notes", message: "Signed in; landed on /notes." }),
    plan: () => ({ planId: "p1", plan: notesPlan(), checks: {}, warnings: [] }),
    ...stub,
  };
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // The stubs answer at once: anything the page is going to show is there within a few seconds.
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  const calls: Opened["calls"] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    const body = req.postData() ? (JSON.parse(req.postData()!) as Json) : null;
    const headers = req.headers();
    calls.push({ method: req.method(), path: url.pathname, body, headers });
    if (url.pathname.startsWith("/api/accounts") && headers["x-run-hound"] !== "1") return json({ error: "Requests to /api/accounts must send the header X-Run-Hound: 1." }, 403);
    if (url.pathname === "/api/accounts" && req.method() === "GET") return json(s.accounts);
    if (url.pathname === "/api/accounts" && req.method() === "PUT") {
      const r = s.put(body ?? {}, s.accounts);
      if (r.status === 200) s.accounts = r.body as AccountsStatus;
      return json(r.body, r.status);
    }
    if (url.pathname === "/api/accounts/test" && req.method() === "POST") return json(s.test(body ?? {}));
    if (url.pathname === "/api/ai") return json(AI_OFF);
    if (url.pathname === "/api/settings") return json({ version: "0.4.0", runsDir: "/runs", allowedHosts: [], serverHosts: [], ai: AI_OFF });
    if (url.pathname === "/api/plan") return json(s.plan(body ?? {}));
    if (url.pathname === "/api/runs") return json({ runs: [] });
    if (url.pathname === "/api/runs/r1") return json({ status: "done", report: s.report });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, errors, calls };
}

const section = (page: Page) => page.getByRole("region", { name: "Test accounts" });
const card = (page: Page, label: string | RegExp) => section(page).getByRole("group", { name: label });
const removeControl = (c: Locator) => c.locator("a, button").filter({ hasText: /Remove/ });
const puts = (o: Opened) => o.calls.filter((c) => c.path === "/api/accounts" && c.method === "PUT").map((c) => c.body ?? {});
const slotPatch = (body: Json, id: AccountId) => ((body.accounts ?? {}) as Record<string, Json | undefined>)[id];

describe("Settings → Test accounts", () => {
  it("shows a card per account, the isolated checkbox and a note on the access checks", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    await section(page).waitFor();
    const a = card(page, /Account A/);
    const b = card(page, /Account B/);
    await a.waitFor();
    await b.waitFor();

    await expect.poll(() => a.getByLabel("Sign-in page URL").inputValue()).toBe(LOGIN_URL);
    expect(await a.getByLabel("Username").inputValue()).toBe("alex@fernway.test");
    expect(await a.getByLabel("Label").count()).toBe(1);
    const password = a.getByLabel("Password", { exact: true });
    expect(await password.getAttribute("type")).toBe("password");
    expect(await password.inputValue()).toBe("");
    expect(await a.innerText()).toMatch(/saved/i);
    expect(await removeControl(a).count()).toBe(1);
    expect(await a.getByRole("button", { name: "Test sign-in" }).count()).toBe(1);
    expect(await a.getByRole("button", { name: /^Save/ }).count()).toBe(1);

    expect(await b.getByLabel("Sign-in page URL").inputValue()).toBe("");
    expect(await b.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    expect(await removeControl(b).count()).toBe(0);
    expect(await b.getByRole("button", { name: "Test sign-in" }).count()).toBe(1);

    const isolated = section(page).getByLabel(/must not see each other's data/);
    expect(await isolated.isChecked()).toBe(true);
    const text = await section(page).innerText();
    expect(text).toMatch(/access/i);
    expect(text).toMatch(/\bown\b/i);
    expect(text).not.toMatch(/\b(null|undefined)\b/);

    const accountCalls = o.calls.filter((c) => c.path.startsWith("/api/accounts"));
    expect(accountCalls.length).toBeGreaterThan(0);
    for (const c of accountCalls) expect(c.headers["x-run-hound"]).toBe("1");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("reflects isolated: false", async () => {
    const o = await open("#/settings", { accounts: accounts(READY_A, slot("b"), false) });
    const isolated = section(o.page).getByLabel(/must not see each other's data/);
    await isolated.waitFor();
    await expect.poll(() => isolated.isChecked()).toBe(false);
    await o.page.close();
  });

  it("never shows a password, even one the API should not have sent", async () => {
    const leaky = accounts({ ...READY_A, password: "leaked-secret-1234" } as AccountStatus);
    const o = await open("#/settings", { accounts: leaky });
    const a = card(o.page, /Account A/);
    await expect.poll(() => a.getByLabel("Sign-in page URL").inputValue()).toBe(LOGIN_URL);
    expect(await a.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    expect(await o.page.content()).not.toContain("leaked-secret-1234");
    await o.page.close();
  });

  it("saves one card with a typed password, then clears the password field", async () => {
    const o = await open("#/settings", {});
    const { page } = o;
    const b = card(page, /Account B/);
    await b.waitFor();
    await b.getByLabel("Sign-in page URL").fill("http://127.0.0.1:5173/login");
    await b.getByLabel("Username").fill("sam@fernway.test");
    await b.getByLabel("Password", { exact: true }).fill("typed-secret-5678");
    await b.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => puts(o).length).toBe(1);
    const body = puts(o)[0]!;
    expect(slotPatch(body, "b")).toMatchObject({ loginUrl: "http://127.0.0.1:5173/login", username: "sam@fernway.test", password: "typed-secret-5678" });
    expect(slotPatch(body, "a")).toBeUndefined();
    await expect.poll(() => card(page, /Account B/).getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await expect.poll(() => card(page, /Account B/).innerText()).toMatch(/saved/i);
    expect(await page.content()).not.toContain("typed-secret-5678");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("sends no password when none was typed, so the saved one is kept", async () => {
    const o = await open("#/settings", {});
    const a = card(o.page, /Account A/);
    await expect.poll(() => a.getByLabel("Username").inputValue()).toBe("alex@fernway.test");
    await a.getByLabel("Username").fill("alex+2@fernway.test");
    await a.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => puts(o).length).toBe(1);
    const patch = slotPatch(puts(o)[0]!, "a")!;
    expect(patch).toMatchObject({ username: "alex+2@fernway.test" });
    expect(patch).not.toHaveProperty("password");
    await o.page.close();
  });

  it("Remove sends an empty password for that card only", async () => {
    const o = await open("#/settings", {});
    const a = card(o.page, /Account A/);
    await removeControl(a).waitFor();
    await removeControl(a).click();
    const removed = () => puts(o).some((b) => slotPatch(b, "a")?.password === "");
    // Remove may save at once or mark the password for removal until Save.
    await o.page.waitForTimeout(300);
    if (!removed()) await a.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(removed).toBe(true);
    expect(puts(o).every((b) => slotPatch(b, "b") === undefined)).toBe(true);
    await expect.poll(() => removeControl(card(o.page, /Account A/)).count()).toBe(0);
    await o.page.close();
  });

  it("saves the isolated setting", async () => {
    const o = await open("#/settings", {});
    const isolated = section(o.page).getByLabel(/must not see each other's data/);
    await isolated.waitFor();
    await isolated.uncheck();
    const saved = () => puts(o).some((b) => b.isolated === false);
    await o.page.waitForTimeout(300);
    if (!saved()) await section(o.page).getByRole("button", { name: /^Save/ }).first().click();
    await expect.poll(saved).toBe(true);
    await o.page.close();
  });

  it("shows a refused save's error in the card", async () => {
    const o = await open("#/settings", {
      put: () => ({ status: 400, body: { error: "http://8.8.8.8/login is not allowed: 8.8.8.8 is not a private address" } }),
    });
    const b = card(o.page, /Account B/);
    await b.waitFor();
    await b.getByLabel("Sign-in page URL").fill("http://8.8.8.8/login");
    await b.getByLabel("Username").fill("sam@fernway.test");
    await b.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(() => b.innerText()).toContain("8.8.8.8 is not a private address");
    await o.page.close();
  });

  it("shows a slot's problem in its card", async () => {
    const problem = "The saved password was for http://127.0.0.1:5173, so it was not used.";
    const o = await open("#/settings", { accounts: accounts(slot("a", { loginUrl: "http://127.0.0.1:5174/login", username: "alex@fernway.test", problem })) });
    await expect.poll(() => card(o.page, /Account A/).innerText()).toContain(problem);
    await o.page.close();
  });

  it("Test sign-in posts the slot and shows where it landed, or why it failed", async () => {
    let answer: unknown = { id: "a", ok: true, landedOn: "/notes", message: "Signed in; landed on /notes." };
    const o = await open("#/settings", { test: () => answer });
    const a = card(o.page, /Account A/);
    await a.waitFor();
    await a.getByRole("button", { name: "Test sign-in" }).click();
    await expect.poll(() => a.innerText()).toContain("Signed in; landed on /notes.");
    const call = o.calls.find((c) => c.path === "/api/accounts/test")!;
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ id: "a" });
    answer = { id: "a", ok: false, message: "Email or password is incorrect" };
    await a.getByRole("button", { name: "Test sign-in" }).click();
    await expect.poll(() => a.innerText()).toContain("Email or password is incorrect");
    expect(o.errors).toEqual([]);
    await o.page.close();
  });

  it("fits a 360 px screen", async () => {
    const o = await open("#/settings", {}, 360);
    await card(o.page, /Account A/).waitFor();
    const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await o.page.close();
  });
});

function notesPlan(account?: AccountRef): Plan {
  const form = {
    url: "http://127.0.0.1:5173/notes",
    index: 0,
    selector: "#new-note",
    name: "New note",
    fields: [{ key: "title", accessibleName: "Title", label: "Title", placeholder: null, type: "text", role: "textbox", required: true, selector: "#title" }],
    controls: [{ accessibleName: "Save note", text: "Save note", role: "button", tag: "button", selector: "#save", isSubmit: true }],
  };
  return {
    target: "http://127.0.0.1:5173/notes",
    form,
    page: { url: form.url, title: "Notes · Notes", forms: [form], controls: [], links: 3 },
    scenarios: [
      { id: "required:s", checkId: "client-only-validation", title: "Required fields are enforced", description: "Submits the form empty.", kind: "danger", priority: "high", destructive: false, defaultSelected: true, scope: "form", formIndex: 0 },
    ],
    groups: [{ id: "features", label: "Features", scenarioIds: ["required:s"] }],
    ...(account ? { account } : {}),
  } as unknown as Plan;
}

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };

describe("New Run → Sign in as", () => {
  const select = (page: Page) => page.getByLabel("Sign in as");

  it("offers Not signed in (default), Account A and Account B, with a slot that isn't set up disabled", async () => {
    const o = await open("#/new", {});
    const { page } = o;
    await expect.poll(() => select(page).locator("option").count()).toBe(3);
    const texts = await select(page).locator("option").allTextContents();
    expect(texts[0]!.trim()).toBe("Not signed in");
    expect(texts[1]).toContain("Account A");
    expect(texts[2]).toContain("Account B");
    expect(texts[2]).toContain("Set it up in Settings");
    expect(await select(page).locator("option").nth(1).isDisabled()).toBe(false);
    expect(await select(page).locator("option").nth(2).isDisabled()).toBe(true);
    expect((await select(page).locator("option:checked").textContent())!.trim()).toBe("Not signed in");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("sends signInAs with the plan and the plan header says 'Signed in as Account A'", async () => {
    const o = await open("#/new", { plan: (body) => ({ planId: "p1", plan: notesPlan(body.signInAs === "a" ? A : undefined), checks: {}, warnings: [] }) });
    const { page } = o;
    await expect.poll(() => select(page).locator("option").count()).toBe(3);
    await select(page).selectOption({ index: 1 });
    await page.getByLabel("Page URL").fill("http://127.0.0.1:5173/notes");
    await page.getByRole("button", { name: "Plan checks" }).click();
    await page.locator("#plan-section").waitFor({ state: "visible" });
    expect(o.calls.find((c) => c.path === "/api/plan")!.body).toMatchObject({ url: "http://127.0.0.1:5173/notes", signInAs: "a" });
    await expect.poll(() => page.locator("#plan-section").innerText()).toContain("Signed in as Account A");
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("Not signed in sends no account, and the plan header doesn't mention one", async () => {
    const o = await open("#/new", {});
    const { page } = o;
    await expect.poll(() => select(page).locator("option").count()).toBe(3);
    await page.getByLabel("Page URL").fill("http://127.0.0.1:5173/notes");
    await page.getByRole("button", { name: "Plan checks" }).click();
    await page.locator("#plan-section").waitFor({ state: "visible" });
    const body = o.calls.find((c) => c.path === "/api/plan")!.body!;
    expect(body.signInAs ?? null).toBeNull();
    expect(await page.locator("#plan-section").innerText()).not.toContain("Signed in as");
    await page.close();
  });
});

function report(accountsUsed?: Report["accounts"]): Report {
  const plan = notesPlan(accountsUsed?.signedInAs ?? undefined);
  return {
    runId: "r1",
    target: plan.target,
    startedAt: "2026-09-26T10:00:00Z",
    finishedAt: "2026-09-26T10:01:00Z",
    durationMs: 60_000,
    groups: [{ id: "features", label: "Features", scenarioIds: ["required:s"], passed: 1, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 1000 }],
    runHoundVersion: "0.4.0",
    plan,
    approved: ["required:s"],
    results: [{ checkId: "client-only-validation", scenarioId: "required:s", status: "pass", findings: [], durationMs: 1000, steps: [] }],
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: 1, failed: 0, errored: 0, skipped: 0 },
    notVisible: [],
    ...(accountsUsed ? { accounts: accountsUsed } : {}),
  };
}

describe("Report view", () => {
  it("says 'Signed in as Account A' and names the other account the run used", async () => {
    const o = await open("#/runs/r1", { report: report({ signedInAs: A, other: B }) });
    await o.page.locator("#report").waitFor({ timeout: 15_000 });
    await expect.poll(() => o.page.locator("#report").innerText()).toContain("Signed in as Account A");
    expect(await o.page.locator("#report").innerText()).toContain("Account B");
    expect(o.errors).toEqual([]);
    await o.page.close();
  });

  it("uses the account's own label", async () => {
    const o = await open("#/runs/r1", { report: report({ signedInAs: { id: "a", label: "Owner" }, other: null }) });
    await o.page.locator("#report").waitFor({ timeout: 15_000 });
    await expect.poll(() => o.page.locator("#report").innerText()).toContain("Signed in as Owner");
    expect(await o.page.locator("#report").innerText()).not.toContain("Account B");
    await o.page.close();
  });

  it("says nothing about accounts for a signed-out run or a 0.3.0 report", async () => {
    for (const r of [report(), report({ signedInAs: null, other: null })]) {
      const o = await open("#/runs/r1", { report: r });
      await o.page.locator("#report").waitFor({ timeout: 15_000 });
      await o.page.locator("#report h1").waitFor();
      expect(await o.page.locator("#report").innerText()).not.toContain("Signed in as");
      expect(o.errors).toEqual([]);
      await o.page.close();
    }
  });
});
