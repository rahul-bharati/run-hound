/**
 * CheckContext identities (0.4.0, docs/v2-spec.md "Signed-in runs" and "Types"): createCheckContext with
 * ContextOptions.sessions opens pages and sends requests as the run's account ("self"), the other account ("other") or
 * nobody ("signed-out").
 *
 * - openPage({ as }) opens its fresh context with that identity's storageState; "other" throws without a second
 *   account; a signed-out run opens everything signed out, as in 0.3.0.
 * - request(as, req) sends one HTTP request with the identity's cookies plus, for self/other, the credential headers
 *   the app itself sent from that identity to the same origin (authorization, apikey, x-*-token, x-api-key; never
 *   guessed from storage). Credential headers in `req.headers` are dropped. The URL must pass the safety gate,
 *   redirects are not followed, the body is capped at 1 MB, header names are lower-case. Not page activity; an
 *   accepted non-GET counts as a test record.
 * - accountMarkers() returns ContextOptions.markers; accounts is ContextOptions.accounts.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import type { AccountRef } from "../core/types.js";
import type { SessionState } from "./auth.js";
import { createCheckContext, type ContextOptions, type RunningCheckContext } from "./context.js";
import { emptyForm } from "./discover.js";

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };

let cookieApp: AccountsApp;
let bearerApp: AccountsApp;
/** An app whose page sends its own credential headers (x-auth-token, "authorization: Custom …") from localStorage. */
let headerApp: FixtureServer;
/** A second local origin that only echoes. */
let elsewhere: FixtureServer;
let artifactsDir: string;
const opened: RunningCheckContext[] = [];

async function makeContext(targetUrl: string, extra: Partial<ContextOptions> = {}): Promise<RunningCheckContext> {
  const ctx = createCheckContext({ browser: await getBrowser(), form: emptyForm(targetUrl), targetUrl, artifactsDir, runToken: "t3st", ...extra });
  opened.push(ctx);
  return ctx;
}

/** The token a bearer-mode storage state carries for `app`. */
function tokenOf(app: AccountsApp, state: SessionState): string {
  const token = state.origins.find((o) => o.origin === app.url)?.localStorage.find((i) => i.name === "token")?.value;
  if (!token) throw new Error("storageState has no token");
  return token;
}

/** A storage state for the header app: a cookie for 127.0.0.1 and localStorage "tok" for the app's origin. */
function headerState(tok: string, cookie: string): SessionState {
  return {
    cookies: [{ name: "sess", value: cookie, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
    origins: [{ origin: headerApp.url, localStorage: [{ name: "tok", value: tok }] }],
  };
}

/** The last request `server` received for `path` (query included in RecordedRequest.url). */
function lastRequest(requests: RecordedRequest[], path: string): RecordedRequest | undefined {
  return requests.filter((r) => r.url.split("?")[0] === path).at(-1);
}

function header(r: RecordedRequest | undefined, name: string): string | undefined {
  const value = r?.headers[name];
  return Array.isArray(value) ? value.join("; ") : value;
}

/** Who /settings says is signed in: the email it shows, or "signed out (<path>)" once the sign-in form is up. */
async function shownUser(page: Page): Promise<string> {
  await page.locator("#me-email, #signin-form").first().waitFor({ timeout: 10_000 });
  if ((await page.locator("#me-email").count()) > 0) return (await page.locator("#me-email").textContent()) ?? "";
  return `signed out (${new URL(page.url()).pathname})`;
}

const bodyOf = (text: string) => JSON.parse(text) as { email?: string; notes?: { ownerId: string }[]; error?: string };

beforeAll(async () => {
  [cookieApp, bearerApp] = await Promise.all([startAccountsApp(), startAccountsApp({ tokenMode: "bearer" })]);
  const echo = (_req: RecordedRequest, res: Parameters<typeof json>[0]) => json(res, 200, { ok: true });
  elsewhere = await startFixtureServer({ routes: { "GET /api/echo": echo } });
  headerApp = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Header app</title></head><body><h1>Header app</h1>
        <script>
          const tok = localStorage.getItem("tok");
          if (tok) fetch("/api/data", { headers: { "x-auth-token": tok, authorization: "Custom " + tok, "x-client-version": "1.2.3" } });
        </script></body></html>`,
      // Holds the same storage but never sends a credential header.
      "/quiet": `<!doctype html><html lang="en"><head><title>Quiet</title></head><body><h1>Quiet</h1></body></html>`,
    },
    routes: {
      "GET /api/data": (_req, res) => json(res, 200, { items: [] }),
      "GET /api/echo": echo,
      "GET /big": (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("x".repeat(2 * 1024 * 1024));
      },
      "GET /hop": (_req, res) => {
        res.writeHead(302, { location: "/landing" });
        res.end();
      },
      "GET /landing": (_req, res) => json(res, 200, { landed: true }),
      "GET /cased": (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json", "X-Custom-Header": "Yes" });
        res.end("{}");
      },
    },
  });
});

afterAll(async () => {
  await Promise.all([cookieApp?.stop(), bearerApp?.stop(), headerApp?.close(), elsewhere?.close()]);
  await closeBrowser();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), "rh-context-request-"));
  for (const app of [cookieApp, bearerApp]) {
    app.reset();
    app.signOutEveryone();
  }
  headerApp.requests.length = 0;
  elsewhere.requests.length = 0;
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((ctx) => ctx.dispose()));
  await rm(artifactsDir, { recursive: true, force: true });
});

describe("openPage({ as })", () => {
  it.each(["cookie", "bearer"] as const)("%s sessions: self (the default) is Account A, other is Account B, signed-out is nobody", async (mode) => {
    const app = mode === "cookie" ? cookieApp : bearerApp;
    const ctx = await makeContext(`${app.url}/settings`, {
      sessions: { self: app.storageState("alice"), other: app.storageState("bob") },
      accounts: { self: A, other: B },
    });

    const byDefault = await ctx.openPage();
    expect(await shownUser(byDefault.page)).toBe(app.users.alice.email);
    // Capture still works on a signed-in page.
    expect(byDefault.capture.requests.some((r) => r.url === `${app.url}/api/me` && r.status === 200)).toBe(true);

    const self = await ctx.openPage({ as: "self" });
    expect(await shownUser(self.page)).toBe(app.users.alice.email);

    const other = await ctx.openPage({ as: "other" });
    expect(await shownUser(other.page)).toBe(app.users.bob.email);
    expect(other.context).not.toBe(self.context);

    const signedOut = await ctx.openPage({ as: "signed-out" });
    expect(await shownUser(signedOut.page)).toBe("signed out (/login)");
    expect(signedOut.page.url()).toBe(`${app.url}/login?next=/settings`);
    expect(await signedOut.context.cookies()).toEqual([]);
    expect(await signedOut.page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  });

  it("keeps a custom viewport together with an identity", async () => {
    const ctx = await makeContext(`${cookieApp.url}/settings`, { sessions: { self: cookieApp.storageState("alice") } });
    const { page } = await ctx.openPage({ as: "self", viewport: { width: 320, height: 700 } });
    expect(page.viewportSize()).toEqual({ width: 320, height: 700 });
    expect(await shownUser(page)).toBe(cookieApp.users.alice.email);
  });

  it('rejects as: "other" when the run has no other account', async () => {
    const ctx = await makeContext(`${cookieApp.url}/settings`, { sessions: { self: cookieApp.storageState("alice") }, accounts: { self: A, other: null } });
    await expect(ctx.openPage({ as: "other" })).rejects.toThrow();
  });

  it("a signed-out run (no sessions) opens the page signed out, as in 0.3.0", async () => {
    const ctx = await makeContext(`${cookieApp.url}/settings`);
    const { page } = await ctx.openPage();
    expect(await shownUser(page)).toBe("signed out (/login)");
  });
});

describe("request(as, …) with cookie sessions", () => {
  const sessions = () => ({ self: cookieApp.storageState("alice"), other: cookieApp.storageState("bob") });

  it("sends the identity's cookies: self is Account A, other is Account B, signed-out is nobody", async () => {
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: sessions(), accounts: { self: A, other: B } });

    const self = await ctx.request("self", { url: `${cookieApp.url}/api/me` });
    expect(self.status).toBe(200);
    expect(bodyOf(self.body).email).toBe(cookieApp.users.alice.email);
    expect(self.headers["content-type"]).toContain("application/json");
    // GET unless the request says otherwise.
    expect(lastRequest(cookieApp.requests, "/api/me")?.method).toBe("GET");

    const other = await ctx.request("other", { url: `${cookieApp.url}/api/me` });
    expect(other.status).toBe(200);
    expect(bodyOf(other.body).email).toBe(cookieApp.users.bob.email);

    const nobody = await ctx.request("signed-out", { url: `${cookieApp.url}/api/me` });
    expect(nobody.status).toBe(401);
    expect(header(lastRequest(cookieApp.requests, "/api/me"), "cookie") ?? "").not.toContain("sid=");
  });

  it("sends the method, headers and body as given; an accepted non-GET counts as a test record", async () => {
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: sessions() });
    expect(ctx.testRecordsCreated()).toBe(0);

    const created = await ctx.request("self", {
      method: "POST",
      url: `${cookieApp.url}/api/notes`,
      headers: { "content-type": "application/json", "x-request-id": "rh-1" },
      body: JSON.stringify({ title: "Run Hound t3st", body: "made by request()" }),
    });
    expect(created.status).toBe(201);
    const sent = lastRequest(cookieApp.requests, "/api/notes");
    expect(sent?.method).toBe("POST");
    expect(header(sent, "x-request-id")).toBe("rh-1");
    expect(JSON.parse(sent!.body)).toEqual({ title: "Run Hound t3st", body: "made by request()" });
    expect(cookieApp.notes().filter((n) => n.title === "Run Hound t3st").map((n) => n.ownerId)).toEqual([cookieApp.users.alice.id]);
    expect(ctx.testRecordsCreated()).toBe(1);

    // A GET and a refused POST create nothing.
    expect((await ctx.request("self", { url: `${cookieApp.url}/api/notes` })).status).toBe(200);
    const refused = await ctx.request("self", {
      method: "POST",
      url: `${cookieApp.url}/api/notes`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(refused.status).toBe(400);
    expect(ctx.testRecordsCreated()).toBe(1);
  });

  it("drops credential headers the caller passes: the identity's own are sent instead", async () => {
    const aliceCookie = cookieApp.authHeaders("alice");
    const aliceSid = aliceCookie.cookie!.replace(/^sid=/, "");
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: sessions() });

    const nobody = await ctx.request("signed-out", { url: `${cookieApp.url}/api/me`, headers: aliceCookie });
    expect(nobody.status).toBe(401);
    expect(header(lastRequest(cookieApp.requests, "/api/me"), "cookie") ?? "").not.toContain(aliceSid);

    const other = await ctx.request("other", { url: `${cookieApp.url}/api/me`, headers: aliceCookie });
    expect(bodyOf(other.body).email).toBe(cookieApp.users.bob.email);
    expect(header(lastRequest(cookieApp.requests, "/api/me"), "cookie") ?? "").not.toContain(aliceSid);
  });

  it("is not recorded as page activity", async () => {
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: sessions() });
    const { capture } = await ctx.openPage();
    const before = capture.requests.length;
    const answer = await ctx.request("self", { url: `${cookieApp.url}/api/me?from=request` });
    expect(answer.status).toBe(200);
    expect(capture.requests.length).toBe(before);
    expect(capture.requests.some((r) => r.url.includes("from=request"))).toBe(false);
  });

  it("does not follow redirects", async () => {
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: sessions() });
    const answer = await ctx.request("self", { url: `${cookieApp.url}/` });
    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe("/notes");

    const hop = await ctx.request("signed-out", { url: `${headerApp.url}/hop` });
    expect(hop.status).toBe(302);
    expect(hop.headers.location).toBe("/landing");
    expect(headerApp.requests.map((r) => r.url)).toContain("/hop");
    expect(headerApp.requests.map((r) => r.url)).not.toContain("/landing");
  });

  it('rejects as: "other" when the run has no other account', async () => {
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: { self: cookieApp.storageState("alice") } });
    expect((await ctx.request("self", { url: `${cookieApp.url}/api/me` })).status).toBe(200);
    await expect(ctx.request("other", { url: `${cookieApp.url}/api/me` })).rejects.toThrow();
  });
});

describe("request(as, …): limits", () => {
  it("refuses URLs outside the safety gate before sending anything", async () => {
    const lookup = async (host: string) => (host === "public.example.test" ? ["93.184.216.34"] : ["127.0.0.1"]);
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: { self: cookieApp.storageState("alice") }, lookup });
    // A local URL is fine…
    expect((await ctx.request("self", { url: `${cookieApp.url}/api/me` })).status).toBe(200);
    // …anything else is refused, for every identity.
    await expect(ctx.request("self", { url: "http://8.8.8.8/api/me" })).rejects.toThrow(/8\.8\.8\.8/);
    await expect(ctx.request("signed-out", { url: "http://8.8.8.8/api/me" })).rejects.toThrow(/8\.8\.8\.8/);
    await expect(ctx.request("self", { url: "http://public.example.test/api/me" })).rejects.toThrow(/public\.example\.test/);
    await expect(ctx.request("self", { url: "file:///etc/passwd" })).rejects.toThrow();
  });

  it("caps the body at 1 MB", async () => {
    const ctx = await makeContext(`${headerApp.url}/quiet`);
    const answer = await ctx.request("signed-out", { url: `${headerApp.url}/big` });
    expect(answer.status).toBe(200);
    expect(answer.body.length).toBeLessThanOrEqual(1024 * 1024);
    expect(answer.body.length).toBeGreaterThan(900_000);
    expect(answer.body.startsWith("xxxx")).toBe(true);
  });

  it("returns header names in lower case", async () => {
    const ctx = await makeContext(`${headerApp.url}/quiet`);
    const answer = await ctx.request("signed-out", { url: `${headerApp.url}/cased` });
    expect(answer.headers["x-custom-header"]).toBe("Yes");
    expect(answer.headers["content-type"]).toBe("application/json");
    expect(Object.keys(answer.headers).every((k) => k === k.toLowerCase())).toBe(true);
  });
});

describe("request(as, …): credential headers are the ones the app sent, never guessed", () => {
  it("bearer sessions: replays the Authorization header each identity's page sent", async () => {
    const selfState = bearerApp.storageState("alice");
    const otherState = bearerApp.storageState("bob");
    const ctx = await makeContext(`${bearerApp.url}/notes`, { sessions: { self: selfState, other: otherState }, accounts: { self: A, other: B } });
    // The app's own pages send "Authorization: Bearer <token>" from each identity.
    await ctx.openPage();
    await ctx.openPage({ as: "other" });

    const self = await ctx.request("self", { url: `${bearerApp.url}/api/notes` });
    expect(self.status).toBe(200);
    expect(bodyOf(self.body).notes?.map((n) => n.ownerId)).toEqual([bearerApp.users.alice.id, bearerApp.users.alice.id]);
    expect(header(lastRequest(bearerApp.requests, "/api/notes"), "authorization")).toBe(`Bearer ${tokenOf(bearerApp, selfState)}`);

    const other = await ctx.request("other", { url: `${bearerApp.url}/api/notes` });
    expect(other.status).toBe(200);
    expect(bodyOf(other.body).notes?.map((n) => n.ownerId)).toEqual([bearerApp.users.bob.id]);
    expect(header(lastRequest(bearerApp.requests, "/api/notes"), "authorization")).toBe(`Bearer ${tokenOf(bearerApp, otherState)}`);

    const nobody = await ctx.request("signed-out", { url: `${bearerApp.url}/api/notes` });
    expect(nobody.status).toBe(401);
    expect(header(lastRequest(bearerApp.requests, "/api/notes"), "authorization")).toBeUndefined();
  });

  it("sends exactly the credential headers the app sent (any scheme, x-*-token), not its other headers", async () => {
    const ctx = await makeContext(`${headerApp.url}/app`, {
      sessions: { self: headerState("tok-self-4f2a", "cookie-self-91c3"), other: headerState("tok-other-7b1d", "cookie-other-2e8f") },
    });
    await ctx.openPage();
    await ctx.openPage({ as: "other" });
    // The page itself sent its headers (so there is something to observe).
    expect(header(headerApp.requests.find((r) => r.url === "/api/data" && header(r, "x-auth-token") === "tok-self-4f2a"), "authorization")).toBe("Custom tok-self-4f2a");

    await ctx.request("self", { url: `${headerApp.url}/api/echo` });
    const asSelf = lastRequest(headerApp.requests, "/api/echo");
    expect(header(asSelf, "x-auth-token")).toBe("tok-self-4f2a");
    expect(header(asSelf, "authorization")).toBe("Custom tok-self-4f2a");
    expect(header(asSelf, "cookie")).toContain("sess=cookie-self-91c3");
    expect(header(asSelf, "x-client-version")).toBeUndefined();

    await ctx.request("other", { url: `${headerApp.url}/api/echo` });
    const asOther = lastRequest(headerApp.requests, "/api/echo");
    expect(header(asOther, "x-auth-token")).toBe("tok-other-7b1d");
    expect(header(asOther, "authorization")).toBe("Custom tok-other-7b1d");
    expect(header(asOther, "cookie")).toContain("sess=cookie-other-2e8f");

    await ctx.request("signed-out", { url: `${headerApp.url}/api/echo` });
    const asNobody = lastRequest(headerApp.requests, "/api/echo");
    expect(header(asNobody, "x-auth-token")).toBeUndefined();
    expect(header(asNobody, "authorization")).toBeUndefined();
    expect(header(asNobody, "cookie")).toBeUndefined();
  });

  it("only sends observed headers back to the origin they were sent to", async () => {
    const ctx = await makeContext(`${headerApp.url}/app`, { sessions: { self: headerState("tok-self-4f2a", "cookie-self-91c3") } });
    await ctx.openPage();
    const answer = await ctx.request("self", { url: `${elsewhere.url}/api/echo` });
    expect(answer.status).toBe(200);
    const sent = lastRequest(elsewhere.requests, "/api/echo");
    expect(sent).toBeDefined();
    expect(header(sent, "authorization")).toBeUndefined();
    expect(header(sent, "x-auth-token")).toBeUndefined();
  });

  it("never turns stored values into headers the app didn't send", async () => {
    const ctx = await makeContext(`${headerApp.url}/quiet`, { sessions: { self: headerState("tok-self-4f2a", "cookie-self-91c3") } });
    const { page } = await ctx.openPage();
    // The token is right there in localStorage, but this page never sends it.
    expect(await page.evaluate(() => localStorage.getItem("tok"))).toBe("tok-self-4f2a");

    const answer = await ctx.request("self", { url: `${headerApp.url}/api/echo` });
    expect(answer.status).toBe(200);
    const sent = lastRequest(headerApp.requests, "/api/echo");
    expect(header(sent, "authorization")).toBeUndefined();
    expect(header(sent, "x-auth-token")).toBeUndefined();
    // Cookies are the identity's own, so they are sent.
    expect(header(sent, "cookie")).toContain("sess=cookie-self-91c3");
  });
});

describe("accountMarkers() and accounts", () => {
  it("returns ContextOptions.markers (a copy) and exposes the account labels", async () => {
    const markers = [cookieApp.users.alice.email];
    const ctx = await makeContext(`${cookieApp.url}/notes`, { sessions: { self: cookieApp.storageState("alice") }, markers, accounts: { self: A, other: null } });
    expect(ctx.accountMarkers()).toEqual([cookieApp.users.alice.email]);
    ctx.accountMarkers().push("changed");
    expect(ctx.accountMarkers()).toEqual([cookieApp.users.alice.email]);
    expect(ctx.accounts).toEqual({ self: A, other: null });

    const signedOut = await makeContext(`${cookieApp.url}/notes`);
    expect(signedOut.accountMarkers()).toEqual([]);
    expect(signedOut.accounts ?? { self: null, other: null }).toEqual({ self: null, other: null });
  });
});
