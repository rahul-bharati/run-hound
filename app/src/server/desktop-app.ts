/**
 * The desktop app's engine: the app createApp builds (the same routes, middleware and guards) plus the routes only the
 * desktop has, because only it has a settings folder of its own and a first launch: GET/POST /api/onboarding and POST
 * /api/data/delete (docs/onboarding-spec.md). The command line's `serve` and the Docker image call createApp and never
 * mount them. desktop/src/engine.ts exports this as the engine's `createApp`.
 *
 * The desktop's main process sets RUNHOUND_CONFIG_DIR to the desktop settings folder before the engine loads, so the
 * folder is configDir(); the command line's own folder is what configDir() gives without RUNHOUND_CONFIG_DIR.
 */
import type { Hono } from "hono";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { configDir } from "../config/ai.js";
import type { ServerOptions } from "../interfaces/server.js";
import { createApp } from "./app.js";
import { registerDesktopRoutes } from "./controllers/index.js";
import { DesktopFlow } from "./models/desktop-flow.js";

export interface DesktopAppOptions extends ServerOptions {
  /** The desktop settings folder. Default: configDir(), i.e. RUNHOUND_CONFIG_DIR, which the desktop app sets. */
  configDir?: string;
  /** The command line's settings folder. Default: where the command line saves when RUNHOUND_CONFIG_DIR is not set. */
  cliConfigDir?: string;
  /**
   * Drops the secret store's unwrapped data key for a settings folder from memory, called once "Delete all keys and data" has
   * deleted its files. Wired to operations/secret-store.ts's forgetStoreKey once the secret-store fix has landed; until then
   * nothing is held back by it: a deleted key file is never read from the cache (loadKey returns null first).
   */
  forgetStoreKey?: (dir: string) => void;
  /** For tests: the environment and home folder the defaults are read from. */
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Where the command line saves its settings: configDir() with RUNHOUND_CONFIG_DIR ignored (it names the desktop's own folder). */
export function commandLineConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return configDir({ ...env, RUNHOUND_CONFIG_DIR: "" }, home);
}

export function createDesktopApp(options: DesktopAppOptions = {}): Hono {
  const app = createApp(options);
  const env = options.env ?? process.env;
  registerDesktopRoutes(app, {
    flow: new DesktopFlow({
      configDir: () => options.configDir ?? configDir(env, options.home),
      cliConfigDir: () => options.cliConfigDir ?? commandLineConfigDir(env, options.home),
      runsDir: resolve(options.runsDir ?? "runs"),
      forgetStoreKey: options.forgetStoreKey ?? (() => undefined),
    }),
  });
  return app;
}
