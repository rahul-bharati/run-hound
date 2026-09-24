/**
 * A check that throws reports one plain line in the report (docs/v0-spec.md: never Playwright's call log).
 */
import { describe, expect, it } from "vitest";
import type { CheckContext, Scenario } from "../../core/types.js";
import { guarded as a11yGuarded } from "./a11y-common.js";
import { guarded as functionalGuarded } from "./functional-finding.js";

const scenario: Scenario = { id: "s", checkId: "axe-states", title: "t", description: "d", kind: "golden", priority: "high", destructive: false, defaultSelected: true };
const PLAYWRIGHT_ERROR = 'locator.fill: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator("#name")\u001b[22m\n';

describe("guarded", () => {
  it("functional checks: the error note drops Playwright's call log", async () => {
    const ctx = { log: () => undefined } as unknown as CheckContext;
    const result = await functionalGuarded("persistence", { ...scenario, checkId: "persistence" }, ctx, async () => {
      throw new Error(PLAYWRIGHT_ERROR);
    });
    expect(result.status).toBe("error");
    expect(result.notes).toBe("locator.fill: Timeout 30000ms exceeded.");
  });

  it("accessibility checks: the error note drops Playwright's call log", async () => {
    const result = await a11yGuarded("axe-states", scenario, async () => {
      throw new Error(PLAYWRIGHT_ERROR);
    });
    expect(result.status).toBe("error");
    expect(result.notes).toBe("locator.fill: Timeout 30000ms exceeded.");
  });
});
