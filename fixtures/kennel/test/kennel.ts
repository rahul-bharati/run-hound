import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of fixtures/kennel. */
export const KENNEL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const V0_BUGS = [
  "F01", "F02", "F03", "F04", "F05", "F06",
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09",
  "S01", "S02", "S03", "S04",
] as const;
export type BugId = (typeof V0_BUGS)[number];

export interface AnalyticsHit {
  method: string;
  url: string;
  body: string;
}

export interface Kennel {
  /** App origin with no trailing slash, e.g. http://127.0.0.1:53211 */
  url: string;
  /** Mock analytics origin (a different port, so a different origin). */
  analyticsUrl: string;
  /** Everything the server wrote to stdout/stderr so far. */
  output(): string;
  /** POST /api/__reset and POST <analytics>/reset. */
  reset(): Promise<void>;
  /** GET <analytics>/hits */
  hits(): Promise<AnalyticsHit[]>;
  stop(): Promise<void>;
}

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

/**
 * Starts `node server/index.mjs` (expects a prior `vite build`, done by globalSetup) on free ports
 * with the given KENNEL_BUGS value ("none", "all" or a comma list). Resolves once the server prints
 * "kennel listening".
 */
export async function startKennel(bugs: string | readonly string[] = "none", timeoutMs = 20_000): Promise<Kennel> {
  const port = await freePort();
  let analyticsPort = await freePort();
  while (analyticsPort === port) analyticsPort = await freePort();

  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: KENNEL_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      ANALYTICS_PORT: String(analyticsPort),
      KENNEL_BUGS: typeof bugs === "string" ? bugs : bugs.join(","),
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
      reject(new Error(`Kennel did not print "kennel listening" within ${timeoutMs} ms. Output:\n${log}`));
    }, timeoutMs);
    child.stdout.on("data", (d: string) => {
      log += d;
      if (log.includes("kennel listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Kennel exited early (code ${code}, signal ${signal}). Output:\n${log}`));
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const url = `http://127.0.0.1:${port}`;
  const analyticsUrl = `http://127.0.0.1:${analyticsPort}`;

  return {
    url,
    analyticsUrl,
    output: () => log,
    async reset() {
      const a = await fetch(`${url}/api/__reset`, { method: "POST" });
      if (!a.ok) throw new Error(`reset failed: ${a.status}`);
      const b = await fetch(`${analyticsUrl}/reset`, { method: "POST" });
      if (!b.ok) throw new Error(`analytics reset failed: ${b.status}`);
    },
    async hits() {
      const res = await fetch(`${analyticsUrl}/hits`);
      const body = (await res.json()) as { hits: AnalyticsHit[] };
      return body.hits;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      await exited;
      clearTimeout(timer);
    },
  };
}
