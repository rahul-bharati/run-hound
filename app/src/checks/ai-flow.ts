import type { Check, CheckContext, CheckResult, Scenario } from "../core/types.js";
import { notImplemented } from "../ai/not-implemented.js";

/**
 * Runs a flow an AI model suggested (Scenario.flow, validated by ai/suggest.ts flowProblem). Plans nothing itself.
 * Runs on a fresh page (ctx.openPage) of the scenario's form under the engine's navigation guard:
 * - fill/choose: fillForm (checks/lib/functional-form.ts) with the field of ctx.form whose key matches;
 * - click: the control at that index of ctx.form.controls; a destructive control without ctx.allowDestructive →
 *   the scenario is skipped ("This flow clicks <name>, which may change or delete data…");
 * - press: page.keyboard.press;
 * - every step reports ctx.step(...) and is recorded with recordFlow (a GIF);
 * - after a click/press: settle(page) and waitForCreates.
 * Each expect is decided deterministically (see FlowExpectation in core/types.ts). The first failing expect ends the
 * flow with ONE finding: severity "medium", category "broken-feature", confidence "advisory", title
 * "AI-suggested flow failed: <scenario title>", meaning names the expectation that failed and what was observed,
 * facts list each step, evidence = the GIF and a frame of the final page, spec = a Playwright test of the steps
 * (specSource). A step that can't be performed (field or control missing) → status "error" with the reason.
 * All expects hold → "pass" with notes listing what was verified. Missing or empty flow → "error".
 */
export const check: Check = {
  id: "ai-flow",
  title: "AI-suggested flows",
  category: "broken-feature",
  scope: "form",
  plan(): Scenario[] {
    return [];
  },
  async run(ctx: CheckContext, scenario: Scenario): Promise<CheckResult> {
    return notImplemented("ai-flow run");
  },
};
