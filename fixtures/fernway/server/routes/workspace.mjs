// Workspace endpoints behind /app and /app/settings (CONTRACT.md "API"): projects, members and tasks for the
// dashboard; profile and notification settings for settings. Node built-ins only.
//
//   GET   /api/projects           -> 200 Project[] (archived ones left out)
//   POST  /api/projects           { name, description, status, priority, ownerId, dueDate, budget, notify } -> 201
//   PATCH /api/projects/:id       { archived: boolean } -> 200 Project (the row menu's "Archive")
//   GET   /api/members            -> 200 Member[]
//   GET   /api/tasks              -> 200 Task[]
//   POST  /api/tasks              { title, projectId } -> 201. W03: the Idempotency-Key is ignored.
//   PATCH /api/tasks/:id          { done: boolean } -> 200 Task (the Today list's checkboxes)
//   GET   /api/profile            -> 200 Profile
//   PUT   /api/profile            { displayName, email, bio, timeZone } -> 200 Profile (bio left out = unchanged)
//   GET   /api/notifications      -> 200 { productUpdates, weeklyDigest, mentions, taskReminders }
//   PATCH /api/notifications      { <key>: boolean } -> 200 the full settings object
//
// The name "Crash" (after trim) in a project name, task title or display name answers 500 (CONTRACT.md). Only the
// fields listed are ever read from a body, so unknown keys (id, progress, avatar, role, ...) are ignored. Saves
// take SAVE_DELAY_MS, like a real network round trip, so the pending state (disabled button, spinner) is visible
// and a double click lands while the first request is still running.

import { badRequest, created, crashIfNamed, notFound, ok, today, validator } from "../http.mjs";
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from "../seed.mjs";

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
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  // Read ctx.store.<field> inside handlers: POST /api/__reset replaces the fields.
  const liveProjects = () => ctx.store.projects.filter((p) => !(/** @type {{ archived?: boolean }} */ (p).archived));
  const memberIds = () => new Set(ctx.store.members.map((m) => m.id));

  // ---- projects ---------------------------------------------------------------------------------

  router.get("/api/projects", () => ok(liveProjects()));

  router.post("/api/projects", async ({ body }) => {
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
    const ownerId = v.text("ownerId") || "alex-rivera";
    if (!memberIds().has(ownerId)) v.fail("ownerId", "Choose an owner from your team.");
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
    ctx.store.projects.push(project);
    return created(project);
  });

  router.patch("/api/projects/:id", async ({ params, body }) => {
    const project = ctx.store.projects.find((p) => p.id === params.id);
    if (!project) return notFound();
    if (typeof body.archived !== "boolean") return badRequest({ archived: "Send archived as true or false." });
    await sleep(SAVE_DELAY_MS);
    Object.assign(project, { archived: body.archived });
    return ok(project);
  });

  // ---- members ----------------------------------------------------------------------------------

  router.get("/api/members", () => ok(ctx.store.members));

  // ---- tasks ------------------------------------------------------------------------------------

  router.get("/api/tasks", () => ok(ctx.store.tasks));

  router.post(
    "/api/tasks",
    async ({ body }) => {
      await sleep(SAVE_DELAY_MS);
      const v = validator(body);
      const title = v.text("title", {
        required: "Enter a task.",
        max: LIMITS.taskTitle,
        maxMessage: `Use ${LIMITS.taskTitle} characters or fewer.`,
      });
      const projectId = v.text("projectId");
      if (projectId && !liveProjects().some((p) => p.id === projectId)) v.fail("projectId", "Choose a project from the list.");
      if (!v.ok) return badRequest(v.errors);
      crashIfNamed(title);

      const task = { id: ctx.newId(), title, projectId, done: false, createdAt: ctx.now() };
      ctx.store.tasks.push(task);
      return created(task);
    },
    // W03: the server ignores the Idempotency-Key, so a double click stores two tasks.
    { idempotency: !ctx.bugOn("W03") },
  );

  router.patch("/api/tasks/:id", async ({ params, body }) => {
    const task = ctx.store.tasks.find((t) => t.id === params.id);
    if (!task) return notFound();
    if (typeof body.done !== "boolean") return badRequest({ done: "Send done as true or false." });
    await sleep(TOGGLE_DELAY_MS);
    task.done = body.done;
    return ok(task);
  });

  // ---- profile ----------------------------------------------------------------------------------

  router.get("/api/profile", () => ok(ctx.store.profile));

  router.put("/api/profile", async ({ body }) => {
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

    const profile = ctx.store.profile;
    Object.assign(profile, { displayName, email, timeZone, ...(bioSent ? { bio } : {}) });
    return ok(profile);
  });

  // ---- notifications ----------------------------------------------------------------------------

  router.get("/api/notifications", () => ok(ctx.store.notifications));

  router.patch("/api/notifications", async ({ body }) => {
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
    Object.assign(ctx.store.notifications, changes);
    return ok(ctx.store.notifications);
  });
}
