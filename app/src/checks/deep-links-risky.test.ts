/**
 * deep-links never opens a link that acts when it is loaded (round-2 review): signing out ("Log off", "/log-off"),
 * disconnecting an integration, accepting an invitation, or any link whose path or query says it deletes, removes or
 * ends something ("?action=delete"). Opening one directly with Account A's session would change A's data or end the
 * session every later scenario uses. Discovery leaves the same links out of DiscoveredPage.linkTargets.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountRef, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./deep-links.js";

const A: AccountRef = { id: "a", label: "Account A" };
const SELF: SessionState = {
  cookies: [{ name: "sid", value: "a-session", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [],
};

const RISKY = ["/log-off", "/integrations/slack/disconnect", "/notes", "/invites/abc123/accept", "/account/session/end"];

let browser: Browser;
let server: FixtureServer;
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  browser = await getBrowser();
  const plain = (title: string) => (_req: unknown, res: import("node:http").ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(shell(title, `<main><h1>${title}</h1></main>`));
  };
  server = await startFixtureServer({
    pages: {
      "/home": shell(
        "Home",
        `<header><nav aria-label="Main">
<a href="/help">Help</a> <a href="/settings">Settings</a>
<a href="/integrations/slack/disconnect">Disconnect Slack</a> <a href="/log-off">Log off</a>
<a href="/notes?action=delete&amp;id=3">Tidy up</a> <a href="/invites/abc123/accept">Join the team</a>
<a href="/account/session/end">Leave</a></nav></header><main><h1>Home</h1></main>`,
      ),
    },
    routes: {
      "GET /help": plain("Help"),
      "GET /settings": plain("Settings"),
      "GET /log-off": plain("Signed out"),
      "GET /integrations/slack/disconnect": plain("Disconnected"),
      "GET /notes": plain("Notes"),
      "GET /invites/abc123/accept": plain("Welcome to the team"),
      "GET /account/session/end": plain("Signed out"),
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(async () => {
  await server?.close();
  await closeBrowser();
});

async function discover(url: string): Promise<DiscoveredPage> {
  const context = await browser.newContext({ storageState: SELF });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: "Home" }).waitFor();
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

describe("deep-links and links that act", () => {
  it("discovery leaves them out of the link targets", async () => {
    const page = await discover(`${server.url}/home`);
    const paths = (page.linkTargets ?? []).map((u) => new URL(u).pathname);
    expect(paths.sort()).toEqual(["/help", "/settings"]);
    for (const risky of RISKY) expect(paths, risky).not.toContain(risky);
  });

  it("opens only the links that just show a page, never one that signs out, disconnects, accepts or deletes", async () => {
    const targetUrl = `${server.url}/home`;
    const page = await discover(targetUrl);
    server.requests.length = 0;
    const dir = await mkdtemp(join(tmpdir(), "rh-deep-links-risky-"));
    dirs.push(dir);
    const ctx = createCheckContext({
      browser,
      form: emptyForm(targetUrl),
      discoveredPage: page,
      targetUrl,
      artifactsDir: dir,
      runToken: "d0b57a1e",
      checkId: "deep-links",
      sessions: { self: SELF },
      accounts: { self: A, other: null },
    });
    contexts.push(ctx);
    const scenario: Scenario = { ...check.plan(emptyForm(targetUrl), page, { signedIn: true, otherAccount: false })[0]!, scope: "page", scopeLabel: "Whole page" };
    const result = await check.run(ctx, scenario);

    expect(result.status, result.notes).toBe("pass");
    const opened = server.requests.filter((r) => r.method === "GET").map((r) => new URL(r.url, "http://x").pathname);
    expect(opened).toContain("/help");
    expect(opened).toContain("/settings");
    for (const risky of RISKY) expect(opened, `${risky} was opened`).not.toContain(risky);
  });
});
