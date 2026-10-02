// csrf (0.6.0 close-out, review round 2): a forge answered after the wait — refused-late is inconclusive (no defence named), stored-then-late-answer is a finding whose cookies aren't named "no cookie".
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
import { setForgeWaitMs } from "../../../../src/checks/lib/cross-site.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "cf7e57a1";
const MARKER = /cf7e57a1csrf/i;
const WAIT_MS = 2_000;
/** Later than the shortened wait. */
const LATE_MS = 4_000;

let browser: Browser;
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];
/** Answers still waiting when a test ends: cleared, and their connections closed. */
const pending: { timer: ReturnType<typeof setTimeout>; res: ServerResponse }[] = [];

beforeAll(async () => {
  setForgeWaitMs(WAIT_MS);
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  for (const p of pending.splice(0)) {
    clearTimeout(p.timer);
    p.res.destroy();
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(async () => {
  setForgeWaitMs();
  await closeBrowser();
});

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

/** The title of a save, whatever it was sent as (JSON, form-encoded or JSON as text/plain). */
function titleOf(body: string): string | null {
  try {
    const v = JSON.parse(body) as { title?: unknown };
    return typeof v.title === "string" ? v.title : null;
  } catch {
    return new URLSearchParams(body).get("title");
  }
}

const PAGE = `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var form = document.getElementById('new');
function load() { fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
  document.getElementById('list').innerHTML = d.tasks.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
form.addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('t').value }) })
    .then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`;

// A task app with no CSRF defence, SameSite=None cookie; JSON save also takes form-encoded or text/plain. A request from another site is answered only after LATE_MS: refused with 403 (`store` false) or stored at once and answered 201 (`store` true).
async function slowApp(store: boolean): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const server = await startFixtureServer({
    pages: { "/app": PAGE },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /api/tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const title = titleOf(req.body);
        if (!title) return end(res, 400, { error: "Title required" });
        if (crossSite(req)) {
          if (store) tasks.push({ id: `t${tasks.length + 1}`, title });
          pending.push({ res, timer: setTimeout(() => (store ? end(res, 201, { ok: true }) : end(res, 403, { error: "Forbidden" })), LATE_MS) });
          return;
        }
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-late-answer-"));
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

describe("csrf: a forge the app answers only after the forge's wait", () => {
  it("refused late with nothing stored: inconclusive, never a pass, and no second encoding is sent on top of it", async () => {
    const server = await slowApp(false);
    const result = await run(server);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    // Only the form-encoded forge: nothing is sent on top of a forge with no answer.
    expect(forged, result.notes).toHaveLength(1);
    expect(forged.every(signedIn)).toBe(true);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);

    expect(result.status, result.notes).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toContain("none came within 2 seconds");
    expect(result.notes).toContain("form-encoded (no answer within 2 seconds)");
    expect(result.notes).toMatch(/check Account A/);
    expect(result.notes).not.toMatch(/stopped it|text\/plain/);
  }, 90_000);

  it("stored at once and answered late: a confirmed finding that says the cookies it carried aren't known", async () => {
    const server = await slowApp(true);
    const result = await run(server);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(true);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.confidence).toBe("confirmed");
    expect(f.title).toMatch(/no CSRF protection/);
    expect(f.title).not.toMatch(/needs no session/);
    expect(f.meaning).toMatch(/didn't see the app's answer/);
    expect(result.notes).toMatch(/check Account A/);
  }, 90_000);
});
