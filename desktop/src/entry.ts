/**
 * The desktop entry: bring up the local Run Hound engine in-process,
 * bind the Hono server to a free loopback port, and report the URL the
 * UI may load.
 *
 * The engine factory is injected by the caller (the Electron main
 * process or a test). This keeps the desktop package decoupled from
 * the engine's import path: the engine stays a CLI binary in the
 * `app/` workspace package, and the desktop receives a function
 * rather than reaching into `app/src`.
 *
 * The factory signature mirrors the engine's `createApp` shape: it
 * takes the runs directory and the bound host, and returns a Hono
 * instance (or any object with a `fetch` method). The desktop does
 * not need to know the engine's types beyond that.
 */

import { connect, createServer } from "node:net";
import { hostname, platform as osPlatform, userInfo } from "node:os";

import { resolveConfigDir, resolveRunsDir } from "./config.js";
import type { DesktopPlatform } from "./contract.js";
import { applyPlaywrightEnv } from "./apply-env.js";
import type { DesktopEngineHandle, DesktopEngineReady, DesktopLaunchOptions } from "./contract.js";

const RUN_HOUND_VERSION = process.env.RUN_HOUND_VERSION ?? "0.0.0-desktop";

/**
 * The factory the desktop hands to the entry. The Electron main wires
 * the real `createApp` from the engine here; tests wire a fake.
 */
export type DesktopEngineFactory = (args: { runsDir: string; boundHost: string }) => { fetch: (request: Request) => Promise<Response> | Response };

/** A minimal HTTP server interface the entry uses to bind the Hono app. */
export interface DesktopServerAdapter {
  startServer(args: { app: { fetch: (request: Request) => Promise<Response> | Response }; port: number; host: string; stdout: NodeJS.WritableStream }): DesktopServerHandle;
}

/** A handle the entry's `stop()` can close. */
export interface DesktopServerHandle {
  close(callback: () => void): void;
}

/** The state the entry hands back to the Electron main. */
export interface DesktopEntryStart {
  readonly handle: DesktopEngineHandle;
  readonly info: DesktopEngineReady;
}

/** Discover a free loopback port by asking the OS to bind then releasing it. */
async function pickFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("could not determine free port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function hostPlatform(): DesktopPlatform {
  const p = osPlatform();
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}

/** Poll the loopback port until a TCP connection succeeds. */
async function waitForServer(port: number, attempts = 50, intervalMs = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await canConnect(port);
    if (ok) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`desktop: engine did not accept connections on port ${port} within ${attempts * intervalMs}ms`);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(50, () => finish(false));
  });
}

/**
 * The exported entry. The order of operations is enforced by the
 * environment variables set in `applyPlaywrightEnv` before
 * `createEngine` is called. The Electron main must call this from
 * inside `app.whenReady()` so the Playwright env is in place before
 * the engine's `playwright` import resolves.
 */
export async function startDesktopEngine(
  launchOptions: DesktopLaunchOptions,
  createEngine: DesktopEngineFactory,
  server: DesktopServerAdapter,
): Promise<DesktopEntryStart> {
  const platform: DesktopPlatform = hostPlatform();
  const configDir = launchOptions.configDir ?? resolveConfigDir(platform);
  const runsDir = launchOptions.runsDir ?? resolveRunsDir(platform);

  applyPlaywrightEnv({
    browsersPath: `${runsDir}/.playwright-browsers`,
    skipBrowserGc: "1",
  });

  // The engine is constructed now, after the env rule. Any import the
  // engine does at module load must have happened in the caller's
  // import graph already; the entry does not own module loading.
  const app = createEngine({ runsDir, boundHost: "127.0.0.1" });

  const port = launchOptions.port ?? (await pickFreeLoopbackPort());

  const desktopStdout: NodeJS.WritableStream = {
    write: (chunk: string | Uint8Array) => {
      process.stderr.write(`[run-hound] ${String(chunk)}`);
      return true;
    },
  } as NodeJS.WritableStream;

  const handle = server.startServer({ app, port, host: "127.0.0.1", stdout: desktopStdout });
  await waitForServer(port);

  const url = `http://127.0.0.1:${port}/`;
  const info: DesktopEngineReady = {
    url,
    runsDir,
    configDir,
    platform,
    runHoundVersion: RUN_HOUND_VERSION,
  };

  const desktopHandle: DesktopEngineHandle = {
    url,
    stop: () => new Promise<void>((resolve) => handle.close(() => resolve())),
  };

  return { handle: desktopHandle, info };
}

/** Diagnostics for the desktop package. */
export const DESKTOP_PACKAGE = {
  name: "@run-hound/desktop",
  version: RUN_HOUND_VERSION,
  hostname: hostname(),
  user: userInfo().username,
};
