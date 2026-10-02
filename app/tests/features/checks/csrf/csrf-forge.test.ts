// csrf (0.6.0 round 1): what is forged and how the answer is read — framework tokens never replayed, run-token values forged at any depth, a CORS allowlist of loopback origins only is never "any site".
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
import { createCheckContext, seedSessionStorage, type RunningCheckContext, type SessionStorageItems } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check } from "../../../../src/checks/csrf.js";

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

function session(host: string, sameSite: "Lax" | "Strict" | "None"): SessionState {
  return {
    cookies: [{ name: "sid", value: "a-session", domain: host, path: "/", expires: -1, httpOnly: true, secure: sameSite === "None", sameSite }],
    origins: [],
  };
}

function end(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));

/** The body parsed as JSON whatever its content-type (as `await req.json()` does), or null. */
function jsonOf(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A multipart part's text value by name, or null. */
function partOf(body: string, name: string): string | null {
  const m = new RegExp(`name="${name.replace(/[[\]]/g, "\\$&")}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body);
  return m ? m[1]! : null;
}

const TITLE = `<label for="t">Title</label><input id="t" name="title" required>`;
/** The form's save as the page sends it. `form` is the form element. */
const FORM_SEND = `fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() })`;
const jsonSend = (expr: string) =>
  `fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${expr}) })`;
const MULTIPART_SEND = `fetch('/api/tasks', { method: 'POST', body: new FormData(form) })`;

/** The page: a "New task" form, and the tasks read as a list (GET /api/tasks) or the last one by id (GET /api/tasks/:id). */
function pageHtml(o: { fields?: string; send: string; read?: "list" | "one"; head?: string; auth?: string }): string {
  const auth = o.auth ?? "{}";
  const read =
    o.read === "one"
      ? `(localStorage.getItem('last') ? fetch('/api/tasks/' + localStorage.getItem('last'), { headers: ${auth} }).then(function (r) { return r.ok ? r.json() : null; }).then(function (x) { return x ? [x] : []; }) : Promise.resolve([]))`
      : `fetch('/api/tasks', { headers: ${auth} }).then(function (r) { return r.ok ? r.json() : { tasks: [] }; }).then(function (d) { return d.tasks || []; })`;
  return `<!doctype html><html lang="en"><head><title>Tasks</title>${o.head ?? ""}</head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task">${o.fields ?? TITLE}<button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var form = document.getElementById('new');
function load() { ${read}.then(function (items) {
  document.getElementById('list').innerHTML = items.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
form.addEventListener('submit', function (e) {
  e.preventDefault();
  ${o.send}.then(function (r) { return r.json(); }).then(function (d) { if (d && d.task) localStorage.setItem('last', d.task.id); document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`;
}

type Task = { id: string; title: string };
/** What POST /api/tasks does with a signed-in request: the title to store, or a refusal. */
type SaveAnswer = { title: string } | { status: number };

// A task app: GET /app is `page`; GET /api/tasks answers {tasks}, GET /api/tasks/:id one task; POST /api/tasks stores what `save` returns (201 {task}) or refuses with its status; every API call needs `auth`; `cors` sets CORS headers per Origin.
async function taskServer(o: {
  page: string;
  save: (req: RecordedRequest) => SaveAnswer;
  auth?: (req: RecordedRequest) => boolean;
  cors?: (origin: string | undefined) => Record<string, string>;
}): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [];
  const auth = o.auth ?? signedIn;
  const cors = (req: RecordedRequest) => o.cors?.(typeof req.headers.origin === "string" ? req.headers.origin : undefined) ?? {};
  const server = await startFixtureServer({
    pages: { "/app": o.page },
    routes: {
      "GET /api/tasks": (req, res) => (auth(req) ? end(res, 200, { tasks }) : end(res, 401, { error: "Sign in first" })),
      "POST /api/tasks": (req, res) => {
        if (!auth(req)) return end(res, 401, { error: "Sign in first" }, cors(req));
        const out = o.save(req);
        if ("status" in out) return end(res, out.status, { error: "Refused" }, cors(req));
        const task = { id: `t${tasks.length + 1}`, title: out.title };
        tasks.push(task);
        return end(res, 201, { task }, cors(req));
      },
      "OPTIONS /api/tasks": (req, res) => {
        res.writeHead(204, cors(req));
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/([^/?]+)/.exec(req.url);
      if (!m || req.method !== "GET") return end(res, 404, { error: "Not found" });
      if (!auth(req)) return end(res, 401, { error: "Sign in first" });
      const task = tasks.find((x) => x.id === m[1]);
      return task ? end(res, 200, task) : end(res, 404, { error: "Not found" });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

async function discover(url: string, state: SessionState, prepare?: (context: import("playwright").BrowserContext) => Promise<void>): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    await prepare?.(context);
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
  const form = page.forms[0]!;
  const planned = check.plan(form, page, { signedIn: true, otherAccount: false })[0];
  if (!planned) throw new Error("csrf planned no scenario for this form");
  return { ...planned, scope: "form", formIndex: 0 };
}

async function run(o: { targetUrl: string; page: DiscoveredPage; self: SessionState; sessionStorage?: SessionStorageItems }): Promise<CheckResult> {
  const dir = await mkdtemp(join(tmpdir(), "rh-csrf-forge-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: o.page.forms[0]!,
    discoveredPage: o.page,
    targetUrl: o.targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "csrf",
    sessions: { self: o.self },
    ...(o.sessionStorage ? { sessionStorage: { self: o.sessionStorage } } : {}),
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  return check.run(ctx, scenarioFor(o.page));
}

/** Runs the check against `server` reached on `host` (127.0.0.1: the other site is localhost, and the other way round). */
async function runApp(server: FixtureServer, sameSite: "Lax" | "Strict" | "None", host: "127.0.0.1" | "localhost" = "127.0.0.1"): Promise<CheckResult> {
  const base = server.url.replace("127.0.0.1", host);
  const self = session(host, sameSite);
  const page = await discover(`${base}/app`, self);
  server.requests.length = 0;
  return run({ targetUrl: `${base}/app`, page, self });
}

/** Requests the app got from the page on the other site (an Origin that isn't the app's own). */
const fromOtherSite = (server: FixtureServer) =>
  server.requests.filter((r) => r.method === "POST" && r.headers.origin !== undefined && r.headers.origin !== `http://${String(r.headers.host)}`);

/** A JSON save the server parses whatever its content-type, `title` read by `pick` (a flat or nested body). */
function jsonAnyType(pick: (body: Record<string, unknown>) => unknown) {
  return (req: RecordedRequest): SaveAnswer => {
    const body = jsonOf(req.body);
    const title = body ? pick(body) : undefined;
    return typeof title === "string" && title ? { title } : { status: 400 };
  };
}

/** A form-encoded save: the title from the body. */
const formSave =
  (field = "title") =>
  (req: RecordedRequest): SaveAnswer => {
    const title = new URLSearchParams(req.body).get(field);
    return title ? { title } : { status: 400 };
  };

describe("csrf: the answer to the text/plain forge is seen", () => {
  it.each(["127.0.0.1", "localhost"] as const)(
    "a stored text/plain forge that carried Account A's cookie names it, never 'the save needs no session' (target on %s)",
    async (host) => {
      const server = await taskServer({ page: pageHtml({ send: jsonSend("{ title: form.elements.title.value }") }), save: jsonAnyType((b) => b.title) });
      const result = await runApp(server, "None", host);
      const stored = fromOtherSite(server).filter((r) => MARKER.test(r.body) && String(r.headers["content-type"]).startsWith("text/plain"));
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.every(signedIn)).toBe(true);
      expect(result.status, result.notes).toBe("fail");
      const f = result.findings[0]!;
      expect(f.title).toBe("A page on another site can change Account A's data (no CSRF protection)");
      expect(f.meaning).toMatch(/sid \(SameSite=None\)/);
      expect(f.meaning).not.toMatch(/attached no cookie/);
      expect(f.fix).not.toMatch(/Require Account A's session/);
    },
    60_000,
  );

  it("passes when every forge is refused on a single-record read (JSON-only save, SameSite=Lax cookie)", async () => {
    const server = await taskServer({
      page: pageHtml({ send: jsonSend("{ title: form.elements.title.value }"), read: "one" }),
      save: (req) => (String(req.headers["content-type"]).includes("application/json") ? jsonAnyType((b) => b.title)(req) : { status: 415 }),
    });
    const result = await runApp(server, "Lax");
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(fromOtherSite(server).length).toBeGreaterThan(0);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/Tried: form-encoded \(401\), JSON sent as text\/plain \(401\)/);
    expect(result.notes).not.toMatch(/check Account A/);
  }, 60_000);

  it("passes on a bearer session whose record endpoint reads one record: no cookie rides along", async () => {
    const TOKEN = "bearer-tok-4f1c9a7e2d";
    const bearer = (req: RecordedRequest) => req.headers.authorization === `Bearer ${TOKEN}`;
    const auth = `(function () { var k = sessionStorage.getItem('app_session'); return k ? { authorization: 'Bearer ' + k } : {}; })()`;
    const server = await taskServer({
      page: pageHtml({
        send: `fetch('/api/tasks', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ${auth}), body: JSON.stringify({ title: form.elements.title.value }) })`,
        read: "one",
        auth,
      }),
      auth: bearer,
      save: (req) => {
        const ct = String(req.headers["content-type"] ?? "");
        return ct.includes("x-www-form-urlencoded") ? formSave()(req) : jsonAnyType((b) => b.title)(req);
      },
    });
    const base = server.url.replace("127.0.0.1", "localhost");
    const storage: SessionStorageItems = [{ origin: base, items: [{ name: "app_session", value: TOKEN }] }];
    const self: SessionState = { cookies: [], origins: [] };
    const page = await discover(`${base}/app`, self, (context) => seedSessionStorage(context, storage));
    server.requests.length = 0;
    const result = await run({ targetUrl: `${base}/app`, page, self, sessionStorage: storage });
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/not a cookie/);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  }, 60_000);
});

describe("csrf: Account A's anti-CSRF token under a framework's own field name is never replayed", () => {
  const TOKEN = "9f2c1e7b4a6d8053e1c2b9a7f4d6e8c1";
  it.each(["task[_token]", "_wpnonce", "form_key", "form_token", "token", "nonce"])("%s: left out, and the app's refusal is a pass", async (field) => {
    const server = await taskServer({
      page: pageHtml({ fields: `<input type="hidden" name="${field}" value="${TOKEN}"><label for="t">Title</label><input id="t" name="task[title]" required>`, send: FORM_SEND }),
      save: (req) => (new URLSearchParams(req.body).get(field) !== TOKEN ? { status: 403 } : formSave("task[title]")(req)),
    });
    const result = await runApp(server, "None");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(r.body).not.toContain(TOKEN);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain(`left out ${field}`);
  }, 60_000);

  // 0.6.0 round 3: a hidden field whose name no framework list knows (Moodle's sesskey, a home-made formToken or
  // _sectok) still holds Account A's token: the page's hidden random value is left out too.
  it.each(["formToken", "sesskey", "_sectok"])("a hidden token under a name no list knows (%s): left out, and the app's refusal is a pass", async (field) => {
    const server = await taskServer({
      page: pageHtml({ fields: `<input type="hidden" name="${field}" value="${TOKEN}">${TITLE}`, send: FORM_SEND }),
      save: (req) => (new URLSearchParams(req.body).get(field) !== TOKEN ? { status: 403 } : formSave()(req)),
    });
    const result = await runApp(server, "None", "localhost");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    for (const r of forged) expect(r.body).not.toContain(TOKEN);
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain(`left out ${field}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  }, 60_000);
});

describe("csrf: every run-token value is forged, at any depth", () => {
  it("a forged create is found when the first run-token field is one the app doesn't keep", async () => {
    const server = await taskServer({
      page: pageHtml({ fields: `<label for="n">Notes</label><input id="n" name="notes">${TITLE}`, send: FORM_SEND }),
      save: formSave(),
    });
    const result = await runApp(server, "None");
    expect(server.tasks.length).toBeGreaterThan(1);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.confidence).toBe("confirmed");
    expect(result.notes).toMatch(/created a new test record[\s\S]*check Account A/);
  }, 60_000);

  it("forges a nested JSON save ({task: {title}}) as text/plain", async () => {
    const server = await taskServer({
      page: pageHtml({ send: jsonSend("{ task: { title: form.elements.title.value } }") }),
      save: jsonAnyType((b) => (b.task as { title?: unknown } | undefined)?.title),
    });
    const result = await runApp(server, "None");
    expect(result.status, result.notes).toBe("fail");
    expect(result.notes).toMatch(/JSON sent as text\/plain/);
    const text = fromOtherSite(server).filter((r) => String(r.headers["content-type"]).startsWith("text/plain"));
    expect(text.length).toBeGreaterThan(0);
    expect(JSON.parse(text[0]!.body)).toEqual({ task: { title: expect.stringMatching(MARKER) } });
  }, 60_000);

  it("forges the typed value, not the first top-level string, of a mixed save ({op, task: {title}})", async () => {
    const server = await taskServer({
      page: pageHtml({ send: jsonSend("{ op: 'create', task: { title: form.elements.title.value } }") }),
      save: jsonAnyType((b) => (b.op === "create" ? (b.task as { title?: unknown } | undefined)?.title : undefined)),
    });
    const result = await runApp(server, "None");
    expect(result.status, result.notes).toBe("fail");
    const text = fromOtherSite(server).filter((r) => String(r.headers["content-type"]).startsWith("text/plain"));
    expect(JSON.parse(text[0]!.body)).toEqual({ op: "create", task: { title: expect.stringMatching(MARKER) } });
  }, 60_000);

  it("forges a multipart save (fetch with new FormData(form)) as a multipart form from the other site", async () => {
    const server = await taskServer({
      page: pageHtml({ send: MULTIPART_SEND }),
      save: (req) => {
        const title = String(req.headers["content-type"]).startsWith("multipart/form-data") ? partOf(req.body, "title") : null;
        return title ? { title } : { status: 400 };
      },
    });
    const result = await runApp(server, "None");
    expect(result.notes).not.toMatch(/needs a preflight/);
    expect(result.status, result.notes).toBe("fail");
    const forged = fromOtherSite(server);
    expect(forged.length).toBeGreaterThan(0);
    expect(forged.every((r) => String(r.headers["content-type"]).startsWith("multipart/form-data"))).toBe(true);
    expect(result.findings[0]!.meaning).toMatch(/multipart/);
    expect(result.findings[0]!.spec!.source).toMatch(/multipart\/form-data/);
  }, 60_000);
});

// A Post/Redirect/Get app: plain <form method="post" action="/tasks">; server 303s a signed-in post to /app?created=<id>, a signed-out one to /login; page reads the one task via GET /api/tasks/:id. No token, no Origin check.
async function prgApp(): Promise<FixtureServer & { tasks: Task[] }> {
  const tasks: Task[] = [];
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form method="post" action="/tasks" aria-label="New task">${TITLE}<button type="submit">Add task</button></form>
<p id="last"></p></main>
<script>
var id = new URLSearchParams(location.search).get('created');
if (id) fetch('/api/tasks/' + id).then(function (r) { return r.ok ? r.json() : null; }).then(function (x) {
  if (x) document.getElementById('last').textContent = 'Added: ' + x.title; });
</script></body></html>`,
      "/login": `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><h1>Sign in</h1></body></html>`,
    },
    routes: {
      "POST /tasks": (req, res) => {
        if (!signedIn(req)) {
          res.writeHead(303, { location: "/login?next=%2Fapp" });
          res.end();
          return;
        }
        const title = new URLSearchParams(req.body).get("title");
        if (!title) return end(res, 400, { error: "Title required" });
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
        res.writeHead(303, { location: `/app?created=${task.id}` });
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/([^/?]+)/.exec(req.url);
      if (!m || req.method !== "GET") return end(res, 404, { error: "Not found" });
      if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
      const task = tasks.find((x) => x.id === m[1]);
      return task ? end(res, 200, task) : end(res, 404, { error: "Not found" });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

describe("csrf: what the app answered the forge", () => {
  it("counts a 303 (Post/Redirect/Get) as an answer: a single-record read is inconclusive, never a pass", async () => {
    const server = await prgApp();
    const result = await runApp(server, "None");
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(true);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.findings).toEqual([]);
    expect(result.notes).toMatch(/^Inconclusive[\s\S]*\(303\)[\s\S]*check Account A/);
  }, 60_000);

  it("counts a redirect to the sign-in page as a refusal: passes when the cookie stays home", async () => {
    const server = await prgApp();
    const result = await runApp(server, "Lax");
    expect(server.tasks.some((t) => MARKER.test(t.title))).toBe(false);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/form-encoded \(303\)/);
  }, 60_000);

  it("is inconclusive, not a pass, when the app refuses the forged value (400) although the forge carried Account A's cookie", async () => {
    // A stand-in for any rule the forged value breaks that the value the app accepted didn't.
    const server = await taskServer({
      page: pageHtml({ send: FORM_SEND }),
      save: (req) => (/csrf/i.test(new URLSearchParams(req.body).get("title") ?? "") ? { status: 400 } : formSave()(req)),
    });
    const result = await runApp(server, "None");
    expect(fromOtherSite(server).every(signedIn)).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive[\s\S]*400/);
    expect(result.notes).not.toMatch(/stopped it/);
  }, 60_000);

  it("keeps the forged value as long as the value the app accepted, so a maxlength the server enforces doesn't hide a finding", async () => {
    const MAX = 20;
    const server = await taskServer({
      page: pageHtml({ fields: `<label for="t">Title</label><input id="t" name="title" maxlength="${MAX}" required>`, send: FORM_SEND }),
      save: (req) => {
        const title = new URLSearchParams(req.body).get("title");
        return title && title.length <= MAX ? { title } : { status: 400 };
      },
    });
    const result = await runApp(server, "None");
    const own = server.tasks[0]!.title;
    const forged = fromOtherSite(server).map((r) => new URLSearchParams(r.body).get("title") ?? "");
    expect(forged.length).toBeGreaterThan(0);
    for (const title of forged) {
      expect(title).toMatch(MARKER);
      expect(title.length).toBe(own.length);
    }
    expect(result.status, result.notes).toBe("fail");
  }, 60_000);

  it("passes, without claiming a defence stopped it, when the app answers 200 and changes nothing", async () => {
    // A write from another origin is answered 200 and dropped.
    const server = await taskServer({
      page: pageHtml({ send: FORM_SEND }),
      save: (req) => (req.headers.origin !== `http://${String(req.headers.host)}` ? { status: 200 } : formSave()(req)),
    });
    const result = await runApp(server, "None");
    expect(server.tasks).toHaveLength(1);
    expect(fromOtherSite(server).length).toBeGreaterThan(0);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/\(200\)/);
    expect(result.notes).not.toMatch(/a SameSite cookie, a CSRF token or an Origin check stopped it/);
  }, 60_000);

  it("finds a stored forge by the new record carrying the run's values, when the app rewrote the forged value", async () => {
    // A stand-in for any rewrite that drops the marker (a sanitiser, a slug): the app strips "csrf" from titles.
    const server = await taskServer({
      page: pageHtml({ send: FORM_SEND }),
      save: (req) => {
        const title = new URLSearchParams(req.body).get("title");
        return title ? { title: title.replace(/csrf/gi, "") } : { status: 400 };
      },
    });
    const result = await runApp(server, "None");
    expect(server.tasks).toHaveLength(2);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.meaning).toMatch(/new record/);
    expect(result.notes).toMatch(/created a new test record[\s\S]*check Account A/);
  }, 60_000);
});

describe("csrf: CORS that trusts loopback origins only", () => {
  it("is never 'any site can send this JSON save': an advisory finding naming the loopback-only allowlist", async () => {
    const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    const server = await taskServer({
      page: pageHtml({ send: jsonSend("{ title: form.elements.title.value }") }),
      save: (req) => (String(req.headers["content-type"]).includes("application/json") ? jsonAnyType((b) => b.title)(req) : { status: 415 }),
      cors: (origin): Record<string, string> =>
        origin && LOOPBACK.test(origin)
          ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" }
          : {},
    });
    const result = await runApp(server, "None");
    // A preflight for an origin that isn't loopback was asked too.
    expect(server.requests.some((r) => r.method === "OPTIONS" && r.headers.origin && !LOOPBACK.test(String(r.headers.origin)))).toBe(true);
    const text = result.findings.map((f) => `${f.title} ${f.meaning} ${f.fix}`).join(" ");
    expect(text).not.toMatch(/any site/);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBe("advisory");
    expect(result.findings[0]!.meaning).toMatch(/loopback/);
    expect(result.findings[0]!.meaning).toMatch(/run-hound-other-site\.invalid/);
  }, 60_000);
});
