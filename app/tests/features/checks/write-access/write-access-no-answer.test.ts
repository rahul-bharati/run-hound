// write-access (0.6.0 close-out review, round 1): an attempt that got no answer (the connection dropped, or it timed out) and left Account A's test record unchanged says nothing about who may change the record: inconclusive, never a pass ("a pass has to mean the app refused the sender"). The verdict still comes from the re-read: an attempt with no answer that did change the record is a confirmed finding.
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

function session(who: Who): SessionState {
  return { cookies: [{ name: "sid", value: `${who}-session`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
}

function callerOf(req: RecordedRequest): Who | null {
  const m = /(?:^|;\s*)sid=([^;]*)/.exec(String(req.headers.cookie ?? ""));
  return m?.[1] === "a-session" ? "a" : m?.[1] === "b-session" ? "b" : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parse(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// A task app whose update has no ownership check (the planted IDOR). Account B's PATCH gets no answer: the server drops the connection, before it applies the write (`drop: "before"`) or after (`drop: "after"`).
async function dropApp(drop: "before" | "after") {
  const tasks: { id: number; owner: Who; title: string }[] = [{ id: 1, owner: "a", title: "Groceries" }];
  let next = 2;
  const view = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title });
  const script = `function load() { return fetch('/api/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (d) { document.getElementById('list').innerHTML = d.map(function (t) { return '<li>' + t.title + '</li>'; }).join(''); }); }
document.getElementById('new').addEventListener('submit', function (e) { e.preventDefault(); var title = document.getElementById('title').value; var json = { 'content-type': 'application/json' };
  fetch('/api/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); })
    .then(function (t) { return fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: json, body: JSON.stringify({ title: title }) }); }).then(load); });
load();`;
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1>
<form id="new" aria-label="New task"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Add task</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main><script>${script}</script></body></html>`,
    },
    routes: {
      "GET /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in" });
        send(res, 200, tasks.filter((t) => t.owner === caller).map(view));
      },
      "POST /api/tasks": (req, res) => {
        const caller = callerOf(req);
        if (!caller) return send(res, 401, { error: "Sign in" });
        const t = { id: next++, owner: caller, title: String(parse(req.body).title ?? "") };
        tasks.push(t);
        send(res, 201, view(t));
      },
    },
    fallback: (req, res) => {
      const m = /^\/api\/tasks\/(\d+)$/.exec(new URL(req.url, "http://x").pathname);
      const t = m ? tasks.find((x) => x.id === Number(m[1])) : undefined;
      if (!t || req.method !== "PATCH") return send(res, 404, { error: "Not found" });
      const caller = callerOf(req);
      if (!caller) return send(res, 401, { error: "Sign in" });
      const title = parse(req.body).title;
      if (caller === "b" && drop === "before") {
        res.socket?.destroy();
        return;
      }
      if (typeof title === "string") t.title = title;
      if (caller === "b") {
        res.socket?.destroy();
        return;
      }
      send(res, 200, view(t));
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

async function run(server: FixtureServer): Promise<CheckResult> {
  const self = session("a");
  const other = session("b");
  const discovered = await discover(server, self);
  const planned = check.plan(discovered.forms[0]!, discovered, { signedIn: true, otherAccount: true }).find((s) => s.id === "write-access:other-account");
  if (!planned) throw new Error("no write-access:other-account scenario");
  const dir = await mkdtemp(join(tmpdir(), "rh-wa-no-answer-"));
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

describe("write-access: an attempt that got no answer", () => {
  it("is inconclusive, never a pass, when the record is unchanged (the connection dropped before the write was applied)", async () => {
    const server = await dropApp("before");
    const result = await run(server);
    expect(result.findings).toEqual([]);
    expect(result.status, result.notes).toBe("skipped");
    expect(result.notes).toMatch(/^Inconclusive: no answer came to PATCH \/api\/tasks\/2 from Account B/);
    expect(result.notes).toMatch(/can't call this a pass/);
    expect(server.tasks.find((t) => t.id === 2)!.title).not.toMatch(/wk7s2p9qwx/);
  });

  it("is still a confirmed finding when the re-read shows the change (the write was applied, then the connection dropped)", async () => {
    const server = await dropApp("after");
    const result = await run(server);
    expect(result.status, result.notes).toBe("fail");
    expect(result.findings[0]!.title).toBe("Account B can change Account A's records");
    expect(result.findings[0]!.confidence).toBe("confirmed");
    // Put back.
    expect(server.tasks.find((t) => t.id === 2)!.title).not.toMatch(/wk7s2p9qwx/);
  });
});
