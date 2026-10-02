// csrf (0.6.0 round 3): Account A's own writes are judged from the first keystroke; autosave writes held and judged too, save-then-fallback notes never say "nothing was changed", and a GraphQL mutation on A's record is held and not forged.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check } from "../../../../src/checks/csrf.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Lowercase letters and digits, so canary values keep it verbatim; must not contain "csrf" (the forged marker suffix). */
const RUN_TOKEN = "cf7e57a1";

let browser: Browser;
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

/** A SameSite=None session cookie: a forge at Account A's record would ride on it. */
function session(host: string): SessionState {
  return {
    cookies: [{ name: "sid", value: "a-session", domain: host, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" }],
    origins: [],
  };
}

const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));

function end(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parse(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

const FAVICON = {
  "GET /favicon.ico": (_req: RecordedRequest, res: ServerResponse) => {
    res.writeHead(204);
    res.end();
  },
};

async function discover(url: string, state: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

function scenarioFor(page: DiscoveredPage): Scenario {
  const form = page.forms[0]!;
  const planned = check.plan(form, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  return { ...planned, scope: "form", formIndex: 0 };
}

/** Runs csrf on `path` of `server`, reached on localhost (the other site is 127.0.0.1). */
async function runAt(server: FixtureServer, path: string): Promise<CheckResult> {
  const base = server.url.replace("127.0.0.1", "localhost");
  const self = session("localhost");
  const page = await discover(`${base}${path}`, self);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-hold-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl: `${base}${path}`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self },
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  return check.run(ctx, scenarioFor(page));
}

/** Requests the app got from a page on another site (an Origin that isn't the app's own). */
const fromOtherSite = (server: FixtureServer) =>
  server.requests.filter((r) => r.method !== "GET" && r.headers.origin !== undefined && r.headers.origin !== `http://${String(r.headers.host)}`);

type Profile = Record<string, string>;

// Account A's profile {id: "u1", displayName: "Alice", bio} read with GET /api/profile; `save` "autosave" POSTs each field as it changes (whole profile on submit), "fallback" PUTs to /api/profile on submit and, when that fails, POSTs to /api/profile/save.
async function profileApp(save: "autosave" | "fallback"): Promise<FixtureServer & { profile: Profile }> {
  const profile: Profile = { id: "u1", displayName: "Alice", bio: "Hello from Alice" };
  const apply = (req: RecordedRequest, res: ServerResponse) => {
    if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
    const body = parse(req.body);
    for (const k of ["displayName", "bio"]) if (typeof body[k] === "string") profile[k] = body[k] as string;
    return end(res, 200, profile);
  };
  const script =
    save === "autosave"
      ? `function save(body) { return fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
['dn', 'bio'].forEach(function (id) {
  var el = document.getElementById(id);
  el.addEventListener('change', function () { var b = {}; b[el.name] = el.value; save(b).then(function () { document.getElementById('status').textContent = 'Saved automatically'; }); });
});
document.getElementById('p').addEventListener('submit', function (e) {
  e.preventDefault();
  save({ displayName: document.getElementById('dn').value, bio: document.getElementById('bio').value }).then(function () { document.getElementById('status').textContent = 'Profile saved'; });
});`
      : `document.getElementById('p').addEventListener('submit', function (e) {
  e.preventDefault();
  var body = JSON.stringify({ displayName: document.getElementById('dn').value, bio: document.getElementById('bio').value });
  fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: body })
    .catch(function () { return fetch('/api/profile/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }); })
    .then(function () { document.getElementById('status').textContent = 'Profile saved'; });
});`;
  const server = await startFixtureServer({
    pages: {
      "/settings": `<!doctype html><html lang="en"><head><title>Profile</title></head><body><main><h1>Profile</h1>
<form id="p" aria-label="Your profile"><label for="dn">Display name</label><input id="dn" name="displayName">
<label for="bio">Bio</label><textarea id="bio" name="bio"></textarea>
<button type="submit">Save profile</button></form><p role="status" id="status"></p></main>
<script>
fetch('/api/profile').then(function (r) { return r.json(); }).then(function (p) { document.getElementById('dn').value = p.displayName; document.getElementById('bio').value = p.bio; });
${script}
</script></body></html>`,
    },
    routes: {
      ...FAVICON,
      "GET /api/profile": (req, res) => (signedIn(req) ? end(res, 200, profile) : end(res, 401, { error: "Sign in first" })),
      "POST /api/profile": apply,
      "PUT /api/profile": apply,
      "POST /api/profile/save": apply,
    },
  });
  servers.push(server);
  return Object.assign(server, { profile });
}

describe("csrf: the form's writes are judged from the first keystroke", () => {
  it("never writes to Account A's own profile through an autosave fired while Run Hound types", async () => {
    const server = await profileApp("autosave");
    const before = JSON.stringify(server.profile);
    const result = await runAt(server, "/settings");
    const writes = server.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url} ${r.body}`);
    expect(JSON.stringify(server.profile), `writes that reached the app: ${writes.join(" | ")}`).toBe(before);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/changes a record Account A already had/);
    expect(result.notes).toMatch(/stopped the form's save \(POST \/api\/profile\) before it reached the app/);
    expect(fromOtherSite(server)).toEqual([]);
  }, 60_000);

  it("never says nothing was changed when the page sent the stopped save's values another way that reached the app", async () => {
    const server = await profileApp("fallback");
    const result = await runAt(server, "/settings");
    // The PUT was stopped; the page's fallback POST reached the app and changed Account A's profile.
    expect(server.requests.some((r) => r.method === "POST" && r.url === "/api/profile/save")).toBe(true);
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/changes a record Account A already had/);
    expect(result.notes).not.toMatch(/nothing was changed/);
    expect(result.notes).toMatch(/POST \/api\/profile\/save/);
    expect(result.notes).toMatch(/reached the app/);
    expect(result.notes).toMatch(/check Account A/);
    expect(fromOtherSite(server)).toEqual([]);
  }, 60_000);
});

// A GraphQL app (POST /graphql for reads and writes): the page reads A's tasks with a query and the form renames t1 ("Groceries", A's own) with a mutation whose variables name it. No CSRF defence, SameSite=None cookie.
async function graphqlApp(): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks = [{ id: "t1", title: "Groceries" }];
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Task</title></head><body><main><h1>Task</h1><p id="current"></p>
<form id="rename" aria-label="Rename task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Save</button></form></main>
<script>
var TASK_ID = null;
function gql(q, v) { return fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: v || {} }) }).then(function (r) { return r.json(); }); }
function load() { return gql('query Tasks { tasks { id title } }').then(function (d) { var t = d.data.tasks[0]; TASK_ID = t.id; document.getElementById('current').textContent = t.title; }); }
document.getElementById('rename').addEventListener('submit', function (e) {
  e.preventDefault();
  gql('mutation UpdateTask($id: ID!, $title: String!) { updateTask(id: $id, title: $title) { id title } }', { id: TASK_ID, title: document.getElementById('title').value }).then(load);
});
load();
</script></body></html>`,
    },
    routes: {
      ...FAVICON,
      "POST /graphql": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { errors: [{ message: "Sign in first" }] });
        const b = parse(req.body);
        const vars = (b.variables ?? {}) as Record<string, unknown>;
        if (/^\s*mutation/.test(String(b.query ?? ""))) {
          const t = tasks.find((x) => x.id === vars.id);
          if (!t) return end(res, 200, { errors: [{ message: "Not found" }] });
          if (typeof vars.title === "string") t.title = vars.title;
          return end(res, 200, { data: { updateTask: t } });
        }
        return end(res, 200, { data: { tasks } });
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

describe("csrf: a GraphQL edit form that renames a task Account A already had", () => {
  it("stops the mutation before it reaches the app (the hold learns t1 from the page's POST query), and forges nothing", async () => {
    const server = await graphqlApp();
    const result = await runAt(server, "/app");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(fromOtherSite(server)).toEqual([]);
    // Account A's own task is never written to (close-out round 1: this was open, the mutation reached the app).
    expect(server.tasks[0]!.title).toBe("Groceries");
    expect(server.requests.filter((r) => r.method === "POST" && /"query":"\s*mutation/.test(r.body))).toEqual([]);
    expect(result.notes).toMatch(/changes a record Account A already had/);
    expect(result.notes).toMatch(/stopped the form's save \(POST \/graphql\) before it reached the app, so nothing was changed/);
  }, 60_000);
});
