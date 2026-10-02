import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer, type RouteHandler } from "../../test-support/server.js";
import { guardContext, guardSummary, rememberCredentials } from "./guard.js";

/**
 * "blocked.test" stands in for a public site. Chromium is told it lives on 127.0.0.1 (so a request that
 * slips through would reach the local fixture server and be recorded), while the safety gate's injected
 * DNS says it is public, so the gate refuses it.
 * "rebind.test" stands in for DNS rebinding: the gate's DNS says it is private (10.0.0.9), but when Chromium looks it
 * up it gets 0.0.0.0, which is not a private address (on Linux a connection to it still reaches this machine).
 */
const lookup = async (host: string) => (host === "blocked.test" ? ["93.184.216.34"] : ["10.0.0.9"]);

let browser: Browser;
let outside: FixtureServer;
let site: FixtureServer;
/** A second local app (another origin) that asks for a password too. */
let other: FixtureServer;
let context: BrowserContext | undefined;

const outsideUrl = (path: string) => `http://blocked.test:${new URL(outside.url).port}${path}`;
const rebindUrl = (path: string) => `http://rebind.test:${new URL(outside.url).port}${path}`;

/** "admin:hunter2" as a Basic Authorization header. */
const BASIC = `Basic ${Buffer.from("admin:hunter2").toString("base64")}`;
const passwordProtected: RouteHandler = (req, res) => {
  if (req.headers.authorization !== BASIC) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="preview"', "content-type": "text/plain" });
    res.end("Password required");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>secret</title><h1>Signed in</h1>");
};

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP rebind.test 0.0.0.0"] });
  outside = await startFixtureServer({ pages: { "/landed": "<title>outside</title><h1>Outside</h1>", "/popup": "<title>popup</title>" } });
  site = await startFixtureServer({
    pages: {
      "/start": `<!doctype html><title>start</title>
        <a id="out" href="${outsideUrl("/landed")}">Leave</a>
        <a id="in" href="/inside">Stay</a>
        <button id="pop" onclick="window.open('${outsideUrl("/popup")}')">Popup</button>
        <form id="post" method="post" action="${outsideUrl("/landed")}"><input name="email" value="owner@example.test"><button>Send</button></form>
        <iframe id="frame"></iframe>`,
      "/inside": "<title>inside</title>",
    },
    routes: {
      "GET /redirect-out": (_req, res) => {
        res.writeHead(302, { location: outsideUrl("/landed") });
        res.end();
      },
      "GET /redirect-in": (_req, res) => {
        res.writeHead(302, { location: "/inside" });
        res.end();
      },
      "GET /secret": passwordProtected,
      "GET /to-other": (_req, res) => {
        res.writeHead(302, { location: `${other.url}/secret` });
        res.end();
      },
    },
  });
  other = await startFixtureServer({ routes: { "GET /secret": passwordProtected } });
});

afterEach(async () => {
  await context?.close().catch(() => undefined);
  context = undefined;
  outside.requests.length = 0;
});

afterAll(async () => {
  await browser?.close();
  await outside?.close();
  await site?.close();
  await other?.close();
});

async function guarded(options: { allowedHosts?: string[] } = {}) {
  context = await browser.newContext();
  const guard = await guardContext(context, { lookup, ...options });
  const page = await context.newPage();
  return { guard, page };
}

describe("guardContext", () => {
  it("lets same-origin navigation and same-origin redirects through", async () => {
    const { guard, page } = await guarded();
    await page.goto(`${site.url}/redirect-in`);
    expect(await page.title()).toBe("inside");
    await page.goto(`${site.url}/start`);
    await page.click("#in");
    await page.waitForURL(/\/inside$/);
    expect(guard.blocked).toEqual([]);
    expect(guard.escaped).toEqual([]);
  });

  it("blocks a link to a host the safety gate refuses, before any request reaches it", async () => {
    const { guard, page } = await guarded();
    await page.goto(`${site.url}/start`);
    await page.click("#out");
    await expect.poll(() => guard.blocked.length).toBeGreaterThan(0);
    expect(guard.blocked[0]).toContain("blocked.test");
    expect(outside.requests).toEqual([]);
    // The blocked navigation leaves Chromium on its own error page, never on the refused site.
    expect(page.url()).not.toContain("blocked.test");
  });

  it("blocks a form post to a refused host, so no form data leaves", async () => {
    const { guard, page } = await guarded();
    await page.goto(`${site.url}/start`);
    await page.click("#post button");
    await expect.poll(() => guard.blocked.length).toBeGreaterThan(0);
    expect(outside.requests).toEqual([]);
  });

  it("blocks popups and iframes pointed at a refused host", async () => {
    const { guard, page } = await guarded();
    await page.goto(`${site.url}/start`);
    await page.click("#pop");
    await page.evaluate((src) => {
      (document.getElementById("frame") as HTMLIFrameElement).src = src;
    }, outsideUrl("/landed"));
    await expect.poll(() => guard.blocked.length).toBeGreaterThanOrEqual(2);
    expect(outside.requests).toEqual([]);
  });

  it("goto to a refused host fails instead of loading it", async () => {
    const { page } = await guarded();
    await expect(page.goto(outsideUrl("/landed"))).rejects.toThrow();
    expect(outside.requests).toEqual([]);
  });

  it("stops the context when a server redirect escapes to a refused host (redirect hops can't be routed)", async () => {
    const { guard, page } = await guarded();
    await page.goto(`${site.url}/redirect-out`).catch(() => undefined);
    await expect.poll(() => guard.escaped.length).toBeGreaterThan(0);
    expect(guard.escaped[0]).toContain("blocked.test");
    // The context is closed, so a check can no longer type into or submit anything on that site.
    await expect.poll(() => page.isClosed()).toBe(true);
  });

  it("stops the context when a host the gate approved by DNS answers from a public address (DNS rebinding)", async () => {
    const { guard, page } = await guarded();
    await page.goto(rebindUrl("/landed")).catch(() => undefined);
    await expect.poll(() => guard.escaped.length).toBeGreaterThan(0);
    expect(guard.escaped[0]).toContain("rebind.test");
    expect(guard.escaped[0]).toContain("0.0.0.0");
    expect(guardSummary(guard)).toMatch(/^Stopped: the page left the target and went to http:\/\/rebind\.test:\d+\/landed \(answered from 0\.0\.0\.0, not a private address\)/);
    await expect.poll(() => page.isClosed()).toBe(true);
  });

  it("trusts a host listed in allowedHosts wherever it answers from", async () => {
    const { guard, page } = await guarded({ allowedHosts: ["rebind.test"] });
    await page.goto(rebindUrl("/landed"));
    expect(await page.title()).toBe("outside");
    await page.waitForTimeout(300);
    expect(guard.escaped).toEqual([]);
    expect(page.isClosed()).toBe(false);
  });
});

describe("user name and password from the target URL", () => {
  it("answers the target's HTTP authentication with them, and never sends them to another origin", async () => {
    rememberCredentials(`${site.url}/book`, { username: "admin", password: "hunter2" });
    const { guard, page } = await guarded();
    const answer = await page.goto(`${site.url}/secret`);
    expect(answer?.status()).toBe(200);
    expect(await page.title()).toBe("secret");
    // The page's own requests to the target are answered too.
    expect(await page.evaluate(`fetch("/secret").then((r) => r.status)`)).toBe(200);
    // Another local app asking for a password gets nothing, by link or by redirect.
    const elsewhere = await page.goto(`${other.url}/secret`);
    expect(elsewhere?.status()).toBe(401);
    await page.goto(`${site.url}/to-other`);
    expect(other.requests.length).toBeGreaterThan(0);
    for (const r of other.requests) expect(r.headers.authorization).toBeUndefined();
    expect(guard.escaped).toEqual([]);
  });
});
