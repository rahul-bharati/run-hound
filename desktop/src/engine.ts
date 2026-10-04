/**
 * The engine surface the desktop main process loads, bundled from the
 * app's TypeScript source into `dist/engine.js` by `scripts/build.mjs`.
 *
 * The app runs its source through tsx and imports `.ts` files by `.js`
 * specifiers, so neither Node nor Electron can import `app/src` directly.
 * Bundling resolves those specifiers at build time; Playwright and axe stay
 * external because they locate their own files and browsers at runtime.
 *
 * The main process must import this module only after the Playwright
 * environment is applied (Rule 4 of docs/desktop-architecture.md), because
 * the bundle evaluates `playwright` when it loads.
 */

export { createApp } from "../../app/src/server/app.js";
export { startServerWithApp } from "../../app/src/cli/adapters/server.js";
export { RUN_HOUND_VERSION } from "../../app/src/engine/runner/options.js";
