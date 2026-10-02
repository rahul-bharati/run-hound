/**
 * Server model wiring: host state, in-memory maps (plans, runs, sign-in-tests counter), and the resolved canShowBrowser
 * flag. The composition root (server/app.ts) constructs each flow from a slice of these.
 */
import { canShowBrowser, discoverAndPlan, RUN_HOUND_VERSION } from "../../engine/runner.js";
import type { ServerOptions } from "../../interfaces/server.js";
import { DEFAULT_MAX_CONCURRENT_RUNS } from "../../config/server.js";
import { HostState, hostStateFromOptions } from "./host-state.js";
import { PlansModel } from "./plans.js";
import { RunsModel } from "./runs.js";
import { SignInTestsCounter } from "./sign-in-tests.js";

/** Everything the composition root needs to build the flows. */
export interface ServerModels {
  readonly host: HostState;
  readonly plans: PlansModel;
  readonly runs: RunsModel;
  readonly signInTests: SignInTestsCounter;
  readonly canShowBrowser: boolean;
  readonly version: string;
}

/** Construct the server models for a ServerOptions bag. */
export function buildServerModels(options: ServerOptions): ServerModels {
  const host = hostStateFromOptions(options);
  const runs = new RunsModel({
    runsDir: host.runsDir,
    maxConcurrentRuns: options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS,
    allowedHosts: options.allowedHosts,
    checks: options.checks,
  });
  const plans = new PlansModel();
  const signInTests = new SignInTestsCounter();
  const headedAvailable = options.canShowBrowser ?? canShowBrowser();
  return {
    host,
    plans,
    runs,
    signInTests,
    canShowBrowser: headedAvailable,
    version: RUN_HOUND_VERSION,
  };
}

/** Re-exported so the composition root can pass the engine's discoverAndPlan to the flows. */
export { discoverAndPlan };