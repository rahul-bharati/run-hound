/**
 * The desktop entry: bind the local Run Hound server to a free loopback
 * port and report the URL the window may load.
 *
 * The engine factory and server adapter are injected by the caller (the
 * Electron main process or a test), so this module never imports the
 * engine. The caller owns module loading: it applies the Playwright
 * environment, then imports the engine, then calls this function.
 */

import { createServer } from "node:net";
import { platform as osPlatform } from "node:os";

import { resolveConfigDir, resolveRunsDir } from "./config.js";
import type { DesktopEngineHandle, DesktopEngineReady, DesktopLaunchOptions, DesktopPlatform } from "./contract.js";

/** The fetch handler the server binds: the engine's Hono app, or a test fake. */
export interface DesktopFetchApp {
  fetch: (request: Request) => Promise<Response> | Response;
}

/** Builds the engine's app. The Electron main wires the engine's `createApp`; tests wire a fake. */
export type DesktopEngineFactory = (args: { runsDir: string; boundHost: string }) => DesktopFetchApp;

/** Binds the app to a port. The Electron main wires the engine's `startServerWithApp`. */
export interface DesktopServerAdapter {
  startServer(args: { app: DesktopFetchApp; port: number; host: string; stdout: NodeJS.WritableStream }): DesktopServerHandle;
}

/** The subset of the engine's server handle the entry needs. */
export interface DesktopServerHandle {
  close(callback: () => void): void;
  readonly listening: boolean;
  on(event: "listening" | "error", listener: (...args: unknown[]) => void): void;
}

/** What the entry hands back to the Electron main. */
export interface DesktopEntryStart {
  readonly handle: DesktopEngineHandle;
  readonly info: DesktopEngineReady;
}

const LOOPBACK = "127.0.0.1";

/** Ask the OS for a free loopback port, then release it for the server to bind. */
async function pickFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("desktop: could not determine a free loopback port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Resolve once the server is listening, or reject with its listen error (a port taken in the meantime, say). */
function whenListening(handle: DesktopServerHandle): Promise<void> {
  if (handle.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    handle.on("listening", () => resolve());
    handle.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/** The platform the app runs on; any other Unix is treated as Linux. */
export function hostPlatform(): DesktopPlatform {
  const p = osPlatform();
  return p === "darwin" || p === "win32" ? p : "linux";
}

/** Server log lines go to stderr with a prefix, so they stay apart from Electron's own output. */
const desktopStdout = {
  write: (chunk: string | Uint8Array): boolean => process.stderr.write(`[run-hound] ${String(chunk)}`),
} as NodeJS.WritableStream;

/**
 * Start the local server. The engine must already be loaded with the
 * Playwright environment in place; this function only builds the app and
 * binds it to loopback.
 */
export async function startDesktopEngine(
  launchOptions: DesktopLaunchOptions & { readonly runHoundVersion: string },
  createEngine: DesktopEngineFactory,
  server: DesktopServerAdapter,
): Promise<DesktopEntryStart> {
  const platform = hostPlatform();
  const configDir = launchOptions.configDir ?? resolveConfigDir(platform);
  const runsDir = launchOptions.runsDir ?? resolveRunsDir(platform);

  const app = createEngine({ runsDir, boundHost: LOOPBACK });
  const port = launchOptions.port ?? (await pickFreeLoopbackPort());
  const handle = server.startServer({ app, port, host: LOOPBACK, stdout: desktopStdout });
  await whenListening(handle);

  const url = `http://${LOOPBACK}:${port}/`;
  return {
    handle: { url, stop: () => new Promise<void>((resolve) => handle.close(() => resolve())) },
    info: { url, runsDir, configDir, platform, runHoundVersion: launchOptions.runHoundVersion },
  };
}
