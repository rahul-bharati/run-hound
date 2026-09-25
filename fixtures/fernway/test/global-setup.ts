import { existsSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { FERNWAY_ROOT } from "./support.js";

/**
 * Builds the Fernway frontend once before any test file, through Vite's JS API (so it does not depend on where the
 * package manager puts binaries). Set FERNWAY_SKIP_BUILD=1 to reuse an existing dist/.
 */
export async function setup() {
  if (process.env.FERNWAY_SKIP_BUILD === "1" && existsSync(join(FERNWAY_ROOT, "dist", "index.html"))) return;

  // Vite bakes `process.env.NODE_ENV || mode` into the bundle, and vitest sets NODE_ENV=test: without this the
  // tests would run (and leave in dist/) React's development build instead of what `pnpm build` ships.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({ root: FERNWAY_ROOT, logLevel: "warn", mode: "production" });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }

  if (!existsSync(join(FERNWAY_ROOT, "dist", "index.html"))) {
    throw new Error("vite build finished but dist/index.html is missing");
  }
}
