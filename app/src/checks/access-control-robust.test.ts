/**
 * access-control on apps that are harder than the accounts app (round-2 review). A small notes app whose sessions are
 * fixed cookies (sid=a-session for A, sid=b-session for B), or bearer tokens when its API is on another local origin.
 * Clean unless an option says otherwise: every /api answers 401 without a session and only the session user's data.
 *
 * - A public script bundle (or page text) that happens to contain Account A's username is not Account A's data: no
 *   finding on a clean app, for a short username ("admin") or an email in a demo hint.
 * - A username is matched as a whole value, never inside another one: B's own "tester12" is not A's "tester1".
 * - An API on another local origin (localhost:<port> for a page on 127.0.0.1): its reads are A's data requests too, so a
 *   read that answers without a session is found.
 * - The test record is saved through a form that saves a record, never through a form that sets a password.
 * - The notes read well with one request, and a page that shows the sign-in form instead of the form says so plainly.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./access-control.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const RUN_TOKEN = "ac0b57a1";

type Which = "other-account" | "signed-out";

interface NotesOptions {
  aUser?: string;
  bUser?: string;
  /** Written into the public /app.js and into the page's own text. */
  hint?: string;
  /** Serve /api/* from a second local origin (localhost:<port>), with bearer tokens from localStorage. */
  apiOrigin?: boolean;
  /** GET /api/notes answers without a session, as A. */
  noAuth?: boolean;
  /** A "Change password" form comes before the "New note" form. */
  passwordForm?: boolean;
  /** The page loads only /api/me (no notes, no form). */
  meOnly?: boolean;
}

interface NotesApp {
  url: string;
  requests: RecordedRequest[];
  passwordChanges: number;
  aUser: string;
  bUser: string;
  close(): Promise<void>;
}

let browser: Browser;
const apps: NotesApp[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

async function startNotes(o: NotesOptions = {}): Promise<NotesApp> {
  const aUser = o.aUser ?? "alice@example.test";
  const bUser = o.bUser ?? "bob@example.test";
  const notes: { owner: "a" | "b"; title: string }[] = [
    { owner: "a", title: "Groceries" },
    { owner: "b", title: "Reading list" },
  ];
  const state = { passwordChanges: 0 };
  let pageOrigin = "";
  const who = (req: RecordedRequest): "a" | "b" | null => {
    const cookie = req.headers.cookie ?? "";
    const auth = String(req.headers.authorization ?? "");
    if (/(?:^|;\s*)sid=a-session\b/.test(cookie) || auth === "Bearer a-token") return "a";
    if (/(?:^|;\s*)sid=b-session\b/.test(cookie) || auth === "Bearer b-token") return "b";
    return null;
  };
  const cors = (): Record<string, string> =>
    o.apiOrigin ? { "access-control-allow-origin": pageOrigin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" } : {};
  const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...cors() });
    res.end(JSON.stringify(body));
  };
  const api = {
    "OPTIONS /api/me": (_req: RecordedRequest, res: import("node:http").ServerResponse) => {
      res.writeHead(204, cors());
      res.end();
    },
    "GET /api/me": (req: RecordedRequest, res: import("node:http").ServerResponse) => {
      const u = who(req);
      return u ? send(res, 200, { username: u === "a" ? aUser : bUser }) : send(res, 401, { error: "Sign in first" });
    },
    "OPTIONS /api/notes": (_req: RecordedRequest, res: import("node:http").ServerResponse) => {
      res.writeHead(204, cors());
      res.end();
    },
    "GET /api/notes": (req: RecordedRequest, res: import("node:http").ServerResponse) => {
      const u = who(req) ?? (o.noAuth ? "a" : null);
      return u ? send(res, 200, { notes: notes.filter((n) => n.owner === u).map((n) => ({ title: n.title })) }) : send(res, 401, { error: "Sign in first" });
    },
    "POST /api/notes": (req: RecordedRequest, res: import("node:http").ServerResponse) => {
      const u = who(req);
      if (!u) return send(res, 401, { error: "Sign in first" });
      notes.push({ owner: u, title: String((JSON.parse(req.body || "{}") as { title?: unknown }).title ?? "") });
      return send(res, 201, { ok: true });
    },
    "OPTIONS /api/password": (_req: RecordedRequest, res: import("node:http").ServerResponse) => {
      res.writeHead(204, cors());
      res.end();
    },
    "PUT /api/password": (req: RecordedRequest, res: import("node:http").ServerResponse) => {
      if (who(req)) state.passwordChanges += 1;
      return send(res, 200, { ok: true });
    },
  };

  const apiServer = o.apiOrigin ? await startFixtureServer({ routes: api }) : null;
  const apiBase = apiServer ? apiServer.url.replace("127.0.0.1", "localhost") : "";
  const forms = [
    o.passwordForm
      ? `<form id="pw" aria-label="Change password"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password">
<label for="cp">Confirm new password</label><input id="cp" type="password" autocomplete="new-password"><button type="submit">Update password</button></form>`
      : "",
    o.meOnly ? "" : `<form id="new-note" aria-label="New note"><label for="title">Title</label><input id="title" name="title" required><button type="submit">Save note</button></form>`,
  ].join("\n");
  const page = `<!doctype html><html lang="en"><head><title>Notes</title><script src="/app.js"></script></head><body>
<main><h1>Your notes</h1>${o.hint ? `<p class="hint">${o.hint}</p>` : ""}<p id="who"></p>${forms}<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
var API = ${JSON.stringify(apiBase)};
var token = localStorage.getItem("token");
var headers = token ? { authorization: "Bearer " + token } : {};
function load() {
  fetch(API + "/api/me", { headers: headers }).then(function (r) {
    if (r.status !== 200) { document.querySelector("main").innerHTML = '<h1>Sign in</h1><form aria-label="Sign in"><label for="u">Username</label><input id="u"><label for="p">Password</label><input id="p" type="password"><button type="submit">Sign in</button></form>'; return null; }
    return r.json();
  }).then(function (me) {
    if (!me) return;
    document.getElementById("who").textContent = "Hello";
    ${o.meOnly ? "" : `fetch(API + "/api/notes", { headers: headers }).then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById("list").innerHTML = d.notes.map(function (n) { return "<li>" + n.title.replace(/</g, "&lt;") + "</li>"; }).join("");
    });`}
  });
}
var nn = document.getElementById("new-note");
if (nn) nn.addEventListener("submit", function (e) {
  e.preventDefault();
  fetch(API + "/api/notes", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers), body: JSON.stringify({ title: document.getElementById("title").value }) })
    .then(function () { document.getElementById("status").textContent = "Note saved"; load(); });
});
var pw = document.getElementById("pw");
if (pw) pw.addEventListener("submit", function (e) {
  e.preventDefault();
  fetch(API + "/api/password", { method: "PUT", headers: Object.assign({ "content-type": "application/json" }, headers), body: JSON.stringify({ password: document.getElementById("np").value }) })
    .then(function () { document.getElementById("status").textContent = "Password updated"; });
});
load();
</script></body></html>`;
  const site = await startFixtureServer({
    pages: { "/notes": page },
    routes: {
      ...(o.apiOrigin ? {} : api),
      "GET /app.js": (_req, res) => {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(`// Public bundle. Routes: "/admin", "/notes". ${o.hint ?? ""}\nwindow.__bundle = true;`);
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  pageOrigin = site.url;
  const handle: NotesApp = {
    url: site.url,
    get requests() {
      return [...site.requests, ...(apiServer?.requests ?? [])];
    },
    get passwordChanges() {
      return state.passwordChanges;
    },
    aUser,
    bUser,
    async close() {
      await site.close();
      await apiServer?.close();
    },
  };
  apps.push(handle);
  return handle;
}

/** The session of A or B (or a dead one) for the app: a cookie, or a bearer token in localStorage for a separate API. */
function session(app: NotesApp, who: "a" | "b" | "dead", apiOrigin = false): SessionState {
  if (apiOrigin) return { cookies: [], origins: [{ origin: app.url, localStorage: [{ name: "token", value: `${who}-token` }] }] };
  return {
    cookies: [{ name: "sid", value: `${who}-session`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
    origins: [],
  };
}

async function discoverWith(url: string, state: SessionState): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: "Your notes" }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

function scenarioFor(which: Which, page: DiscoveredPage): Scenario {
  const planned = check.plan(page.forms[0] ?? emptyForm(page.url), page, { signedIn: true, otherAccount: which === "other-account" }).find((s) => s.id === `access-control:${which}`)!;
  return { ...planned, scope: "page", scopeLabel: "Whole page" };
}

async function run(app: NotesApp, which: Which, o: { apiOrigin?: boolean; self?: "a" | "dead" } = {}): Promise<CheckResult> {
  const targetUrl = `${app.url}/notes`;
  const discovered = await discoverWith(targetUrl, session(app, "a", o.apiOrigin));
  const dir = await mkdtemp(join(tmpdir(), "rh-access-robust-"));
  dirs.push(dir);
  const ctx = createCheckContext({
    browser,
    form: discovered.forms[0] ?? emptyForm(targetUrl),
    openForm: false,
    discoveredPage: discovered,
    targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "access-control",
    sessions: which === "other-account" ? { self: session(app, o.self ?? "a", o.apiOrigin), other: session(app, "b", o.apiOrigin) } : { self: session(app, o.self ?? "a", o.apiOrigin) },
    accounts: { self: A, other: which === "other-account" ? B : null },
    markers: [app.aUser],
  });
  contexts.push(ctx);
  return check.run(ctx, scenarioFor(which, discovered));
}

describe("access-control on a clean app: what is not Account A's data", () => {
  for (const [name, o] of [
    ["a short username that is also a route in the public bundle", { aUser: "admin" }],
    ["an email in a public demo hint (bundle and page text)", { aUser: "demo@acme.test", hint: "Try the demo account: demo@acme.test" }],
  ] as const) {
    it(`no finding for ${name}`, async () => {
      const app = await startNotes(o);
      for (const which of ["other-account", "signed-out"] as const) {
        const result = await run(app, which);
        expect(result.findings, `${which}: ${JSON.stringify(result.findings.map((f) => f.title))}`).toEqual([]);
        expect(result.status, `${which}: ${result.notes}`).toBe("pass");
      }
    });
  }

  it("B's own username is not A's when it merely contains it (tester12 vs tester1)", async () => {
    const app = await startNotes({ aUser: "tester1", bUser: "tester12" });
    const result = await run(app, "other-account");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  });
});

describe("access-control with the app's API on another local origin", () => {
  it("clean: A's reads from the API are A's data requests, and each is refused without a session", async () => {
    const app = await startNotes({ apiOrigin: true });
    const result = await run(app, "signed-out", { apiOrigin: true });
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/Checked 2 of Account A's requests/);
    const signedOutReads = app.requests.filter((r) => r.method === "GET" && r.url.startsWith("/api/") && !r.headers.authorization && !r.headers.cookie);
    expect(signedOutReads.map((r) => r.url).sort()).toEqual(["/api/me", "/api/notes"]);
  });

  it("noAuth: the API's GET /api/notes answers without a session: critical, confirmed", async () => {
    const app = await startNotes({ apiOrigin: true, noAuth: true });
    const result = await run(app, "signed-out", { apiOrigin: true });
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe("critical");
    expect(result.findings[0]!.locations).toEqual([expect.stringMatching(/^GET \/api\/notes\b/)]);
    expect(JSON.stringify(result)).not.toContain("a-token");
  });
});

describe("access-control: the test record", () => {
  it("is saved through the form that saves a record, never through a form that sets a password", async () => {
    const app = await startNotes({ passwordForm: true });
    const result = await run(app, "signed-out");
    expect(app.passwordChanges, "Account A's password was changed").toBe(0);
    expect(app.requests.some((r) => r.method === "POST" && r.url === "/api/notes"), "no test record was saved").toBe(true);
    expect(result.status, result.notes).toBe("pass");
  });
});

describe("access-control: notes", () => {
  it("say it plainly with one request", async () => {
    const app = await startNotes({ meOnly: true });
    const result = await run(app, "signed-out");
    expect(result.status, result.notes).toBe("pass");
    expect(result.notes).toMatch(/Account A's only data request/);
    expect(result.notes).not.toMatch(/\b1 of Account A's request\b/);
  });

  it("a page that shows the sign-in form instead of the form fails in plain words (the session ended)", async () => {
    const app = await startNotes();
    const result = await run(app, "signed-out", { self: "dead" });
    expect(result.status).toBe("error");
    expect(result.notes).toMatch(/sign-in form/);
    expect(result.notes).toMatch(/session/);
    expect(result.notes).not.toMatch(/locator\.|Timeout \d+ms/);
  });
});
