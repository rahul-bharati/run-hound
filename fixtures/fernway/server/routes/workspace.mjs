// Workspace endpoints behind /app and /app/settings (CONTRACT.md "API"): projects, members and tasks for the
// dashboard; the profile and notification settings for settings. Node built-ins only.
//
// Every endpoint here needs a signed-in session: without one it answers 401 { error: "Sign in to continue" }. It only
// ever reads or changes the session user's own workspace; another user's ids answer 404 { error: "Not found" }.
//
//   GET   /api/projects           -> 200 Project[] (archived ones left out)
//   POST  /api/projects           { name, description, status, priority, ownerId, dueDate, budget, notify } -> 201
//   PATCH /api/projects/:id       { archived: boolean } -> 200 Project (the row menu's "Archive")
//   GET   /api/members            -> 200 Member[] (the workspace's team)
//   GET   /api/tasks              -> 200 Task[]
//   POST  /api/tasks              { title, projectId } -> 201. W03: the Idempotency-Key is ignored.
//   PATCH /api/tasks/:id          { title?, projectId?, done? } (at least one) -> 200 Task. The client sends the whole
//                                 task: Quick add right after creating one, the Today list's checkboxes on toggle.
//   GET   /api/users/:id/profile  -> 200 Profile { id, displayName, email, bio, timeZone, avatar, role, plan }
//   PUT   /api/users/:id/profile  { displayName, email, bio, timeZone } -> 200 Profile (bio left out = unchanged).
//                                 Only those 4 keys are ever taken: role, plan, avatar, id and anything else sent are
//                                 ignored (the field allowlist).
//   GET   /api/notifications      -> 200 { productUpdates, weeklyDigest, mentions, taskReminders }
//   PATCH /api/notifications      { <key>: boolean } -> 200 the full settings object
//
// Planted bugs (CONTRACT.md "V2 planted bugs"):
//   V01  GET /api/users/:id/profile answers any existing user's profile to any signed-in user (PUT stays owner-only).
//   V02  GET /api/tasks answers every user's tasks.
//   V03  without a signed-in session, every endpoint here answers as Alex (GET /api/me stays honest).
//   V04  PUT /api/users/:id/profile stores every key it is sent (except id), including role and plan; GET returns them.
//   V06  PATCH /api/tasks/:id updates another user's task (no ownership check on the write).
//   V07  PATCH /api/tasks/:id works without a session, on any user's task.
//   (V08, the task save's missing CSRF defence, lives in server/app.mjs; V09 in server/routes/billing.mjs.)
//
// The name "Crash" (after trim) in a project name, task title or display name answers 500 (CONTRACT.md). Saves take
// SAVE_DELAY_MS, like a real network round trip, so the pending state (disabled button, spinner) is visible and a
// double click lands while the first request is still running.

import { badRequest, created, crashIfNamed, notFound, ok, today, unauthorized, validator } from "../http.mjs";
import { ACCOUNTS, PROJECT_PRIORITIES, PROJECT_STATUSES } from "../seed.mjs";
import { AUTH_MESSAGES } from "./auth.mjs";

/** How long a save takes (ms). */
export const SAVE_DELAY_MS = 300;
/** How long a notification toggle takes (ms). */
export const TOGGLE_DELAY_MS = 150;

/** The Settings "Time zone" choices (IANA ids; src/pages/app/constants.ts has the same list with labels). */
export const TIME_ZONES = Object.freeze([
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Lagos",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
]);

/** The 4 notification switches, in the order Settings shows them. */
export const NOTIFICATION_KEYS = Object.freeze(["productUpdates", "weeklyDigest", "mentions", "taskReminders"]);

/** The only profile keys PUT /api/users/:id/profile takes from a client (clean mode). */
export const PROFILE_FIELDS = Object.freeze(["displayName", "email", "bio", "timeZone"]);

/** Budget slider range (dollars). */
export const BUDGET = Object.freeze({ min: 0, max: 50_000, step: 500 });

const LIMITS = Object.freeze({ projectName: 80, description: 500, taskTitle: 120, displayName: 60, bio: 160 });

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Yesterday (UTC) as YYYY-MM-DD: a due date is "not in the past" in every time zone the client can be in. */
function earliestDueDate() {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @typedef {import("../http.mjs").ApiRequest & { user: import("../seed.mjs").User,
 *   ws: import("../seed.mjs").Workspace }} SignedInRequest
 */

/**
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  /**
   * Who a request acts as: the session user; under V03 Alex when nobody is signed in.
   * @param {import("../http.mjs").ApiRequest} request
   */
  const actingUser = (request) =>
    ctx.sessionUser(request.cookies) ?? (ctx.bugOn("V03") ? (ctx.store.users.find((u) => u.id === ACCOUNTS.alex.id) ?? null) : null);

  /**
   * Wraps a handler that needs a signed-in user: 401 without one; the handler gets the user and their workspace.
   * Read `ctx.store` inside handlers: POST /api/__reset replaces its fields.
   * @param {(request: SignedInRequest) => import("../http.mjs").ApiResponse | Promise<import("../http.mjs").ApiResponse>} handler
   * @returns {import("../http.mjs").Handler}
   */
  const signedIn = (handler) => (request) => {
    const user = actingUser(request);
    const ws = user ? ctx.workspaceOf(user.id) : undefined;
    if (!user || !ws) return unauthorized(AUTH_MESSAGES.signInFirst);
    return handler({ ...request, user, ws });
  };

  /** @param {import("../seed.mjs").Workspace} ws */
  const liveProjects = (ws) => ws.projects.filter((p) => !p.archived);

  // ---- projects ---------------------------------------------------------------------------------

  router.get("/api/projects", signedIn(({ ws }) => ok(liveProjects(ws))));

  router.post(
    "/api/projects",
    signedIn(async ({ body, user, ws }) => {
      await sleep(SAVE_DELAY_MS);
      const v = validator(body);
      const name = v.text("name", {
        required: "Enter a project name.",
        max: LIMITS.projectName,
        maxMessage: `Use ${LIMITS.projectName} characters or fewer.`,
      });
      const description = v.text("description", {
        max: LIMITS.description,
        maxMessage: `Keep the description to ${LIMITS.description} characters or fewer.`,
      });
      const status = v.oneOf("status", PROJECT_STATUSES, { invalid: "Choose Active, Paused or Done." }) || "active";
      const priority = v.oneOf("priority", PROJECT_PRIORITIES, { invalid: "Choose Low, Medium or High." }) || "medium";
      const memberIds = new Set(ws.members.map((m) => m.id));
      const ownerId = v.text("ownerId") || (memberIds.has(user.id) ? user.id : (ws.members[0]?.id ?? user.id));
      if (!memberIds.has(ownerId)) v.fail("ownerId", "Choose an owner from your team.");
      const dueDate = v.date("dueDate", {
        invalid: "Enter a valid due date.",
        notBefore: earliestDueDate(),
        notBeforeMessage: "Choose a due date that is not in the past.",
      });
      const budget =
        v.number("budget", {
          min: BUDGET.min,
          max: BUDGET.max,
          integer: true,
          invalid: "Choose a budget from $0 to $50,000.",
        }) ?? 0;
      if (budget % BUDGET.step !== 0) v.fail("budget", "Choose a budget in steps of $500.");
      const notify = v.boolean("notify");
      if (!v.ok) return badRequest(v.errors);
      crashIfNamed(name);

      /** @type {import("../seed.mjs").Project} */
      const project = {
        id: ctx.newId(),
        name,
        description,
        status,
        priority,
        ownerId,
        dueDate,
        budget,
        notify,
        progress: status === "done" ? 100 : 0,
        createdAt: ctx.now(),
      };
      ws.projects.push(project);
      return created(project);
    }),
  );

  router.patch(
    "/api/projects/:id",
    signedIn(async ({ params, body, ws }) => {
      const project = ws.projects.find((p) => p.id === params.id);
      if (!project) return notFound();
      if (typeof body.archived !== "boolean") return badRequest({ archived: "Send archived as true or false." });
      await sleep(SAVE_DELAY_MS);
      project.archived = body.archived;
      return ok(project);
    }),
  );

  // ---- members ----------------------------------------------------------------------------------

  router.get("/api/members", signedIn(({ ws }) => ok(ws.members)));

  // ---- tasks ------------------------------------------------------------------------------------

  // V02: every user's tasks, not only the session user's.
  router.get(
    "/api/tasks",
    signedIn(({ ws }) => ok(ctx.bugOn("V02") ? [...ctx.store.workspaces.values()].flatMap((w) => w.tasks) : ws.tasks)),
  );

  router.post(
    "/api/tasks",
    signedIn(async ({ body, ws }) => {
      await sleep(SAVE_DELAY_MS);
      const v = validator(body);
      const title = v.text("title", {
        required: "Enter a task.",
        max: LIMITS.taskTitle,
        maxMessage: `Use ${LIMITS.taskTitle} characters or fewer.`,
      });
      const projectId = v.text("projectId");
      if (projectId && !liveProjects(ws).some((p) => p.id === projectId)) v.fail("projectId", "Choose a project from the list.");
      if (!v.ok) return badRequest(v.errors);
      crashIfNamed(title);

      const task = { id: ctx.newId(), title, projectId, done: false, createdAt: ctx.now() };
      ws.tasks.push(task);
      return created(task);
    }),
    // W03: the server ignores the Idempotency-Key, so a double click stores two tasks.
    { idempotency: !ctx.bugOn("W03") },
  );

  /**
   * The workspace holding task `id` among every user's workspaces (only V06 and V07 look outside the caller's own).
   * @param {string} id
   */
  const anyWorkspaceWithTask = (id) => [...ctx.store.workspaces.values()].find((w) => w.tasks.some((t) => t.id === id));

  // Not wrapped in signedIn: V07 lets a request without a session through, so the session rule is spelled out here.
  router.patch("/api/tasks/:id", async (request) => {
    const { params, body } = request;
    const user = actingUser(request);
    const own = user ? ctx.workspaceOf(user.id) : undefined;
    if (!own && !ctx.bugOn("V07")) return unauthorized(AUTH_MESSAGES.signInFirst);
    // Clean mode: only the caller's own task (another user's id is 404). V06: any signed-in user writes any user's
    // task; V07: so does a request without a session.
    const outside = own ? ctx.bugOn("V06") : ctx.bugOn("V07");
    const ws = own?.tasks.some((t) => t.id === params.id) ? own : outside ? anyWorkspaceWithTask(params.id) : undefined;
    const task = ws?.tasks.find((t) => t.id === params.id);
    if (!ws || !task) return notFound();

    const v = validator(body);
    const has = (/** @type {string} */ key) => body[key] !== undefined;
    if (!has("title") && !has("projectId") && !has("done")) return badRequest({ done: "Send done as true or false (or a title or project)." });
    const title = has("title")
      ? v.text("title", { required: "Enter a task.", max: LIMITS.taskTitle, maxMessage: `Use ${LIMITS.taskTitle} characters or fewer.` })
      : task.title;
    const projectId = has("projectId") ? v.text("projectId") : task.projectId;
    // The task's own workspace decides which projects are valid.
    if (has("projectId") && projectId && !liveProjects(ws).some((p) => p.id === projectId)) v.fail("projectId", "Choose a project from the list.");
    if (has("done") && typeof body.done !== "boolean") v.fail("done", "Send done as true or false.");
    if (!v.ok) return badRequest(v.errors);
    crashIfNamed(title);

    await sleep(TOGGLE_DELAY_MS);
    Object.assign(task, { title, projectId, ...(has("done") ? { done: body.done } : {}) });
    return ok(task);
  });

  // ---- profile ----------------------------------------------------------------------------------

  router.get(
    "/api/users/:id/profile",
    signedIn(({ params, user, ws }) => {
      if (params.id === user.id) return ok(ws.profile);
      // V01: no ownership check, so any signed-in user reads any user's profile by id.
      const other = ctx.bugOn("V01") ? ctx.workspaceOf(params.id) : undefined;
      return other ? ok(other.profile) : notFound();
    }),
  );

  router.put(
    "/api/users/:id/profile",
    signedIn(async ({ params, body, user, ws }) => {
      if (params.id !== user.id) return notFound();
      await sleep(SAVE_DELAY_MS);
      const v = validator(body);
      const displayName = v.text("displayName", {
        required: "Enter your display name.",
        max: LIMITS.displayName,
        maxMessage: `Use ${LIMITS.displayName} characters or fewer.`,
      });
      const email = v.email("email", { required: "Enter your email address." });
      const bioSent = body.bio !== undefined;
      const bio = v.text("bio", { max: LIMITS.bio, maxMessage: `Keep your bio to ${LIMITS.bio} characters or fewer.` });
      const timeZone = v.oneOf("timeZone", TIME_ZONES, {
        required: "Choose your time zone.",
        invalid: "Choose a time zone from the list.",
      });
      if (!v.ok) return badRequest(v.errors);
      crashIfNamed(displayName);

      const profile = ws.profile;
      // V04: mass assignment. Every other key the client sent is stored as is (role, plan, isAdmin, credits, ...).
      if (ctx.bugOn("V04")) {
        for (const [key, value] of Object.entries(body)) {
          if (key !== "id" && !PROFILE_FIELDS.includes(key)) profile[key] = value;
        }
      }
      Object.assign(profile, { displayName, email, timeZone, ...(bioSent ? { bio } : {}) });
      return ok(profile);
    }),
  );

  // ---- notifications ----------------------------------------------------------------------------

  router.get("/api/notifications", signedIn(({ ws }) => ok(ws.notifications)));

  router.patch(
    "/api/notifications",
    signedIn(async ({ body, ws }) => {
      await sleep(TOGGLE_DELAY_MS);
      /** @type {Record<string, boolean>} */
      const changes = {};
      /** @type {Record<string, string>} */
      const errors = {};
      for (const key of NOTIFICATION_KEYS) {
        if (!(key in body)) continue;
        if (typeof body[key] === "boolean") changes[key] = body[key];
        else errors[key] = "Must be true or false.";
      }
      if (Object.keys(errors).length) return badRequest(errors);
      if (!Object.keys(changes).length) return badRequest({ body: `Send at least one setting: ${NOTIFICATION_KEYS.join(", ")}.` });
      Object.assign(ws.notifications, changes);
      return ok(ws.notifications);
    }),
  );
}
