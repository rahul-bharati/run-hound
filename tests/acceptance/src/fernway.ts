/**
 * Starts the Fernway fixture for acceptance runs (fixtures/fernway/CONTRACT.md, "Process").
 *
 *   - built once with `vite build` in fixtures/fernway (one build serves every mode)
 *   - started with `node server/index.mjs`, env PORT, FERNWAY_BUGS ("none" | "all" | "W01,V02")
 *   - prints "fernway listening" once it accepts connections
 *   - POST /api/__reset restores the seed (sessions survive it)
 *
 * V2 (CONTRACT.md "Accounts"): /app, /app/settings and /app/help need a session. Run Hound signs in as Alex (test
 * account A) with Sam as account B; fernwayAccounts() builds that AccountsConfig for an instance, so no test reads
 * accounts.json.
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

/** The routes that need a session (signed out, the SPA sends you to /login?next=<path>). */
export const SIGNED_IN_ROUTES: readonly string[] = ["/app", "/app/settings", "/app/help"];
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

export interface FernwayInstance {
  /** Origin with no trailing slash, e.g. http://localhost:53211 */
  url: string;
  bugs: string;
  reset(): Promise<void>;
  stop(): Promise<void>;
  /** Everything the server printed, for failure messages. */
  output(): string;
}

async function startOnce(bugs: string, timeoutMs: number): Promise<FernwayInstance> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", PORT: String(port), FERNWAY_BUGS: bugs };
  delete env.HOST; // all interfaces, so both localhost forms answer
  const child: ChildProcess = spawn(process.execPath, ["server/index.mjs"], { cwd: FERNWAY_DIR, env, stdio: ["ignore", "pipe", "pipe"] });

  let out = "";
  const exited = new Promise<void>((res) => child.once("exit", () => res()));
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`Fernway (FERNWAY_BUGS=${bugs}) did not print "fernway listening" within ${timeoutMs} ms.\n${out}`));
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
      rej(new Error(`Fernway (FERNWAY_BUGS=${bugs}) exited early (code ${code}, signal ${signal}).\n${out}`));
    });
  });

  const url = `http://localhost:${port}`;
  return {
    url,
    bugs,
    output: () => out,
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

/** Starts Fernway with FERNWAY_BUGS=bugs on a free port; retries if the port was taken in between. */
export async function startFernway(bugs = "none", options: { timeoutMs?: number; attempts?: number } = {}): Promise<FernwayInstance> {
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await startOnce(bugs, options.timeoutMs ?? 30_000);
    } catch (err) {
      last = err;
      if (!(err instanceof Error) || !/EADDRINUSE/.test(err.message)) break;
    }
  }
  throw last;
}
