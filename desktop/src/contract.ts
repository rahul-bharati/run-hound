/**
 * D2 contract: the types the desktop entry, the IPC channels, the preload
 * bridge and the configuration resolution must satisfy. This file contains
 * no behavior; the next slice implements against it. The decision in
 * docs/desktop-architecture.md is the source of truth for why these shapes
 * are what they are; this file is the shape.
 */

/** Operating system the desktop app is running on. */
export type DesktopPlatform = "linux" | "darwin" | "win32";

/**
 * The arguments a desktop launch may carry. The entry point must accept
 * all of these; tests assert each is honoured.
 */
export interface DesktopLaunchOptions {
  /** Override the working directory for the run; required when launched from a GUI. */
  readonly runsDir?: string;
  /** Override the configuration directory; the default is platform-appropriate. */
  readonly configDir?: string;
  /** Show the Chromium window for manual sign-in; defaults to true on desktop. */
  readonly headedBrowser?: boolean;
  /** Port the local Hono server binds to; defaults to a free loopback port. */
  readonly port?: number;
  /** Called when the engine has started and the UI may load. */
  readonly onEngineReady?: (info: DesktopEngineReady) => void;
  /** Called on fatal startup error. */
  readonly onStartupError?: (err: Error) => void;
}

/** Information the renderer needs once the local engine is up. */
export interface DesktopEngineReady {
  readonly url: string;
  readonly runsDir: string;
  readonly configDir: string;
  readonly platform: DesktopPlatform;
  readonly runHoundVersion: string;
}

/**
 * The entry function the desktop package must export. It sets the
 * Playwright environment variables, then imports the engine, then starts
 * the local Hono server, then loads the UI. The implementation must
 * follow the env-ordering rule in env.ts.
 */
export type DesktopEntry = (options?: DesktopLaunchOptions) => Promise<DesktopEngineHandle>;

/** A handle the desktop shell can use to stop the engine and the server. */
export interface DesktopEngineHandle {
  /** Stop the engine and the server, releasing the port and the browser. */
  stop(): Promise<void>;
  /** The loopback URL the UI may load. */
  readonly url: string;
}

/** Names of the IPC channels the desktop shell uses. */
export interface DesktopIpcChannels {
  /** Renderer asks for the version check; main answers with the latest release, if known (one check per launch). */
  readonly "desktop:version:check": DesktopVersionCheckChannel;
  /** Main notifies the renderer that the engine is ready. */
  readonly "desktop:engine:ready": DesktopEngineReadyChannel;
  /** Renderer asks the main process to open the user's runs directory. */
  readonly "desktop:runs-dir:open": DesktopOpenRunsDirChannel;
}

export interface DesktopVersionCheckChannel {
  /** Renderer → main: void. */
  readonly request: void;
  /**
   * Main → renderer: the latest published version (no leading "v"), or null if it could not be learned. `newer` is true
   * only when `latest` is a higher version than `current`; `url` is then the release page on this repository's GitHub
   * Releases, to open in the default browser. `error` is a short reason when the check failed or is turned off; a
   * failed check is never an error to the user (D4, docs/desktop-architecture.md Rule 8).
   */
  readonly response: {
    readonly latest: string | null;
    readonly current: string;
    readonly newer: boolean;
    readonly url: string | null;
    readonly error?: string;
  };
}

export interface DesktopEngineReadyChannel {
  /** Main → renderer: fired once on startup. */
  readonly payload: DesktopEngineReady;
}

export interface DesktopOpenRunsDirChannel {
  /** Renderer → main: void. */
  readonly request: void;
  /** Main → renderer: true if the open succeeded, false otherwise. */
  readonly response: { readonly ok: boolean; readonly error?: string };
}

/**
 * The minimum surface the preload exposes to the renderer. No Node
 * integration, no other channels, no other globals. Rule 5 of
 * docs/desktop-architecture.md.
 */
export interface DesktopPreloadBridge {
  readonly version: { check(): Promise<DesktopVersionCheckChannel["response"]> };
  readonly runsDir: { open(): Promise<DesktopOpenRunsDirChannel["response"]> };
  readonly engine: { onReady(cb: (info: DesktopEngineReady) => void): () => void };
}
