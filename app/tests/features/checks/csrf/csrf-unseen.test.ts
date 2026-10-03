// csrf (0.6.0 close-out): a forge whose answer Run Hound never sees — "no answer seen" is never read as "no cookie attached"; a stored forge that carried A's session is never titled "(the save needs no session)".
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
/** A request from the page on the other site: an Origin that isn't the app's own. */
const crossSite = (req: RecordedRequest) => typeof req.headers.origin === "string" && req.headers.origin !== `http://${String(req.headers.host)}`;

const PAGE = `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var form = document.getElementById('new');
function load() { fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
  document.getElementById('list').innerHTML = d.tasks.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
form.addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() })
    .then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`;

// A task app with no CSRF defence, SameSite=None cookie: POST /api/tasks stores the title; a request from another site gets no answer at all after it was stored (its connection is closed).
async function lateApp(): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const server = await startFixtureServer({
    pages: { "/app": PAGE },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /api/tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const title = new URLSearchParams(req.body).get("title");
        if (!title) return end(res, 400, { error: "Title required" });
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
        if (crossSite(req)) {
          res.socket?.destroy();
          return;
        }
        return end(res, 201, { task });
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-unseen-"));
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

describe("csrf: a stored forge whose answer Run Hound never saw", () => {
  it("is a finding that never says the save needs no session: the cookies it carried aren't known", async () => {
    const server = await lateApp();
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    // The forge rode on Account A's cookie and was stored.
    expect(forged.length).toBeGreaterThan(0);
    expect(forged.every(signedIn)).toBe(true);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(true);

    expect(result.status, result.notes).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.confidence).toBe("confirmed");
    expect(f.title).not.toMatch(/needs no session/);
    expect(f.title).toMatch(/no CSRF protection/);
    expect(f.meaning).not.toMatch(/attached no cookie/);
    expect(f.meaning).toMatch(/didn't see the app's answer/);
    expect(f.fix).not.toMatch(/with no session at all/);
    const card = JSON.stringify(f.evidence);
    expect(card).not.toMatch(/The browser attached no cookie/);
    expect(result.notes).toMatch(/check Account A/);
  }, 90_000);
});
