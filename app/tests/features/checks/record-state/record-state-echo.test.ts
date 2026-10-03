/**
 * record-state (0.6.0 close-out): the record endpoint is a GET after the save, also when the save is form-encoded
 * (docs/v2-spec.md "mass-assignment" step 2, "a GET after reload whose JSON contains the test value"; "Records Account A
 * already had": only a record whose id was read before the save, or a record endpoint that reads one record at a URL
 * without its id, is "a record Account A already had").
 *
 * findOwnRecord finds the save itself when the caller doesn't name it (csrf): the first write whose body holds a test
 * value. A form-encoded body holds it encoded (title=Title+rs7e57a1ws, title=Title%20rs7e57a1ws), and it still counts,
 * so a GET the page made while Run Hound typed (a name-availability hint that echoes the typed value in its path,
 * GET /api/tasks/available/<title> → {title, available}) is never the record endpoint. Before the fix it was: the
 * echo reads as one record at a URL without its id, and csrf skipped an ordinary create form with a false "changed a
 * record Account A already had … Could not be undone: check Account A".
 *
 * A save that sends its values in its URL's query (POST /api/tasks?title=Title+rs7e57a1ws with a body of its own, or
 * none) is the save too (close-out review, round 1): before, no write matched, the whole capture was read, and the echo
 * was the record endpoint again. So is one that sends its value in its URL's path (PUT /api/tags/<name>, with no body
 * and no query; close-out review, round 2), after a body and a query have been looked for.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { AccountRef, Capture, CheckContext, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check as csrf } from "../../../../src/checks/csrf.js";
import { findOwnRecord, type CapturedRequest } from "../../../../src/checks/lib/record-state.js";

const TARGET = "http://localhost:4100/app";
/** A test value as canaryValues makes it: the run token, lower case, inside, after a word and a space. */
const TEST_VALUE = "Task rs7e57a1ws";

/** A CheckContext whose request() is never expected to be used (every read here has its body in the capture). */
function quietContext(): { ctx: CheckContext; sent: string[] } {
  const sent: string[] = [];
  const ctx = {
    targetUrl: TARGET,
    runToken: "Rs7e57a1",
    request: async (_as: string, req: { url: string }) => {
      sent.push(req.url);
      return { status: 500, headers: {}, body: "" };
    },
  } as unknown as CheckContext;
  return { ctx, sent };
}

function captured(r: Partial<CapturedRequest> & { url: string }): CapturedRequest {
  return { method: "GET", resourceType: "fetch", postData: null, status: 200, failure: null, responseBody: null, ...r };
}

const echo = captured({
  url: `http://localhost:4100/api/tasks/available/${encodeURIComponent(TEST_VALUE)}`,
  responseBody: JSON.stringify({ title: TEST_VALUE, available: true }),
});
const save = (postData: string) =>
  captured({ url: "http://localhost:4100/api/tasks", method: "POST", postData, status: 201, responseBody: JSON.stringify({ ok: true }) });
const list = captured({
  url: "http://localhost:4100/api/tasks",
  responseBody: JSON.stringify([{ id: 1, title: "Groceries" }, { id: 7, title: TEST_VALUE }]),
});
const capture = (...requests: CapturedRequest[]): Capture => ({ requests, console: [], pageErrors: [] });

describe("findOwnRecord: the save is found in a form-encoded body too", () => {
  for (const [how, body] of [
    ["+ for a space", `title=${TEST_VALUE.replace(/ /g, "+")}`],
    ["%20 for a space", `title=${encodeURIComponent(TEST_VALUE)}`],
    ["among other fields", `_method=post&title=${TEST_VALUE.replace(/ /g, "+")}&done=0`],
  ] as const) {
    it(`never takes a GET made before a form-encoded save (${how}), such as a hint that echoes the typed value in its path`, async () => {
      const { ctx, sent } = quietContext();
      const found = await findOwnRecord(ctx, capture(echo, save(body), list), [TEST_VALUE], { arrays: true });
      expect(found?.url).toBe("http://localhost:4100/api/tasks");
      // Nor when it is the only read that holds the value: there is then no record endpoint.
      expect(await findOwnRecord(ctx, capture(echo, save(body)), [TEST_VALUE], { arrays: true })).toBeNull();
      expect(sent).toEqual([]);
    });
  }

  for (const [how, url, body] of [
    ["with a body of its own", `http://localhost:4100/api/tasks?title=${TEST_VALUE.replace(/ /g, "+")}`, "source=web"],
    ["with no body", `http://localhost:4100/api/tasks?title=${encodeURIComponent(TEST_VALUE)}`, null],
  ] as const) {
    it(`never takes a GET made before a save that sends its values in its URL's query (${how})`, async () => {
      const { ctx, sent } = quietContext();
      const querySave = captured({ url, method: "POST", postData: body, status: 201, responseBody: JSON.stringify({ ok: true }) });
      const found = await findOwnRecord(ctx, capture(echo, querySave, list), [TEST_VALUE], { arrays: true });
      expect(found?.url).toBe("http://localhost:4100/api/tasks");
      expect(await findOwnRecord(ctx, capture(echo, querySave), [TEST_VALUE], { arrays: true })).toBeNull();
      expect(sent).toEqual([]);
    });
  }

  for (const [how, body] of [
    ["with no body", null],
    ["with a body of other fields", JSON.stringify({ color: "blue" })],
  ] as const) {
    it(`never takes a GET made before a save that sends its value in its URL's path (${how})`, async () => {
      const { ctx, sent } = quietContext();
      const tagEcho = captured({
        url: `http://localhost:4100/api/tags/available/${encodeURIComponent(TEST_VALUE)}`,
        responseBody: JSON.stringify({ name: TEST_VALUE, available: true }),
      });
      const pathSave = captured({ url: `http://localhost:4100/api/tags/${encodeURIComponent(TEST_VALUE)}`, method: "PUT", postData: body, status: 201, responseBody: "{}" });
      const tags = captured({ url: "http://localhost:4100/api/tags", responseBody: JSON.stringify([{ id: 7, name: TEST_VALUE }]) });
      expect((await findOwnRecord(ctx, capture(tagEcho, pathSave, tags), [TEST_VALUE], { arrays: true }))?.url).toBe("http://localhost:4100/api/tags");
      expect(await findOwnRecord(ctx, capture(tagEcho, pathSave), [TEST_VALUE], { arrays: true })).toBeNull();
      expect(sent).toEqual([]);
    });
  }

  it("takes a write whose query holds a test value for the save before one that only has it in its path", async () => {
    const { ctx } = quietContext();
    const pathWrite = captured({ url: `http://localhost:4100/api/drafts/${encodeURIComponent(TEST_VALUE)}`, method: "PUT", postData: null, responseBody: "{}" });
    const querySave = captured({ url: `http://localhost:4100/api/tasks?title=${encodeURIComponent(TEST_VALUE)}`, method: "POST", postData: null, status: 201, responseBody: "{}" });
    // The echo comes after the path write but before the query save: only the query save orders the reads.
    expect(await findOwnRecord(ctx, capture(pathWrite, echo, querySave), [TEST_VALUE], { arrays: true })).toBeNull();
  });

  it("takes a write whose body holds a test value for the save before one that only has it in its query", async () => {
    const { ctx } = quietContext();
    // A lookup the page POSTs while the title is typed (?q=<title>), then the echo, then the save itself.
    const lookup = captured({ url: `http://localhost:4100/api/lookup?q=${encodeURIComponent(TEST_VALUE)}`, method: "POST", postData: null, responseBody: "{}" });
    const body = `title=${TEST_VALUE.replace(/ /g, "+")}`;
    expect((await findOwnRecord(ctx, capture(lookup, echo, save(body), list), [TEST_VALUE], { arrays: true }))?.url).toBe("http://localhost:4100/api/tasks");
    expect(await findOwnRecord(ctx, capture(lookup, echo, save(body)), [TEST_VALUE], { arrays: true })).toBeNull();
  });

  it("still reads the whole capture when no write carries a test value", async () => {
    const { ctx } = quietContext();
    // The save sends only an id (the values went another way): no save to order by, so every GET is looked at.
    const found = await findOwnRecord(ctx, capture(list, save("id=7")), [TEST_VALUE], { arrays: true });
    expect(found?.url).toBe("http://localhost:4100/api/tasks");
  });

  it("a body that isn't valid percent-encoding is read as it is", async () => {
    const { ctx } = quietContext();
    const found = await findOwnRecord(ctx, capture(echo, save(`title=${TEST_VALUE.replace(/ /g, "+")}&note=100%`), list), [TEST_VALUE], {
      arrays: true,
    });
    expect(found?.url).toBe("http://localhost:4100/api/tasks");
  });
});

describe("csrf: a create form with a name-availability hint that echoes the typed value in its path", () => {
  const A: AccountRef = { id: "a", label: "Account A" };
  /** Lowercase letters and digits, and not "csrf" (the forged marker's suffix). */
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

  const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(String(req.headers.cookie ?? ""));
  function end(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * An ordinary create form (form-encoded POST /api/tasks, list GET /api/tasks) with no CSRF defence (a SameSite=None
   * session cookie, no token). As the title is typed, the page GETs /api/tasks/available/<title>, which answers
   * {title, available}: the typed value echoed back before any record holds it.
   */
  async function availabilityApp(save: "body" | "query" = "body") {
    const tasks: { id: string; title: string }[] = [];
    const submit =
      save === "query"
        ? "fetch('/api/tasks?' + new URLSearchParams(new FormData(e.target)).toString(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'source=web' })"
        : "fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(e.target)).toString() })";
    const server = await startFixtureServer({
      pages: {
        "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Add task</button></form>
<p id="hint"></p><p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var t = document.getElementById('t');
function load() { fetch('/api/tasks').then(function (r) { return r.json(); }).then(function (xs) {
  document.getElementById('list').innerHTML = xs.map(function (x) { return '<li>' + String(x.title).replace(/</g, '&lt;') + '</li>'; }).join(''); }); }
t.addEventListener('input', function () {
  if (!t.value) return;
  fetch('/api/tasks/available/' + encodeURIComponent(t.value)).then(function (r) { return r.json(); }).then(function (s) {
    document.getElementById('hint').textContent = s.available ? '' : 'That title is taken'; });
});
document.getElementById('new').addEventListener('submit', function (e) {
  e.preventDefault();
  ${submit}
    .then(function (r) { return r.json(); }).then(function () { document.getElementById('status').textContent = 'Task added'; load(); });
});
load();
</script></body></html>`,
      },
      routes: {
        "POST /api/tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          const title = save === "query" ? new URL(req.url, "http://x").searchParams.get("title") : new URLSearchParams(req.body).get("title");
          if (!title) return end(res, 400, { error: "Title required" });
          const task = { id: `t${tasks.length + 1}`, title };
          tasks.push(task);
          return end(res, 201, { task });
        },
        "GET /api/tasks": (req, res) => {
          if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
          return end(res, 200, tasks);
        },
        "GET /favicon.ico": (_req, res) => {
          res.writeHead(204);
          res.end();
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/available\/(.+)$/.exec(new URL(req.url, "http://x").pathname);
        if (!m || req.method !== "GET") return end(res, 404, { error: "Not found" });
        if (!signedIn(req)) return end(res, 401, { error: "Sign in first" });
        const title = decodeURIComponent(m[1]!);
        return end(res, 200, { title, available: !tasks.some((x) => x.title === title) });
      },
    });
    servers.push(server);
    return Object.assign(server, { tasks });
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

  async function run(server: FixtureServer): Promise<CheckResult> {
    const base = server.url.replace("127.0.0.1", "localhost");
    const self: SessionState = {
      cookies: [{ name: "sid", value: "a-session", domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" }],
      origins: [],
    };
    const page = await discover(`${base}/app`, self);
    server.requests.length = 0;
    const dir = await mkdtemp(join(tmpdir(), "rh-record-echo-"));
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
    const planned = csrf.plan(page.forms[0]!, page, { signedIn: true, otherAccount: false })[0];
    if (!planned) throw new Error("csrf planned no scenario for this form");
    const scenario: Scenario = { ...planned, scope: "form", formIndex: 0 };
    return csrf.run(ctx, scenario);
  }

  it("reads the record from the list after the save, not the echo, and finds the missing CSRF defence", async () => {
    const server = await availabilityApp();
    const result = await run(server);
    expect(result.notes).not.toMatch(/already had|Could not be undone/);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings.map((f) => f.title)).toEqual(["A page on another site can change Account A's data (no CSRF protection)"]);
    // The echo was never written to: every write is a POST to the save's own URL.
    expect(server.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url, "http://x").pathname}`)).toEqual(
      expect.arrayContaining(["POST /api/tasks"]),
    );
    expect(server.requests.some((r) => r.method !== "GET" && /available/.test(r.url))).toBe(false);
  });

  it("does the same when the save sends its values in its URL's query: never a record Account A already had", async () => {
    const server = await availabilityApp("query");
    const result = await run(server);
    expect(result.notes).not.toMatch(/already had|Could not be undone/);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings.map((f) => f.title)).toEqual(["A page on another site can change Account A's data (no CSRF protection)"]);
    expect(server.requests.some((r) => r.method !== "GET" && /available/.test(r.url))).toBe(false);
  });
});
