/**
 * Model facade: the single object controllers depend on, in place of free-floating maps and process.env reads. Built
 * once by createApp from a ServerOptions bag and shared with every controller. The shape is explicit so a
 * controller can't accidentally reach into another module's state.
 */
import { canShowBrowser, discoverAndPlan, planWarnings, RUN_HOUND_VERSION } from "../../engine/runner.js";
import type { Check, Plan, Report } from "../../core/types.js";
import type { ServerOptions } from "../interfaces/server.js";
import type { RunState } from "../state/server-internal-types.js";
import { HostState, hostStateFromOptions } from "./host-state.js";
import { PlansModel } from "./plans.js";
import { RunsModel } from "./runs.js";
import { SignInTestsCounter } from "./sign-in-tests.js";
import { redactSecrets } from "../../engine/redact.js";
import { cleanErrorMessage } from "../../engine/errors.js";
import { isSignInFailure } from "../accounts.js";
import {
  NoFormFoundError,
  TargetNotAllowedError,
  TargetUnreachableError,
} from "../../engine/errors.js";

/** Errors caused by the user's input (bad or refused URL, no form, page won't load) rather than by Run Hound. */
export function isUserError(err: unknown): boolean {
  return (
    isSignInFailure(err) ||
    err instanceof TargetNotAllowedError ||
    err instanceof NoFormFoundError ||
    err instanceof TargetUnreachableError ||
    (err instanceof Error && /net::ERR_|Timeout .*exceeded/.test(err.message))
  );
}

/** Check titles for the plan's fieldset legends, e.g. {"dead-control": "Every button does something"}. */
export async function checkTitles(
  checks: Check[] | undefined,
): Promise<Record<string, string>> {
  const list: Check[] = checks ?? (await import("../../checks/index.js")).checks;
  return Object.fromEntries(list.map((c) => [c.id, c.title]));
}

/** Public interface of the model facade (what controllers consume). */
export interface Services {
  readonly host: HostState;
  readonly plans: PlansModel;
  readonly runs: RunsModel;
  readonly signInTests: SignInTestsCounter;
  readonly checks: Check[] | undefined;
  /** Whether a visible browser window can open on this machine. Detected (canShowBrowser) when omitted. */
  readonly canShowBrowser: boolean;
  readonly version: string;
  /** The full ServerOptions bag, for pass-through to runPlan / discoverAndPlan. */
  readonly options: ServerOptions;
  /** The full run start hook (so the controller stays thin). */
  readonly startRun: RunsModel["startRun"];
  /** discoverAndPlan re-exported for the controllers to call. */
  readonly discoverAndPlan: typeof discoverAndPlan;
  /** planWarnings re-exported for the controllers to call. */
  readonly planWarnings: typeof planWarnings;
  /** checkTitles re-exported for the controllers to call. */
  readonly checkTitles: typeof checkTitles;
  /** isUserError re-exported for the controllers to call. */
  readonly isUserError: typeof isUserError;
  /** redactSecrets re-exported for the controllers to call. */
  readonly redactSecrets: typeof redactSecrets;
  /** cleanErrorMessage re-exported for the controllers to call. */
  readonly cleanErrorMessage: typeof cleanErrorMessage;
  /** runState re-exported for the controllers to call. */
  readonly runState: RunsModel["runState"];
  /** listRuns re-exported for the controllers to call. */
  readonly listRuns: RunsModel["listRuns"];
  /** diskSummary re-exported for the controllers to call. */
  readonly diskSummary: RunsModel["diskSummary"];
  /** prune helper for plan redaction / sort safety. */
  readonly isRedactedPlan: RunsModel["isRedactedPlan"];
}

/**
 * Build a fresh services facade for a ServerOptions bag. The host state owns the host predicate (loopback +
 * configured extras); the plans, runs and signInTests counters are independent and don't share maps.
 */
export function buildServices(options: ServerOptions): Services {
  const host = hostStateFromOptions(options);
  const runs = new RunsModel({
    runsDir: host.runsDir,
    maxConcurrentRuns: options.maxConcurrentRuns ?? 2,
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
    checks: options.checks,
    canShowBrowser: headedAvailable,
    version: RUN_HOUND_VERSION,
    options,
    startRun: (plan, approved, flags) => runs.startRun(plan, approved, flags),
    discoverAndPlan,
    planWarnings,
    checkTitles,
    isUserError,
    redactSecrets,
    cleanErrorMessage,
    runState: (id: string) => runs.runState(id),
    listRuns: () => runs.listRuns(),
    diskSummary: (id: string) => runs.diskSummary(id),
    isRedactedPlan: (state: RunState) => runs.isRedactedPlan(state),
  };
}

// Re-export common types from where the controllers will import them, so callers don't need to drill.
export type { RunState, Plan, Report };
