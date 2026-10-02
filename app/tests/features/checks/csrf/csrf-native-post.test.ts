/**
 * csrf (0.6.0 close-out): a plain HTML form posted natively (no script), whose anti-CSRF token is a hidden input under a
 * name no framework list knows (a home-made formToken). The post leaves the page: the app answers 303 to a page with no
 * form, so the token is no longer in the page once the save was sent. It is read before the submit, so the forged body
 * still leaves it out (docs/v2-spec.md "`csrf`": "Nothing is added to them (no token …)"), and the app's refusal is a
 * pass, never a confirmed "no CSRF protection" on a token-protected app.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./csrf.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "cf7e57a1";
const MARKER = /cf7e57a1csrf/i;
const TOKEN = "9f2c1e7b4a6d8053e1c2b9a7f4d6e8c1";

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
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));
const crossSite = (req: RecordedRequest) => typeof req.headers.origin === "string" && req.headers.origin !== `http://${String(req.headers.host)}`;

const LIST_SCRIPT = `<script>
fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) {
  document.getElementById('list').innerHTML = d.tasks.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); });
</script>`;

/**
 * GET /app: a native form (POST /tasks, form-encoded) with the token in a hidden `field`. POST /tasks refuses a body
 * without the token (403), else stores the task and answers 303 to /done, a page with the list and no form or token.
 * No other defence, and a SameSite=None cookie: only the token stops a page on another site.
 */
async function nativeApp(field: string): Promise<FixtureServer & { tasks: { id: string; title: string }[] }> {
  const tasks: { id: string; title: string }[] = [];
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form method="post" action="/tasks" aria-label="New task"><input type="hidden" name="${field}" value="${TOKEN}"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
      "/done": `<!doctype html><html lang="en"><head><title>Saved</title></head><body><main><h1>Task saved</h1><ul id="list"></ul></main>${LIST_SCRIPT}</body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /tasks": (req, res) => {
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const params = new URLSearchParams(req.body);
        if (params.get(field) !== TOKEN) return end(res, 403, { error: "Bad CSRF token" });
        const title = params.get("title");
        if (!title) return end(res, 400, { error: "Title required" });
        tasks.push({ id: `t${tasks.length + 1}`, title });
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
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-native-"));
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

describe("csrf: a native form post that leaves the page, with a hidden token under a name no list knows", () => {
  it.each(["formToken", "sesskey"])("%s: read before the submit and left out, so the app's refusal is a pass", async (field) => {
    const server = await nativeApp(field);
    const result = await run(server);
    // Account A's own save went through natively (it carried the token).
    expect(server.tasks.some((t) => /cf7e57a1/.test(t.title))).toBe(true);
    const forged = server.requests.filter((r) => r.method === "POST" && crossSite(r));
    expect(forged.length, result.notes).toBeGreaterThan(0);
    for (const r of forged) expect(r.body).not.toContain(TOKEN);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain(`left out ${field}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  }, 90_000);
});
