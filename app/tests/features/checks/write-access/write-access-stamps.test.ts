/**
 * write-access (0.6.0 close-out): optimistic locking the record's reads don't show. The app's own update carries
 * lock_version, but the read Run Hound re-reads the record with ({id, title}) doesn't show it, so the replay can only
 * carry the value the app's own update sent, which the app's own save made stale. An app that refuses a stale version
 * with 409, 412 or 428 is inconclusive (write-access-shapes.test.ts); these apps refuse it another way, a validation
 * error (422, 400) or an unhandled StaleObjectError (500). The update has no ownership check (a planted IDOR), so the
 * refusal says nothing about who may change the record: inconclusive, never a pass. A refusal of Account B itself
 * (403, 404) still passes, and a version the read does show is replayed at its current value, so the IDOR is found.
 *
 * Round 1 of the close-out review:
 * - A 404 is a common way to refuse a stale version too (UPDATE … WHERE id = $1 AND lock_version = $2 matches no row;
 *   Prisma's P2025 mapped to 404). A 404 to an attempt that carried a stamp the read doesn't show is compared with the
 *   same write sent as Account A (the app's own update, with the same stale stamp): refused the same way, B's 404
 *   proves nothing (inconclusive); answered otherwise (a 422 for the stale version, or accepted), B's 404 was a refusal
 *   of B (a pass).
 * - A version the app's update sends in its URL's query (PATCH /api/tasks/2?lock_version=0) is refreshed like one in
 *   the body when the read shows it, and named as stale when it doesn't.
 *
 * Round 2 of the close-out review:
 * - Account A's comparison is the same attempt as Account B's, with a test value of its own in the same field (never a
 *   write that changes nothing: an app may answer that 200 at once, or refuse it with 422, before it looks at the
 *   version), judged by a re-read as Account A. It passes B's 404 only when the re-read shows A's value (the app took the
 *   stale version from its owner) or the app answers A with a conflict (409, 412, 428). A 404, a 2xx that left the
 *   record unchanged, a 400, 422 or 5xx, or no answer is inconclusive.
 * - A 2xx that left the record unchanged while the attempt carried a version the read doesn't show (UPDATE … WHERE
 *   lock_version = $2 matched no row, answered 200 or 204) is compared the same way: it is never a pass on its own.
 * - A query parameter by a stamp's name is refreshed only when its value is one the record showed before the app's
 *   update was sent (the save's answer, a read of the record, or the snapshot): ?version=2, an API version, on a record
 *   whose own version is 5, is left as the app sent it and named as stale.
 * - Known limit, pinned: when the app applies Account A's comparison and its reads show updated_at, the put-back leaves
 *   updated_at changed, so the scenario is inconclusive ("check Account A"), never a pass.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const RUN_TOKEN = "wk7s2p9q";

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

type Who = "a" | "b";

/** A session: sid, plus any `extra` cookies (a csrftoken). */
function session(who: Who, extra: Record<string, string> = {}): SessionState {
  const cookie = (name: string, value: string) => ({ name, value, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: name === "sid", secure: false, sameSite: "Lax" as const });
  return { cookies: [cookie("sid", `${who}-session`), ...Object.entries(extra).map(([n, v]) => cookie(n, v))], origins: [] };
}

function cookieOf(req: RecordedRequest, name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(String(req.headers.cookie ?? ""));
  return m ? m[1]! : null;
}

function callerOf(req: RecordedRequest): Who | null {
  const sid = cookieOf(req, "sid");
  return sid === "a-session" ? "a" : sid === "b-session" ? "b" : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parse(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

const pathOf = (url: string) => new URL(url, "http://x").pathname;
const page = (script: string, field = "title") => `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="${field}" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
function csrf() { var m = /(?:^|;\\s*)csrftoken=([^;]*)/.exec(document.cookie); return m ? m[1] : ''; }
${script}
</script></body></html>`;

async function discover(server: FixtureServer, self: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: self });
  try {
    const p = await context.newPage();
    await p.goto(`${server.url}/app`);
    await p.getByRole("heading", { level: 1, name: "Tasks" }).waitFor();
    await p.waitForLoadState("networkidle");
    return await discoverPage(p);
  } finally {
    await context.close();
  }
}

async function run(server: FixtureServer, which: "other-account" | "signed-out", o: { self?: SessionState; other?: SessionState } = {}): Promise<CheckResult> {
  const self = o.self ?? session("a");
  const other = o.other ?? session("b");
  const discovered = await discover(server, self);
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`no write-access:${which} scenario`);
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-stamps-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0]!,
    discoveredPage: discovered,
    targetUrl: `${server.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: { self, other },
    accounts: { self: A, other: B },
    markers: [],
  });
  contexts.push(ctx);
  server.requests.length = 0;
  return check.run(ctx, { ...planned, scope: "form", formIndex: 0 } as Scenario);
}

const writesBy = (server: FixtureServer, who: Who | null) => server.requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method) && callerOf(r) === who);

/**
 * A task app with optimistic locking: each update sends the lock_version it last had (from the create's or the last
 * update's answer); a stale one is refused with `stale`, or answered 200 (the task as it is) or 204 without being
 * applied ("noop200", "noop204": UPDATE … WHERE lock_version = $2 matched no row). `read`: whether the list read shows
 * lock_version. `owner`: whether the update checks who owns the task before its version: true answers anyone else 404,
 * a number answers that status, "noop200" answers 200 without applying the write; without it, the planted IDOR.
 * `where`: the update sends lock_version in its JSON body (the default) or in its URL's query
 * (PATCH /api/tasks/2?lock_version=0); "api-version" sends ?version=2, an API version the app insists on, while the
 * record has a `version` of its own (from 5, shown when `read` is "shown") that the app never checks.
 * `checks: false`: the app never looks at the version it is sent. `earlyNoop`: a PATCH whose title is the task's own
 * is answered 200 at once, before the version check; `refuseNoChange`: refused 422 at once ("nothing to change").
 * `pageEdits`: the page's own update renames the task (appends " edited"), so it changes the record and its version.
 * `updatedAt`: the read shows updated_at, set on every applied save.
 */
async function lockApp(o: {
  read: "shown" | "hidden";
  stale: number | "noop200" | "noop204";
  owner?: boolean | number | "noop200";
  where?: "body" | "query" | "api-version";
  checks?: boolean;
  earlyNoop?: boolean;
  refuseNoChange?: boolean;
  pageEdits?: boolean;
  updatedAt?: boolean;
}) {
  const start = o.where === "api-version" ? 5 : 0;
  const tasks: { id: number; owner: Who; title: string; version: number; updated: number }[] = [{ id: 1, owner: "a", title: "Groceries", version: start, updated: 1 }];
  let next = 2;
  let clock = 10;
  const view = (t: (typeof tasks)[number]) => ({
    id: t.id,
    title: t.title,
    ...(o.read === "shown" ? { [o.where === "api-version" ? "version" : "lock_version"]: t.version } : {}),
    ...(o.updatedAt ? { updated_at: `2026-09-28T00:00:${String(t.updated).padStart(2, "0")}Z` } : {}),
  });
  const title = o.pageEdits ? "title + ' edited'" : "title";
  const update =
    o.where === "query"
      ? `fetch('/api/tasks/' + t.id + '?lock_version=' + t.lock_version, { method: 'PATCH', headers: json, body: JSON.stringify({ title: ${title} }) })`
      : o.where === "api-version"
        ? `fetch('/api/tasks/' + t.id + '?version=2', { method: 'PATCH', headers: json, body: JSON.stringify({ title: ${title} }) })`
        : `fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: json, body: JSON.stringify({ title: ${title}, lock_version: t.lock_version }) })`;
  const script = `function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var json = { 'content-type': 'application/json' };
  fetch('/api/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (t) { return ${update}; }).then(load); });
load();`;
  const server = await startFixtureServer({
    pages: { "/app": page(script) },
    routes: {
      "GET /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in" });
        send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
      },
      "POST /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in" });
        const t = { id: next++, owner: caller, title: String(parse(req.body).title ?? ""), version: start, updated: clock++ };
        tasks.push(t);
        send(res, 201, { ...view(t), lock_version: t.version });
      },
    },
    fallback: (req, res) => {
      const url = new URL(req.url, "http://x");
      const m = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
      const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
      if (!t || req.method !== "PATCH") return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      if (!caller) return send(res, 401, { error: "Sign in" });
      if (o.owner && t.owner !== caller) {
        if (o.owner === "noop200") return send(res, 200, view(t));
        return send(res, o.owner === true ? 404 : o.owner, { error: "Not found" });
      }
      const body = parse(req.body);
      if (o.earlyNoop && body.title === t.title) return send(res, 200, view(t));
      if (o.refuseNoChange && body.title === t.title) return send(res, 422, { error: "Nothing to change" });
      if (o.where === "api-version") {
        if (url.searchParams.get("version") !== "2") return send(res, 400, { error: "Unsupported API version" });
      } else {
        const sentVersion = o.where === "query" ? url.searchParams.get("lock_version") : body.lock_version;
        if (o.checks !== false && Number(sentVersion) !== t.version) {
          if (o.stale === "noop200") return send(res, 200, view(t));
          if (o.stale === "noop204") return send(res, 204, null);
          // 404: UPDATE … WHERE id = $1 AND lock_version = $2 matched no row.
          return send(
            res,
            o.stale,
            o.stale === 404 ? { error: "Not found" } : o.stale >= 500 ? { error: "ActiveRecord::StaleObjectError" } : { errors: { lock_version: ["is stale"] } },
          );
        }
      }
      if (typeof body.title === "string") t.title = body.title;
      t.version += 1;
      t.updated = clock++;
      send(res, 200, { ...view(t), lock_version: t.version });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

describe("write-access: a version the record's reads don't show, refused another way than 409", () => {
  for (const stale of [422, 400, 500]) {
    it(`is inconclusive, never a pass, when the stale version is refused with ${stale} and the record is unchanged`, async () => {
      const server = await lockApp({ read: "hidden", stale });
      const result = await run(server, "other-account");
      expect(result.findings).toEqual([]);
      expect(result.status, result.notes).toBe("skipped");
      expect(result.notes).toMatch(/^Inconclusive/);
      expect(result.notes).toContain(`PATCH /api/tasks/2 (${stale})`);
      expect(result.notes).toMatch(/lock_version/);
      // The replay carried the value the app's own update sent: Run Hound had no other.
      const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
      expect(parse(probe.body).lock_version).toBe(0);
      expect(server.tasks.find((t) => t.id === 2)!.title).not.toMatch(/wk7s2p9qwx/);
    });
  }

  it("still passes when the app refuses Account B itself (404) before it looks at the version, and a stale version with a conflict (409)", async () => {
    const server = await lockApp({ read: "hidden", stale: 409, owner: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
  });

  it("still passes when the app refuses Account B itself with 403 (not the version's answer), whatever it answers a stale version", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, owner: 403 });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("PATCH /api/tasks/2 (403)");
    expect(aAfterB(server)).toEqual([]);
  });

  it("still passes a signed-out visitor refused as one (401)", async () => {
    const server = await lockApp({ read: "hidden", stale: 422 });
    const result = await run(server, "signed-out");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("(401)");
  });

  it("replays a version the read shows at its current value, so the missing ownership check is found (422 for a stale one)", async () => {
    const server = await lockApp({ read: "shown", stale: 422 });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    expect(parse(writesBy(server, "b").find((r) => r.method === "PATCH")!.body).lock_version).toBe(1);
  });
});

/** Account A's PATCHes sent after Account B's first one: the write Run Hound compares B's refusal with. */
function aAfterB(server: FixtureServer) {
  const firstB = server.requests.findIndex((r) => r.method === "PATCH" && callerOf(r) === "b");
  return firstB < 0 ? [] : server.requests.slice(firstB + 1).filter((r) => r.method === "PATCH" && callerOf(r) === "a");
}

describe("write-access: a 404 to an attempt that carried a version the record's reads don't show", () => {
  it("is inconclusive when the app refuses a stale version with 404 (no row matched), since Account A's own write is refused the same way", async () => {
    const server = await lockApp({ read: "hidden", stale: 404 });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
    expect(result.notes).toMatch(/lock_version/);
    expect(result.notes).toMatch(/Account A/);
    // The comparison is the same attempt as Account A: the same stale version, and a test value of its own in the same
    // field (never Account B's marker, never the created value).
    const control = aAfterB(server);
    expect(control).toHaveLength(1);
    expect(parse(control[0]!.body).lock_version).toBe(0);
    expect(parse(control[0]!.body).title).toBe("Title wk7s2p9qwybwab");
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("is inconclusive when the app answers 404 both for someone else's task and for a stale version", async () => {
    const server = await lockApp({ read: "hidden", stale: 404, owner: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
  });

  it("passes when the app answers Account A's same write with a conflict (409): a stale version isn't answered 404, so B's 404 was a refusal of Account B", async () => {
    const server = await lockApp({ read: "hidden", stale: 409, owner: true });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
    expect(result.notes).toMatch(/Account A.*409/);
    const control = aAfterB(server);
    expect(control).toHaveLength(1);
    expect(parse(control[0]!.body).title).toBe("Title wk7s2p9qwybwab");
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("is inconclusive when Account A's same write is refused with 422: the re-read shows nothing, and a 422 may be the version check or anything else", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, owner: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
    expect(result.notes).toMatch(/Account A.*422/);
    expect(aAfterB(server)).toHaveLength(1);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("passes when the app applies Account A's same write (it never looks at the version), and puts it back", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, owner: true, checks: false });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
    expect(result.notes).toMatch(/applied it/);
    expect(result.notes).not.toMatch(/Could not be undone|check Account A/);
    // Account A's copy carried its own test value, the re-read showed it, and the put-back undid it.
    const control = aAfterB(server);
    expect(parse(control[0]!.body).title).toBe("Title wk7s2p9qwybwab");
    expect(control.length).toBeGreaterThanOrEqual(2);
    const task = server.tasks.find((t) => t.id === 2)!;
    expect(task.title).toBe("Title wk7s2p9qwab");
  });

  it("is not a pass when the app answers a write that changes nothing at once (200) and a stale version with 404", async () => {
    // The page's own update renames the task, so the replay's lock_version is stale; a copy that set the values the task
    // already has would be answered 200 before the version check and read as "the app takes a stale version".
    const server = await lockApp({ read: "hidden", stale: 404, earlyNoop: true, pageEdits: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toContain("PATCH /api/tasks/2 (404)");
    const control = aAfterB(server);
    expect(control).toHaveLength(1);
    expect(parse(control[0]!.body)).toEqual({ title: "Title wk7s2p9qwybwab edited", lock_version: 0 });
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab edited");
  });

  it("is not a pass when the app refuses a write that changes nothing with 422 before it looks at the version", async () => {
    const server = await lockApp({ read: "hidden", stale: 404, refuseNoChange: true, pageEdits: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab edited");
  });

  it("known limit: when the app applies Account A's same write and its reads show updated_at, the put-back leaves updated_at changed, so it is inconclusive", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, owner: true, checks: false, updatedAt: true });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive: updated_at/);
    expect(result.notes).toMatch(/as Account A to compare/);
    expect(result.notes).toMatch(/check Account A/);
    expect(result.notes).toMatch(/back to its values except updated_at/);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("sends no comparison as Account A when every stamp could be refreshed (the read shows lock_version)", async () => {
    const server = await lockApp({ read: "shown", stale: 422, owner: true });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(aAfterB(server)).toEqual([]);
  });
});

describe("write-access: a version the app's update sends in its URL's query", () => {
  it("is refreshed from the read when the read shows it, so the missing ownership check is found", async () => {
    const server = await lockApp({ read: "shown", stale: 422, where: "query" });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    // Named as it was sent.
    expect(result.findings[0]!.location).toBe("PATCH /api/tasks/2?lock_version=1");
    const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
    expect(new URL(probe.url, "http://x").searchParams.get("lock_version")).toBe("1");
    // The put-back carries the version the record has now in the query too, so the record is back.
    expect(result.notes).not.toMatch(/Could not be undone/);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("is named as stale when the read doesn't show it: a 422 is inconclusive, never a pass", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, where: "query" });
    const result = await run(server, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive/);
    expect(result.notes).toMatch(/lock_version/);
    const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
    expect(new URL(probe.url, "http://x").searchParams.get("lock_version")).toBe("0");
    expect(server.tasks.find((t) => t.id === 2)!.title).not.toMatch(/wk7s2p9qwx/);
  });

  it("still passes a clean app that refuses Account B (404) before it looks at the version, and a stale one with a conflict (409)", async () => {
    const server = await lockApp({ read: "hidden", stale: 409, where: "query", owner: true });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    // Account A's comparison went to the same URL, with the same stale version, and a test value of its own.
    const control = aAfterB(server);
    expect(control).toHaveLength(1);
    expect(new URL(control[0]!.url, "http://x").searchParams.get("lock_version")).toBe("0");
    expect(parse(control[0]!.body).title).toBe("Title wk7s2p9qwybwab");
  });
});

describe("write-access: a stale version the app answers 200 or 204 without applying it (close-out review, round 2)", () => {
  for (const stale of ["noop200", "noop204"] as const) {
    const code = stale === "noop200" ? 200 : 204;
    it(`is inconclusive, never a pass, when UPDATE … WHERE lock_version matched no row and the app answered ${code}`, async () => {
      const server = await lockApp({ read: "hidden", stale });
      const result = await run(server, "other-account");
      expect(result.findings).toEqual([]);
      expect(result.status, result.notes).toBe("skipped");
      expect(result.notes).toMatch(/^Inconclusive/);
      expect(result.notes).toContain(`PATCH /api/tasks/2 (${code})`);
      expect(result.notes).toMatch(/lock_version/);
      // Compared with the same write as Account A, which the app ignored the same way.
      const control = aAfterB(server);
      expect(control).toHaveLength(1);
      expect(parse(control[0]!.body)).toEqual({ title: "Title wk7s2p9qwybwab", lock_version: 0 });
      expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
    });
  }

  it("passes when the app answers Account B 200 without applying the write and applies Account A's same write", async () => {
    const server = await lockApp({ read: "hidden", stale: 422, owner: "noop200", checks: false });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toContain("PATCH /api/tasks/2 (200)");
    expect(result.notes).toMatch(/applied it/);
    expect(result.notes).not.toMatch(/Could not be undone|check Account A/);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });

  it("passes when the app answers Account B 200 without applying the write and Account A's same write with a conflict (409)", async () => {
    const server = await lockApp({ read: "hidden", stale: 409, owner: "noop200" });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/Account A.*409/);
  });

  it("sends no comparison for a 200 when every stamp could be refreshed (the read shows lock_version)", async () => {
    const server = await lockApp({ read: "shown", stale: 409, owner: "noop200" });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("pass");
    expect(aAfterB(server)).toEqual([]);
  });
});

describe("write-access: a query parameter by a stamp's name that isn't the record's (close-out review, round 2)", () => {
  it("leaves ?version=2 (an API version) as the app sent it when the record's own version (5+) was never 2, so the missing ownership check is found", async () => {
    const server = await lockApp({ read: "shown", stale: 422, where: "api-version" });
    const result = await run(server, "other-account");
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    expect(result.findings[0]!.location).toBe("PATCH /api/tasks/2?version=2");
    const probe = writesBy(server, "b").find((r) => r.method === "PATCH")!;
    expect(new URL(probe.url, "http://x").searchParams.get("version")).toBe("2");
    // The put-back goes to the URL as the app sent it, so the record is back.
    expect(result.notes).not.toMatch(/Could not be undone/);
    expect(server.tasks.find((t) => t.id === 2)!.title).toBe("Title wk7s2p9qwab");
  });
});
