// write-access (0.6.0 close-out round 1): an app whose writes carry an anti-CSRF token in a header, the way Django (X-CSRFToken from the csrftoken cookie), Laravel and Angular with axios (X-XSRF-TOKEN from the URL-encoded XSRF-TOKEN cookie) and Rails (X-CSRF-Token from <meta name="csrf-token">) apps send it from their scripts. The update has no ownership check (a planted IDOR) unless `owner` is set.
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../../../../src/core/types.js";
import type { SessionState } from "../../../../src/engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverPage } from "../../../../src/engine/discover.js";
import { check } from "../../../../src/checks/write-access.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const RUN_TOKEN = "hk7s2p9q";

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
// Where the page reads its token: a cookie (Django), a URL-encoded cookie (Laravel, axios), a <meta> (Rails), or a JSON endpoint it keeps in memory.
type Source = "cookie" | "encoded-cookie" | "meta" | "memory";

// Each account's anti-CSRF token, as the header carries it.
const TOKEN: Record<Who, string> = { a: "acsrf7Hq2Lm9Xc4Pz81==", b: "bcsrf3Zr8Wn1Pk6Qy52==" };
const HEADER: Record<Source, string> = { cookie: "x-csrftoken", "encoded-cookie": "x-xsrf-token", meta: "x-csrf-token", memory: "x-csrf-token" };
const COOKIE: Partial<Record<Source, { name: string; value: (who: Who) => string }>> = {
  cookie: { name: "csrftoken", value: (who) => TOKEN[who] },
  "encoded-cookie": { name: "XSRF-TOKEN", value: (who) => encodeURIComponent(TOKEN[who]) },
};

function session(who: Who, source: Source, withToken = true): SessionState {
  const cookie = (name: string, value: string, httpOnly: boolean) => ({ name, value, domain: "127.0.0.1", path: "/", expires: -1, httpOnly, secure: false, sameSite: "Lax" as const });
  const token = withToken ? COOKIE[source] : undefined;
  return { cookies: [cookie("sid", `${who}-session`, true), ...(token ? [cookie(token.name, token.value(who), false)] : [])], origins: [] };
}

// The value of cookie `name` a request carried, or "" when it carried none.
function cookieOf(req: RecordedRequest, name: string): string {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(String(req.headers.cookie ?? ""))?.[1] ?? "";
}

function callerOf(req: RecordedRequest): Who | null {
  const m = /(?:^|;\s*)sid=([^;]*)/.exec(String(req.headers.cookie ?? ""));
  return m?.[1] === "a-session" ? "a" : m?.[1] === "b-session" ? "b" : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const pathOf = (url: string) => new URL(url, "http://x").pathname;

// The page's script for reading its token, by source.
const READ_TOKEN: Record<Source, string> = {
  cookie: "function token() { var m = /(?:^|;\\s*)csrftoken=([^;]*)/.exec(document.cookie); return Promise.resolve(m ? m[1] : ''); }",
  "encoded-cookie": "function token() { var m = /(?:^|;\\s*)XSRF-TOKEN=([^;]*)/.exec(document.cookie); return Promise.resolve(m ? decodeURIComponent(m[1]) : ''); }",
  meta: "function token() { var m = document.querySelector('meta[name=csrf-token]'); return Promise.resolve(m ? m.getAttribute('content') : ''); }",
  memory: "var KEPT = null; function token() { return KEPT ? Promise.resolve(KEPT) : fetch('/api/csrf').then(function (r) { return r.json(); }).then(function (d) { KEPT = d.token; return KEPT; }); }",
};

// A task app whose every write carries the caller's token in HEADER[source]. The form creates a task (POST /api/tasks) and then saves it again (POST /api/tasks/<id>): the app's own update. `order`: whether the update checks the token before the session (Django's middleware, "csrf-first") or after it. `owner`: whether it checks who owns the task.
async function headerApp(o: {
  source: Source;
  owner?: boolean;
  order?: "csrf-first" | "session-first";
  refuse?: number;
  rotate?: boolean;
  // A double-submit app (Django's csrftoken, csrf-csrf): the header must equal the csrftoken cookie the same request carries. "rotate": every load of the page sets a fresh csrftoken (a token per render). "unsaved": the page sets one only when the request carries none (a saved session taken before the app issued it again).
  jar?: "rotate" | "unsaved";
}) {
  const tasks: { id: number; owner: Who; title: string }[] = [{ id: 1, owner: "a", title: "Groceries" }];
  let next = 2;
  const header = HEADER[o.source];
  const refuse = o.refuse ?? 403;
  // Laravel's way (`rotate`): every answer to a signed-in caller sets XSRF-TOKEN again, encrypted anew ("<token>.<n>").
  let issued = 0;
  let minted = 0;
  const reply = (res: ServerResponse, who: Who | null, status: number, body: unknown) => {
    if (o.rotate && who) res.setHeader("set-cookie", `XSRF-TOKEN=${encodeURIComponent(`${TOKEN[who]}.${++issued}`)}; Path=/`);
    send(res, status, body);
  };
  const html = (who: Who | null) => `<!doctype html><html lang="en"><head><title>Tasks</title>${
    o.source === "meta" && who ? `<meta name="csrf-token" content="${TOKEN[who]}">` : ""
  }</head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
${READ_TOKEN[o.source]}
function post(url, body) { return token().then(function (t) { return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', '${header}': t }, body: JSON.stringify(body) }); }); }
function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value;
  post('/api/tasks', { title: title }).then(function (r) { return r.json(); }).then(function (t) { return post('/api/tasks/' + t.id, { title: title }); }).then(load); });
load();
</script></body></html>`;
  // Any token the app issued to the caller's session is accepted, the way Laravel decrypts its cookie.
  const tokenOk = (req: RecordedRequest, who: Who | null) => {
    const sent = String(req.headers[header] ?? "");
    if (o.jar) return who !== null && sent !== "" && sent === cookieOf(req, "csrftoken");
    return who !== null && (sent === TOKEN[who] || (o.rotate === true && sent.startsWith(`${TOKEN[who]}.`)));
  };
  const server = await startFixtureServer({
    routes: {
      "GET /app": (req, res) => {
        if (o.jar === "rotate" || (o.jar === "unsaved" && cookieOf(req, "csrftoken") === "")) {
          res.setHeader("set-cookie", `csrftoken=fresh${callerOf(req) ?? "x"}${++minted}Zq8Lm2Xc4Pz81Wn6; Path=/`);
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html(callerOf(req)));
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "GET /api/csrf": (req, res) => {
        const who = callerOf(req);
        if (!who) return send(res, 401, { error: "Sign in" });
        send(res, 200, { token: TOKEN[who] });
      },
      "GET /api/tasks": (req, res) => {
        const who = callerOf(req);
        if (!who) return send(res, 401, { error: "Sign in" });
        reply(res, who, 200, tasks.filter((t) => t.owner === who).map((t) => ({ id: t.id, title: t.title })));
      },
      "POST /api/tasks": (req, res) => {
        const who = callerOf(req);
        if (!who) return send(res, 401, { error: "Sign in" });
        if (!tokenOk(req, who)) return reply(res, who, refuse, { detail: "CSRF Failed: CSRF token missing or incorrect." });
        const t = { id: next++, owner: who, title: String((JSON.parse(req.body) as { title?: string }).title ?? "") };
        tasks.push(t);
        reply(res, who, 201, { id: t.id, title: t.title });
      },
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/(\d+)$/.exec(pathOf(req.url));
      const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
      if (!t || req.method !== "POST") return send(res, 404, { error: "Not found" });
      const who = callerOf(req);
      if (o.order === "csrf-first") {
        if (!tokenOk(req, who)) return reply(res, who, refuse, { detail: "CSRF Failed: CSRF token missing or incorrect." });
        if (!who) return send(res, 401, { error: "Sign in" });
      } else {
        if (!who) return send(res, 401, { error: "Sign in" });
        if (!tokenOk(req, who)) return reply(res, who, refuse, { detail: "CSRF Failed: CSRF token missing or incorrect." });
      }
      if (o.owner && t.owner !== who) return reply(res, who, 404, { error: "Not found" });
      const title = (JSON.parse(req.body) as { title?: unknown }).title;
      if (typeof title === "string") t.title = title;
      reply(res, who, 200, { id: t.id, title: t.title });
    },
  });
  servers.push(server);
  return Object.assign(server, { tasks });
}

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

async function run(server: FixtureServer, which: "other-account" | "signed-out", source: Source, saved = true): Promise<CheckResult> {
  const self = session("a", source, saved);
  const discovered = await discover(server, self);
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === `write-access:${which}`);
  if (!planned) throw new Error(`no write-access:${which} scenario`);
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-header-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0]!,
    discoveredPage: discovered,
    targetUrl: `${server.url}/app`,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "write-access",
    sessions: { self, other: session("b", source, saved) },
    accounts: { self: A, other: B },
    markers: [],
  });
  contexts.push(ctx);
  server.requests.length = 0;
  return check.run(ctx, { ...planned, scope: "form", formIndex: 0 } as Scenario);
}

// The updates (POST /api/tasks/<id>) sent by `who` (null: with no session).
const updatesBy = (server: FixtureServer, who: Who | null) =>
  server.requests.filter((r) => r.method === "POST" && /^\/api\/tasks\/\d+$/.test(pathOf(r.url)) && callerOf(r) === who);

describe("write-access: an app whose writes carry an anti-CSRF token in a header", () => {
  it.each(["cookie", "encoded-cookie", "meta"] as const)("%s: Account B's replay carries B's own token in the header, so the IDOR is found", async (source) => {
    const server = await headerApp({ source });
    const result = await run(server, "other-account", source);
    const fromB = updatesBy(server, "b");
    expect(fromB.length, result.notes).toBeGreaterThan(0);
    for (const r of fromB) {
      expect(r.headers[HEADER[source]]).toBe(TOKEN.b);
      // Account A's token never goes out as Account B, anywhere in the request.
      expect(JSON.stringify(r)).not.toContain(TOKEN.a.slice(0, 16));
    }
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings.map((f) => `${f.severity} ${f.confidence}`)).toContain("critical confirmed");
    // Put back.
    expect(server.tasks.filter((t) => t.owner === "a" && t.id !== 1).every((t) => !/hk7s2p9qwxb/.test(t.title))).toBe(true);
  }, 90_000);

  it("a clean app (the update checks the owner) still passes: B's own token is sent, and the app refuses B", async () => {
    const server = await headerApp({ source: "cookie", owner: true });
    const result = await run(server, "other-account", "cookie");
    const fromB = updatesBy(server, "b");
    expect(fromB.length).toBeGreaterThan(0);
    expect(fromB.every((r) => r.headers["x-csrftoken"] === TOKEN.b)).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
  }, 90_000);

  it("no token of B's own to read (kept in memory): B's refused replay (403) is inconclusive, never a pass", async () => {
    const server = await headerApp({ source: "memory" });
    const result = await run(server, "other-account", "memory");
    const fromB = updatesBy(server, "b");
    expect(fromB.length).toBeGreaterThan(0);
    // Never Account A's token.
    for (const r of fromB) expect(r.headers["x-csrf-token"]).toBeUndefined();
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/Inconclusive/);
    expect(result.notes).toMatch(/x-csrf-token/i);
    expect(result.notes).toMatch(/can't call this a pass/);
    expect(result.notes).toMatch(/couldn't match a token of Account B's own/);
  }, 90_000);

  it("signed out, an app that checks the token before the session (403) is inconclusive, never a pass", async () => {
    const server = await headerApp({ source: "cookie", order: "csrf-first" });
    const result = await run(server, "signed-out", "cookie");
    expect(updatesBy(server, null).length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/x-csrftoken/i);
    expect(result.notes).toMatch(/can't call this a pass/);
  }, 90_000);

  it("signed out, an app that asks for a session first (401) passes", async () => {
    const server = await headerApp({ source: "cookie", order: "session-first" });
    const result = await run(server, "signed-out", "cookie");
    expect(updatesBy(server, null).length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("pass");
  }, 90_000);

  it.each([422, 400])("signed out, an app that refuses the header-less replay with %i before the session (Rails, ASP.NET Core) is inconclusive, never a pass", async (refuse) => {
    const server = await headerApp({ source: "meta", order: "csrf-first", refuse });
    const result = await run(server, "signed-out", "meta");
    expect(updatesBy(server, null).length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(new RegExp(`\\(${refuse}\\), sent without the anti-CSRF header`));
    expect(result.notes).toMatch(/can't call this a pass/);
  }, 90_000);

  it.each([422, 400])("no token of B's own to read (kept in memory): B's replay refused with %i is inconclusive, never a pass", async (refuse) => {
    const server = await headerApp({ source: "memory", refuse });
    const result = await run(server, "other-account", "memory");
    const fromB = updatesBy(server, "b");
    expect(fromB.length).toBeGreaterThan(0);
    for (const r of fromB) expect(r.headers["x-csrf-token"]).toBeUndefined();
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/can't call this a pass/);
  }, 90_000);

  it("Laravel's XSRF-TOKEN cookie, encrypted anew on every answer: B's replay carries B's current cookie, paired by name, so the IDOR is found", async () => {
    const server = await headerApp({ source: "encoded-cookie", refuse: 419, rotate: true });
    const result = await run(server, "other-account", "encoded-cookie");
    const fromB = updatesBy(server, "b");
    expect(fromB.length, result.notes).toBeGreaterThan(0);
    for (const r of fromB) {
      expect(String(r.headers["x-xsrf-token"] ?? "")).toMatch(new RegExp(`^${TOKEN.b.replace(/[=]/g, "\\$&")}(\\.\\d+)?$`));
      expect(JSON.stringify(r)).not.toContain(TOKEN.a.slice(0, 16));
    }
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings.map((f) => `${f.severity} ${f.confidence}`)).toContain("critical confirmed");
  }, 90_000);

  // 0.6.0 close-out round 3: B's token is read from a page opened as B (a browser context), but the replay goes through a request context seeded from B's saved session. When the page load set a csrftoken the saved session doesn't hold (a fresh one per render, or one the saved session never had), the header no longer matches the cookie the replay carries: the app's 403 is its CSRF check, and the update, which has no owner check, is never called a pass.
  it.each([
    ["rotate", true],
    ["unsaved", false],
  ] as const)("double-submit, the page sets csrftoken on load (%s): B's refused replay is never a pass", async (jar, saved) => {
    const server = await headerApp({ source: "cookie", jar });
    const result = await run(server, "other-account", "cookie", saved);
    const fromB = updatesBy(server, "b");
    expect(fromB.length, result.notes).toBeGreaterThan(0);
    for (const r of fromB) expect(JSON.stringify(r)).not.toContain(TOKEN.a.slice(0, 16));
    expect(result.status, result.notes).not.toBe("pass");
    if (result.status === "fail") {
      expect(result.findings.map((f) => `${f.severity} ${f.confidence}`)).toContain("critical confirmed");
    } else {
      expect(result.status, result.notes).toBe("skipped");
      expect(result.findings).toEqual([]);
      expect(result.notes).toMatch(/Inconclusive/);
      expect(result.notes).toMatch(/x-csrftoken/i);
      expect(result.notes).toMatch(/csrftoken/);
      expect(result.notes).toMatch(/can't call this a pass/);
    }
  }, 90_000);
});
