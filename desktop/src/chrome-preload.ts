/**
 * Preload for the child windows (the HTML report, evidence images, other engine pages). It gives them the Run Hound
 * window look (chrome.ts) and nothing else: no contextBridge, no ipcRenderer, nothing on `window`. These pages run
 * under the report's own restrictions and must never reach the desktop bridge (docs/desktop-architecture.md Rule 5).
 *
 * Built as a single CommonJS file, since a sandboxed preload cannot load ES modules or other local files.
 */

import { installDesktopChrome } from "./chrome.js";

installDesktopChrome({ stylesheet: true });
