/** Public facade for the runner: re-exports the public surface so the existing `engine/runner.js` import path keeps working. Implementation lives in focused modules under `./runner/` and the canonical config/constants/interfaces/types/errors homes. New code should import from the canonical homes directly. */
export {
  canShowBrowser,
  newRunId,
  RUN_HOUND_VERSION,
  scenarioLimitMs,
  scenarioTimeoutNote,
  stillSignedOutMessage,
  planWarnings,
  needsOtherAccount,
} from "./runner/options.js";
export { NO_DISPLAY_MESSAGE, ENGINE_STEP, STOPPED_NOTE, SCENARIO_TIMEOUT_MS, NETWORK_IDLE_TIMEOUT_MS } from "./runner/options.js";
export type { RunOptions } from "./runner/options.js";
export type { ProgressEvent } from "./runner/options.js";
export { discoverAndPlan } from "./runner/plan-flow.js";
export { runPlan } from "./runner/run-flow.js";
export { NothingToRunError } from "../errors/nothing-to-run-error.js";
