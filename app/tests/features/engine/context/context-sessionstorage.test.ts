// CheckContext with sessionStorage sessions (0.6.0, docs/v2-spec.md "Sign-in: two-step and sessionStorage"): every new browser context for an identity seeds that identity's sessionStorage items (SignedIn.sessionStorage) before any page script runs, with an init script per origin, so a new tab is signed in as the app expects; CheckContext.request keeps authenticating with the credential headers harvested from the app's own requests (nothing guessed from storage); the items reach createCheckContext as ContextOptions.sessionStorage = { self?, other? } beside ContextOptions.sessions; items are seeded only on their own origin and a value the app changes later is not overwritten on the next page load; runs against the accounts app in tokenMode "session-storage".
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../../../support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../support/server.js";
import type { AccountRef } from "../../../../src/core/types.js";
import type { SessionState, SignedIn } from "../../../../src/engine/auth.js";
import { createCheckContext, type ContextOptions, type RunningCheckContext } from "../../../../src/engine/context.js";
import { emptyForm } from "../../../../src/engine/discover.js";

type SessionStorageItems = NonNullable<SignedIn["sessionStorage"]>;
// TODO(N7 → N6/lead): once N7 lands ContextOptions.sessionStorage in context.ts, delete this type and the `as ContextOptions` cast in makeContext, so tsc checks the shape these tests pass against the real field.
type SeededOptions = ContextOptions & { sessionStorage?: { self?: SessionStorageItems; other?: SessionStorageItems } };

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
/** A session-storage app's storage state: nothing (its session is in sessionStorage). */
const EMPTY: SessionState = { cookies: [], origins: [] };

let app: AccountsApp;
/** Another local origin that serves a plain page. */
let elsewhere: FixtureServer;
let artifactsDir: string;
const opened: RunningCheckContext[] = [];

async function makeContext(targetUrl: string, extra: Partial<SeededOptions> = {}): Promise<RunningCheckContext> {
  const options: SeededOptions = { browser: await getBrowser(), form: emptyForm(targetUrl), targetUrl, artifactsDir, runToken: "t3st", ...extra };
  const ctx = createCheckContext(options as ContextOptions);
  opened.push(ctx);
  return ctx;
}

/** Signed-in items for alice and bob (new sessions on the app), and the options that give them to the identities. */
function seeded(): { alice: SessionStorageItems; bob: SessionStorageItems; options: Partial<SeededOptions> } {
  const alice = app.sessionStorage("alice");
  const bob = app.sessionStorage("bob");
  return {
    alice,
    bob,
    options: { sessions: { self: EMPTY, other: EMPTY }, sessionStorage: { self: alice, other: bob }, accounts: { self: A, other: B } },
  };
}

const tokenIn = (items: SessionStorageItems) => items[0]!.items.find((i) => i.name === "token")!.value;

/** Who /settings says is signed in: the email it shows, or "signed out (<path>)" once the sign-in form is up. */
async function shownUser(page: Page): Promise<string> {
  await page.locator("#me-email, #signin-form").first().waitFor({ timeout: 10_000 });
  if ((await page.locator("#me-email").count()) > 0) return (await page.locator("#me-email").textContent()) ?? "";
  return `signed out (${new URL(page.url()).pathname})`;
}

function header(r: RecordedRequest | undefined, name: string): string | undefined {
  const value = r?.headers[name];
  return Array.isArray(value) ? value.join("; ") : value;
}

function lastRequest(path: string): RecordedRequest | undefined {
  return app.requests.filter((r) => r.url.split("?")[0] === path).at(-1);
}

const bodyOf = (text: string) => JSON.parse(text) as { email?: string; notes?: { ownerId: string }[] };

beforeAll(async () => {
  app = await startAccountsApp({ tokenMode: "session-storage" });
  elsewhere = await startFixtureServer({
    pages: { "/peek": `<!doctype html><html lang="en"><head><title>Peek</title></head><body><h1>Another site</h1></body></html>` },
  });
});

afterAll(async () => {
  await Promise.all([app?.stop(), elsewhere?.close()]);
  await closeBrowser();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), "rh-context-sessionstorage-"));
  app.reset();
  app.signOutEveryone();
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((ctx) => ctx.dispose()));
  await rm(artifactsDir, { recursive: true, force: true });
});

describe("the accounts app's session-storage mode, by hand (so the tests below fail only for createCheckContext's reasons)", () => {
  it("a plain context seeded by an init script with app.sessionStorage(user) opens /settings signed in; without it /settings ends on /login", async () => {
    const browser = await getBrowser();
    const alice = app.sessionStorage("alice");
    const seededContext = await browser.newContext();
    try {
      // The seeding the contract asks of Run Hound's contexts: per origin, before any page script, only if absent.
      await seededContext.addInitScript((entries) => {
        for (const entry of entries) {
          if (entry.origin !== location.origin) continue;
          for (const item of entry.items) if (sessionStorage.getItem(item.name) === null) sessionStorage.setItem(item.name, item.value);
        }
      }, alice);
      const page = await seededContext.newPage();
      await page.goto(`${app.url}/settings`);
      expect(await shownUser(page)).toBe(app.users.alice.email);
      expect(page.url()).toBe(`${app.url}/settings`);
      expect(header(lastRequest("/api/me"), "authorization")).toBe(`Bearer ${tokenIn(alice)}`);
    } finally {
      await seededContext.close();
    }

    const plain = await browser.newContext();
    try {
      const page = await plain.newPage();
      await page.goto(`${app.url}/settings`);
      expect(await shownUser(page)).toBe("signed out (/login)");
    } finally {
      await plain.close();
    }
  });

  it("storageState(user) refuses this mode (an empty state would be a signed-out identity)", () => {
    expect(() => app.storageState("alice")).toThrow(/sessionStorage\(user\)/);
  });
});

describe("openPage: sessionStorage is seeded before the app's scripts run", () => {
  it("self (the default) opens the page signed in: the app found its token on load and never saw the sign-in page", async () => {
    const { alice, options } = seeded();
    const ctx = await makeContext(`${app.url}/settings`, options);
    const { page } = await ctx.openPage();

    expect(await shownUser(page)).toBe(app.users.alice.email);
    expect(page.url()).toBe(`${app.url}/settings`);
    expect(await page.evaluate(() => sessionStorage.getItem("token"))).toBe(tokenIn(alice));
    // The app's very first /api/me already carried the token.
    const checks = app.requests.filter((r) => r.url === "/api/me");
    expect(checks.length).toBeGreaterThan(0);
    for (const r of checks) expect(header(r, "authorization")).toBe(`Bearer ${tokenIn(alice)}`);
    expect(app.requests.some((r) => r.url.startsWith("/login"))).toBe(false);
  });

  it("other gets its own items, and signed-out gets none", async () => {
    const { options } = seeded();
    const ctx = await makeContext(`${app.url}/settings`, options);

    const self = await ctx.openPage({ as: "self" });
    expect(await shownUser(self.page)).toBe(app.users.alice.email);

    const other = await ctx.openPage({ as: "other" });
    expect(await shownUser(other.page)).toBe(app.users.bob.email);

    const signedOut = await ctx.openPage({ as: "signed-out" });
    expect(await shownUser(signedOut.page)).toBe("signed out (/login)");
    expect(await signedOut.page.evaluate(() => sessionStorage.length)).toBe(0);
  });

  it("a second tab of the same browser context is signed in too", async () => {
    const { options } = seeded();
    const ctx = await makeContext(`${app.url}/settings`, options);
    const { context } = await ctx.openPage();
    const tab = await context.newPage();
    await tab.goto(`${app.url}/settings`);
    expect(await shownUser(tab)).toBe(app.users.alice.email);
  });

  it("seeds the items only on their own origin: not on another port, not on another host name for the same server", async () => {
    const { options } = seeded();
    const ctx = await makeContext(`${app.url}/settings`, options);
    const { page } = await ctx.openPage();
    expect(await shownUser(page)).toBe(app.users.alice.email);

    await page.goto(`${elsewhere.url}/peek`);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

    // The same server reached as localhost is another origin: the app there finds no token and asks to sign in.
    await page.goto(`http://localhost:${new URL(app.url).port}/settings`);
    expect(await shownUser(page)).toBe("signed out (/login)");
    expect(await page.evaluate(() => sessionStorage.getItem("token"))).toBeNull();
  });

  it("keeps a value the app changed itself: the next page load doesn't write the seeded value over it", async () => {
    const { alice } = seeded();
    const withPreference: SessionStorageItems = [{ origin: app.url, items: [...alice[0]!.items, { name: "notes.sort", value: "newest" }] }];
    const ctx = await makeContext(`${app.url}/settings`, { sessions: { self: EMPTY }, sessionStorage: { self: withPreference } });
    const { page } = await ctx.openPage();
    expect(await shownUser(page)).toBe(app.users.alice.email);
    expect(await page.evaluate(() => sessionStorage.getItem("notes.sort"))).toBe("newest");

    await page.evaluate(() => sessionStorage.setItem("notes.sort", "oldest"));
    await page.reload();
    expect(await shownUser(page)).toBe(app.users.alice.email);
    expect(await page.evaluate(() => sessionStorage.getItem("notes.sort"))).toBe("oldest");
  });
});

describe("request(as, …) with sessionStorage sessions: the Authorization header the app sent", () => {
  it("sends nothing guessed from storage before a page ran, then each identity's harvested bearer header", async () => {
    const { alice, bob, options } = seeded();
    const ctx = await makeContext(`${app.url}/notes`, options);

    // No page has sent anything yet: the token sits in the items, but it is never turned into a header.
    const early = await ctx.request("self", { url: `${app.url}/api/me` });
    expect(early.status).toBe(401);
    expect(header(lastRequest("/api/me"), "authorization")).toBeUndefined();

    // The app's own pages send "Authorization: Bearer <token>" from each identity.
    await ctx.openPage();
    await ctx.openPage({ as: "other" });

    const self = await ctx.request("self", { url: `${app.url}/api/notes` });
    expect(self.status).toBe(200);
    expect(bodyOf(self.body).notes?.map((n) => n.ownerId)).toEqual([app.users.alice.id, app.users.alice.id]);
    expect(header(lastRequest("/api/notes"), "authorization")).toBe(`Bearer ${tokenIn(alice)}`);

    const other = await ctx.request("other", { url: `${app.url}/api/me` });
    expect(other.status).toBe(200);
    expect(bodyOf(other.body).email).toBe(app.users.bob.email);
    expect(header(lastRequest("/api/me"), "authorization")).toBe(`Bearer ${tokenIn(bob)}`);

    const nobody = await ctx.request("signed-out", { url: `${app.url}/api/notes` });
    expect(nobody.status).toBe(401);
    expect(header(lastRequest("/api/notes"), "authorization")).toBeUndefined();
  });
});
