// csrf (0.6.0 close-out, review round 1): a hidden value that only looks random (UUID reference) is left out by value alone; a 4xx/2xx-no-store refusal may be the reference, not a CSRF defence — inconclusive, never a pass. 403/419 still passes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check } from "../../../../src/checks/csrf.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "cf7e57a1";
const MARKER = /cf7e57a1csrf/i;
const LIST_ID = "3f2a1b4c-5d6e-4f80-9a1b-2c3d4e5f6a7b";
const RAILS_TOKEN = "Zk3q9XbR2mT7vN4cL8pW1yH6sD5gJ0aE";

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

interface AppOptions {
  /** A native form post that lands on /done (a page with no form), or a fetch that stays on the page. */
  native: boolean;
  /** The status a body without list_id is refused with. */
  refuse: number;
  /** A named anti-CSRF token (Rails' authenticity_token) the save also needs, refused with `refuse` too. */
  railsToken?: boolean;
}

// A task app with no CSRF defence (SameSite=None cookie, no Origin check) unless `railsToken`; form carries a hidden list_id (UUID, the list the task goes in), POST /tasks refuses a body without it.
async function refApp(o: AppOptions): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const form = o.native ? `<form method="post" action="/tasks" aria-label="New task">` : `<form id="new" aria-label="New task">`;
  const spa = o.native
    ? ""
    : `<script>document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault();
  fetch('/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(e.target)).toString() })
  .then(function () { location.reload(); }); });</script>`;
  const token = o.railsToken ? `<input type="hidden" name="authenticity_token" value="${RAILS_TOKEN}">` : "";
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
${form}${token}<input type="hidden" name="list_id" value="${LIST_ID}"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}${spa}</body></html>`,
      "/done": `<!doctype html><html lang="en"><head><title>Saved</title></head><body><main><h1>Task saved</h1><ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const p = new URLSearchParams(req.body);
        if (o.railsToken && p.get("authenticity_token") !== RAILS_TOKEN) return end(res, o.refuse, { error: "Can't verify CSRF token authenticity" });
        if (p.get("list_id") !== LIST_ID) return end(res, o.refuse, { error: "Unknown list" });
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-ref-"));
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

describe("csrf: a hidden UUID reference the save needs, left out as a possible token", () => {
  for (const native of [true, false]) {
    for (const refuse of [400, 422]) {
      it(`${native ? "native post that leaves the page" : "fetch that stays on the page"}, refused ${refuse}: inconclusive, never a pass`, async () => {
        const server = await refApp({ native, refuse });
        const result = await run(server);
        // Account A's own save went through (it carried list_id).
        expect(server.tasks.some((t) => /cf7e57a1/.test(t.title) && !MARKER.test(t.title))).toBe(true);
        // The forge ran, rode on A's cookie, left list_id out, and was refused.
        const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
        expect(forged.length, result.notes).toBeGreaterThan(0);
        expect(forged.every(signedIn)).toBe(true);
        for (const r of forged) expect(r.body).not.toContain(LIST_ID);
        expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);

        expect(result.status, result.notes).not.toBe("pass");
        expect(result.status, result.notes).toBe("skipped");
        expect(result.findings).toEqual([]);
        expect(result.notes).toMatch(/^Inconclusive/);
        expect(result.notes).toContain("list_id");
        expect(result.notes).toMatch(/a random value in a hidden input Run Hound can't place \(a token, or a reference such as an id\)/);
        expect(result.notes).not.toMatch(/list_id, which carr(?:ies|y) Account A's anti-CSRF token/);
        expect(result.notes).not.toMatch(/stopped it\)/);
        expect(result.notes).toContain(`(${refuse})`);
        expect(JSON.stringify(result)).not.toContain(LIST_ID);
      }, 90_000);
    }
  }

  it("a 2xx that stores nothing, with the reference left out: inconclusive, never a pass", async () => {
    const server = await refApp({ native: false, refuse: 200 });
    const result = await run(server);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/Run Hound can't place/);
  }, 90_000);

  it("a named token (authenticity_token) left out too, refused 422 by the CSRF defence: still inconclusive while the reference is out", async () => {
    // Rails answers a missing authenticity_token with 422; with list_id also left out, Run Hound can't tell which one
    // the app refused, so this is not a pass (the safe side), and the notes name both fields for what they are.
    const server = await refApp({ native: true, refuse: 422, railsToken: true });
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    expect(forged.length, result.notes).toBeGreaterThan(0);
    for (const r of forged) {
      expect(r.body).not.toContain(RAILS_TOKEN);
      expect(r.body).not.toContain(LIST_ID);
    }
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/authenticity_token, which carries Account A's anti-CSRF token/);
    expect(result.notes).toMatch(/list_id, a random value in a hidden input Run Hound can't place/);
    expect(JSON.stringify(result)).not.toContain(RAILS_TOKEN);
  }, 90_000);
});

describe("csrf: a save URL whose query carries a value a hidden input also holds", () => {
  it("left out of the URL as a value Run Hound can't place, never as Account A's anti-CSRF token; refused 400: inconclusive", async () => {
    // The page keeps the current list in a hidden input outside the form, and the form posts to /tasks?list=<that id>.
    const tasks: { id: string; title: string }[] = [];
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<input type="hidden" name="current_list" value="${LIST_ID}">
<form method="post" action="/tasks?list=${LIST_ID}" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
        "/done": `<!doctype html><html lang="en"><head><title>Saved</title></head><body><main><h1>Task saved</h1><ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
      },
      routes: {
        "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
        "POST /tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          if (new URL(req.url, "http://x").searchParams.get("list") !== LIST_ID) return end(res, 400, { error: "Unknown list" });
          tasks.push({ id: `t${tasks.length + 1}`, title: new URLSearchParams(req.body).get("title") ?? "" });
          res.writeHead(303, { location: "/done" });
          res.end();
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
    for (const r of forged) expect(r.url).not.toContain(LIST_ID);
    expect(tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/list, a random value the app's own page added that Run Hound can't place/);
    expect(result.notes).not.toMatch(/Account A's anti-CSRF token/);
    expect(JSON.stringify(result)).not.toContain(LIST_ID);
  }, 90_000);
});

describe("csrf: a named token alone, refused with the status a CSRF defence gives", () => {
  it("authenticity_token left out and the forge refused 422 (Rails): a pass, the token named as a token", async () => {
    const tasks: { id: string; title: string }[] = [];
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form method="post" action="/tasks" aria-label="New task"><input type="hidden" name="authenticity_token" value="${RAILS_TOKEN}"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
        "/done": `<!doctype html><html lang="en"><head><title>Saved</title></head><body><main><h1>Task saved</h1><ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
      },
      routes: {
        "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
        "POST /tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          const p = new URLSearchParams(req.body);
          if (p.get("authenticity_token") !== RAILS_TOKEN) return end(res, 422, { error: "Can't verify CSRF token authenticity" });
          tasks.push({ id: `t${tasks.length + 1}`, title: p.get("title") ?? "" });
          res.writeHead(303, { location: "/done" });
          res.end();
        },
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
    });
    servers.push(server);
    const result = await run(server);
    expect(tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/authenticity_token, which carries Account A's anti-CSRF token/);
    expect(result.notes).not.toMatch(/can't place/);
  }, 90_000);
});
