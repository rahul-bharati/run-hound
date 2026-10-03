/** Helpers used by both plan-flow and run-flow: the small "prepare the environment and report a phase" pieces — the safety gate options, the Chromium launch args, the lazy check resolution, and the engine-level progress event. */

import type { LaunchOptions } from "playwright";
import type { Check } from "../../core/types.js";
import { checkTarget, type SafetyOptions, pinArgs } from "../safety.js";
import { allowedHosts } from "../../config/runner.js";
import { ENGINE_STEP } from "../../constants/runner-constants.js";
import { redactSecrets } from "../redact.js";
import type { RunOptions } from "../../interfaces/runner.js";

/** Safety options the gate and the navigation guard share. */
export function safetyOptions(options: RunOptions): SafetyOptions {
  return { allowedHosts: allowedHosts(options.allowedHosts), lookup: options.lookup };
}

/** Launch options shared by discovery and the run: pinned host, and a visible window when headed. */
export function launchOptions(target: Awaited<ReturnType<typeof checkTarget>>, options: RunOptions): LaunchOptions {
  return { args: pinArgs(target), headless: !options.headed };
}

/** Reports an engine phase (not tied to a scenario) to onProgress. */
export function engineStep(options: RunOptions, label: string, url: string): void {
  options.onProgress?.({ type: "step", scenarioId: ENGINE_STEP, label, url: redactSecrets(url), at: new Date().toISOString() });
}

/** Loaded lazily so the engine does not pull in the whole check library when callers pass their own checks. */
export async function resolveChecks(options: RunOptions): Promise<Check[]> {
  if (options.checks) return options.checks;
  const { checks } = await import("../../checks/index.js");
  return checks;
}
