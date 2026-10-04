import type { DesktopIpcChannels } from "./contract.js";

/** The IPC channel names, shared by the main process and the preload so the two cannot drift. */
export const CHANNELS = {
  versionCheck: "desktop:version:check",
  engineReady: "desktop:engine:ready",
  runsDirOpen: "desktop:runs-dir:open",
} as const satisfies Record<string, keyof DesktopIpcChannels>;
