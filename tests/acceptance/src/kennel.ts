/**
 * Starts the Kennel fixture for acceptance runs.
 *
 * Kennel runtime contract (docs/v0-spec.md):
 *   - built once with `vite build` in fixtures/kennel (one build serves every mode)
 *   - started with `node server/index.mjs`, env PORT, ANALYTICS_PORT, KENNEL_BUGS ("none" | "all" | "F01,A03")
 *   - prints "kennel listening" once both servers accept connections
 *   - form at /book; POST /api/__reset clears all data
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const KENNEL_DIR = join(REPO_ROOT, "fixtures/kennel");

let built: Promise<void> | undefined;

/** Runs `vite build` in fixtures/kennel once per process. KENNEL_SKIP_BUILD=1 skips it. */
export function buildKennel(): Promise<void> {
  if (process.env.KENNEL_SKIP_BUILD === "1") return Promise.resolve();
  // Run Vite through Node's module resolution rather than a .bin shim, whose location
  // depends on the package manager's linker.
  const viteRunner = "import('vite').then((v) => v.build({ root: process.cwd(), mode: 'production' }))";
  built ??= execFileAsync(process.execPath, ["--input-type=module", "-e", viteRunner], {
    cwd: KENNEL_DIR,
    env: { ...process.env, NODE_ENV: "production" },
    maxBuffer: 16 * 1024 * 1024,
  }).then(
    () => undefined,
    (err: Error & { stdout?: string; stderr?: string }) => {
      throw new Error(`Kennel build failed: ${err.message}\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
    },
  );
  return built;
}

/** Asks the OS for a free TCP port. Small race with other processes; startKennel retries on failure. */
export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const address = srv.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      srv.close(() => resolvePort(address.port));
    });
  });
}

export interface KennelInstance {
  /** Base URL with no trailing slash, e.g. http://localhost:53211 */
  url: string;
  /** The booking form. */
  bookUrl: string;
  /** Mock analytics base URL (a different origin, i.e. a third party). */
  analyticsUrl: string;
  bugs: string;
  /** POST /api/__reset. */
  reset(): Promise<void>;
  stop(): Promise<void>;
  /** Everything the server printed, for failure messages. */
  output(): string;
}

async function startOnce(bugs: string, timeoutMs: number): Promise<KennelInstance> {
  const port = await freePort();
  let analyticsPort = await freePort();
  while (analyticsPort === port) analyticsPort = await freePort();

  const child: ChildProcess = spawn(process.execPath, ["server/index.mjs"], {
    cwd: KENNEL_DIR,
    env: { ...process.env, PORT: String(port), ANALYTICS_PORT: String(analyticsPort), KENNEL_BUGS: bugs },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  const exited = new Promise<void>((res) => child.once("exit", () => res()));

  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`Kennel (KENNEL_BUGS=${bugs}) did not print "kennel listening" within ${timeoutMs} ms.\n${out}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("kennel listening")) {
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
      rej(new Error(`Kennel (KENNEL_BUGS=${bugs}) exited early (code ${code}, signal ${signal}).\n${out}`));
    });
  });

  const url = `http://localhost:${port}`;
  return {
    url,
    bookUrl: `${url}/book`,
    analyticsUrl: `http://localhost:${analyticsPort}`,
    bugs,
    output: () => out,
    async reset() {
      const res = await fetch(`${url}/api/__reset`, { method: "POST" });
      if (!res.ok) throw new Error(`POST /api/__reset returned ${res.status}`);
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

/** Starts Kennel with KENNEL_BUGS=bugs on free ports; retries if a port was taken in between. */
export async function startKennel(bugs: string, options: { timeoutMs?: number; attempts?: number } = {}): Promise<KennelInstance> {
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await startOnce(bugs, options.timeoutMs ?? 30_000);
    } catch (err) {
      last = err;
      // Only an early exit (e.g. EADDRINUSE) is worth retrying; a missing server file fails the same way each time.
      if (!(err instanceof Error) || !/EADDRINUSE/.test(err.message)) break;
    }
  }
  throw last;
}

/**
 * The fake secrets planted in Kennel's bundle scripts (S01, S02), read straight from the fixture so the
 * artifact-redaction assertion can never drift from what Kennel ships.
 */
export async function kennelFakeSecrets(): Promise<string[]> {
  const dir = join(KENNEL_DIR, "server/secrets");
  const files = await readdir(dir);
  const values = new Set<string>();
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    for (const m of text.matchAll(/\b(sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g)) values.add(m[1]!);
  }
  if (values.size === 0) throw new Error(`no fake secrets found in ${dir}`);
  return [...values];
}

/** Every file under `dir`, recursively (absolute paths). */
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}
