/**
 * Starts the Fernway fixture for acceptance runs (fixtures/fernway/CONTRACT.md, "Process").
 *
 *   - built once with `vite build` in fixtures/fernway (one build serves every mode)
 *   - started with `node server/index.mjs`, env PORT, FERNWAY_BUGS ("none" | "all" | "W01,V02"), FERNWAY_LOGIN
 *     ("one-step" | "two-step") and FERNWAY_SESSION ("cookie" | "session-storage"); the two modes are always set, to
 *     their defaults unless a test asks for another, so a developer's shell can't change what a run tests
 *   - prints "fernway listening" once it accepts connections
 *   - POST /api/__reset restores the seed (sessions survive it); GET /api/__config names the bugs and modes it runs
 *
 * V2 (CONTRACT.md "Accounts"): /app, /app/settings, /app/help and /app/upgraded need a session. Run Hound signs in as
 * Alex (test account A) with Sam as account B; fernwayAccounts() builds that AccountsConfig for an instance, so no test
 * reads accounts.json. accountState() reads an account's own records and plan straight from Fernway's API (with a
 * cookie, or in session-storage mode a bearer token), so the write-side checks (0.5.0, 0.6.0) can be held to leaving
 * them as they were.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AccountsConfig } from "../../../app/src/accounts/types.js";
import { freePort, REPO_ROOT } from "./kennel.js";

const execFileAsync = promisify(execFile);

/** fixtures/fernway, or ACCEPTANCE_FERNWAY_DIR (a copy with its own dist/, so parallel builds don't collide). */
export const FERNWAY_DIR = process.env.ACCEPTANCE_FERNWAY_DIR || join(REPO_ROOT, "fixtures/fernway");

/** One entry of fixtures/fernway/bugs.json. `page` is a route, or "*" for a bug on every route. */
export interface FernwayBug {
  id: string;
  version: string;
  category: string;
  severity: string;
  title: string;
  detectedBy: string;
  page: string;
  /** The scenario of `detectedBy` that catches it (V01-V03: "access-control:other-account" / ":signed-out"). */
  scenario?: string;
  /** Other pages the same bug is caught on (V03: /app/settings). */
  alsoOn?: string[];
}

/** The seeded accounts (fixtures/fernway/server/seed.mjs ACCOUNTS). Alex is test account A, Sam is B. */
export const FERNWAY_ACCOUNTS = {
  alex: { email: "alex@fernway.test", password: "correct-horse-battery", name: "Alex Rivera" },
  sam: { email: "sam@fernway.test", password: "staple-lemon-orbit", name: "Sam Okafor" },
} as const;

/** The routes that need a session (signed out, the SPA sends you to /login?next=<path>). /app/upgraded is 0.5.0's. */
export const SIGNED_IN_ROUTES: readonly string[] = ["/app", "/app/settings", "/app/help", "/app/upgraded"];
export const needsSignIn = (route: string) => SIGNED_IN_ROUTES.includes(route);

/**
 * Run Hound's test accounts for a running Fernway: A = Alex, B = Sam, both signing in at <url>/login, isolated (they
 * must not see each other's data). Pass it as RunOptions.accounts with signInAs "a".
 */
export function fernwayAccounts(url: string): AccountsConfig {
  const loginUrl = `${url}/login`;
  return {
    isolated: true,
    accounts: {
      a: { id: "a", label: "Account A", loginUrl, username: FERNWAY_ACCOUNTS.alex.email, password: FERNWAY_ACCOUNTS.alex.password },
      b: { id: "b", label: "Account B", loginUrl, username: FERNWAY_ACCOUNTS.sam.email, password: FERNWAY_ACCOUNTS.sam.password },
    },
  };
}

/**
 * Every file under `dir` (recursively) whose bytes contain one of `needles`, as "<relative path>: <needle label>".
 * Binary files are searched as bytes too.
 */
export async function filesContaining(dir: string, needles: Record<string, string>): Promise<string[]> {
  const hits: string[] = [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const bytes = await readFile(path);
    for (const [label, needle] of Object.entries(needles)) {
      if (bytes.includes(Buffer.from(needle, "utf8"))) hits.push(`${path.slice(dir.length + 1)}: ${label}`);
    }
  }
  return hits;
}

/**
 * Session values a text file shows in the clear (0.6.0, docs/v2-spec.md "Acceptance (0.6.0)": the grep covers
 * sessionStorage token values and the new run folders): an `Authorization: Bearer <token>` value (as a header, or URL-
 * or form-encoded), a session-storage token (43 characters of base64url, CONTRACT.md "Sign-in and session modes") or a
 * cookie-mode session id (a UUID) stored under Fernway's `fernway_session` key (a sessionStorage item, a
 * `sessionStorage.setItem("fernway_session", …)` call, a JSON field, a storage-state entry, a cookie pair), or a
 * session-storage token answered as the `token` field of a sign-in or sign-up. Any quoting counts: plain, escaped
 * JSON, URL-encoded, or HTML entities (report.html embeds the evidence JSON with `&quot;`). A redaction marker, or the
 * cookie check's masked `fernway_session=… (36 chars)`, is not a value. This finds the shape, so it holds without
 * knowing the values: the registry-based grep can only look for the session values the engine registered, and this one
 * also catches one the engine never registered (a cookie or a token). Hits name the file and the kind of value, never
 * any of it.
 */
export async function sessionTokensIn(dir: string): Promise<string[]> {
  const hits: string[] = [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|md|html|txt|log|ts|js|har)$/i.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    for (const kind of sessionTokenShapesIn(await readFile(path, "utf8"))) hits.push(`${path.slice(dir.length + 1)}: ${kind}`);
  }
  return hits;
}

/**
 * Any run of quote marks around a key or a value, however it is written: a plain or backslash-escaped quote, a
 * URL-encoded one, or an HTML entity (report.html writes the evidence JSON's quotes as `&quot;`). The token greps share
 * it.
 */
const QUOTES = `(?:["'\\\\]|%22|%27|&quot;|&#0*34;|&#x0*22;|&#0*39;|&#x0*27;|&apos;)*`;

/** The shapes sessionTokensIn and sessionTokenShapesIn look for, with the kind of value each names. */
const TOKEN_SHAPES: readonly [string, RegExp][] = (() => {
  const q = QUOTES;
  const token = `[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])`;
  // Cookie mode's session id (server/app.mjs: randomUUID()). The cookie check shows it masked ("… (36 chars)").
  const uuid = `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])`;
  // The key and its value: "key": "v", key=v, key%3Dv, and setItem("key", "v") (an exported spec or init script).
  const pair = (value: string) => `fernway_session${q}\\s*(?:[:=,]|%3D|%2C)\\s*${q}${value}`;
  // A storage-state entry: {"name":"fernway_session","value":"v"}.
  const stateEntry = (value: string) => `fernway_session${q}\\s*,\\s*${q}value${q}\\s*:\\s*${q}${value}`;
  return [
    // A header, or one URL- or form-encoded into a query or a body (Bearer%20…, Bearer+…).
    ["a bearer token", /\bBearer(?:\s|%20|\+)+[A-Za-z0-9._~+/-]{16,}=*/gi],
    ["a fernway_session token", new RegExp(pair(token), "gi")],
    ["a fernway_session token (storage state)", new RegExp(stateEntry(token), "gi")],
    // Sign-in and sign-up answer the token itself in session-storage mode ({"token":"..."}). \b keeps it off keys that
    // only end in "token" (runToken, csrf_token: the CSRF grep's).
    ["a token field", new RegExp(`\\btoken${q}\\s*(?:[:=]|%3D)\\s*${q}${token}`, "gi")],
    ["a fernway_session cookie id", new RegExp(pair(uuid), "gi")],
    ["a fernway_session cookie id (storage state)", new RegExp(stateEntry(uuid), "gi")],
  ];
})();

/**
 * sessionTokensIn's grep on one text: the kinds of session value (a bearer or sessionStorage token, a cookie-mode
 * session id) `text` shows in the clear, one entry per kind with how many times ("a bearer token (2 times)"), never any
 * of the value. For what has no run folder: a Plan or Report as JSON (a plan that was never run included), and a
 * run's log lines, progress events included.
 */
export function sessionTokenShapesIn(text: string): string[] {
  const hits: string[] = [];
  for (const [kind, pattern] of TOKEN_SHAPES) {
    const n = [...text.matchAll(pattern)].length;
    if (n > 0) hits.push(`${kind}${n > 1 ? ` (${n} times)` : ""}`);
  }
  return hits;
}

/** Fernway's session-storage token: 43 characters of base64url (CONTRACT.md "Sign-in and session modes"). */
export const SESSION_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether notes say a write-side check left something of Account A changed, or couldn't tell (docs/v2-spec.md "Safety
 * contract": "… could not be undone: check Account A"; paywall-trust's "… may still be pro: check Account A"). One
 * such sentence isn't about a change left behind and is left out, only in csrf's notes (`checkId` "csrf"): csrf naming
 * the new test record a forged create made ("The forged request created a new test record under Account A (… Run Hound
 * doesn't delete records): check Account A."). On V08 that create is the bug working, and test records are never
 * deleted (docs/v2-spec.md "Safety contract"). The same sentence from any other check, or with no check named, counts.
 */
export function leftChanged(notes: string | undefined, checkId?: string): boolean {
  const text = notes ?? "";
  const rest = checkId === "csrf" ? text.replace(/[^.]*\bcreated a new test record\b[^.]*\./gi, "") : text;
  return /could not be undone|check Account A/i.test(rest);
}

/** A record with an id, as Fernway's list APIs return them. */
type Row = { id: string } & Record<string, unknown>;

/** One account's data as Fernway's own API returns it to that account: what the write-side checks must leave alone. */
export interface AccountState {
  tasks: Row[];
  projects: Row[];
  /** The Settings profile, with the server-side `role` and `plan`. */
  profile: Record<string, unknown>;
}

/**
 * Signs in to a running Fernway as `who` (its own session, not Run Hound's) and reads that account's tasks, projects
 * and profile (plan included). Node's fetch sends no Origin header, which clean mode's cross-site defence lets through.
 * The session is the cookie the sign-in sets, or in session-storage mode (no cookie) the `token` it answers, sent as
 * `Authorization: Bearer` (CONTRACT.md "Sign-in and session modes").
 */
export async function accountState(url: string, who: keyof typeof FERNWAY_ACCOUNTS): Promise<AccountState> {
  const account = FERNWAY_ACCOUNTS[who];
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (login.status !== 200) throw new Error(`Signing in to Fernway as ${who} answered ${login.status}`);
  const answer = (await login.json().catch(() => ({}))) as { token?: unknown };
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session: Record<string, string> =
    typeof answer.token === "string" && answer.token ? { authorization: `Bearer ${answer.token}` } : { cookie };
  if (!session.authorization && !cookie) throw new Error(`Signing in to Fernway as ${who} set no cookie and answered no token`);
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${url}${path}`, { headers: session });
    if (res.status !== 200) throw new Error(`GET ${path} as ${who} answered ${res.status}`);
    return (await res.json()) as T;
  };
  const me = await get<{ id: string }>("/api/me");
  const [tasks, projects, profile] = await Promise.all([
    get<Row[]>("/api/tasks"),
    get<Row[]>("/api/projects"),
    get<Record<string, unknown>>(`/api/users/${encodeURIComponent(me.id)}/profile`),
  ]);
  await fetch(`${url}/api/logout`, { method: "POST", headers: session }).catch(() => undefined);
  return { tasks, projects, profile };
}

/**
 * What changed in an account's pre-existing data between two reads, one line per change: a record that is gone or
 * holds other values, or a changed profile field (the plan included). Records created in between (the run's test
 * records) are not changes.
 */
export function stateChanges(before: AccountState, after: AccountState): string[] {
  const changes: string[] = [];
  for (const kind of ["tasks", "projects"] as const) {
    const now = new Map(after[kind].map((r) => [r.id, r]));
    for (const record of before[kind]) {
      const later = now.get(record.id);
      if (!later) changes.push(`${kind} ${record.id} is gone`);
      else if (JSON.stringify(later) !== JSON.stringify(record)) changes.push(`${kind} ${record.id}: ${JSON.stringify(record)} -> ${JSON.stringify(later)}`);
    }
  }
  const keys = new Set([...Object.keys(before.profile), ...Object.keys(after.profile)]);
  for (const key of keys) {
    const [was, is] = [JSON.stringify(before.profile[key]), JSON.stringify(after.profile[key])];
    if (was !== is) changes.push(`profile.${key}: ${was} -> ${is}`);
  }
  return changes;
}

/**
 * The run's own test records that still hold a probe value, as "<account>: <record id>" (never the value).
 * stateChanges leaves out the records a run created, and those are the only records csrf and write-access write to,
 * so this is the independent re-read that holds them to putting their test record back (docs/v2-spec.md "Safety
 * contract": restore, then confirm). A probe value is the run token (8 hex characters, runner.ts) followed by the tag
 * a check inserts after it when it changes a value: write-access's "wxb" (as Account B) and "wxs" (signed out)
 * (write-access.ts SALT.mark), and csrf's "csrf" (csrf.ts markValue). The values a record is created with ("wab",
 * "was", "xsite" after the token) are not probe values. On V08 (`forgedCreateAllowed`), csrf's forged create is the one
 * record allowed to keep its marker: it is a new record, and test records are never deleted.
 */
export function probeValuesLeft(state: { alex: AccountState; sam: AccountState }, forgedCreateAllowed = false): string[] {
  const probe = forgedCreateAllowed ? /[0-9a-f]{8}wx[bs]/i : /[0-9a-f]{8}(?:wx[bs]|csrf)/i;
  return (["alex", "sam"] as const).flatMap((who) =>
    [...state[who].tasks, ...state[who].projects].filter((r) => probe.test(JSON.stringify(r))).map((r) => `${who}: ${r.id}`),
  );
}

/**
 * CSRF token values a text file shows in the clear: a `csrf`/`xsrf` token name, or Express csurf's `_csrf`, followed
 * by a value (a header, a form field, a cookie or a JSON key, in any quoting: plain, escaped JSON, URL-encoded or HTML
 * entities) that isn't a redaction marker. Fernway's clean mode defends with an Origin check and issues no token, so
 * on Fernway this finds nothing unless something invents one; it keeps the grep honest for apps that do. Hits name the
 * file, never any of the value.
 */
export async function csrfTokensIn(dir: string): Promise<string[]> {
  const hits: string[] = [];
  const pattern = new RegExp(`(?:\\b[xc]srf[-_]?token|\\b_csrf)${QUOTES}\\s*(?:[:=]|%3D)\\s*${QUOTES}([A-Za-z0-9+/_.=-]{12,})`, "gi");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|md|html|txt|log|ts|js|har)$/i.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, "utf8");
    for (const m of text.matchAll(pattern)) {
      if (!/REDACTED/i.test(m[1]!)) hits.push(`${path.slice(dir.length + 1)}: a CSRF token`);
    }
  }
  return hits;
}

export async function loadFernwayBugs(): Promise<FernwayBug[]> {
  const raw = JSON.parse(await readFile(join(FERNWAY_DIR, "bugs.json"), "utf8")) as { bugs: FernwayBug[] };
  return raw.bugs;
}

let built: Promise<void> | undefined;

/** Runs `vite build` in fixtures/fernway once per process. FERNWAY_SKIP_BUILD=1 skips it. */
export function buildFernway(): Promise<void> {
  if (process.env.FERNWAY_SKIP_BUILD === "1") return Promise.resolve();
  // Vite through Node's module resolution rather than a .bin shim, whose location depends on the linker.
  const viteRunner = "import('vite').then((v) => v.build({ root: process.cwd(), mode: 'production', logLevel: 'warn' }))";
  built ??= execFileAsync(process.execPath, ["--input-type=module", "-e", viteRunner], {
    cwd: FERNWAY_DIR,
    env: { ...process.env, NODE_ENV: "production" },
    maxBuffer: 16 * 1024 * 1024,
  }).then(
    () => undefined,
    (err: Error & { stdout?: string; stderr?: string }) => {
      throw new Error(`Fernway build failed: ${err.message}\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
    },
  );
  return built;
}

/** FERNWAY_LOGIN and FERNWAY_SESSION (CONTRACT.md "Sign-in and session modes"). */
export type FernwayLogin = "one-step" | "two-step";
export type FernwaySession = "cookie" | "session-storage";
export interface FernwayModes {
  /** Default "one-step". */
  login?: FernwayLogin;
  /** Default "cookie". */
  session?: FernwaySession;
}

/** GET /api/__config: what a running Fernway says it runs (bugs, sign-in form, where the session lives). */
export interface FernwayConfig {
  bugs: string[];
  login: FernwayLogin;
  session: FernwaySession;
}

export interface FernwayInstance {
  /** Origin with no trailing slash, e.g. http://localhost:53211 */
  url: string;
  bugs: string;
  login: FernwayLogin;
  session: FernwaySession;
  /** GET /api/__config. */
  config(): Promise<FernwayConfig>;
  reset(): Promise<void>;
  stop(): Promise<void>;
  /** Everything the server printed, for failure messages. */
  output(): string;
}

async function startOnce(bugs: string, modes: Required<FernwayModes>, timeoutMs: number): Promise<FernwayInstance> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    FERNWAY_BUGS: bugs,
    FERNWAY_LOGIN: modes.login,
    FERNWAY_SESSION: modes.session,
  };
  delete env.HOST; // all interfaces, so both localhost forms answer
  const child: ChildProcess = spawn(process.execPath, ["server/index.mjs"], { cwd: FERNWAY_DIR, env, stdio: ["ignore", "pipe", "pipe"] });

  let out = "";
  const exited = new Promise<void>((res) => child.once("exit", () => res()));
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`Fernway (FERNWAY_BUGS=${bugs}, ${modes.login}, ${modes.session}) did not print "fernway listening" within ${timeoutMs} ms.\n${out}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("fernway listening")) {
        clearTimeout(timer);
        res();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      rej(err);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      rej(new Error(`Fernway (FERNWAY_BUGS=${bugs}, ${modes.login}, ${modes.session}) exited early (code ${code}, signal ${signal}).\n${out}`));
    });
  });

  const url = `http://localhost:${port}`;
  return {
    url,
    bugs,
    login: modes.login,
    session: modes.session,
    output: () => out,
    async config() {
      const res = await fetch(`${url}/api/__config`);
      if (res.status !== 200) throw new Error(`GET /api/__config returned ${res.status}`);
      return (await res.json()) as FernwayConfig;
    },
    async reset() {
      const res = await fetch(`${url}/api/__reset`, { method: "POST" });
      if (res.status !== 204) throw new Error(`POST /api/__reset returned ${res.status}`);
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/**
 * Starts Fernway with FERNWAY_BUGS=bugs on a free port, in the given sign-in and session modes (one-step and cookie by
 * default); retries if the port was taken in between.
 */
export async function startFernway(bugs = "none", options: FernwayModes & { timeoutMs?: number; attempts?: number } = {}): Promise<FernwayInstance> {
  const attempts = options.attempts ?? 3;
  const modes: Required<FernwayModes> = { login: options.login ?? "one-step", session: options.session ?? "cookie" };
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await startOnce(bugs, modes, options.timeoutMs ?? 30_000);
    } catch (err) {
      last = err;
      if (!(err instanceof Error) || !/EADDRINUSE/.test(err.message)) break;
    }
  }
  throw last;
}
