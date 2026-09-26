/**
 * The /app Dashboard contract (CONTRACT.md "/app Dashboard", "API", W03, W05): the workspace API (projects, members,
 * tasks), the app shell, stat cards, the chart with its text summary, the projects table with status tabs and row
 * actions, the Quick add task form and the New project sheet, each in clean mode and with its planted bug.
 *
 * /app and its API need a session (V2): every API call and page here is signed in as Alex unless it says otherwise.
 * Accounts, isolation, 401s and V01-V05 are covered in accounts.test.ts.
 */
import type { Page, Request, Route } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import {
  api as rawApi,
  axeViolations,
  closeBrowser,
  horizontalOverflow,
  openPage,
  STACK_RE,
  useFernway,
  type ApiInit,
  type Fernway,
  type OpenedPage,
} from "./support.js";

/** The API as Alex (pass `as` to call it as someone else, or "nobody"). */
const api = (fw: Fernway, path: string, init: ApiInit = {}) => rawApi(fw, path, { as: "alex", ...init });

afterAll(async () => {
  await closeBrowser();
});

const SEEDED_PROJECTS = [
  "Northwind rebrand",
  "Atlas mobile app",
  "Juniper website refresh",
  "Harbor & Co. launch video",
  "Maple Studio brand book",
  "Q3 client reporting",
];

const validProject = (overrides: Record<string, unknown> = {}) => ({
  name: "Cedar onboarding kit",
  description: "Welcome pack, templates and a kickoff deck.",
  status: "active",
  priority: "high",
  ownerId: "hana-sato",
  dueDate: "2027-03-15",
  budget: 12500,
  notify: true,
  ...overrides,
});

const key = () => crypto.randomUUID();

/**
 * Holds every request matching `path` and `method` until release() (so a test can look at the pending state).
 * `seen` records them in order.
 */
async function holdRequests(page: Page, path: string, method: string) {
  const waiting: (() => void)[] = [];
  const seen: Request[] = [];
  let released = false;
  await page.route(
    (url) => url.pathname === path,
    async (route: Route) => {
      if (route.request().method() !== method) return route.fallback();
      seen.push(route.request());
      if (!released) await new Promise<void>((resolve) => waiting.push(resolve));
      await route.fallback();
    },
  );
  return {
    seen,
    release() {
      released = true;
      for (const go of waiting.splice(0)) go();
    },
  };
}

/** Records the requests the page sends to `path` with `method`. */
function recordRequests(page: Page, path: string, method: string): Request[] {
  const list: Request[] = [];
  page.on("request", (req) => {
    if (req.method() === method && new URL(req.url()).pathname === path) list.push(req);
  });
  return list;
}

async function openDashboard(fw: Fernway, options: Parameters<typeof openPage>[2] = {}): Promise<OpenedPage> {
  const opened = await openPage(fw, "/app", { as: "alex", ...options });
  await opened.page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
  await projectsTable(opened.page).getByRole("row").nth(1).waitFor();
  return opened;
}

const projectsTable = (page: Page) => page.locator("#projects").getByRole("table");
const projectRows = (page: Page) => projectsTable(page).locator("tbody tr");
const rowNames = async (page: Page) => (await projectRows(page).locator("th[scope=row]").allTextContents()).map((t) => t.trim());
const quickAdd = (page: Page) => page.getByRole("form", { name: "Quick add" });
const todayList = (page: Page) => page.getByRole("list", { name: "Today" });

/** The element ids in an aria-describedby / aria-labelledby value, resolved to their text. */
async function referencedText(page: Page, locator: ReturnType<Page["locator"]>, attr: string): Promise<string[]> {
  const ids = ((await locator.getAttribute(attr)) ?? "").split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (const id of ids) {
    const el = page.locator(`[id="${id}"]`);
    expect(await el.count(), `${attr} target #${id} exists`).toBe(1);
    texts.push(((await el.textContent()) ?? "").trim());
  }
  return texts;
}

async function selectOption(page: Page, trigger: ReturnType<Page["locator"]>, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
}

// ---- API -----------------------------------------------------------------------------------------

describe("workspace API: projects, members, tasks (clean mode)", () => {
  const ref = useFernway("none");

  it("GET /api/projects lists the 6 seeded projects with every field", async () => {
    const res = await api(ref.fw, "/api/projects");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(SEEDED_PROJECTS);
    for (const p of res.body) {
      expect(Object.keys(p).sort()).toEqual(
        ["budget", "createdAt", "description", "dueDate", "id", "name", "notify", "ownerId", "priority", "progress", "status"].sort(),
      );
    }
  });

  it("GET /api/members lists the 8 team members", async () => {
    const res = await api(ref.fw, "/api/members");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
    expect(res.body[0]).toEqual({ id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", role: "Studio lead", avatar: 0 });
  });

  it("GET /api/tasks lists the seeded tasks", async () => {
    const res = await api(ref.fw, "/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body.map((t: { title: string }) => t.title)).toContain("Review homepage wireframes");
  });

  it("POST /api/projects creates a project (201) that GET lists; unknown keys are ignored", async () => {
    const res = await api(ref.fw, "/api/projects", {
      body: { ...validProject(), id: "hijack", progress: 99, createdAt: "1999-01-01", archived: true, role: "admin" },
      headers: { "idempotency-key": key() },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(validProject());
    expect(res.body.id).not.toBe("hijack");
    expect(res.body.progress).toBe(0);
    expect(res.body.createdAt).not.toBe("1999-01-01");
    expect(res.body).not.toHaveProperty("role");
    const list = await api(ref.fw, "/api/projects");
    expect(list.body).toHaveLength(7);
    expect(list.body.find((p: { id: string }) => p.id === res.body.id)).toMatchObject(validProject());
  });

  it("POST /api/projects: only the name is required; the rest has defaults", async () => {
    const res = await api(ref.fw, "/api/projects", { body: { name: "  Spruce  " } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Spruce", description: "", status: "active", priority: "medium", ownerId: "alex-rivera", dueDate: "", budget: 0, notify: false });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "   " }, "name"],
    [{ name: "x".repeat(81) }, "name"],
    [{ status: "archived" }, "status"],
    [{ priority: "urgent" }, "priority"],
    [{ ownerId: "nobody" }, "ownerId"],
    [{ dueDate: "2026-02-30" }, "dueDate"],
    [{ dueDate: "2020-01-01" }, "dueDate"],
    [{ budget: -500 }, "budget"],
    [{ budget: 50_500 }, "budget"],
    [{ budget: 1234 }, "budget"],
    [{ notify: "yes" }, "notify"],
    [{ description: "x".repeat(501) }, "description"],
  ])("POST /api/projects %j answers 400 with an error for %s", async (override, field) => {
    const res = await api(ref.fw, "/api/projects", { body: validProject(override) });
    expect(res.status).toBe(400);
    expect(typeof res.body.errors[field]).toBe("string");
    expect((await api(ref.fw, "/api/projects")).body).toHaveLength(6);
  });

  it("POST /api/projects named Crash answers a bare 500 and stores nothing", async () => {
    const res = await api(ref.fw, "/api/projects", { body: validProject({ name: " Crash " }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(STACK_RE);
    expect((await api(ref.fw, "/api/projects")).body).toHaveLength(6);
  });

  it("POST /api/projects with a repeated Idempotency-Key saves once", async () => {
    const k = key();
    const [a, b] = await Promise.all([
      api(ref.fw, "/api/projects", { body: validProject(), headers: { "idempotency-key": k } }),
      api(ref.fw, "/api/projects", { body: validProject(), headers: { "idempotency-key": k } }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect((await api(ref.fw, "/api/projects")).body).toHaveLength(7);
  });

  it("PATCH /api/projects/:id archives a project; GET no longer lists it; unknown ids answer 404", async () => {
    const res = await api(ref.fw, "/api/projects/northwind-rebrand", { method: "PATCH", body: { archived: true, name: "Renamed" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "northwind-rebrand", name: "Northwind rebrand", archived: true });
    const list = await api(ref.fw, "/api/projects");
    expect(list.body.map((p: { id: string }) => p.id)).not.toContain("northwind-rebrand");
    expect((await api(ref.fw, "/api/projects/nope", { method: "PATCH", body: { archived: true } })).status).toBe(404);
    expect((await api(ref.fw, "/api/projects/atlas-mobile-app", { method: "PATCH", body: {} })).status).toBe(400);
    expect((await api(ref.fw, "/api/projects/atlas-mobile-app", { method: "PATCH", body: { archived: "yes" } })).status).toBe(400);
  });

  it("POST /api/tasks creates a task (201) that GET lists; the project is optional but must exist", async () => {
    const res = await api(ref.fw, "/api/tasks", { body: { title: " Draft kickoff agenda ", projectId: "atlas-mobile-app", done: true, id: "x" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Draft kickoff agenda", projectId: "atlas-mobile-app", done: false });
    expect(res.body.id).not.toBe("x");
    const noProject = await api(ref.fw, "/api/tasks", { body: { title: "Water the ferns" } });
    expect(noProject.status).toBe(201);
    expect(noProject.body.projectId).toBe("");
    const titles = (await api(ref.fw, "/api/tasks")).body.map((t: { title: string }) => t.title);
    expect(titles).toEqual(expect.arrayContaining(["Draft kickoff agenda", "Water the ferns"]));
  });

  it.each([
    [{ title: "" }, "title"],
    [{ title: "x".repeat(121) }, "title"],
    [{ title: "Ok", projectId: "missing" }, "projectId"],
    [{ title: 42 }, "title"],
  ])("POST /api/tasks %j answers 400 for %s", async (body, field) => {
    const res = await api(ref.fw, "/api/tasks", { body });
    expect(res.status).toBe(400);
    expect(typeof res.body.errors[field]).toBe("string");
  });

  it("POST /api/tasks titled Crash answers a bare 500", async () => {
    const res = await api(ref.fw, "/api/tasks", { body: { title: "Crash" } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
  });

  it("POST /api/tasks de-duplicates by Idempotency-Key (clean mode)", async () => {
    const k = key();
    const [a, b] = await Promise.all([
      api(ref.fw, "/api/tasks", { body: { title: "Once" }, headers: { "idempotency-key": k } }),
      api(ref.fw, "/api/tasks", { body: { title: "Once" }, headers: { "idempotency-key": k } }),
    ]);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    const once = (await api(ref.fw, "/api/tasks")).body.filter((t: { title: string }) => t.title === "Once");
    expect(once).toHaveLength(1);
  });

  it("PATCH /api/tasks/:id marks a task done; unknown ids answer 404; done must be a boolean", async () => {
    const res = await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: { done: true } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "task-wireframes", done: true });
    expect((await api(ref.fw, "/api/tasks")).body.find((t: { id: string }) => t.id === "task-wireframes").done).toBe(true);
    expect((await api(ref.fw, "/api/tasks/nope", { method: "PATCH", body: { done: true } })).status).toBe(404);
    expect((await api(ref.fw, "/api/tasks/task-wireframes", { method: "PATCH", body: {} })).status).toBe(400);
  });

  it("POST /api/__reset restores projects and tasks", async () => {
    await api(ref.fw, "/api/projects", { body: validProject() });
    await api(ref.fw, "/api/tasks", { body: { title: "Temp" } });
    await ref.fw.reset();
    expect((await api(ref.fw, "/api/projects")).body).toHaveLength(6);
    expect((await api(ref.fw, "/api/tasks")).body).toHaveLength(3);
  });
});

describe("W03 on the server: POST /api/tasks ignores the Idempotency-Key", () => {
  const ref = useFernway("W03");

  it("the same key twice saves twice; other endpoints still de-duplicate", async () => {
    const k = key();
    const a = await api(ref.fw, "/api/tasks", { body: { title: "Twice" }, headers: { "idempotency-key": k } });
    const b = await api(ref.fw, "/api/tasks", { body: { title: "Twice" }, headers: { "idempotency-key": k } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
    const p = key();
    const c = await api(ref.fw, "/api/projects", { body: validProject(), headers: { "idempotency-key": p } });
    const d = await api(ref.fw, "/api/projects", { body: validProject(), headers: { "idempotency-key": p } });
    expect(d.body.id).toBe(c.body.id);
  });
});

// ---- the page ------------------------------------------------------------------------------------

describe("/app dashboard in a browser (clean mode)", () => {
  const ref = useFernway("none");

  it("loads with one h1, 4 stat cards, the chart with a text summary, and no errors", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      expect(await page.title()).toBe("Fernway: Dashboard");
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.locator("main").count()).toBe(1);

      const stats = page.getByRole("list", { name: "Workspace at a glance" }).getByRole("listitem");
      expect(await stats.count()).toBe(4);
      const statText = (await stats.allTextContents()).join(" | ");
      expect(statText).toContain("Active projects");
      expect(statText).toContain("Open tasks");

      const chart = page.getByRole("img", { name: "Tasks completed and created per week" });
      expect(await chart.count()).toBe(1);
      const summary = await referencedText(page, chart, "aria-describedby");
      expect(summary.join(" ")).toMatch(/completed/i);
      expect(summary.join(" ")).toMatch(/\d/);
      // The chart's numbers are also available as a table.
      await page.getByText("Show chart data").click();
      expect(await page.getByRole("table", { name: /per week/ }).locator("tbody tr").count()).toBe(12);

      expect(await page.getByRole("heading", { level: 2, name: "Projects" }).count()).toBe(1);
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
      const paths = events.requests.map((r) => new URL(r.url()).pathname);
      expect(paths).toEqual(expect.arrayContaining(["/api/me", "/api/projects", "/api/members", "/api/tasks"]));
      // The greeting names the signed-in user.
      expect(await page.locator("main").textContent()).toContain(", Alex. Here's where your studio stands today.");
    } finally {
      await close();
    }
  });

  it("the projects table has a caption and one row per project; status tabs filter it (mouse and keyboard)", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      expect(((await projectsTable(page).locator("caption").textContent()) ?? "").trim()).not.toBe("");
      expect(await rowNames(page)).toEqual(SEEDED_PROJECTS);
      const tabs = page.locator("#projects").getByRole("tab");
      expect((await tabs.allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim())).toEqual(["All", "Active", "Paused", "Done"]);
      expect(await page.getByRole("tab", { name: "All", exact: true }).getAttribute("aria-selected")).toBe("true");

      await page.getByRole("tab", { name: "Paused", exact: true }).click();
      expect(await rowNames(page)).toEqual(["Harbor & Co. launch video"]);

      // Radix moves roving focus on a timer, so each key is held like a person would (press delay).
      const selected = (name: string) => page.getByRole("tab", { name, exact: true }).getAttribute("aria-selected");
      await page.getByRole("tab", { name: "Paused", exact: true }).focus();
      await page.keyboard.press("ArrowRight", { delay: 50 });
      await expect.poll(() => selected("Done")).toBe("true");
      expect(await rowNames(page)).toEqual(["Maple Studio brand book", "Q3 client reporting"]);
      await page.keyboard.press("Home", { delay: 50 });
      await expect.poll(() => selected("All")).toBe("true");
      await page.keyboard.press("ArrowRight", { delay: 50 });
      await expect.poll(() => selected("Active")).toBe("true");
      expect(await rowNames(page)).toEqual(["Northwind rebrand", "Atlas mobile app", "Juniper website refresh"]);
      expect(await projectsTable(page).locator("caption").textContent()).toMatch(/3/);
    } finally {
      await close();
    }
  });

  it("each row has an actions menu (Open, Duplicate, Archive) operable by keyboard", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      const trigger = page.getByRole("button", { name: "Actions for Northwind rebrand" });
      expect(await trigger.count()).toBe(1);
      for (const name of SEEDED_PROJECTS) expect(await page.getByRole("button", { name: `Actions for ${name}` }).count()).toBe(1);

      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await menu.waitFor();
      expect(await menu.getByRole("menuitem").allInnerTexts()).toEqual(["Open", "Duplicate", "Archive"]);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

      // Open: a details panel named after the project; Esc returns focus to the row's trigger.
      await trigger.click();
      await page.getByRole("menuitem", { name: "Open" }).click();
      const details = page.getByRole("dialog", { name: "Northwind rebrand" });
      await details.waitFor();
      expect(await details.textContent()).toContain("Priya Shah");
      await page.keyboard.press("Escape");
      await details.waitFor({ state: "hidden" });
      await expect.poll(() => trigger.evaluate((el) => el === document.activeElement)).toBe(true);

      // Duplicate: a copy is saved and listed.
      await trigger.click();
      await page.getByRole("menuitem", { name: "Duplicate" }).click();
      await page.getByRole("rowheader", { name: /Northwind rebrand \(copy\)/ }).waitFor();
      await page.getByText("Duplicated Northwind rebrand").first().waitFor();
      expect((await api(ref.fw, "/api/projects")).body.map((p: { name: string }) => p.name)).toContain("Northwind rebrand (copy)");

      // Archive asks first (a destructive action), then removes the row for good.
      await page.getByRole("button", { name: "Actions for Atlas mobile app" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Archive Atlas mobile app?" });
      await confirm.waitFor();
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await confirm.waitFor({ state: "hidden" });
      expect(await rowNames(page)).toContain("Atlas mobile app");
      await page.getByRole("button", { name: "Actions for Atlas mobile app" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      await confirm.getByRole("button", { name: "Archive project" }).click();
      await confirm.waitFor({ state: "hidden" });
      await expect.poll(() => rowNames(page)).not.toContain("Atlas mobile app");
      await page.reload({ waitUntil: "networkidle" });
      await projectRows(page).first().waitFor();
      expect(await rowNames(page)).not.toContain("Atlas mobile app");
      expect(await rowNames(page)).toContain("Northwind rebrand (copy)");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a failed Duplicate is announced as an alert and by toast, and adds no row", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      await page.route(
        (url) => url.pathname === "/api/projects",
        (route) =>
          route.request().method() === "POST"
            ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) })
            : route.fallback(),
      );
      await page.getByRole("button", { name: "Actions for Juniper website refresh" }).click();
      await page.getByRole("menuitem", { name: "Duplicate" }).click();
      const alert = page.locator("#projects").getByRole("alert").filter({ hasText: "Project not duplicated" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side");
      await page.locator("[data-sonner-toast]").filter({ hasText: "Project not duplicated" }).waitFor();
      expect(await rowNames(page)).toEqual(SEEDED_PROJECTS);
      expect((await page.locator("#projects").getByRole("status").textContent())?.trim()).toBe("");
    } finally {
      await close();
    }
  });

  it("app shell: collapse, palette, notifications and account menu keep their names on /app", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      expect(await page.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded")).toBe("true");
      expect(await page.getByRole("button", { name: "Notifications" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Account menu" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Search" }).count()).toBe(1);
      const nav = page.getByRole("navigation", { name: "App" }).first();
      expect(await nav.getByRole("link").allInnerTexts()).toEqual(["Dashboard", "Projects", "Settings", "Help"]);
      expect(await page.getByText("Signed in as Alex Rivera · Rivera Studio").count()).toBeGreaterThan(0);

      // The palette can open the New project sheet.
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Search Fernway" }).waitFor();
      await page.getByRole("combobox", { name: "Search Fernway" }).fill("new project");
      await page.getByRole("option", { name: "New project" }).click();
      await page.getByRole("dialog", { name: "New project" }).waitFor();
    } finally {
      await close();
    }
  });
});

describe("Quick add task form (clean mode)", () => {
  const ref = useFernway("none");

  it("has a named form with labelled Task and Project fields and an Add task button", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const form = quickAdd(page);
      expect(await form.count()).toBe(1);
      expect(await form.evaluate((el) => el.tagName)).toBe("FORM");
      expect(await form.getByRole("textbox", { name: "Task" }).count()).toBe(1);
      expect(await form.getByRole("combobox", { name: "Project" }).count()).toBe(1);
      expect(await form.getByRole("button", { name: "Add task" }).count()).toBe(1);
      expect(await todayList(page).getByRole("listitem").count()).toBe(3);
      // The Today list is outside the form: its checkboxes are not form fields.
      expect(await form.getByRole("checkbox").count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("an empty submit marks Task invalid, describes it with a visible message, focuses it and announces the error", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      const posts = recordRequests(page, "/api/tasks", "POST");
      const task = quickAdd(page).getByRole("textbox", { name: "Task" });
      await quickAdd(page).getByRole("button", { name: "Add task" }).click();
      await expect.poll(() => task.getAttribute("aria-invalid")).toBe("true");
      const described = await referencedText(page, task, "aria-describedby");
      expect(described).toContain("Enter a task.");
      expect(await page.getByText("Enter a task.").isVisible()).toBe(true);
      expect(await task.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await quickAdd(page).getByRole("alert").textContent()).toMatch(/1 problem/);
      expect(posts).toHaveLength(0);
      // Fixing it clears the error on change.
      await task.fill("Plan the retro");
      await expect.poll(() => task.getAttribute("aria-invalid")).toBeNull();
      expect(events.consoleErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("while saving the button is disabled and busy with the same name; then a toast, a status and the task in Today (after reload too)", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      const form = quickAdd(page);
      await form.getByRole("textbox", { name: "Task" }).fill("Book the Atlas usability study");
      // Project select, by keyboard.
      const project = form.getByRole("combobox", { name: "Project" });
      await project.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor();
      await page.getByRole("option", { name: "Atlas mobile app" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      expect(await project.textContent()).toContain("Atlas mobile app");

      const hold = await holdRequests(page, "/api/tasks", "POST");
      const button = form.getByRole("button", { name: "Add task" });
      await button.click();
      await expect.poll(() => hold.seen.length).toBe(1);
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute("aria-busy")).toBe("true");
      expect(await form.getByRole("button", { name: "Add task" }).count()).toBe(1);
      const body = JSON.parse(hold.seen[0]!.postData() ?? "{}");
      expect(body).toEqual({ title: "Book the Atlas usability study", projectId: "atlas-mobile-app" });
      expect(hold.seen[0]!.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      hold.release();

      await todayList(page).getByText("Book the Atlas usability study").waitFor();
      await page.getByRole("status").filter({ hasText: "Added" }).first().waitFor();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Task added" }).waitFor();
      expect(await button.isEnabled()).toBe(true);
      expect(await form.getByRole("textbox", { name: "Task" }).inputValue()).toBe("");

      await page.reload({ waitUntil: "networkidle" });
      await todayList(page).getByText("Book the Atlas usability study").waitFor();
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a double click saves once (disabled while pending)", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const posts = recordRequests(page, "/api/tasks", "POST");
      await quickAdd(page).getByRole("textbox", { name: "Task" }).fill("Only once please");
      await quickAdd(page).getByRole("button", { name: "Add task" }).dblclick();
      await todayList(page).getByText("Only once please").waitFor();
      await page.waitForTimeout(800);
      expect(posts).toHaveLength(1);
      const saved = (await api(ref.fw, "/api/tasks")).body.filter((t: { title: string }) => t.title === "Only once please");
      expect(saved).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("a server error (Crash) is announced inline and by toast; the value is kept and the button re-enabled", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      const form = quickAdd(page);
      await form.getByRole("textbox", { name: "Task" }).fill("Crash");
      await form.getByRole("button", { name: "Add task" }).click();
      const alert = form.getByRole("alert").filter({ hasText: "Task not added" });
      await alert.waitFor();
      expect(await alert.textContent()).toContain("Something went wrong on our side");
      await page.locator("[data-sonner-toast]").filter({ hasText: "Task not added" }).waitFor();
      expect(await form.getByRole("textbox", { name: "Task" }).inputValue()).toBe("Crash");
      expect(await form.getByRole("button", { name: "Add task" }).isEnabled()).toBe(true);
      expect(await todayList(page).getByText("Crash", { exact: true }).count()).toBe(0);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a network failure is announced too", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      await page.route((url) => url.pathname === "/api/tasks", (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()));
      await quickAdd(page).getByRole("textbox", { name: "Task" }).fill("Offline task");
      await quickAdd(page).getByRole("button", { name: "Add task" }).click();
      await quickAdd(page).getByRole("alert").filter({ hasText: "couldn't reach Fernway" }).waitFor();
      expect(await quickAdd(page).getByRole("textbox", { name: "Task" }).inputValue()).toBe("Offline task");
    } finally {
      await close();
    }
  });

  it("checking a task in Today marks it done (and it stays done after reload)", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const box = todayList(page).getByRole("checkbox", { name: "Review homepage wireframes" });
      expect(await box.getAttribute("aria-checked")).toBe("false");
      await box.focus();
      await page.keyboard.press("Space");
      await expect.poll(() => box.getAttribute("aria-checked")).toBe("true");
      await expect.poll(async () => (await api(ref.fw, "/api/tasks")).body.find((t: { id: string }) => t.id === "task-wireframes").done).toBe(true);
      await page.reload({ waitUntil: "networkidle" });
      await expect.poll(() => todayList(page).getByRole("checkbox", { name: "Review homepage wireframes" }).getAttribute("aria-checked")).toBe("true");
    } finally {
      await close();
    }
  });
});

describe("New project sheet (clean mode)", () => {
  const ref = useFernway("none");

  async function openSheet(page: Page) {
    await page.getByRole("button", { name: "New project" }).click();
    const sheet = page.getByRole("dialog", { name: "New project" });
    await sheet.waitFor();
    return sheet;
  }

  it("is a dialog with a form of labelled fields; Esc closes it and returns focus to the trigger", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      // The sheet's form is not in the DOM until it opens (only Quick add is, CONTRACT.md).
      expect(await page.locator("form").count()).toBe(1);
      const sheet = await openSheet(page);
      expect(await sheet.locator("form").count()).toBe(1);
      expect(await sheet.getByRole("textbox", { name: "Project name" }).count()).toBe(1);
      expect(await sheet.getByRole("textbox", { name: "Description" }).count()).toBe(1);
      expect(await sheet.getByRole("combobox", { name: "Status" }).textContent()).toContain("Active");
      const priority = sheet.getByRole("radiogroup", { name: "Priority" });
      expect(await priority.getByRole("radio").count()).toBe(3);
      expect(await priority.getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")).toBe("true");
      expect(await sheet.getByRole("combobox", { name: "Owner" }).textContent()).toContain("Alex Rivera");
      expect(await sheet.getByLabel("Due date").getAttribute("type")).toBe("date");
      const budget = sheet.getByRole("slider", { name: "Budget" });
      expect(await budget.getAttribute("aria-valuemin")).toBe("0");
      expect(await budget.getAttribute("aria-valuemax")).toBe("50000");
      expect(await sheet.getByRole("switch", { name: "Notify the team" }).count()).toBe(1);
      expect(await sheet.getByRole("button", { name: "Create project" }).count()).toBe(1);

      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "hidden" });
      await expect.poll(() => page.getByRole("button", { name: "New project" }).evaluate((el) => el === document.activeElement)).toBe(true);

      // The close button is named "Close".
      await openSheet(page);
      await page.getByRole("dialog", { name: "New project" }).getByRole("button", { name: "Close" }).click();
      await page.getByRole("dialog", { name: "New project" }).waitFor({ state: "hidden" });
    } finally {
      await close();
    }
  });

  it("an empty submit marks Project name invalid, focuses it and announces the error", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const posts = recordRequests(page, "/api/projects", "POST");
      const sheet = await openSheet(page);
      await sheet.getByRole("button", { name: "Create project" }).click();
      const name = sheet.getByRole("textbox", { name: "Project name" });
      await expect.poll(() => name.getAttribute("aria-invalid")).toBe("true");
      expect(await referencedText(page, name, "aria-describedby")).toContain("Enter a project name.");
      expect(await name.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await sheet.getByRole("alert").first().textContent()).toMatch(/problem/);
      expect(posts).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("every Radix control works from the keyboard; Create project saves, closes, toasts and lists the project (after reload too)", async () => {
    const { page, events, close } = await openDashboard(ref.fw);
    try {
      const sheet = await openSheet(page);
      await sheet.getByRole("textbox", { name: "Project name" }).fill("Cedar onboarding kit");
      await sheet.getByRole("textbox", { name: "Description" }).fill("Welcome pack, templates and a kickoff deck.");

      // Status: Select by keyboard.
      await sheet.getByRole("combobox", { name: "Status" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor();
      await page.getByRole("option", { name: "Paused" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      expect(await sheet.getByRole("combobox", { name: "Status" }).textContent()).toContain("Paused");

      // Priority: arrow keys move the selection.
      await sheet.getByRole("radio", { name: "Medium" }).focus();
      await page.keyboard.press("ArrowRight", { delay: 50 });
      await expect.poll(() => sheet.getByRole("radio", { name: "High" }).getAttribute("aria-checked")).toBe("true");

      // Owner: combobox + filterable list.
      const owner = sheet.getByRole("combobox", { name: "Owner" });
      await owner.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.type("hana");
      // cmdk ranks fuzzy matches: the best one is first and pre-selected, so Enter picks it.
      await expect.poll(() => page.getByRole("option").count()).toBeLessThan(8);
      const best = page.getByRole("option").first();
      expect(await best.textContent()).toContain("Hana Sato");
      expect(await best.getAttribute("aria-selected")).toBe("true");
      await page.keyboard.press("Enter");
      await expect.poll(() => owner.textContent()).toContain("Hana Sato");
      await expect.poll(() => owner.evaluate((el) => el === document.activeElement)).toBe(true);

      await sheet.getByLabel("Due date").fill("2027-03-15");

      // Budget: slider keys, value shown.
      const budget = sheet.getByRole("slider", { name: "Budget" });
      const start = Number(await budget.getAttribute("aria-valuenow"));
      await budget.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      expect(Number(await budget.getAttribute("aria-valuenow"))).toBe(start + 2500);
      expect(await budget.getAttribute("aria-valuetext")).toBe("$12,500");
      expect(await sheet.getByText("$12,500").count()).toBeGreaterThan(0);

      // Notify the team: Space toggles.
      const notify = sheet.getByRole("switch", { name: "Notify the team" });
      const before = await notify.getAttribute("aria-checked");
      await notify.focus();
      await page.keyboard.press("Space");
      expect(await notify.getAttribute("aria-checked")).not.toBe(before);

      const hold = await holdRequests(page, "/api/projects", "POST");
      const submit = sheet.getByRole("button", { name: "Create project" });
      await submit.click();
      await expect.poll(() => hold.seen.length).toBe(1);
      expect(await submit.isDisabled()).toBe(true);
      expect(await submit.getAttribute("aria-busy")).toBe("true");
      expect(hold.seen[0]!.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(hold.seen[0]!.postData() ?? "{}")).toEqual({
        name: "Cedar onboarding kit",
        description: "Welcome pack, templates and a kickoff deck.",
        status: "paused",
        priority: "high",
        ownerId: "hana-sato",
        dueDate: "2027-03-15",
        budget: 12500,
        notify: before !== "true",
      });
      hold.release();

      await sheet.waitFor({ state: "hidden" });
      await page.locator("[data-sonner-toast]").filter({ hasText: "Project created" }).waitFor();
      await page.getByRole("status").filter({ hasText: "Cedar onboarding kit" }).first().waitFor();
      expect((await rowNames(page))[0]).toBe("Cedar onboarding kit");
      await expect.poll(() => page.getByRole("button", { name: "New project" }).evaluate((el) => el === document.activeElement)).toBe(true);

      await page.reload({ waitUntil: "networkidle" });
      await projectRows(page).first().waitFor();
      expect((await rowNames(page))[0]).toBe("Cedar onboarding kit");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("the owner list filters by name and shows all 8 members", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const sheet = await openSheet(page);
      await sheet.getByRole("combobox", { name: "Owner" }).click();
      expect(await page.getByRole("option").count()).toBe(8);
      await page.keyboard.type("0000");
      await page.getByText("No team member matches").waitFor();
      await page.keyboard.press("Escape");
      expect(await sheet.isVisible()).toBe(true);
    } finally {
      await close();
    }
  });

  it("a server error keeps the sheet open with an alert, a toast and the values", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const sheet = await openSheet(page);
      await sheet.getByRole("textbox", { name: "Project name" }).fill("Crash");
      await selectOption(page, sheet.getByRole("combobox", { name: "Status" }), "Done");
      await sheet.getByRole("button", { name: "Create project" }).click();
      await sheet.getByRole("alert").filter({ hasText: "Project not created" }).waitFor();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Project not created" }).waitFor();
      expect(await sheet.getByRole("textbox", { name: "Project name" }).inputValue()).toBe("Crash");
      expect(await sheet.getByRole("combobox", { name: "Status" }).textContent()).toContain("Done");
      expect(await sheet.getByRole("button", { name: "Create project" }).isEnabled()).toBe(true);
      expect(await rowNames(page)).not.toContain("Crash");
    } finally {
      await close();
    }
  });

  it("server field errors show on the field", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      await page.route(
        (url) => url.pathname === "/api/projects",
        (route) =>
          route.request().method() === "POST"
            ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ errors: { name: "A project with this name already exists." } }) })
            : route.fallback(),
      );
      const sheet = await openSheet(page);
      await sheet.getByRole("textbox", { name: "Project name" }).fill("Northwind rebrand");
      await sheet.getByRole("button", { name: "Create project" }).click();
      const name = sheet.getByRole("textbox", { name: "Project name" });
      await expect.poll(() => name.getAttribute("aria-invalid")).toBe("true");
      expect(await referencedText(page, name, "aria-describedby")).toContain("A project with this name already exists.");
    } finally {
      await close();
    }
  });
});

describe("dashboard accessibility and layout (clean mode)", () => {
  const ref = useFernway("none");

  it.each(["light", "dark"] as const)("passes axe in %s mode: page, New project sheet, row menu, details and archive dialogs", async (colorScheme) => {
    const { page, close } = await openDashboard(ref.fw, { colorScheme, reducedMotion: "reduce" });
    try {
      expect(await axeViolations(page), "page").toEqual([]);
      await page.getByText("Show chart data").click();
      expect(await axeViolations(page), "chart data").toEqual([]);

      await quickAdd(page).getByRole("button", { name: "Add task" }).click();
      await quickAdd(page).getByRole("textbox", { name: "Task" }).and(page.locator("[aria-invalid=true]")).waitFor();
      expect(await axeViolations(page), "quick add errors").toEqual([]);

      await page.getByRole("button", { name: "New project" }).click();
      const sheet = page.getByRole("dialog", { name: "New project" });
      await sheet.waitFor();
      expect(await axeViolations(page), "sheet").toEqual([]);
      await sheet.getByRole("button", { name: "Create project" }).click();
      await sheet.getByRole("textbox", { name: "Project name" }).and(page.locator("[aria-invalid=true]")).waitFor();
      expect(await axeViolations(page), "sheet errors").toEqual([]);
      await sheet.getByRole("combobox", { name: "Owner" }).click();
      await page.getByRole("option").first().waitFor();
      expect(await axeViolations(page), "owner list").toEqual([]);
      await page.keyboard.press("Escape");
      await sheet.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("listbox").waitFor();
      expect(await axeViolations(page), "status list").toEqual([]);
      // One Escape per layer, as a person would press them (the Select's layer takes a key while it closes).
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "hidden" });
      await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).toBe("");

      await page.getByRole("button", { name: "Actions for Juniper website refresh" }).click();
      await page.getByRole("menu").waitFor();
      expect(await axeViolations(page), "row menu").toEqual([]);
      await page.getByRole("menuitem", { name: "Open" }).click();
      await page.getByRole("dialog", { name: "Juniper website refresh" }).waitFor();
      expect(await axeViolations(page), "details").toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });

      await page.getByRole("button", { name: "Actions for Juniper website refresh" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      await page.getByRole("alertdialog").waitFor();
      expect(await axeViolations(page), "archive dialog").toEqual([]);
    } finally {
      await close();
    }
  });

  it("the page and the sheet reflow at 320px with no horizontal scroll", async () => {
    const { page, close } = await openDashboard(ref.fw, { viewport: { width: 320, height: 800 } });
    try {
      expect(await horizontalOverflow(page)).toBe(false);
      await page.getByRole("button", { name: "New project" }).click();
      await page.getByRole("dialog", { name: "New project" }).waitFor();
      expect(await horizontalOverflow(page)).toBe(false);
      const width = await page.getByRole("dialog", { name: "New project" }).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(width).toBeLessThanOrEqual(1);
    } finally {
      await close();
    }
  });

  it("every button on the page is at least 24x24 and has a name", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, [role=tab], [role=checkbox], [role=switch], a[href]")]
          .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest(".sr-only"))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => (r.width < 24 || r.height < 24) && !(el.tagName === "A" && el.closest("p, li, td, th")))
          .map(({ el, r }) => `${el.tagName} "${(el.textContent ?? "").trim()}" ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      expect(small).toEqual([]);
    } finally {
      await close();
    }
  });
});

// ---- planted bugs --------------------------------------------------------------------------------

describe("W03: Add task never disables and the server ignores the key, so a double click adds 2", () => {
  const ref = useFernway("W03");

  it("the button stays enabled while saving and a double click saves two tasks", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      const posts = recordRequests(page, "/api/tasks", "POST");
      await quickAdd(page).getByRole("textbox", { name: "Task" }).fill("Twice by accident");
      const button = quickAdd(page).getByRole("button", { name: "Add task" });
      await button.dblclick();
      await page.waitForTimeout(100);
      expect(await button.isEnabled()).toBe(true);
      expect(await button.getAttribute("aria-busy")).toBeNull();
      await expect.poll(() => posts.length).toBe(2);
      await expect
        .poll(async () => (await api(ref.fw, "/api/tasks")).body.filter((t: { title: string }) => t.title === "Twice by accident").length, { timeout: 5000 })
        .toBe(2);
    } finally {
      await close();
    }
  });

  it("changes nothing else: New project still disables while saving", async () => {
    const { page, close } = await openDashboard(ref.fw);
    try {
      await page.getByRole("button", { name: "New project" }).click();
      const sheet = page.getByRole("dialog", { name: "New project" });
      await sheet.getByRole("textbox", { name: "Project name" }).fill("Still guarded");
      const hold = await holdRequests(page, "/api/projects", "POST");
      await sheet.getByRole("button", { name: "Create project" }).click();
      await expect.poll(() => hold.seen.length).toBe(1);
      expect(await sheet.getByRole("button", { name: "Create project" }).isDisabled()).toBe(true);
      hold.release();
      await sheet.waitFor({ state: "hidden" });
    } finally {
      await close();
    }
  });
});

describe("W05: icon-only shell buttons have no accessible name on /app", () => {
  const ref = useFernway("W05");

  it("collapse and notifications lose their names (axe reports button-name); everything else on the page is unchanged", async () => {
    const { page, close } = await openDashboard(ref.fw, { reducedMotion: "reduce" });
    try {
      expect(await page.getByRole("button", { name: "Collapse sidebar" }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Notifications" }).count()).toBe(0);
      const violations = await axeViolations(page);
      expect(violations.filter((v) => v.startsWith("button-name")).length).toBe(2);
      expect(violations.filter((v) => !v.startsWith("button-name"))).toEqual([]);
      expect(await page.getByRole("button", { name: "Account menu" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Actions for Northwind rebrand" }).count()).toBe(1);
    } finally {
      await close();
    }
  });
});
