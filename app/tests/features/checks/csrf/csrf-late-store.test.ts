// csrf (0.6.0 close-out, review round 1): a forge the app answers late (or never) — form/multipart forge waited on for the app's answer; late-stored is a finding, never-answered is inconclusive and never names a defence.
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
/** Longer than the 5 s the form forge used to wait for its answer. */
const LATE_MS = 7_000;

let browser: Browser;
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];
const timers: NodeJS.Timeout[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  timers.splice(0).forEach(clearTimeout);
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

// A task app with no CSRF defence, SameSite=None cookie; a request from another site is handled by `crossSiteSave` (gets the store function and the response), every other one is stored and answered at once.
async function app(
  crossSiteSave: (store: () => { id: string; title: string }, res: ServerResponse) => void,
): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const server = await startFixtureServer({
    pages: { "/app": PAGE },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /api/tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const title = new URLSearchParams(req.body).get("title");
        if (!title) return end(res, 400, { error: "Title required" });
        const store = () => {
          const task = { id: `t${tasks.length + 1}`, title };
          tasks.push(task);
          return task;
        };
        if (crossSite(req)) return crossSiteSave(store, res);
        return end(res, 201, { task: store() });
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-late-"));
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

describe("csrf: a form-encoded forge the app answers late, or never", () => {
  it("stored and answered 7 s later: waited for, a confirmed finding, and the forged record is named (check Account A)", async () => {
    const server = await app((store, res) => {
      timers.push(setTimeout(() => end(res, 201, { task: store() }), LATE_MS));
    });
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    expect(forged.length).toBeGreaterThan(0);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(true);

    expect(result.status, result.notes).not.toBe("pass");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.confidence).toBe("confirmed");
    // The answer was waited for, so the cookies the forge carried are known.
    expect(f.meaning).toMatch(/attached Account A's cookie sid \(SameSite=None\)/);
    expect(result.notes).toMatch(/check Account A/);
  }, 120_000);

  it("the connection closes with no answer and nothing is stored yet: inconclusive, never a pass, and it says to check Account A", async () => {
    // The app stores the forge only after Run Hound's re-read (a queue behind a proxy that dropped the connection).
    let storedLater!: () => void;
    const later = new Promise<void>((resolve) => (storedLater = resolve));
    const server = await app((store, res) => {
      timers.push(
        setTimeout(() => {
          store();
          storedLater();
        }, 5_000),
      );
      res.socket?.destroy();
    });
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    expect(forged.length).toBeGreaterThan(0);
    expect(forged.every(signedIn)).toBe(true);

    expect(result.status, result.notes).not.toBe("pass");
    expect(result.status, result.notes).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/didn't answer/);
    expect(result.notes).toMatch(/may still store it/);
    expect(result.notes).toMatch(/check Account A/);
    // No defence is named when no answer was seen.
    expect(result.notes).not.toMatch(/SameSite cookie, a CSRF token or an Origin check/);
    // The app did store it later: the notes were right to send the user to Account A.
    await later;
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(true);
  }, 120_000);
});
