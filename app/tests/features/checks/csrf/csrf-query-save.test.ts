/**
 * csrf (0.6.0 round 2): which save is forged, and what its URL carries (docs/v2-spec.md "`csrf`": "only the save
 * request this form already makes for the run's test record … Nothing is added to them (no token, no credential
 * header)"; "Evidence redacts … CSRF tokens").
 *   - an anti-CSRF token or a credential in the save's query string (Spring's ?_csrf=, ?access_token=) is never sent
 *     from the other site, and neither the finding nor the exported spec holds it;
 *   - a stored forge after a credential was left out of the URL is inconclusive, never "the save needs no session";
 *   - a POST the form sends before its save (a validation call that stores nothing) is never the one forged, and when
 *     several POSTs carry the typed values and none can be tied to the record, the result is never a pass.
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
import { queryParamKind, withoutQueryCredentials } from "./lib/cross-site-query.js";

const A: AccountRef = { id: "a", label: "Account A" };
/** Lowercase letters and digits, so canary values keep it verbatim; must not contain "csrf" (the forged marker suffix). */
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

function session(host: string, sameSite: "Lax" | "None"): SessionState {
  return {
    cookies: [{ name: "sid", value: "a-session", domain: host, path: "/", expires: -1, httpOnly: true, secure: sameSite === "None", sameSite }],
    origins: [],
  };
}

function end(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));
const query = (req: RecordedRequest, name: string) => new URL(req.url, "http://x").searchParams.get(name);

/** A request body's title, parsed as JSON whatever its content-type, else form-encoded. */
function titleOf(body: string): string | null {
  try {
    const v = JSON.parse(body) as { title?: unknown };
    return typeof v?.title === "string" ? v.title : null;
  } catch {
    return new URLSearchParams(body).get("title");
  }
}

/** The page: a "New task" form whose submit runs `submit` (with `t`, the title input), then reloads the list with `list`. */
function pageHtml(o: { submit: string; list?: string; before?: string }): string {
  return `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
${o.before ?? ""}
var t = document.getElementById('t');
function load() { return fetch(${o.list ?? "'/api/tasks'"}).then(function (r) { return r.ok ? r.json() : []; }).then(function (xs) {
  document.getElementById('list').innerHTML = xs.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  ${o.submit}.then(function () { document.getElementById('status').textContent = 'Task added'; return load(); });
});
${o.before ? "" : "load();"}
</script></body></html>`;
}

async function discover(url: string, state: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
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

function scenarioFor(page: DiscoveredPage): Scenario {
  const planned = check.plan(page.forms[0]!, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  return { ...planned, scope: "form", formIndex: 0 };
}

/** Runs csrf against `server` reached on localhost (the other site is 127.0.0.1). */
async function runApp(server: FixtureServer, sameSite: "Lax" | "None"): Promise<CheckResult> {
  const base = server.url.replace("127.0.0.1", "localhost");
  const self = session("localhost", sameSite);
  const page = await discover(`${base}/app`, self);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-query-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: page.forms[0]!,
    discoveredPage: page,
    targetUrl: `${base}/app`,
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

/** POSTs the app got from the page on the other site (an Origin that isn't the app's own). */
const fromOtherSite = (server: FixtureServer) =>
  server.requests.filter((r) => r.method === "POST" && r.headers.origin !== undefined && r.headers.origin !== `http://${String(r.headers.host)}`);

type Task = { id: string; title: string };
const favicon = (_req: RecordedRequest, res: ServerResponse) => {
  res.writeHead(204);
  res.end();
};

describe("cross-site-query: which query parameters a replayed URL leaves out", () => {
  it("leaves out tokens and credentials by name, Account A's token by value, and a random value Run Hound didn't type", () => {
    const tokens = new Set(["k9Lm2Qx7Rt4Vb8Nz1Pw5"]);
    const cleaned = withoutQueryCredentials(
      "http://localhost:3000/api/tasks?_csrf=Zq81kP0xW4mN7vB2cR9t&access_token=tokA7Hq2Lm9Xc4&t=k9Lm2Qx7Rt4Vb8Nz1Pw5&page=2&listId=65f1c2a9b7e4d3c2a1b0f9e8&h=Qm7Zr2Lp9Kx4Wn8Vb3Ty&q=cf7e57a1xsite9Lm2Qx7Rt4Vb8Nz",
      tokens,
      RUN_TOKEN,
    );
    expect(cleaned.url).toBe("http://localhost:3000/api/tasks?page=2&listId=65f1c2a9b7e4d3c2a1b0f9e8&q=cf7e57a1xsite9Lm2Qx7Rt4Vb8Nz");
    expect(cleaned.dropped).toEqual([
      { name: "_csrf", kind: "csrf" },
      { name: "access_token", kind: "credential" },
      { name: "t", kind: "csrf" },
      { name: "h", kind: "secret" },
    ]);
    expect(cleaned.values).toEqual(["Zq81kP0xW4mN7vB2cR9t", "tokA7Hq2Lm9Xc4", "k9Lm2Qx7Rt4Vb8Nz1Pw5", "Qm7Zr2Lp9Kx4Wn8Vb3Ty"]);
    for (const name of ["api_token", "token", "auth", "apikey", "api_key", "jwt", "session", "sig"]) {
      expect(queryParamKind(name, "x", new Set(), RUN_TOKEN), name).toBe("credential");
    }
    expect(withoutQueryCredentials("http://localhost:3000/api/tasks?page=2", tokens, RUN_TOKEN).url).toBe("http://localhost:3000/api/tasks?page=2");
  });
});

describe("csrf: a token or a credential in the save's query string is never forged", () => {
  const TOKEN = "Zq81kP0xW4mN7vB2cR9t";

  /** Spring-style: the save is POST /api/tasks?_csrf=<token>; `checks` says whether the app requires it. */
  async function queryTokenApp(checks: boolean) {
    const tasks: Task[] = [];
    const server = await startFixtureServer({
      pages: {
        "/app": pageHtml({
          before: `var CSRF = ${JSON.stringify(TOKEN)};`,
          submit: `fetch('/api/tasks?_csrf=' + encodeURIComponent(CSRF), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(e.target)).toString() })`,
        }).replace("</script>", "load();</script>"),
      },
      routes: {
        "POST /api/tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          if (checks && (query(req, "_csrf") ?? new URLSearchParams(req.body).get("_csrf")) !== TOKEN) return end(res, 403, { error: "Invalid CSRF token" });
          const title = titleOf(req.body);
          if (!title) return end(res, 400, { error: "Title required" });
          const task = { id: `t${tasks.length + 1}`, title };
          tasks.push(task);
          return end(res, 201, { task });
        },
        "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, tasks) : end(res, 401, { error: "Sign in first" })),
        "GET /favicon.ico": favicon,
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("passes on an app whose token rides in the query: the forge leaves it out and the app refuses it", async () => {
    const server = await queryTokenApp(true);
    const result = await runApp(server, "None");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(r.url).not.toContain(TOKEN);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.findings, result.notes).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/left out _csrf/);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  }, 60_000);

  it("finds it on an app that ignores the token, and neither the finding nor the spec holds it", async () => {
    const server = await queryTokenApp(false);
    const result = await runApp(server, "None");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(r.url).not.toContain(TOKEN);
    expect(result.status, result.notes).toBe("fail");
    const f = result.findings[0]!;
    expect(f.location).toBe("POST /api/tasks");
    expect(f.spec?.source).toContain(`const SAVE = "/api/tasks";`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  }, 60_000);
});

describe("csrf: an API authenticated by ?access_token= in the URL", () => {
  const TOK = "tokA7Hq2Lm9Xc4";

  /**
   * The page gets its API token from GET /api/session (the SameSite=Lax cookie) and calls the API with ?access_token=.
   * `saveNeedsToken` false: the save stores into Account A's tasks whoever sends it.
   */
  async function urlTokenApp(saveNeedsToken: boolean) {
    const tasks: Task[] = [];
    const byToken = (req: RecordedRequest) => query(req, "access_token") === TOK;
    const server = await startFixtureServer({
      pages: {
        "/app": pageHtml({
          before: `var tok = null; function api(p) { return p + (p.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(tok); }
fetch('/api/session').then(function (r) { return r.json(); }).then(function (s) { tok = s.token; load(); });`,
          list: "api('/api/tasks')",
          submit: `fetch(api('/api/tasks'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t.value }) })`,
        }),
      },
      routes: {
        "GET /api/session": (req, res) => (signedIn(req) ? end(res, 200, { token: TOK }) : end(res, 401, { error: "Sign in" })),
        "GET /api/tasks": (req, res) => (byToken(req) ? end(res, 200, tasks) : end(res, 401, { error: "Bad token" })),
        "POST /api/tasks": (req, res) => {
          if (saveNeedsToken && !byToken(req)) return end(res, 401, { error: "Bad token" });
          const title = titleOf(req.body);
          if (!title) return end(res, 400, { error: "Title required" });
          const task = { id: `t${tasks.length + 1}`, title };
          tasks.push(task);
          return end(res, 201, task);
        },
        "GET /favicon.ico": favicon,
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("never sends Account A's access token from the other site: a clean app passes, and nothing holds the token", async () => {
    const server = await urlTokenApp(true);
    const result = await runApp(server, "Lax");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(query(r, "access_token")).toBeNull();
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.findings, result.notes).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/access_token/);
    expect(JSON.stringify(result)).not.toContain(TOK);
  }, 60_000);

  it("is inconclusive, never 'the save needs no session', when the forge left the credential out and was still stored", async () => {
    const server = await urlTokenApp(false);
    const result = await runApp(server, "Lax");
    for (const r of fromOtherSite(server)) expect(query(r, "access_token")).toBeNull();
    expect(result.findings, result.notes).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/access_token/);
    expect(JSON.stringify(result)).not.toContain(TOK);
  }, 60_000);
});

describe("csrf: the save the form makes for the test record, not a POST it sends before it", () => {
  /**
   * CSRF-vulnerable unless `originCheck` (SameSite=None cookie, no token; JSON taken whatever its content-type). On
   * submit the page first POSTs /api/tasks/validate {title} (stores nothing), then POST /api/tasks {title}.
   * `saveAnswer` "created" answers 201 with the task; "ok" answers 200 {ok:true}, which ties neither POST to the record.
   */
  async function validateThenSaveApp(o: { saveAnswer: "created" | "ok"; originCheck?: boolean }) {
    const tasks: Task[] = [];
    const server = await startFixtureServer({
      pages: {
        "/app": pageHtml({
          before: `function post(url, body) { return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }`,
          submit: `post('/api/tasks/validate', { title: t.value }).then(function () { return post('/api/tasks', { title: t.value }); })`,
        }).replace("</script>", "load();</script>"),
      },
      routes: {
        "POST /api/tasks/validate": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          return end(res, 200, titleOf(req.body) ? { ok: true } : { ok: false });
        },
        "POST /api/tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          const origin = req.headers.origin;
          if (o.originCheck && origin !== undefined && origin !== `http://${String(req.headers.host)}`) return end(res, 403, { error: "Cross-site" });
          const title = titleOf(req.body);
          if (!title) return end(res, 400, { error: "Title required" });
          const task = { id: `t${tasks.length + 1}`, title };
          tasks.push(task);
          return o.saveAnswer === "created" ? end(res, 201, { task }) : end(res, 200, { ok: true });
        },
        "GET /api/tasks": (req, res) => (signedIn(req) ? end(res, 200, tasks) : end(res, 401, { error: "Sign in first" })),
        "GET /favicon.ico": favicon,
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
  }

  it("forges the save that created the record (201 with the task), not the validation call, and finds the flaw", async () => {
    const server = await validateThenSaveApp({ saveAnswer: "created" });
    const result = await runApp(server, "None");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(new URL(r.url, "http://x").pathname).toBe("/api/tasks");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.location).toBe("POST /api/tasks");
  }, 60_000);

  it("is never a pass when two POSTs carry the typed values and neither answer ties one to the record", async () => {
    const server = await validateThenSaveApp({ saveAnswer: "ok", originCheck: true });
    const result = await runApp(server, "None");
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(new URL(r.url, "http://x").pathname).toBe("/api/tasks");
    expect(result.status, result.notes).not.toBe("pass");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/POST \/api\/tasks\/validate/);
  }, 60_000);
});
