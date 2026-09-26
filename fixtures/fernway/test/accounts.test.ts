/**
 * Fernway V2 (docs/v2-spec.md "Fernway V2", CONTRACT.md "Accounts" and "V2 planted bugs"): two real accounts (Alex and
 * Sam) with a workspace each, GET /api/me, sign-up / demo sign-in / sign-out, every workspace API behind a session and
 * scoped to the session user (401 signed out, 404 for another user's ids), the profile's field allowlist, the SPA's
 * redirect to /login?next=<path>, and each of V01-V05 on versus off.
 */
import type { Page } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  api,
  closeBrowser,
  CSP,
  openPage,
  profileUrl,
  sessionIdOf,
  signIn,
  useFernway,
  type Fernway,
} from "./support.js";

afterAll(closeBrowser);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_RE = new RegExp(`^fernway_session=(${UUID}); Path=/; HttpOnly; SameSite=Lax$`);
const SIGN_IN_FIRST = { error: "Sign in to continue" };
const NOT_FOUND = { error: "Not found" };

const ALEX_PROJECTS = ["Northwind rebrand", "Atlas mobile app", "Juniper website refresh", "Harbor & Co. launch video", "Maple Studio brand book", "Q3 client reporting"];
const SAM_PROJECTS = ["Bramble Bakery identity", "Metro Line trip planner", "Harbour Museum website", "Night Shift podcast artwork", "Greenway annual report", "Invoicing clean-up"];
const ALEX_TASK_IDS = ["task-wireframes", "task-sprint-notes", "task-palette"];
const SAM_TASK_IDS = ["task-bramble-sketches", "task-offline-mode", "task-print-proofs"];
const PROFILE_KEYS = ["avatar", "bio", "displayName", "email", "id", "plan", "role", "timeZone"];

const NEW_USER = { name: "Maya Patel", email: "maya@juniper.test", password: "Tr0ub4dor&3-horse", company: "Juniper Studio", terms: true };
const validProfile = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Alex R.",
  email: "alex.rivera@example.test",
  bio: "Plans projects at Fernway.",
  timeZone: "Europe/London",
  ...overrides,
});
/** What Run Hound's mass-assignment check adds to a save (docs/v2-spec.md "mass-assignment"). */
const PRIVILEGE_FIELDS = { role: "admin", isAdmin: true, is_admin: true, admin: true, plan: "pro", tier: "pro", credits: 999999, verified: true, emailVerified: true };

/** Every workspace endpoint, with a body that would succeed signed in (as Alex). */
const WORKSPACE_CALLS: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/projects" },
  { method: "POST", path: "/api/projects", body: { name: "Signed-out project" } },
  { method: "PATCH", path: "/api/projects/northwind-rebrand", body: { archived: true } },
  { method: "GET", path: "/api/members" },
  { method: "GET", path: "/api/tasks" },
  { method: "POST", path: "/api/tasks", body: { title: "Signed-out task" } },
  { method: "PATCH", path: "/api/tasks/task-wireframes", body: { done: true } },
  { method: "GET", path: "/api/users/alex-rivera/profile" },
  { method: "PUT", path: "/api/users/alex-rivera/profile", body: { displayName: "Nobody", email: "nobody@example.test", bio: "", timeZone: "UTC" } },
  { method: "GET", path: "/api/notifications" },
  { method: "PATCH", path: "/api/notifications", body: { mentions: false } },
];

const names = (list: { name: string }[]) => list.map((p) => p.name);
const ids = (list: { id: string }[]) => list.map((t) => t.id);

/** Alex's workspace as the API shows it to Alex: nothing a signed-out or other-account call may have changed. */
async function expectAlexUntouched(fw: Fernway) {
  expect(names((await api(fw, "/api/projects", { as: "alex" })).body)).toEqual(ALEX_PROJECTS);
  expect(ids((await api(fw, "/api/tasks", { as: "alex" })).body)).toEqual(ALEX_TASK_IDS);
  expect((await api(fw, "/api/tasks", { as: "alex" })).body.find((t: { id: string }) => t.id === "task-wireframes").done).toBe(false);
  expect((await api(fw, profileUrl("alex"), { as: "alex" })).body).toMatchObject({ displayName: "Alex Rivera", email: "alex@fernway.test", role: "member", plan: "free" });
  expect((await api(fw, "/api/notifications", { as: "alex" })).body.mentions).toBe(true);
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

// ---- sessions ---------------------------------------------------------------------------------------

describe("accounts and sessions (clean mode)", () => {
  const ref = useFernway("none");

  it("GET /api/me answers the session user with the workspace name, and 401 without a session", async () => {
    const nobody = await api(ref.fw, "/api/me");
    expect(nobody.status).toBe(401);
    expect(nobody.body).toEqual(SIGN_IN_FIRST);
    expect((await api(ref.fw, "/api/me", { as: "alex" })).body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", workspace: "Rivera Studio" });
    expect((await api(ref.fw, "/api/me", { as: "sam" })).body).toEqual({ id: "sam-okafor", name: "Sam Okafor", email: "sam@fernway.test", workspace: "Okafor & Co" });
    // A visitor's cookie from the first page load signs nobody in.
    const visitor = (await fetch(`${ref.fw.url}/`)).headers.get("set-cookie")!.split(";")[0]!;
    expect((await api(ref.fw, "/api/me", { headers: { cookie: visitor } })).status).toBe(401);
    expect((await api(ref.fw, "/api/me", { headers: { cookie: "fernway_session=not-a-session" } })).status).toBe(401);
  });

  it("Sam signs in with his own password (and not with Alex's)", async () => {
    const res = await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.sam.email, password: ACCOUNTS.sam.password } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "sam-okafor", name: "Sam Okafor", email: "sam@fernway.test" });
    expect(res.headers.get("set-cookie")).toMatch(SESSION_RE);
    expect((await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.sam.email, password: ACCOUNTS.alex.password } })).status).toBe(401);
  });

  it("POST /api/login/demo signs in as Alex with a new session; no password goes either way", async () => {
    const res = await api(ref.fw, "/api/login/demo", { method: "POST", body: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test" });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(SESSION_RE);
    expect(JSON.stringify(res.body)).not.toContain(ACCOUNTS.alex.password);
    const me = await api(ref.fw, "/api/me", { headers: { cookie: `fernway_session=${sessionIdOf(setCookie)}` } });
    expect(me.body.id).toBe("alex-rivera");
    // Each call is a new session (never a replayed one).
    const again = await api(ref.fw, "/api/login/demo", { method: "POST", body: {}, headers: { "idempotency-key": "demo-1" } });
    const third = await api(ref.fw, "/api/login/demo", { method: "POST", body: {}, headers: { "idempotency-key": "demo-1" } });
    expect(sessionIdOf(third.headers.get("set-cookie"))).not.toBe(sessionIdOf(again.headers.get("set-cookie")));
  });

  it("POST /api/logout ends the session and removes the cookie; it works signed out too", async () => {
    const cookie = await signIn(ref.fw, "alex");
    expect((await api(ref.fw, "/api/me", { headers: { cookie } })).status).toBe(200);
    const res = await api(ref.fw, "/api/logout", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBe("fernway_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    expect((await api(ref.fw, "/api/me", { headers: { cookie } })).status).toBe(401);
    expect((await api(ref.fw, "/api/projects", { headers: { cookie } })).status).toBe(401);
    // Other sessions of the same user are not affected.
    expect((await api(ref.fw, "/api/me", { as: "alex" })).status).toBe(200);
    expect((await api(ref.fw, "/api/logout", { method: "POST" })).status).toBe(204);
  });

  it("sign-up creates a user with an empty workspace and signs them in", async () => {
    const res = await api(ref.fw, "/api/signup", { body: NEW_USER });
    expect(res.status).toBe(201);
    const cookie = `fernway_session=${sessionIdOf(res.headers.get("set-cookie"))}`;
    const me = await api(ref.fw, "/api/me", { headers: { cookie } });
    expect(me.body).toEqual({ id: res.body.id, name: "Maya Patel", email: "maya@juniper.test", workspace: "Juniper Studio" });
    expect((await api(ref.fw, "/api/projects", { headers: { cookie } })).body).toEqual([]);
    expect((await api(ref.fw, "/api/tasks", { headers: { cookie } })).body).toEqual([]);
    expect((await api(ref.fw, "/api/members", { headers: { cookie } })).body).toEqual([
      { id: res.body.id, name: "Maya Patel", email: "maya@juniper.test", role: "Owner", avatar: null },
    ]);
    expect((await api(ref.fw, `/api/users/${res.body.id}/profile`, { headers: { cookie } })).body).toEqual({
      id: res.body.id,
      displayName: "Maya Patel",
      email: "maya@juniper.test",
      bio: "",
      timeZone: "UTC",
      avatar: null,
      role: "member",
      plan: "free",
    });
    // Her workspace works like anyone's: a project she creates is hers.
    const created = await api(ref.fw, "/api/projects", { body: { name: "Kickoff" }, headers: { cookie } });
    expect(created.status).toBe(201);
    expect(created.body.ownerId).toBe(res.body.id);
    expect(names((await api(ref.fw, "/api/projects", { headers: { cookie } })).body)).toEqual(["Kickoff"]);
    await expectAlexUntouched(ref.fw);
    // Without a company, the workspace is named after her.
    const solo = await api(ref.fw, "/api/signup", { body: { ...NEW_USER, email: "solo@juniper.test", company: "" } });
    const soloMe = await api(ref.fw, "/api/me", { headers: { cookie: `fernway_session=${sessionIdOf(solo.headers.get("set-cookie"))}` } });
    expect(soloMe.body.workspace).toBe("Maya's workspace");
  });

  it("POST /api/onboarding renames the signed-in user's workspace; signed out it only creates the setup", async () => {
    const setup = { workspaceName: "Rivera & Friends", slug: "rivera-friends", useCase: "client", invites: [] };
    expect((await api(ref.fw, "/api/onboarding", { body: setup })).status).toBe(201);
    expect((await api(ref.fw, "/api/me", { as: "alex" })).body.workspace).toBe("Rivera Studio");
    expect((await api(ref.fw, "/api/onboarding", { body: { ...setup, slug: "rivera-friends-2" }, as: "alex" })).status).toBe(201);
    expect((await api(ref.fw, "/api/me", { as: "alex" })).body.workspace).toBe("Rivera & Friends");
    expect((await api(ref.fw, "/api/me", { as: "sam" })).body.workspace).toBe("Okafor & Co");
    await ref.fw.reset();
    expect((await api(ref.fw, "/api/me", { as: "alex" })).body.workspace).toBe("Rivera Studio");
  });
});

// ---- the workspace API: sessions, isolation, ownership ------------------------------------------------

describe("workspace API needs a session and only shows your own workspace (clean mode)", () => {
  const ref = useFernway("none");

  it.each(WORKSPACE_CALLS)("$method $path answers 401 without a session, and changes nothing", async ({ method, path, body }) => {
    for (const headers of [{}, { cookie: "fernway_session=not-a-session" }] as Record<string, string>[]) {
      const res = await api(ref.fw, path, { method, body, headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.body).toEqual(SIGN_IN_FIRST);
    }
    await expectAlexUntouched(ref.fw);
  });

  it("the old /api/profile is gone (404)", async () => {
    expect((await api(ref.fw, "/api/profile", { as: "alex" })).status).toBe(404);
    expect((await api(ref.fw, "/api/profile", { method: "PUT", body: validProfile(), as: "alex" })).status).toBe(404);
  });

  it("Alex and Sam each see only their own projects, tasks, members, profile and settings", async () => {
    expect(names((await api(ref.fw, "/api/projects", { as: "alex" })).body)).toEqual(ALEX_PROJECTS);
    expect(names((await api(ref.fw, "/api/projects", { as: "sam" })).body)).toEqual(SAM_PROJECTS);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "alex" })).body)).toEqual(ALEX_TASK_IDS);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toEqual(SAM_TASK_IDS);
    const alexTeam = (await api(ref.fw, "/api/members", { as: "alex" })).body;
    const samTeam = (await api(ref.fw, "/api/members", { as: "sam" })).body;
    expect(alexTeam).toHaveLength(8);
    expect(samTeam.map((m: { id: string }) => m.id)).toEqual(["sam-okafor", "lena-brandt", "tomas-silva", "ruth-mensah", "kenji-ito"]);
    expect((await api(ref.fw, profileUrl("sam"), { as: "sam" })).body).toMatchObject({ id: "sam-okafor", displayName: "Sam Okafor", avatar: null, role: "member", plan: "free" });

    // Nothing Sam can read names Alex, and the other way round.
    for (const path of ["/api/me", "/api/projects", "/api/tasks", "/api/members", profileUrl("sam"), "/api/notifications"]) {
      const text = JSON.stringify((await api(ref.fw, path, { as: "sam" })).body).toLowerCase();
      expect(text, path).not.toContain("alex");
      expect(text, path).not.toContain("rivera");
    }
    for (const path of ["/api/me", "/api/projects", "/api/tasks", "/api/members", profileUrl("alex"), "/api/notifications"]) {
      expect(JSON.stringify((await api(ref.fw, path, { as: "alex" })).body), path).not.toContain("sam@fernway.test");
    }
  });

  it("what Alex creates or changes stays in Alex's workspace", async () => {
    const project = await api(ref.fw, "/api/projects", { body: { name: "Alex only" }, as: "alex" });
    const task = await api(ref.fw, "/api/tasks", { body: { title: "Alex's secret task", projectId: "northwind-rebrand" }, as: "alex" });
    expect([project.status, task.status]).toEqual([201, 201]);
    await api(ref.fw, "/api/notifications", { method: "PATCH", body: { mentions: false }, as: "alex" });
    await api(ref.fw, profileUrl("alex"), { method: "PUT", body: validProfile({ bio: "Alex's new bio" }), as: "alex" });

    expect(names((await api(ref.fw, "/api/projects", { as: "sam" })).body)).toEqual(SAM_PROJECTS);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toEqual(SAM_TASK_IDS);
    expect((await api(ref.fw, "/api/notifications", { as: "sam" })).body.mentions).toBe(true);
    expect((await api(ref.fw, profileUrl("sam"), { as: "sam" })).body.bio).not.toContain("Alex");
    expect(names((await api(ref.fw, "/api/projects", { as: "alex" })).body)).toContain("Alex only");
  });

  it("another user's ids answer 404 (read or write), and nothing of theirs changes", async () => {
    // Sam reading or writing Alex's profile.
    const read = await api(ref.fw, profileUrl("alex"), { as: "sam" });
    expect(read.status).toBe(404);
    expect(read.body).toEqual(NOT_FOUND);
    expect((await api(ref.fw, profileUrl("alex"), { method: "PUT", body: validProfile({ displayName: "Sam was here" }), as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, "/api/users/nobody/profile", { as: "sam" })).status).toBe(404);
    // Sam changing Alex's project or task.
    expect((await api(ref.fw, "/api/projects/northwind-rebrand", { method: "PATCH", body: { archived: true }, as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true }, as: "sam" })).status).toBe(404);
    // Alex's projects and people are not choices in Sam's workspace.
    const task = await api(ref.fw, "/api/tasks", { body: { title: "Borrowed project", projectId: "northwind-rebrand" }, as: "sam" });
    expect(task.status).toBe(400);
    expect(task.body.errors.projectId).toBe("Choose a project from the list.");
    const project = await api(ref.fw, "/api/projects", { body: { name: "Borrowed owner", ownerId: "priya-shah" }, as: "sam" });
    expect(project.status).toBe(400);
    expect(project.body.errors.ownerId).toBe("Choose an owner from your team.");
    await expectAlexUntouched(ref.fw);
  });

  it("the profile's field allowlist: role, plan and every other key are ignored, and GET never shows them", async () => {
    const res = await api(ref.fw, profileUrl("alex"), {
      method: "PUT",
      body: { ...validProfile(), ...PRIVILEGE_FIELDS, id: "sam-okafor", avatar: 3 },
      as: "alex",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...validProfile(), id: "alex-rivera", avatar: 0, role: "member", plan: "free" });
    const stored = (await api(ref.fw, profileUrl("alex"), { as: "alex" })).body;
    expect(Object.keys(stored).sort()).toEqual(PROFILE_KEYS);
    expect(stored).toMatchObject({ role: "member", plan: "free" });
    // A save with only privilege fields fails validation (the 4 fields are required) and changes nothing.
    expect((await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { role: "admin" }, as: "alex" })).status).toBe(400);
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.role).toBe("member");
  });

  it("an Idempotency-Key never replays one user's answer to another", async () => {
    const headers = { "idempotency-key": "shared-key-1" };
    const a = await api(ref.fw, "/api/tasks", { body: { title: "Same key" }, headers, as: "alex" });
    const b = await api(ref.fw, "/api/tasks", { body: { title: "Same key" }, headers, as: "sam" });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).not.toBe(a.body.id);
    expect(b.headers.get("idempotent-replayed")).toBeNull();
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toContain(b.body.id);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).not.toContain(a.body.id);
  });

  it("an Idempotency-Key never hands one visitor's sign-up (and its session) to another visitor", async () => {
    const visitor = async () => (await fetch(`${ref.fw.url}/`)).headers.get("set-cookie")!.split(";")[0]!;
    const [one, two] = [await visitor(), await visitor()];
    expect(one).not.toBe(two);
    const headers = { "idempotency-key": "signup-shared-key" };
    const first = await api(ref.fw, "/api/signup", { body: NEW_USER, headers: { ...headers, cookie: one } });
    expect(first.status).toBe(201);
    const session = sessionIdOf(first.headers.get("set-cookie"));
    expect(session).not.toBeNull();

    const second = await api(ref.fw, "/api/signup", { body: NEW_USER, headers: { ...headers, cookie: two } });
    expect(second.headers.get("idempotent-replayed")).toBeNull();
    expect(second.status).toBe(409);
    expect(second.headers.get("set-cookie")).toBeNull();

    // The first visitor's double click still gets its own answer again.
    const again = await api(ref.fw, "/api/signup", { body: NEW_USER, headers: { ...headers, cookie: one } });
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(sessionIdOf(again.headers.get("set-cookie"))).toBe(session);
  });

  it("the same account signed in twice: a key from one session never replays into the other", async () => {
    const [first, second] = [await signIn(ref.fw, "alex"), await signIn(ref.fw, "alex")];
    const headers = { "idempotency-key": "alex-two-browsers" };
    const a = await api(ref.fw, "/api/tasks", { body: { title: "From the laptop" }, headers: { ...headers, cookie: first } });
    const b = await api(ref.fw, "/api/tasks", { body: { title: "From the laptop" }, headers: { ...headers, cookie: second } });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers.get("idempotent-replayed")).toBeNull();
    expect(b.body.id).not.toBe(a.body.id);
  });
});

// ---- the pages -----------------------------------------------------------------------------------------

describe("signed-in pages (clean mode)", () => {
  const ref = useFernway("none");

  it.each([
    ["/app", "/login?next=/app"],
    ["/app/settings", "/login?next=/app/settings"],
    ["/app/settings#billing", "/login?next=/app/settings%23billing"],
  ])("signed out, %s sends you to %s; signing in there brings you back", async (path, login) => {
    const { page, events, close } = await openPage(ref.fw, path, { reducedMotion: "reduce" });
    try {
      await page.waitForURL(`${ref.fw.url}${login}`);
      await page.getByRole("heading", { level: 1, name: "Welcome back" }).waitFor();
      // The document itself was fine; only the session check said "not signed in".
      expect(events.badResponses).toEqual([`401 ${ref.fw.url}/api/me`]);
      expect(events.pageErrors).toEqual([]);
      const paths = events.requests.map((r) => new URL(r.url()).pathname);
      expect(paths.filter((p) => p.startsWith("/api/") && p !== "/api/__config" && p !== "/api/me")).toEqual([]);

      await page.getByLabel("Email", { exact: true }).fill(ACCOUNTS.alex.email);
      await page.getByLabel("Password", { exact: true }).fill(ACCOUNTS.alex.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${ref.fw.url}${path}`);
      await page.getByText("Signed in as Alex Rivera · Rivera Studio").first().waitFor();
      if (path.endsWith("#billing")) await page.getByRole("tabpanel", { name: "Billing" }).waitFor();
    } finally {
      await close();
    }
  });

  it("the public pages never ask who is signed in (no /api/me, so no 401 on them)", async () => {
    for (const route of ["/", "/signup", "/login", "/onboarding"]) {
      const { events, close } = await openPage(ref.fw, route);
      try {
        expect(events.requests.map((r) => new URL(r.url()).pathname), route).not.toContain("/api/me");
        expect(events.badResponses, route).toEqual([]);
      } finally {
        await close();
      }
    }
  });

  it("signed in as Sam, /app shows Sam's workspace and nothing of Alex's", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app", { as: "sam" });
    try {
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await page.locator("#projects tbody tr").first().waitFor();
      await page.getByText("Signed in as Sam Okafor · Okafor & Co").first().waitFor();
      const rows = (await page.locator("#projects tbody th[scope=row]").allTextContents()).map((t) => t.trim());
      expect(rows.sort()).toEqual([...SAM_PROJECTS].sort());
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const alexOnly of ["northwind", "review homepage wireframes", "priya shah"]) expect(text, alexOnly).not.toContain(alexOnly);
      expect(text).toContain("sketch the bramble logo options");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("signed in as Sam, Settings loads and saves Sam's own profile (initials instead of a photo)", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/settings", { as: "sam", reducedMotion: "reduce" });
    try {
      const form = page.getByRole("form", { name: "Profile" });
      const displayName = form.getByRole("textbox", { name: "Display name", exact: true });
      await expect.poll(() => displayName.inputValue()).toBe("Sam Okafor");
      expect(await form.getByRole("textbox", { name: "Email" }).inputValue()).toBe("sam@fernway.test");
      expect(await form.getByRole("img").count()).toBe(0);
      expect(await page.getByText("Okafor & Co", { exact: true }).count()).toBeGreaterThan(0);
      await displayName.fill("Sam O.");
      const put = page.waitForRequest((r) => r.method() === "PUT");
      await form.getByRole("button", { name: "Save changes" }).click();
      expect(new URL((await put).url()).pathname).toBe(profileUrl("sam"));
      await form.getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
      expect((await api(ref.fw, profileUrl("sam"), { as: "sam" })).body.displayName).toBe("Sam O.");
      expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.displayName).toBe("Alex Rivera");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("Sign out (account menu) ends the session on the server and sends you to /login", async () => {
    const { page, context, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      const cookie = (await context.cookies()).find((c) => c.name === "fernway_session")!.value;
      await page.getByRole("button", { name: "Account menu" }).click();
      const logout = page.waitForRequest((r) => r.url().endsWith("/api/logout") && r.method() === "POST");
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await logout;
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
      await toast(page, "You're signed out").waitFor();
      expect((await api(ref.fw, "/api/me", { headers: { cookie: `fernway_session=${cookie}` } })).status).toBe(401);
      expect((await context.cookies()).find((c) => c.name === "fernway_session")).toBeUndefined();
      // Opening the dashboard again asks you to sign in.
      await page.goto(`${ref.fw.url}/app`, { waitUntil: "networkidle" });
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
    } finally {
      await close();
    }
  });

  it("Sign out from the command palette works too", async () => {
    const { page, close } = await openPage(ref.fw, "/app/settings", { as: "sam" });
    try {
      await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Search Fernway" }).fill("sign out");
      await page.getByRole("option", { name: "Sign out" }).click();
      await page.waitForURL(`${ref.fw.url}/login?next=/app/settings`);
    } finally {
      await close();
    }
  });
});

// ---- V2 planted bugs --------------------------------------------------------------------------------------

describe("V01: GET /api/users/:id/profile has no ownership check", () => {
  const ref = useFernway("V01");

  it("any signed-in user reads any user's profile by id; writing is still owner-only; signed out is still 401", async () => {
    const leak = await api(ref.fw, profileUrl("alex"), { as: "sam" });
    expect(leak.status).toBe(200);
    expect(leak.body).toMatchObject({ id: "alex-rivera", email: "alex@fernway.test", displayName: "Alex Rivera" });
    expect((await api(ref.fw, profileUrl("sam"), { as: "alex" })).body.email).toBe("sam@fernway.test");
    expect((await api(ref.fw, "/api/users/nobody/profile", { as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, profileUrl("alex"), { method: "PUT", body: validProfile(), as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, profileUrl("alex"))).status).toBe(401);
  });

  it("changes nothing else: tasks stay scoped, the allowlist holds, /app/settings opens directly", async () => {
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toEqual(SAM_TASK_IDS);
    await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { ...validProfile(), role: "admin" }, as: "alex" });
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.role).toBe("member");
    expect((await fetch(`${ref.fw.url}/app/settings`)).status).toBe(200);
  });
});

describe("V02: GET /api/tasks answers every user's tasks", () => {
  const ref = useFernway("V02");

  it("each user gets everyone's tasks; changing someone else's task is still 404; signed out is still 401", async () => {
    const forSam = ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body);
    expect(forSam).toEqual(expect.arrayContaining([...ALEX_TASK_IDS, ...SAM_TASK_IDS]));
    expect(ids((await api(ref.fw, "/api/tasks", { as: "alex" })).body)).toEqual(expect.arrayContaining(SAM_TASK_IDS));
    // A task Alex adds (as Run Hound's test record would be) shows up for Sam.
    const task = await api(ref.fw, "/api/tasks", { body: { title: "Alex's marker task" }, as: "alex" });
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toContain(task.body.id);
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true }, as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, "/api/tasks")).status).toBe(401);
  });

  it("changes nothing else: profiles and projects stay scoped", async () => {
    expect((await api(ref.fw, profileUrl("alex"), { as: "sam" })).status).toBe(404);
    expect(names((await api(ref.fw, "/api/projects", { as: "sam" })).body)).toEqual(SAM_PROJECTS);
  });
});

describe("V03: the workspace APIs answer without a session (as Alex); only the SPA redirects", () => {
  const ref = useFernway("V03");

  it.each(WORKSPACE_CALLS.filter((c) => c.method === "GET"))("GET $path answers Alex's data signed out", async ({ path }) => {
    const res = await api(ref.fw, path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual((await api(ref.fw, path, { as: "alex" })).body);
  });

  it("writes work signed out too, into Alex's workspace; /api/me stays honest; signed-in users are unaffected", async () => {
    const task = await api(ref.fw, "/api/tasks", { body: { title: "Written by nobody" } });
    expect(task.status).toBe(201);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "alex" })).body)).toContain(task.body.id);
    expect((await api(ref.fw, "/api/me")).status).toBe(401);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toEqual(SAM_TASK_IDS);
    expect((await api(ref.fw, profileUrl("alex"), { as: "sam" })).status).toBe(404);
  });

  it("the SPA still sends a signed-out visitor to /login", async () => {
    const { page, close } = await openPage(ref.fw, "/app");
    try {
      await page.waitForURL(`${ref.fw.url}/login?next=/app`);
    } finally {
      await close();
    }
  });
});

describe("V04: PUT /api/users/:id/profile stores any key (mass assignment)", () => {
  const ref = useFernway("V04");

  it("role, plan and every other key sent are stored and returned; id is not; replaying the old values restores them", async () => {
    const res = await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { ...validProfile(), ...PRIVILEGE_FIELDS, id: "sam-okafor" }, as: "alex" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(PRIVILEGE_FIELDS);
    const stored = (await api(ref.fw, profileUrl("alex"), { as: "alex" })).body;
    expect(stored).toMatchObject({ ...validProfile(), ...PRIVILEGE_FIELDS, id: "alex-rivera" });
    await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { ...validProfile(), role: "member", plan: "free" }, as: "alex" });
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body).toMatchObject({ role: "member", plan: "free" });
  });

  it("changes nothing else: the 4 fields are still validated, other users' profiles are still 404", async () => {
    expect((await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { role: "admin" }, as: "alex" })).status).toBe(400);
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body.role).toBe("member");
    expect((await api(ref.fw, profileUrl("alex"), { as: "sam" })).status).toBe(404);
    expect((await api(ref.fw, profileUrl("sam"), { method: "PUT", body: { ...validProfile(), role: "admin" }, as: "alex" })).status).toBe(404);
  });
});

describe("V05: /app/settings and /onboarding answer 404 when opened directly", () => {
  const ref = useFernway("V05");

  it.each(["/app/settings", "/onboarding", "/app/settings/", "/onboarding/"])("GET %s answers a bare 404 Not Found page (not the SPA)", async (path) => {
    const res = await fetch(`${ref.fw.url}${path}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    const html = await res.text();
    expect(html).toContain("<title>404 Not Found</title>");
    expect(html).toContain("<h1>Not Found</h1>");
    expect(html).not.toContain('<div id="root"></div>');
  });

  it("every other route still serves the SPA", async () => {
    for (const route of ["/", "/signup", "/login", "/app"]) expect((await fetch(`${ref.fw.url}${route}`)).status, route).toBe(200);
  });

  it("in-app navigation still renders them: the sidebar's Settings link and the footer's Set up a workspace link", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await page.getByRole("navigation", { name: "App" }).first().getByRole("link", { name: "Settings" }).click();
      await page.waitForURL(`${ref.fw.url}/app/settings`);
      await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
      expect(events.badResponses).toEqual([]);
      // A reload (opening it directly) breaks.
      const reload = await page.reload();
      expect(reload?.status()).toBe(404);
      expect(await page.locator("h1").textContent()).toBe("Not Found");

      await page.goto(`${ref.fw.url}/`, { waitUntil: "networkidle" });
      await page.getByRole("contentinfo").getByRole("link", { name: "Set up a workspace" }).click();
      await page.waitForURL(`${ref.fw.url}/onboarding`);
      await page.getByRole("heading", { level: 1, name: "Set up your workspace" }).waitFor();
    } finally {
      await close();
    }
  });
});

describe("V01-V05 off: clean mode answers every V2 probe correctly", () => {
  const ref = useFernway("W01,W02,W03,W04,W05,W06,W07,W08,W09,W10");

  it("no leak, no signed-out access, the allowlist holds and the direct routes work, even with every V1 bug on", async () => {
    expect((await api(ref.fw, profileUrl("alex"), { as: "sam" })).status).toBe(404);
    expect(ids((await api(ref.fw, "/api/tasks", { as: "sam" })).body)).toEqual(SAM_TASK_IDS);
    expect((await api(ref.fw, "/api/tasks")).status).toBe(401);
    await api(ref.fw, profileUrl("alex"), { method: "PUT", body: { ...validProfile(), ...PRIVILEGE_FIELDS }, as: "alex" });
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body).toMatchObject({ role: "member", plan: "free" });
    expect((await api(ref.fw, profileUrl("alex"), { as: "alex" })).body).not.toHaveProperty("isAdmin");
    for (const route of ["/app/settings", "/onboarding"]) expect((await fetch(`${ref.fw.url}${route}`)).status, route).toBe(200);
  });

  it("W09 also drops HttpOnly from the sign-in cookie and the sign-out cookie", async () => {
    const res = await api(ref.fw, "/api/login", { body: { email: ACCOUNTS.sam.email, password: ACCOUNTS.sam.password } });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^fernway_session=${UUID}; Path=/; SameSite=Lax$`));
    const out = await api(ref.fw, "/api/logout", { method: "POST", headers: { cookie: `fernway_session=${sessionIdOf(res.headers.get("set-cookie"))}` } });
    expect(out.headers.get("set-cookie")).toBe("fernway_session=; Path=/; SameSite=Lax; Max-Age=0");
  });
});
