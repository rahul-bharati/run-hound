/**
 * mass-assignment when the record already holds privileged values, when the response holds other records, and when
 * the save creates a record (round-2 review). A field counts as accepted only when the record Run Hound saved did not
 * hold the injected value before the replay and holds it after, looking only at that record (the object that holds
 * the test values, and its parents), never at a list of other people or older records. The notes say what was
 * restored only when a re-read shows it, and a save that creates a record is never "restored" by creating another.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./mass-assignment.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "ma0b57a1";
const SELF: SessionState = {
  cookies: [{ name: "sid", value: "a-session", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};

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

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const signedIn = (req: RecordedRequest) => /(?:^|;\s*)sid=a-session\b/.test(req.headers.cookie ?? "");

interface ProfileOptions {
  /** What the account's record already holds, besides displayName. */
  extras?: Record<string, unknown>;
  /** The answer also lists the workspace's members (one of them an admin). */
  members?: boolean;
  /** PUT stores every key; "sticky" keeps a role once it is "admin" (a restore can't take it back). */
  store?: "displayName" | "everything" | "sticky";
}

/** A profile page: GET /api/profile loads the record, PUT /api/profile saves the form's one field. */
async function profileApp(o: ProfileOptions = {}): Promise<FixtureServer> {
  const record: Record<string, unknown> = { id: "u1", displayName: "Alice", ...(o.extras ?? {}) };
  const server = await startFixtureServer({
    pages: {
      "/profile": `<!doctype html><html lang="en"><head><title>Profile</title></head><body><main><h1>Profile</h1>
<form id="profile" aria-label="Profile"><label for="dn">Display name</label><input id="dn" name="displayName" required><button type="submit">Save profile</button></form>
<p role="status" id="status"></p></main>
<script>
fetch("/api/profile").then(function (r) { return r.json(); }).then(function (p) { document.getElementById("dn").value = p.profile.displayName; });
document.getElementById("profile").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: document.getElementById("dn").value }) })
    .then(function () { document.getElementById("status").textContent = "Profile saved"; });
});
</script></body></html>`,
    },
    routes: {
      "GET /api/profile": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, { profile: record, ...(o.members ? { members: [{ name: "Owner", role: "admin", plan: "pro" }] } : {}) });
      },
      "PUT /api/profile": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        const body = JSON.parse(req.body) as Record<string, unknown>;
        if (typeof body.displayName === "string") record.displayName = body.displayName;
        if (o.store === "everything" || o.store === "sticky") {
          for (const [k, v] of Object.entries(body)) {
            if (k === "id" || k === "displayName") continue;
            if (o.store === "sticky" && k === "role" && record.role === "admin") continue;
            record[k] = v;
          }
        }
        return send(res, 200, { profile: record });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return server;
}

/** A notes page: POST /api/notes creates a note (storing every key it is sent), GET /api/notes lists them. */
async function notesApp(): Promise<FixtureServer> {
  const notes: Record<string, unknown>[] = [];
  const server = await startFixtureServer({
    pages: {
      "/notes": `<!doctype html><html lang="en"><head><title>Notes</title></head><body><main><h1>Notes</h1>
<form id="note" aria-label="New note"><label for="t">Title</label><input id="t" name="title" required><button type="submit">Save note</button></form>
<p role="status" id="status"></p><ul id="list"></ul></main>
<script>
function load() { fetch("/api/notes").then(function (r) { return r.json(); }).then(function (d) {
  document.getElementById("list").innerHTML = d.notes.map(function (n) { return "<li>" + String(n.title).replace(/</g, "&lt;") + "</li>"; }).join(""); }); }
document.getElementById("note").addEventListener("submit", function (e) {
  e.preventDefault();
  fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: document.getElementById("t").value }) })
    .then(function () { document.getElementById("status").textContent = "Note saved"; load(); });
});
load();
</script></body></html>`,
    },
    routes: {
      "GET /api/notes": (req, res) => (signedIn(req) ? send(res, 200, { notes }) : send(res, 401, { error: "Sign in first" })),
      "POST /api/notes": (req, res) => {
        if (!signedIn(req)) return send(res, 401, { error: "Sign in first" });
        const note = { id: `n${notes.length + 1}`, ...(JSON.parse(req.body) as Record<string, unknown>) };
        notes.push(note);
        return send(res, 201, { note });
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return server;
}

async function discover(url: string, ready: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: SELF });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: ready }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

async function run(server: FixtureServer, path: string, ready: string): Promise<CheckResult> {
  const targetUrl = `${server.url}${path}`;
  const page = await discover(targetUrl, ready);
  server.requests.length = 0;
  const dir = await mkdtemp(join(tmpdir(), "rh-mass-robust-"));
  dirs.push(dir);
  const form = page.forms[0]!;
  const ctx = createCheckContext({
    browser,
    form,
    discoveredPage: page,
    targetUrl,
    artifactsDir: dir,
    runToken: RUN_TOKEN,
    checkId: "mass-assignment",
    sessions: { self: SELF },
    accounts: { self: A, other: null },
    markers: [],
  });
  contexts.push(ctx);
  const scenario: Scenario = { ...check.plan(form, page, { signedIn: true, otherAccount: false })[0]!, scope: "form", formIndex: 0 };
  return check.run(ctx, scenario);
}

const writes = (server: FixtureServer) => server.requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");

describe("mass-assignment on a clean server", () => {
  it("passes when Account A's record already holds the injected values (an admin, a pro plan, a verified email)", async () => {
    const server = await profileApp({ extras: { role: "admin", plan: "pro", emailVerified: true } });
    const result = await run(server, "/profile", "Profile");
    expect(result.findings.map((f) => f.title)).toEqual([]);
    expect(result.status).toBe("pass");
    // Nothing changed, so nothing to restore: the form's own save and the replay, no third write.
    expect(writes(server)).toHaveLength(2);
    expect(result.notes).not.toMatch(/Restored/);
    expect(result.notes).toMatch(/already/);
  });

  it("passes when the answer also lists other members who are admins", async () => {
    const server = await profileApp({ members: true });
    const result = await run(server, "/profile", "Profile");
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("pass");
  });
});

describe("mass-assignment on a vulnerable server", () => {
  it("a save that creates a record: the finding stands, and no second record is created to 'restore' anything", async () => {
    const server = await notesApp();
    const result = await run(server, "/notes", "Notes");
    expect(result.status).toBe("fail");
    expect(result.findings.find((f) => f.severity === "critical")?.title).toMatch(/role/);
    // The form's own POST and the replay: no third POST.
    expect(writes(server).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/notes", "POST /api/notes"]);
    expect(result.notes).not.toMatch(/Restored/);
    expect(result.notes).toMatch(/new (test )?record/);
  });

  it("says a field was restored only when a re-read shows it; a field the server kept is named", async () => {
    const server = await profileApp({ extras: { role: "member", plan: "free" }, store: "sticky" });
    const result = await run(server, "/profile", "Profile");
    expect(result.status).toBe("fail");
    // plan went back to free; role stayed admin.
    expect(result.notes).toMatch(/Restored plan/);
    expect(result.notes).not.toMatch(/Restored[^.]*\brole\b/);
    expect(result.notes).toMatch(/\brole\b[^.]*(still|kept)/);
  });
});
