// csrf (0.6.0 close-out, review round 2): a 403 on a hidden value Run Hound left out is inconclusive when the value looks like a reference (authorization check), a pass when it doesn't (and the note never names a defence Run Hound didn't see).
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
const RUN_TOKEN = "cf7e57a1";
const MARKER = /cf7e57a1csrf/i;
const LIST_UUID = "3f2a1b4c-5d6e-4f80-9a1b-2c3d4e5f6a7b";
const OBJECT_ID = "65f1a2b3c4d5e6f708192a3b";
const HEX_TOKEN = "9f2c1e7b4a6d8053e1c2b9a7f4d6e8c1";
const DEFENCE_CLAIM = /stopped it\)/;

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

const self: SessionState = {
  cookies: [{ name: "sid", value: "a-session", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" }],
  origins: [],
};

function end(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));
const crossSite = (req: RecordedRequest) => typeof req.headers.origin === "string" && req.headers.origin !== `http://${String(req.headers.host)}`;

const LIST_SCRIPT = `<script>
fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
  document.getElementById('list').innerHTML = d.tasks.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); });
</script>`;

const DONE = `<!doctype html><html lang="en"><head><title>Saved</title></head><body><main><h1>Task saved</h1><ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`;

interface AppOptions {
  /** A native form post that lands on /done, or a fetch that stays on the page. */
  native: boolean;
  /** The hidden input's name and value; POST /tasks refuses a body without that value with `refuse`. */
  field: string;
  value: string;
  refuse: number;
}

// A task app with no CSRF defence (SameSite=None cookie, no token, no Origin check): only the hidden value (a reference a page may know, or a token it may not) stands between it and a forged save.
async function hiddenApp(o: AppOptions): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const form = o.native ? `<form method="post" action="/tasks" aria-label="New task">` : `<form id="new" aria-label="New task">`;
  const spa = o.native
    ? ""
    : `<script>document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault();
  fetch('/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(e.target)).toString() })
  .then(function () { location.reload(); }); });</script>`;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
${form}<input type="hidden" name="${o.field}" value="${o.value}"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}${spa}</body></html>`,
      "/done": DONE,
    },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const p = new URLSearchParams(req.body);
        if (p.get(o.field) !== o.value) return end(res, o.refuse, { error: "You can't add tasks to that list" });
        const title = p.get("title");
        if (!title) return end(res, 400, { error: "Title required" });
        tasks.push({ id: `t${tasks.length + 1}`, title });
        if (o.native) {
          res.writeHead(303, { location: "/done" });
          res.end();
          return;
        }
        return end(res, 201, { ok: true });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

async function discover(url: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: self });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

async function run(server: FixtureServer): Promise<CheckResult> {
  const targetUrl = `${server.url}/app`;
  const page = await discover(targetUrl);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-ref403-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self },
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  const planned = check.plan(page.forms[0]!, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  const scenario: Scenario = { ...planned, scope: "form", formIndex: 0 };
  return check.run(ctx, scenario);
}

/** The forge ran, rode on Account A's cookie, left the hidden value out, and stored nothing. */
function expectRefusedForge(server: FixtureServer & { tasks: { title: string }[] }, value: string, notes: string | undefined) {
  const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
  expect(forged.length, notes).toBeGreaterThan(0);
  expect(forged.every(signedIn)).toBe(true);
  for (const r of forged) expect(r.body).not.toContain(value);
  expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
}

describe("csrf: a hidden reference left out, and the forge refused with 403", () => {
  for (const native of [true, false]) {
    it(`list_id holding a UUID (${native ? "native post" : "fetch"}): inconclusive, never a pass`, async () => {
      const server = await hiddenApp({ native, field: "list_id", value: LIST_UUID, refuse: 403 });
      const result = await run(server);
      expectRefusedForge(server, LIST_UUID, result.notes);
      expect(result.status, result.notes).toBe("skipped");
      expect(result.findings).toEqual([]);
      expect(result.notes).toMatch(/^Inconclusive/);
      expect(result.notes).toContain("(403)");
      expect(result.notes).toMatch(/list_id looks like a reference/);
      expect(result.notes).toMatch(/list_id, a random value in a hidden input Run Hound can't place/);
      expect(result.notes).not.toMatch(DEFENCE_CLAIM);
      expect(result.notes).not.toMatch(/Account A's anti-CSRF token/);
      expect(JSON.stringify(result)).not.toContain(LIST_UUID);
    }, 90_000);
  }

  it("a hidden value under a plain name holding an ObjectId: inconclusive, never a pass", async () => {
    const server = await hiddenApp({ native: false, field: "list", value: OBJECT_ID, refuse: 403 });
    const result = await run(server);
    expectRefusedForge(server, OBJECT_ID, result.notes);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/list looks like a reference/);
    expect(JSON.stringify(result)).not.toContain(OBJECT_ID);
  }, 90_000);

  it("a camelCase id name (listId) holding a random value: inconclusive, never a pass", async () => {
    const server = await hiddenApp({ native: false, field: "listId", value: HEX_TOKEN, refuse: 403 });
    const result = await run(server);
    expectRefusedForge(server, HEX_TOKEN, result.notes);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/listId looks like a reference/);
  }, 90_000);

  it("the same reference refused with 419 (Laravel's answer to a missing CSRF token): a pass that names no defence it didn't see", async () => {
    const server = await hiddenApp({ native: false, field: "list_id", value: LIST_UUID, refuse: 419 });
    const result = await run(server);
    expectRefusedForge(server, LIST_UUID, result.notes);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).not.toMatch(DEFENCE_CLAIM);
    expect(result.notes).toMatch(/can't rule out that the app refused a missing value/);
    expect(result.notes).toContain("left out list_id");
  }, 90_000);
});

describe("csrf: a hidden value nothing says is a reference, refused with 403", () => {
  it("formToken of hex: a pass, but the note never names a defence Run Hound didn't see", async () => {
    const server = await hiddenApp({ native: true, field: "formToken", value: HEX_TOKEN, refuse: 403 });
    const result = await run(server);
    expectRefusedForge(server, HEX_TOKEN, result.notes);
    expect(result.status, result.notes).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.notes).not.toMatch(DEFENCE_CLAIM);
    expect(result.notes).toMatch(/can't rule out that the app refused a missing value/);
    expect(result.notes).toContain("left out formToken");
    expect(result.notes).not.toMatch(/looks like a reference/);
    expect(JSON.stringify(result)).not.toContain(HEX_TOKEN);
  }, 90_000);
});

describe("csrf: a body value that only the save's URL held", () => {
  it("is named as the URL's value, never as a value in a hidden input", async () => {
    // The page's script posts to /tasks?list=<id> with list=<id> in the body too; no hidden input holds the id.
    const tasks: { id: string; title: string }[] = [];
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}
<script>var LIST = ${JSON.stringify(OBJECT_ID)};
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault();
  fetch('/tasks?list=' + LIST, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ list: LIST, title: document.getElementById('t').value }).toString() })
  .then(function () { location.reload(); }); });</script></body></html>`,
      },
      routes: {
        "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
        "POST /tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          const p = new URLSearchParams(req.body);
          if (new URL(req.url, "http://x").searchParams.get("list") !== OBJECT_ID || p.get("list") !== OBJECT_ID) return end(res, 400, { error: "Unknown list" });
          tasks.push({ id: `t${tasks.length + 1}`, title: p.get("title") ?? "" });
          return end(res, 201, { ok: true });
        },
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
    });
    servers.push(server);
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    expect(forged.length, result.notes).toBeGreaterThan(0);
    for (const r of forged) {
      expect(r.url).not.toContain(OBJECT_ID);
      expect(r.body).not.toContain(OBJECT_ID);
    }
    expect(tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/list, a random value from the save's URL Run Hound can't place/);
    expect(result.notes).not.toMatch(/in a hidden input/);
    expect(JSON.stringify(result)).not.toContain(OBJECT_ID);
  }, 90_000);
});
