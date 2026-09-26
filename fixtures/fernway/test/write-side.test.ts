/**
 * Fernway's write side (docs/v2-spec.md "Fernway (0.5.0 planned bugs)", CONTRACT.md "Tasks", "Cross-site requests",
 * "Billing" and "V2 planted bugs"): task updates with their ownership and session checks, the CSRF defences (the
 * SameSite=Lax cookie, the Origin check, JSON-only task writes), the server-side plan with the local test checkout
 * and /app/upgraded, and each of V06-V09 on versus off. What Run Hound's write-access, csrf and paywall-trust checks
 * do is done here by hand: write as the other identity, then re-read as Alex.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { BrowserContext, Request } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, isLoopbackHost } from "../server/app.mjs";
import { ACCOUNTS, api, closeBrowser, FERNWAY_ROOT, getBrowser, openPage, profileUrl, useFernway, type Fernway } from "./support.js";

afterAll(closeBrowser);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CROSS_SITE = { error: "This request came from another site, so Fernway refused it." };
const SIGN_IN_FIRST = { error: "Sign in to continue" };
const EVIL = "http://evil.example";

interface Task {
  id: string;
  title: string;
  projectId: string;
  done: boolean;
}

/** Alex's tasks, read as Alex (the re-read every write-side check ends with). */
const alexTasks = async (fw: Fernway): Promise<Task[]> => (await api<Task[]>(fw, "/api/tasks", { as: "alex" })).body;
const alexTask = async (fw: Fernway, id: string) => (await alexTasks(fw)).find((t) => t.id === id);
const alexPlan = async (fw: Fernway): Promise<string> => (await api(fw, profileUrl("alex"), { as: "alex" })).body.plan;

/** A task Alex creates the way Quick add does (POST, then the whole task with PATCH): the run's own test record. */
async function alexCreatesTask(fw: Fernway, title = "Run Hound test task rh1234"): Promise<Task> {
  const created = await api<Task>(fw, "/api/tasks", { body: { title, projectId: "northwind-rebrand" }, as: "alex" });
  expect(created.status).toBe(201);
  const saved = await api<Task>(fw, `/api/tasks/${created.body.id}`, { method: "PATCH", body: { title, projectId: "northwind-rebrand", done: false }, as: "alex" });
  expect(saved.status).toBe(200);
  return saved.body;
}

/** A raw request with an explicit cookie and headers (for Origin and content-type cases the api() helper doesn't send). */
async function raw(fw: Fernway, path: string, init: { method?: string; body?: string; headers?: Record<string, string>; as?: "alex" | "sam" }) {
  const cookie: Record<string, string> = init.as ? { cookie: await fw.session(init.as) } : {};
  const res = await fetch(`${fw.url}${path}`, { method: init.method ?? "POST", headers: { ...cookie, ...init.headers }, body: init.body });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON.
  }
  return { status: res.status, body: body as any };
}

/**
 * Signs Alex in inside `context` the way a browser does (POST /api/login from a Fernway page), so Chromium itself
 * decides whether to keep the cookie and which SameSite it has.
 */
async function browserSignIn(fw: Fernway, context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${fw.url}/login`, { waitUntil: "load" });
  const status = await page.evaluate(
    async ({ email, password }) =>
      (await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).status,
    { email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password },
  );
  expect(status).toBe(200);
  await page.close();
}

/**
 * From a blank page on another site, in Alex's browser, submits a plain HTML form (form-encoded, no preflight) to
 * POST /api/tasks, as Run Hound's csrf check does. The page is served by a real server on another port, addressed as
 * localhost (Fernway runs on 127.0.0.1: a different site). A page Playwright fulfils from a route has no address, so
 * Chromium's private network checks would block its request to a loopback address before it ever left the browser.
 * Resolves once the browser has finished (or given up on) the forged request.
 */
async function forgeTaskFromAnotherSite(fw: Fernway, context: BrowserContext, title: string): Promise<void> {
  const attacker = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="en"><head><title>Another site</title></head><body></body></html>');
  });
  await new Promise<void>((resolve) => attacker.listen(0, "127.0.0.1", resolve));
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${(attacker.address() as { port: number }).port}/`, { waitUntil: "load" });
    // The iframe never shows the answer (Fernway forbids framing): "failed" after the server answered counts too.
    const answered = new Promise<void>((resolve) => {
      const done = (req: Request) => {
        if (req.url() === `${fw.url}/api/tasks` && req.method() === "POST") resolve();
      };
      page.on("requestfinished", done);
      page.on("requestfailed", done);
    });
    await page.evaluate(
      ({ action, title }) => {
        const frame = document.createElement("iframe");
        frame.name = "sink";
        document.body.appendChild(frame);
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action;
        form.target = "sink";
        for (const [name, value] of [
          ["title", title],
          ["projectId", ""],
        ]) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name!;
          input.value = value!;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      },
      { action: `${fw.url}/api/tasks`, title },
    );
    await answered;
  } finally {
    await page.close();
    attacker.close();
  }
}

// ---- clean mode: tasks ---------------------------------------------------------------------------

describe("tasks: the whole-task update and its ownership and session checks (clean mode)", () => {
  const ref = useFernway("none");

  it("PATCH /api/tasks/:id updates title, project and done (any of them); the task's own projects only", async () => {
    const task = await alexCreatesTask(ref.fw);
    const res = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { title: "  Renamed task  ", projectId: "", done: true }, as: "alex" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: task.id, title: "Renamed task", projectId: "", done: true });
    expect(await alexTask(ref.fw, task.id)).toMatchObject({ title: "Renamed task", projectId: "", done: true });
    // A partial update keeps the other fields.
    expect((await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { done: false }, as: "alex" })).body).toMatchObject({ title: "Renamed task", done: false });
  });

  it.each([
    [{ title: "" }, "title"],
    [{ title: "x".repeat(121) }, "title"],
    [{ title: 7 }, "title"],
    [{ projectId: "bramble-bakery-identity" }, "projectId"],
    [{ done: "yes" }, "done"],
    [{}, "done"],
  ])("PATCH /api/tasks/:id %j answers 400 for %s and changes nothing", async (body, field) => {
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body, as: "alex" });
    expect(res.status).toBe(400);
    expect(typeof res.body.errors[field]).toBe("string");
    expect(await alexTask(ref.fw, "task-wireframes")).toMatchObject({ title: "Review homepage wireframes", projectId: "juniper-website", done: false });
  });

  it("a task renamed Crash answers a bare 500 and keeps its title", async () => {
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { title: "Crash" }, as: "alex" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect((await alexTask(ref.fw, "task-wireframes"))?.title).toBe("Review homepage wireframes");
  });

  it("Sam can't change Alex's task (404), and a request without a session can't either (401); Alex's re-read is unchanged", async () => {
    const task = await alexCreatesTask(ref.fw);
    const change = { title: "Changed by someone else rh1234x", projectId: "", done: true };
    const asSam = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: change, as: "sam" });
    expect(asSam.status).toBe(404);
    expect(asSam.body).toEqual({ error: "Not found" });
    const signedOut = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: change });
    expect(signedOut.status).toBe(401);
    expect(signedOut.body).toEqual(SIGN_IN_FIRST);
    expect(await alexTask(ref.fw, task.id)).toEqual(task);
  });
});

// ---- clean mode: cross-site requests -------------------------------------------------------------

describe("cross-site requests (clean mode): SameSite=Lax, the Origin check and JSON-only task writes", () => {
  const ref = useFernway("none");

  it("a write whose Origin is another site answers 403 and stores nothing, even with Alex's cookie", async () => {
    const before = (await alexTasks(ref.fw)).length;
    const json = { "content-type": "application/json" };
    const post = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Forged task" }), headers: { ...json, origin: EVIL }, as: "alex" });
    expect(post.status).toBe(403);
    expect(post.body).toEqual(CROSS_SITE);
    const patch = await raw(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: JSON.stringify({ done: true }), headers: { ...json, origin: EVIL }, as: "alex" });
    expect(patch.status).toBe(403);
    const profile = await raw(ref.fw, profileUrl("alex"), {
      method: "PUT",
      body: JSON.stringify({ displayName: "Forged", email: "forged@example.test", bio: "", timeZone: "UTC" }),
      headers: { ...json, origin: "null" },
      as: "alex",
    });
    expect(profile.status).toBe(403);
    // No Origin, but the browser says the request is cross-site.
    const fetchMeta = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Forged task" }), headers: { ...json, "sec-fetch-site": "cross-site" }, as: "alex" });
    expect(fetchMeta.status).toBe(403);
    expect((await alexTasks(ref.fw)).length).toBe(before);
    expect((await alexTask(ref.fw, "task-wireframes"))?.done).toBe(false);
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.displayName).toBe("Alex Rivera");
  });

  it("the app's own origin, or no Origin at all (curl, a server), is fine; reads are never checked", async () => {
    const own = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Same-site task" }), headers: { "content-type": "application/json", origin: ref.fw.url }, as: "alex" });
    expect(own.status).toBe(201);
    const none = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Server task" }), headers: { "content-type": "application/json" }, as: "alex" });
    expect(none.status).toBe(201);
    expect((await raw(ref.fw, "/api/tasks", { method: "GET", headers: { origin: EVIL }, as: "alex" })).status).toBe(200);
  });

  it("the task save takes JSON only: a form-encoded or text/plain body answers 415 (a cross-site page can only send those)", async () => {
    const before = (await alexTasks(ref.fw)).length;
    const form = await raw(ref.fw, "/api/tasks", { body: "title=Form+task&projectId=", headers: { "content-type": "application/x-www-form-urlencoded", origin: ref.fw.url }, as: "alex" });
    expect(form.status).toBe(415);
    expect(typeof form.body.errors.body).toBe("string");
    const text = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Text task" }), headers: { "content-type": "text/plain", origin: ref.fw.url }, as: "alex" });
    expect(text.status).toBe(415);
    const patch = await raw(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: "done=true", headers: { "content-type": "application/x-www-form-urlencoded" }, as: "alex" });
    expect(patch.status).toBe(415);
    expect((await alexTasks(ref.fw)).length).toBe(before);
  });

  it("a real page on another site, in Alex's signed-in browser, can't create a task (the Lax cookie stays home)", async () => {
    const context = await (await getBrowser()).newContext();
    try {
      await browserSignIn(ref.fw, context);
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "fernway_session")).toMatchObject({ domain: "127.0.0.1", sameSite: "Lax", httpOnly: true, secure: false });
      await forgeTaskFromAnotherSite(ref.fw, context, "Forged from another site rh9999");
      expect((await alexTasks(ref.fw)).map((t) => t.title)).not.toContain("Forged from another site rh9999");
    } finally {
      await context.close();
    }
  });
});

// ---- clean mode: the plan ------------------------------------------------------------------------

describe("the plan and the local test checkout (clean mode)", () => {
  const ref = useFernway("none");

  const checkout = async (as: "alex" | "sam" = "alex", body: Record<string, unknown> = { plan: "pro" }) => api(ref.fw, "/api/billing/checkout", { body, as });
  const pay = (id: string, as: "alex" | "sam" = "alex") => api(ref.fw, `/api/billing/checkout/${id}/pay`, { method: "POST", as });
  const confirm = (body: Record<string, unknown>, as: "alex" | "sam" = "alex") => api(ref.fw, "/api/billing/confirm", { body, as });

  it("Alex starts on the Free plan", async () => {
    expect(await alexPlan(ref.fw)).toBe("free");
  });

  it("the server sets the price: an amount or price the client sends is ignored; an unknown plan answers 400", async () => {
    const res = await checkout("alex", { plan: "pro", amount: 0, price: 0, currency: "jpy" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.stringMatching(new RegExp(`^chk_${UUID}$`)), plan: "pro", amount: 1200, currency: "usd", status: "open" });
    expect((await checkout("alex", { plan: "enterprise" })).status).toBe(400);
    expect((await checkout("alex", {})).status).toBe(400);
    expect(await alexPlan(ref.fw)).toBe("free");
  });

  it("confirming grants nothing without a server-recorded payment: no checkout, an unpaid one, or Sam's paid one", async () => {
    expect((await confirm({})).body).toEqual({ confirmed: false, plan: "free" });
    expect((await confirm({ checkout: "chk_made_up" })).body).toEqual({ confirmed: false, plan: "free" });
    const open = await checkout();
    expect((await confirm({ checkout: open.body.id })).body).toEqual({ confirmed: false, plan: "free" });
    const sams = await checkout("sam");
    expect((await pay(sams.body.id, "sam")).body.status).toBe("paid");
    expect((await confirm({ checkout: sams.body.id })).body).toEqual({ confirmed: false, plan: "free" });
    // Alex can't pay Sam's checkout either.
    expect((await pay(sams.body.id)).status).toBe(404);
    expect(await alexPlan(ref.fw)).toBe("free");
  });

  it("a paid checkout grants Pro once; confirming it again grants nothing new; cancel goes back to Free for good", async () => {
    const started = await checkout();
    expect((await pay(started.body.id)).body).toMatchObject({ id: started.body.id, status: "paid" });
    expect((await confirm({ checkout: started.body.id })).body).toEqual({ confirmed: true, plan: "pro" });
    expect(await alexPlan(ref.fw)).toBe("pro");
    expect((await confirm({ checkout: started.body.id })).body).toEqual({ confirmed: true, plan: "pro" });
    expect((await api(ref.fw, "/api/billing/cancel", { method: "POST", as: "alex" })).body).toEqual({ plan: "free" });
    expect(await alexPlan(ref.fw)).toBe("free");
    // The used checkout can't grant Pro a second time.
    expect((await confirm({ checkout: started.body.id })).body).toEqual({ confirmed: true, plan: "free" });
    expect(await alexPlan(ref.fw)).toBe("free");
  });

  it("every billing endpoint needs a session (401), and the profile still never takes plan from a client", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/checkout/chk_x/pay", "/api/billing/confirm", "/api/billing/cancel"]) {
      const res = await api(ref.fw, path, { body: { plan: "pro" } });
      expect(res.status, path).toBe(401);
      expect(res.body, path).toEqual(SIGN_IN_FIRST);
    }
    const put = await api(ref.fw, profileUrl("alex"), {
      method: "PUT",
      body: { displayName: "Alex Rivera", email: "alex@fernway.test", bio: "", timeZone: "UTC", plan: "pro" },
      as: "alex",
    });
    expect(put.status).toBe(200);
    expect(put.body.plan).toBe("free");
  });

  it("opening /app/upgraded by hand shows 'No payment to confirm' and Alex stays on Free (no failing request)", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/upgraded", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Your upgrade" }).waitFor();
      await page.getByRole("heading", { level: 2, name: "No payment to confirm" }).waitFor();
      expect(await page.getByRole("status").filter({ hasText: "your account is on the Free plan" }).count()).toBe(1);
      expect(await page.title()).toBe("Fernway: Upgrade");
      expect(events.badResponses).toEqual([]);
      expect(events.consoleErrors).toEqual([]);
      const confirms = events.requests.filter((r) => new URL(r.url()).pathname === "/api/billing/confirm");
      expect(confirms).toHaveLength(1);
      expect(JSON.parse(confirms[0]!.postData() ?? "{}")).toEqual({ checkout: null });
      expect(await alexPlan(ref.fw)).toBe("free");
    } finally {
      await close();
    }
  });

  it("the Billing tab links to /app/upgraded, and Upgrade to Pro, Pay and the success page make Alex Pro; Switch back to Free undoes it", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/settings", { as: "alex", reducedMotion: "reduce" });
    try {
      await page.getByRole("tab", { name: "Billing" }).click();
      const panel = page.getByRole("tabpanel", { name: "Billing" });
      await panel.getByRole("heading", { level: 2, name: /Free plan/ }).waitFor();
      expect(await panel.getByRole("link", { name: "Already paid? Refresh your plan" }).getAttribute("href")).toBe("/app/upgraded");
      // The link is in the page on load (the Billing panel stays mounted), where Run Hound's paywall-trust finds it.
      expect(await page.locator('a[href="/app/upgraded"]').count()).toBe(1);

      await panel.getByRole("button", { name: "Upgrade to Pro" }).click();
      const dialog = page.getByRole("dialog", { name: "Test checkout" });
      await dialog.waitFor();
      expect(await dialog.getByText("$12.00").count()).toBeGreaterThan(0);
      await dialog.getByRole("button", { name: "Pay $12.00" }).click();
      await page.waitForURL(new RegExp(`/app/upgraded\\?checkout=chk_${UUID}$`));
      await page.getByRole("heading", { level: 2, name: "Pro is active" }).waitFor();
      expect(await alexPlan(ref.fw)).toBe("pro");

      await page.getByRole("link", { name: "Back to billing" }).click();
      const billing = page.getByRole("tabpanel", { name: "Billing" });
      await billing.getByRole("heading", { level: 2, name: /Pro plan/ }).waitFor();
      await billing.getByRole("button", { name: "Switch back to Free" }).click();
      await billing.getByRole("status").filter({ hasText: "back on the Free plan" }).waitFor();
      await billing.getByRole("heading", { level: 2, name: /Free plan/ }).waitFor();
      expect(await alexPlan(ref.fw)).toBe("free");
      expect(events.badResponses).toEqual([]);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });
});

// ---- the SPA sends the task update Run Hound observes ------------------------------------------

describe("Quick add sends the task update the app itself uses (clean mode)", () => {
  const ref = useFernway("none");

  it("adding a task is POST /api/tasks, then PATCH /api/tasks/<new id> with the whole task; the Today checkbox sends it too", async () => {
    const { page, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      const writes: { method: string; path: string; body: unknown }[] = [];
      page.on("request", (req) => {
        const path = new URL(req.url()).pathname;
        if (req.method() !== "GET" && path.startsWith("/api/tasks")) writes.push({ method: req.method(), path, body: JSON.parse(req.postData() ?? "null") });
      });
      const form = page.getByRole("form", { name: "Quick add" });
      await form.getByRole("textbox", { name: "Task" }).fill("Send the moodboard");
      await form.getByRole("button", { name: "Add task" }).click();
      await page.getByRole("list", { name: "Today" }).getByText("Send the moodboard").waitFor();
      const task = (await alexTasks(ref.fw)).find((t) => t.title === "Send the moodboard")!;
      await expect.poll(() => writes.length).toBe(2);
      expect(writes).toEqual([
        { method: "POST", path: "/api/tasks", body: { title: "Send the moodboard", projectId: "" } },
        { method: "PATCH", path: `/api/tasks/${task.id}`, body: { title: "Send the moodboard", projectId: "", done: false } },
      ]);
      await page.getByRole("list", { name: "Today" }).getByRole("checkbox", { name: "Send the moodboard" }).click();
      await expect.poll(() => writes.length).toBe(3);
      expect(writes[2]).toEqual({ method: "PATCH", path: `/api/tasks/${task.id}`, body: { title: "Send the moodboard", projectId: "", done: true } });
    } finally {
      await close();
    }
  });
});

// ---- V06 ------------------------------------------------------------------------------------------

describe("V06: PATCH /api/tasks/:id updates another user's task", () => {
  const ref = useFernway("V06");

  it("Sam changes, and marks done, Alex's own test task: Alex's re-read shows it; putting the old values back restores it", async () => {
    const task = await alexCreatesTask(ref.fw);
    const res = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { title: "Changed by Sam rh1234v06", projectId: "northwind-rebrand", done: true }, as: "sam" });
    expect(res.status).toBe(200);
    expect(await alexTask(ref.fw, task.id)).toMatchObject({ title: "Changed by Sam rh1234v06", done: true });
    // Alex's project stays valid for Alex's task (the task's own workspace decides), and Sam's list never shows it.
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "sam" })).body.map((t) => t.id)).not.toContain(task.id);
    // The restore Run Hound does: Alex's own update with the snapshot's values.
    await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { title: task.title, projectId: task.projectId, done: task.done }, as: "alex" });
    expect(await alexTask(ref.fw, task.id)).toEqual(task);
  });

  it("changes only that: without a session it is still 401, reads stay scoped, and the Origin check still holds", async () => {
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true } })).status).toBe(401);
    expect((await api<Task[]>(ref.fw, "/api/tasks", { as: "sam" })).body.map((t) => t.id)).not.toContain("task-wireframes");
    expect((await api(ref.fw, "/api/projects/northwind-rebrand", { method: "PATCH", body: { archived: true }, as: "sam" })).status).toBe(404);
    const forged = await raw(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: JSON.stringify({ done: true }), headers: { "content-type": "application/json", origin: EVIL }, as: "sam" });
    expect(forged.status).toBe(403);
    expect((await alexTask(ref.fw, "task-wireframes"))?.done).toBe(false);
  });
});

// ---- V07 ------------------------------------------------------------------------------------------

describe("V07: writes to /api/tasks/:id work without a session", () => {
  const ref = useFernway("V07");

  it("a request with no session changes Alex's task; Alex's re-read shows it", async () => {
    const task = await alexCreatesTask(ref.fw);
    const res = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { title: "Changed by nobody rh1234v07", projectId: "", done: false } });
    expect(res.status).toBe(200);
    expect((await alexTask(ref.fw, task.id))?.title).toBe("Changed by nobody rh1234v07");
    // A signed-out visitor's cookie (from a page load) is no session either.
    const visitor = (await fetch(`${ref.fw.url}/`)).headers.get("set-cookie")!.split(";")[0]!;
    const again = await api(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: { done: true }, headers: { cookie: visitor } });
    expect(again.status).toBe(200);
    expect((await alexTask(ref.fw, task.id))?.done).toBe(true);
  });

  it("changes only that: Sam still gets 404 for Alex's task, reads and creates still need a session", async () => {
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true }, as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, "/api/tasks")).status).toBe(401);
    expect((await api(ref.fw, "/api/tasks", { body: { title: "Signed-out task" } })).status).toBe(401);
    expect((await api(ref.fw, "/api/tasks/no-such-task", { method: "PATCH", body: { done: true } })).status).toBe(404);
    expect((await alexTask(ref.fw, "task-wireframes"))?.done).toBe(false);
  });
});

// ---- V08 ------------------------------------------------------------------------------------------

describe("V08: SameSite=None cookie, and the task save takes a form post with no Origin check", () => {
  const ref = useFernway("V08");

  it("the session cookie is SameSite=None; Secure on a loopback host, and SameSite=Lax anywhere else", async () => {
    const login = await fetch(`${ref.fw.url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password }),
    });
    expect(login.headers.get("set-cookie")).toMatch(new RegExp(`^fernway_session=${UUID}; Path=/; HttpOnly; SameSite=None; Secure$`));
    expect((await fetch(`${ref.fw.url}/`)).headers.get("set-cookie")).toMatch(/; SameSite=None; Secure$/);
    const app = createApp({ bugs: new Set(["V08"]), modules: [] });
    expect(app.ctx.sessionCookie("abc", "localhost:4110")).toBe("fernway_session=abc; Path=/; HttpOnly; SameSite=None; Secure");
    expect(app.ctx.sessionCookie("abc", "fernway-bugs:4110")).toBe("fernway_session=abc; Path=/; HttpOnly; SameSite=Lax");
    expect(app.ctx.clearSessionCookie("[::1]:4110")).toBe("fernway_session=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0");
    const both = createApp({ bugs: new Set(["V08", "W09"]), modules: [] });
    expect(both.ctx.sessionCookie("abc", "127.0.0.1")).toBe("fernway_session=abc; Path=/; SameSite=None; Secure");
    expect([isLoopbackHost("localhost"), isLoopbackHost("app.localhost:80"), isLoopbackHost("127.0.0.5:1"), isLoopbackHost("[::1]:3000")]).toEqual([true, true, true, true]);
    expect([isLoopbackHost("fernway:4110"), isLoopbackHost("192.168.1.2"), isLoopbackHost(undefined), isLoopbackHost("localhost.example")]).toEqual([false, false, false, false]);
  });

  it("with Alex's cookie, a form-encoded task save from another origin is stored; other writes keep the Origin check", async () => {
    const res = await raw(ref.fw, "/api/tasks", { body: "title=Forged+rh1234csrf&projectId=", headers: { "content-type": "application/x-www-form-urlencoded", origin: EVIL }, as: "alex" });
    expect(res.status).toBe(201);
    expect((await alexTasks(ref.fw)).map((t) => t.title)).toContain("Forged rh1234csrf");
    // JSON sent as text/plain (the other no-preflight body) works too.
    const text = await raw(ref.fw, "/api/tasks", { body: JSON.stringify({ title: "Text rh1234csrf" }), headers: { "content-type": "text/plain", origin: EVIL }, as: "alex" });
    expect(text.status).toBe(201);
    const task = await alexCreatesTask(ref.fw);
    const patch = await raw(ref.fw, `/api/tasks/${task.id}`, { method: "PATCH", body: "done=true", headers: { "content-type": "application/x-www-form-urlencoded", origin: EVIL }, as: "alex" });
    expect(patch.status).toBe(200);
    expect((await alexTask(ref.fw, task.id))?.done).toBe(true);
    const profile = await raw(ref.fw, profileUrl("alex"), {
      method: "PUT",
      body: JSON.stringify({ displayName: "Forged", email: "forged@example.test", bio: "", timeZone: "UTC" }),
      headers: { "content-type": "application/json", origin: EVIL },
      as: "alex",
    });
    expect(profile.status).toBe(403);
    // Still no write without a session.
    expect((await raw(ref.fw, "/api/tasks", { body: "title=Nobody", headers: { "content-type": "application/x-www-form-urlencoded", origin: EVIL } })).status).toBe(401);
  });

  it("a real page on another site, in Alex's signed-in browser, creates a task in Alex's workspace", async () => {
    const context = await (await getBrowser()).newContext();
    try {
      await browserSignIn(ref.fw, context);
      // Chromium keeps the Secure cookie on http://127.0.0.1 (a loopback host) and will send it cross-site. (Playwright's
      // context.cookies(url) leaves a Secure cookie out for an http 127.0.0.1 URL, so every cookie is read.)
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "fernway_session")).toMatchObject({ domain: "127.0.0.1", sameSite: "None", secure: true, httpOnly: true });
      await forgeTaskFromAnotherSite(ref.fw, context, "Forged from another site rh9999");
      expect((await alexTasks(ref.fw)).map((t) => t.title)).toContain("Forged from another site rh9999");
      // The session still works for Fernway's own pages.
      const { page, close } = await openPage(ref.fw, "/app", { storageState: await context.storageState() });
      try {
        await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      } finally {
        await close();
      }
    } finally {
      await context.close();
    }
  });
});

// ---- V09 ------------------------------------------------------------------------------------------

describe("V09: /app/upgraded grants Pro on load", () => {
  const ref = useFernway("V09");

  it("opening /app/upgraded, with no checkout and no payment, makes Alex Pro; Switch back to Free restores it", async () => {
    expect(await alexPlan(ref.fw)).toBe("free");
    const { page, events, close } = await openPage(ref.fw, "/app/upgraded", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 2, name: "Pro is active" }).waitFor();
      expect(await alexPlan(ref.fw)).toBe("pro");
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
    expect((await api(ref.fw, "/api/billing/cancel", { method: "POST", as: "alex" })).body).toEqual({ plan: "free" });
    expect(await alexPlan(ref.fw)).toBe("free");
  });

  it("the confirm endpoint alone grants it, for whoever calls it; still not without a session, and Sam's plan is untouched", async () => {
    expect((await api(ref.fw, "/api/billing/confirm", { body: { checkout: null }, as: "alex" })).body).toEqual({ confirmed: true, plan: "pro" });
    expect((await api(ref.fw, profileUrl("sam"), { as: "sam" })).body.plan).toBe("free");
    expect((await api(ref.fw, "/api/billing/confirm", { body: {} })).status).toBe(401);
    // The profile's allowlist is V04's business, not V09's.
    await api(ref.fw, "/api/billing/cancel", { method: "POST", as: "alex" });
    const put = await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { displayName: "Alex Rivera", email: "alex@fernway.test", bio: "", timeZone: "UTC", plan: "pro" }, as: "alex" });
    expect(put.body.plan).toBe("free");
  });
});

// ---- bugs.json ------------------------------------------------------------------------------------

describe("bugs.json names V06-V09 with the check and page that catch each", () => {
  it("lists each once, as the spec's table says", () => {
    const bugs = JSON.parse(readFileSync(join(FERNWAY_ROOT, "bugs.json"), "utf8")).bugs as Record<string, unknown>[];
    const pick = (id: string) => {
      const b = bugs.find((x) => x.id === id)!;
      return { detectedBy: b.detectedBy, scenario: b.scenario, page: b.page, version: b.version, category: b.category };
    };
    expect(pick("V06")).toEqual({ detectedBy: "write-access", scenario: "write-access:other-account", page: "/app", version: "V2", category: "security" });
    expect(pick("V07")).toEqual({ detectedBy: "write-access", scenario: "write-access:signed-out", page: "/app", version: "V2", category: "security" });
    expect(pick("V08")).toEqual({ detectedBy: "csrf", scenario: undefined, page: "/app", version: "V2", category: "security" });
    expect(pick("V09")).toEqual({ detectedBy: "paywall-trust", scenario: undefined, page: "/app/settings", version: "V2", category: "security" });
    expect(bugs.map((b) => b.id)).toEqual(["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10", "V01", "V02", "V03", "V04", "V05", "V06", "V07", "V08", "V09"]);
  });
});
