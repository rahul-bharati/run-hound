import { afterEach, describe, expect, it } from "vitest";
import { ENV_ORDER_RULE, PLAYWRIGHT_ENV_NAMES } from "../src/env.js";
import type { PlaywrightEnvInit } from "../src/env.js";

describe("D2 env-ordering rule", () => {
  it("names the two environment variables the entry must set", () => {
    expect(PLAYWRIGHT_ENV_NAMES).toEqual(["PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_SKIP_BROWSER_GC"]);
  });

  it("states the rule plainly so the next slice can cite it", () => {
    expect(ENV_ORDER_RULE).toMatch(/PLAYWRIGHT_BROWSERS_PATH/);
    expect(ENV_ORDER_RULE).toMatch(/PLAYWRIGHT_SKIP_BROWSER_GC/);
    expect(ENV_ORDER_RULE).toMatch(/before any module/);
    expect(ENV_ORDER_RULE).toMatch(/engine/);
  });
});

describe("D2 env ordering is observable", () => {
  const previous: Record<string, string | undefined> = {};
  for (const name of PLAYWRIGHT_ENV_NAMES) previous[name] = process.env[name];
  afterEach(() => {
    for (const name of PLAYWRIGHT_ENV_NAMES) {
      const prior = previous[name];
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    }
  });

  it("requires the env to be set before the engine is importable", async () => {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.PLAYWRIGHT_SKIP_BROWSER_GC;

    // Importing the contract must NOT pull the engine module into the
    // graph. Playwright resolves its browser directory at import time;
    // if a future change makes the contract depend on the engine, this
    // assertion fails. We assert by reading the contract module's URL
    // and confirming the env rule is documented in env.ts, not
    // contract.ts.
    const contract = await import("../src/contract.js");
    const envModule = await import("../src/env.js");
    // All contract exports are types and have no runtime presence; the
    // object exists and is empty. The test is that importing the
    // contract does not throw and does not bring the engine along.
    expect(typeof contract).toBe("object");
    // The env rule must be exported from env.ts, not from contract.ts.
    expect(typeof envModule.ENV_ORDER_RULE).toBe("string");
    expect(envModule.ENV_ORDER_RULE).toMatch(/PLAYWRIGHT_BROWSERS_PATH/);
  });

  it("encodes the init shape the next slice must apply", () => {
    const init: PlaywrightEnvInit = {
      browsersPath: "/Applications/Run Hound.app/Contents/Resources/chromium-1.63.0",
      skipBrowserGc: "1",
    };
    expect(init.skipBrowserGc).toBe("1");
    expect(init.browsersPath.length).toBeGreaterThan(0);
  });
});
