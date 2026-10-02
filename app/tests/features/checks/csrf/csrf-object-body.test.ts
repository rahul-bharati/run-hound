// csrf (0.6.0 close-out, review round 1): a JSON-object body with no forgeable text field (the page encodes the typed value) is skipped; the skip says "JSON object", never "a bare JSON value, not an object".
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

const PAGE = `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var form = document.getElementById('new');
function load() { fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
  document.getElementById('list').innerHTML = d.tasks.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
form.addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { b64: btoa(form.elements.title.value) } }) })
    .then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`;

/** A task app whose save is a JSON object carrying the title base64-encoded, parsed whatever its content-type. No CSRF defence. */
async function encodedApp(): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const server = await startFixtureServer({
    pages: { "/app": PAGE },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /api/tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        let title = "";
        try {
          const body = JSON.parse(req.body) as { data?: { b64?: unknown } };
          title = Buffer.from(String(body.data?.b64 ?? ""), "base64").toString("utf8");
        } catch {
          return end(res, 400, { error: "Bad JSON" });
        }
        if (!title) return end(res, 400, { error: "Title required" });
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-object-"));
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

describe("csrf: a save whose JSON body is an object with no text field to forge", () => {
  it("is skipped with a reason that says it is a JSON object, never a bare JSON value, and nothing is forged", async () => {
    const server = await encodedApp();
    const result = await run(server);
    // Account A's own save went through (the server decoded the title).
    expect(server.tasks.some((t) => /cf7e57a1/.test(t.title))).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).not.toMatch(/bare JSON value/);
    expect(result.notes).not.toMatch(/not an object/);
    expect(result.notes).toMatch(/a JSON object with no text field Run Hound can forge/);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
  }, 90_000);
});
