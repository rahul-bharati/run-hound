/**
 * Shared test helpers for Fernway: start the real server (node server/index.mjs) on a free port with a given
 * FERNWAY_BUGS, call its API (signed out, or signed in as Alex or Sam), and drive it with Playwright while collecting
 * console errors, page errors, failed requests and 4xx/5xx responses. globalSetup (test/global-setup.ts) builds dist/
 * once before any test file.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Request } from "playwright";

/** Absolute path of fixtures/fernway. */
export const FERNWAY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The V2 bugs (docs/v2-spec.md "Fernway V2": V01-V05; "Fernway (0.5.0 planned bugs)": V06-V09). */
export const V2_BUGS = ["V01", "V02", "V03", "V04", "V05", "V06", "V07", "V08", "V09"] as const;
/** Every bug FERNWAY_BUGS=all turns on (server/bugs.mjs). */
export const ALL_BUGS = ["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10", ...V2_BUGS] as const;
export type BugId = (typeof ALL_BUGS)[number];

/** The eight client-side routes; each answers 200 with index.html. */
export const ROUTES = ["/", "/signup", "/login", "/onboarding", "/app", "/app/settings", "/app/help", "/app/upgraded"] as const;
/** The routes that need a session (signed out, the SPA sends you to /login?next=<path>). */
export const SIGNED_IN_ROUTES = ["/app", "/app/settings", "/app/help", "/app/upgraded"] as const;
export const isSignedInRoute = (route: string) => (SIGNED_IN_ROUTES as readonly string[]).includes(route);

/** The seeded accounts (server/seed.mjs ACCOUNTS; CONTRACT.md "Accounts"). */
export const ACCOUNTS = {
  alex: { id: "alex-rivera", email: "alex@fernway.test", password: "correct-horse-battery", name: "Alex Rivera", workspace: "Rivera Studio" },
  sam: { id: "sam-okafor", email: "sam@fernway.test", password: "staple-lemon-orbit", name: "Sam Okafor", workspace: "Okafor & Co" },
} as const;
export type AccountName = keyof typeof ACCOUNTS;

/** Alex, the demo account. */
export const DEMO_ACCOUNT = { email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password } as const;

/** GET /api/users/:id/profile of a seeded account. */
export const profileUrl = (who: AccountName) => `/api/users/${ACCOUNTS[who].id}/profile`;

/** The clean-mode Content-Security-Policy (CONTRACT.md). */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** Matches Node/V8 stack frames, internal paths and framework dumps (none may reach a response body). */
export const STACK_RE = /\n\s*at\s+\S|\bat\s+[^\s]+\s+\([^)]*:\d+:\d+\)|node:internal|node_modules\/|file:\/\/\/|\/server\/[\w.-]+\.m?js/;

/** Finds a free TCP port on 127.0.0.1 by binding port 0. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** FERNWAY_LOGIN and FERNWAY_SESSION (server/modes.mjs; CONTRACT.md "Sign-in and session modes"). */
export type LoginMode = "one-step" | "two-step";
export type SessionMode = "cookie" | "session-storage";
export interface FernwayModes {
  login?: LoginMode;
  session?: SessionMode;
}

/** The sessionStorage key the SPA keeps its token under in session-storage mode (src/lib/session-token.ts). */
export const SESSION_TOKEN_KEY = "fernway_session";

export interface Fernway {
  /** Origin with no trailing slash, e.g. http://127.0.0.1:53211 */
  url: string;
  port: number;
  /** The modes it was started with (defaults: one-step, cookie). */
  modes: Required<FernwayModes>;
  /** Everything the server wrote to stdout/stderr so far. */
  output(): string;
  /** POST /api/__reset (restores the seed and clears the idempotency cache; sessions survive). */
  reset(): Promise<void>;
  /**
   * A `cookie` header value ("fernway_session=<id>") signed in as that account, made once per server and reused
   * (sessions survive POST /api/__reset). Never sign it out: use signIn() for a session a test may end. Cookie mode
   * only (session-storage mode sets no cookie: use auth() or signInToken()).
   */
  session(who: AccountName): Promise<string>;
  /**
   * The request headers that sign in as that account in this server's session mode, made once per server and reused:
   * `{ cookie }` in cookie mode, `{ authorization: "Bearer <token>" }` in session-storage mode.
   */
  auth(who: AccountName): Promise<Record<string, string>>;
  stop(): Promise<void>;
}

/**
 * Starts `node server/index.mjs` (expects dist/ from globalSetup) on a free port with the given FERNWAY_BUGS
 * ("none", "all", a comma list, or an array of ids). Resolves once the server prints "fernway listening".
 */
export async function startFernway(
  bugs: string | readonly string[] = "none",
  options: { timeoutMs?: number; env?: Record<string, string> } & FernwayModes = {},
): Promise<Fernway> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const modes: Required<FernwayModes> = { login: options.login ?? "one-step", session: options.session ?? "cookie" };
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: FERNWAY_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      FERNWAY_BUGS: typeof bugs === "string" ? bugs : bugs.join(","),
      FERNWAY_LOGIN: modes.login,
      FERNWAY_SESSION: modes.session,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => (log += d));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Fernway did not print "fernway listening" within ${timeoutMs} ms. Output:\n${log}`));
    }, timeoutMs);
    child.stdout.on("data", (d: string) => {
      log += d;
      if (log.includes("fernway listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Fernway exited early (code ${code}, signal ${signal}). Output:\n${log}`));
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const url = `http://127.0.0.1:${port}`;
  const sessions = new Map<AccountName, Promise<string>>();
  const auths = new Map<AccountName, Promise<Record<string, string>>>();
  const fw: Fernway = {
    url,
    port,
    modes,
    output: () => log,
    async reset() {
      const res = await fetch(`${url}/api/__reset`, { method: "POST" });
      if (res.status !== 204) throw new Error(`reset failed: ${res.status}`);
    },
    session(who) {
      let cookie = sessions.get(who);
      if (!cookie) {
        cookie = signIn(fw, who);
        sessions.set(who, cookie);
      }
      return cookie;
    },
    auth(who) {
      let headers = auths.get(who);
      if (!headers) {
        headers =
          modes.session === "session-storage"
            ? signInToken(fw, who).then((token) => ({ authorization: `Bearer ${token}` }))
            : fw.session(who).then((cookie) => ({ cookie }));
        auths.set(who, headers);
      }
      return headers;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      await exited;
      clearTimeout(timer);
    },
  };
  return fw;
}

/** The session id in a Set-Cookie value for fernway_session (null when there is none). */
export function sessionIdOf(setCookie: string | null): string | null {
  return /(?:^|,\s*)fernway_session=([^;,]+)/.exec(setCookie ?? "")?.[1] ?? null;
}

/** Signs in with POST /api/login and returns a fresh `cookie` header value ("fernway_session=<id>"). */
export async function signIn(fw: Fernway, who: AccountName): Promise<string> {
  const { email, password } = ACCOUNTS[who];
  const res = await fetch(`${fw.url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const id = sessionIdOf(res.headers.get("set-cookie"));
  if (res.status !== 200 || !id) throw new Error(`signing in as ${who} failed: ${res.status}`);
  return `fernway_session=${id}`;
}

/**
 * Signs in with POST /api/login on a server in session-storage mode and returns the session token it answers (the
 * value the SPA keeps in sessionStorage and sends as "Authorization: Bearer <token>").
 */
export async function signInToken(fw: Fernway, who: AccountName): Promise<string> {
  const { email, password } = ACCOUNTS[who];
  const res = await fetch(`${fw.url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = (await res.json().catch(() => ({}))) as { token?: unknown };
  if (res.status !== 200 || typeof body.token !== "string") throw new Error(`signing in as ${who} (session-storage) failed: ${res.status}`);
  return body.token;
}

/**
 * Vitest lifecycle helper: starts Fernway (with the given modes) before the describe block, stops it after, and resets
 * the data before each test. Read `ref.fw` inside tests.
 */
export function useFernway(bugs: string | readonly string[] = "none", modes: FernwayModes = {}): { fw: Fernway } {
  const ref = {} as { fw: Fernway };
  beforeAll(async () => {
    ref.fw = await startFernway(bugs, modes);
  });
  afterAll(async () => {
    await ref.fw?.stop();
  });
  beforeEach(async () => {
    await ref.fw.reset();
  });
  return ref;
}

// ---- API ---------------------------------------------------------------------------------------

export interface JsonResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

export interface ApiInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Signed in as this account (its cached session), or "nobody" / absent for no session. */
  as?: AccountName | "nobody";
}

/**
 * Calls the API and parses JSON (body is null for an empty response). `body` is JSON-encoded unless it is a string
 * (sent as is, for malformed-JSON tests). `as` signs the request in as that account the way the server's session mode
 * expects: its session cookie, or its bearer token in session-storage mode.
 */
export async function api<T = any>(fw: Fernway, path: string, init: ApiInit = {}): Promise<JsonResponse<T>> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const cookie: Record<string, string> = init.as && init.as !== "nobody" ? await fw.auth(init.as) : {};
  const res = await fetch(`${fw.url}${path}`, {
    method,
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...cookie, ...init.headers },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, headers: res.headers, body: body as T };
}

// ---- browser -----------------------------------------------------------------------------------

let browser: Browser | undefined;

/** One headless Chromium per test file; call closeBrowser() in afterAll. */
export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch();
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export interface PageEvents {
  consoleErrors: string[];
  pageErrors: string[];
  /** Requests that failed at the network level ("<method> <url>: <error>"). */
  failedRequests: string[];
  /** Responses with status >= 400 ("<status> <url>"). */
  badResponses: string[];
  requests: Request[];
}

export interface OpenedPage {
  page: Page;
  context: BrowserContext;
  events: PageEvents;
  close(): Promise<void>;
}

export interface OpenPageOptions extends Pick<BrowserContextOptions, "colorScheme" | "reducedMotion" | "viewport" | "storageState"> {
  /** Wait for this load state after navigation (default "networkidle"). */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /**
   * Signed in as this account: a fresh session (POST /api/login) whose cookie the context gets before loading, or in
   * session-storage mode whose token every page of the context finds in sessionStorage.
   */
  as?: AccountName;
}

/**
 * Seeds `token` into sessionStorage for Fernway's origin in every page of the context before any page script runs, as
 * Run Hound does for a sessionStorage session. Only when the key is absent, so a token the page itself set wins; after
 * a sign-out the next load seeds the old (now ended) token again, and the SPA drops it when GET /api/me answers 401.
 */
export async function seedSessionToken(fw: Fernway, context: BrowserContext, token: string): Promise<void> {
  await context.addInitScript(
    ({ origin, key, value }) => {
      try {
        if (location.origin === origin && sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
      } catch {
        // No sessionStorage on this page (about:blank, a sandboxed frame).
      }
    },
    { origin: fw.url, key: SESSION_TOKEN_KEY, value: token },
  );
}

/**
 * Puts a fresh session for `who` into the browser context: the HttpOnly cookie the server would have set, or in
 * session-storage mode the token in sessionStorage (seedSessionToken).
 */
export async function signInContext(fw: Fernway, context: BrowserContext, who: AccountName): Promise<void> {
  if (fw.modes.session === "session-storage") return seedSessionToken(fw, context, await signInToken(fw, who));
  const value = (await signIn(fw, who)).slice("fernway_session=".length);
  await context.addCookies([{ name: "fernway_session", value, url: fw.url, httpOnly: true, sameSite: "Lax" }]);
}

/** Opens `path` in a fresh browser context (1280x800 unless given) and records what went wrong. */
export async function openPage(fw: Fernway, path = "/", options: OpenPageOptions = {}): Promise<OpenedPage> {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    colorScheme: options.colorScheme ?? "light",
    reducedMotion: options.reducedMotion ?? "no-preference",
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });
  if (options.as) await signInContext(fw, context, options.as);
  const page = await context.newPage();
  const events: PageEvents = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], requests: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") events.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => events.pageErrors.push(String(err)));
  page.on("request", (req) => events.requests.push(req));
  page.on("requestfailed", (req) => events.failedRequests.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText ?? "failed"}`));
  page.on("response", (res) => {
    if (res.status() >= 400) events.badResponses.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(`${fw.url}${path}`, { waitUntil: options.waitUntil ?? "networkidle" });
  return {
    page,
    context,
    events,
    close: () => context.close(),
  };
}

/** True when the page scrolls horizontally (a 320px reflow failure). */
export async function horizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

// ---- accessibility ------------------------------------------------------------------------------

/** The axe tags Run Hound's axe-states check runs (app/src/checks/axe-states.ts). */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe with Run Hound's tags on the page (or `include` a selector) and returns the violations as short strings
 * "<rule>: <target> (<summary>)" so a failing expect() says what is wrong. Clean mode must return [].
 */
export async function axeViolations(page: Page, options: { include?: string; disableRules?: string[] } = {}): Promise<string[]> {
  // Let entrance animations and transitions (a toast sliding in, a dialog fading in) finish first: text caught
  // mid-fade is half transparent, and its contrast would be measured wrong on a slow machine. Endless ones (spinners)
  // never finish, so they don't count.
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include) builder = builder.include(options.include);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const results = await builder.analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} (${(n.failureSummary ?? v.help).replace(/\s+/g, " ").slice(0, 200)})`),
  );
}
