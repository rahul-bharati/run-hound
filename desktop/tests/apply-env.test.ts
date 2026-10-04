import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPlaywrightEnv } from "../src/apply-env.js";
import { PLAYWRIGHT_ENV_NAMES } from "../src/env.js";

const captured: Record<string, string | undefined> = {};
for (const name of PLAYWRIGHT_ENV_NAMES) captured[name] = process.env[name];

function snapshot(): Record<string, string | undefined> {
  return { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, PLAYWRIGHT_SKIP_BROWSER_GC: process.env.PLAYWRIGHT_SKIP_BROWSER_GC };
}

function restore(): void {
  for (const name of PLAYWRIGHT_ENV_NAMES) {
    const prior = captured[name];
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

describe("applyPlaywrightEnv", () => {
  beforeEach(() => {
    restore();
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.PLAYWRIGHT_SKIP_BROWSER_GC;
  });
  afterEach(restore);

  it("sets both Playwright variables on the target env", () => {
    applyPlaywrightEnv({ browsersPath: "/browsers", skipBrowserGc: "1" });
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe("/browsers");
    expect(process.env.PLAYWRIGHT_SKIP_BROWSER_GC).toBe("1");
  });

  it("writes to a sandbox env without mutating process.env", () => {
    const before = snapshot();
    const sandbox: NodeJS.ProcessEnv = {};
    applyPlaywrightEnv({ browsersPath: "/sandbox", skipBrowserGc: "1" }, sandbox);
    expect(sandbox.PLAYWRIGHT_BROWSERS_PATH).toBe("/sandbox");
    expect(sandbox.PLAYWRIGHT_SKIP_BROWSER_GC).toBe("1");
    expect(snapshot()).toEqual(before);
  });

  it("is idempotent: a second call with the same init is a no-op", () => {
    applyPlaywrightEnv({ browsersPath: "/browsers", skipBrowserGc: "1" });
    const after = snapshot();
    applyPlaywrightEnv({ browsersPath: "/browsers", skipBrowserGc: "1" });
    expect(snapshot()).toEqual(after);
  });

  it("overwrites a stale value with the new init", () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/old";
    process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "0";
    applyPlaywrightEnv({ browsersPath: "/new", skipBrowserGc: "1" });
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe("/new");
    expect(process.env.PLAYWRIGHT_SKIP_BROWSER_GC).toBe("1");
  });

  it("is referenced by the env-ordering rule", () => {
    // The contract requires both variable names; this test fails if
    // either is removed from PLAYWRIGHT_ENV_NAMES.
    expect(PLAYWRIGHT_ENV_NAMES).toContain("PLAYWRIGHT_BROWSERS_PATH");
    expect(PLAYWRIGHT_ENV_NAMES).toContain("PLAYWRIGHT_SKIP_BROWSER_GC");
  });
});
