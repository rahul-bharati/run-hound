/**
 * Runs flow: /api/runs, /api/runs/:id/stop, /api/runs/:id/rerun, /api/runs/:id, /api/runs/:id/live,
 * /api/runs/:id/live.jpg, /api/runs/:id/{report.json|md|html}, /api/runs/:id/specs/:file, /api/runs/:id/artifacts/:file.
 * Reads from the runs model and the plans store passed in; holds no state of its own.
 */
import { planAccount, registerPasswords, usernameHider } from "../accounts.js";
import { notReadyMessage, resolveAccounts } from "../../config/accounts.js";
import { planBounded, aiForRequest, type SignedInForPlanning } from "./ai-session.js";
import { cleanErrorMessage } from "../../engine/errors.js";
import { NO_DISPLAY_MESSAGE } from "../../engine/runner.js";
import { redactSecrets } from "../../engine/redact.js";
import { isUserError } from "./plan-flow.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_TYPES, REPORT_CSP, REPORT_FILES, SAFE_FILE } from "../../constants/server-constants.js";
import type { Plan } from "../../core/types.js";
import type { RunState, RunSummary } from "../../types/server.js";
import type {
  ArtifactFile,
  FileFetchOutcome,
  FlowError,
  IRunsFlow,
  ReportFile,
  RunListSummary,
  RunLiveView,
  RunStatusView,
  SpecFile,
  StartRunBody,
  StartRunOutcome,
  StartRunRefused,
  StopOutcome,
} from "../../interfaces/server.js";
import type { DiscoverAndPlan, ServerOptions } from "../../interfaces/server.js";

/** What the runs flow needs from the engine (discoverAndPlan wrapper + server options). */
export interface RunsFlowDeps {
  discoverAndPlan: DiscoverAndPlan;
  plans: { get(id: string): { plan: Plan; ai: boolean } | undefined };
  runs: RunsModelLike;
  options: Pick<ServerOptions, "checks" | "allowedHosts">;
  host: { aiPlanBudgetMs(): number };
  canShowBrowser: boolean;
}

/** The slice of RunsModel the runs flow uses. */
export interface RunsModelLike {
  startRun(plan: Plan, approved: string[], flags: { allowDestructive: boolean; headed: boolean; ai: boolean; session?: import("../../ai/session.js").AiSession; accounts?: import("../../interfaces/accounts.js").AccountsConfig }): { runId: string } | { error: string; code: 409 };
  runState(runId: string): Promise<RunState | undefined>;
  listRuns(): Promise<RunSummary[]>;
  isRedactedPlan(state: RunState): boolean;
  readonly map: Map<string, RunState>;
  readonly maxConcurrentRuns: number;
  readonly runsDir: string;
}

/** Runs flow: every /api/runs and /api/runs/:id operation. */
export class RunsFlow implements IRunsFlow {
  readonly #deps: RunsFlowDeps;

  constructor(deps: RunsFlowDeps) {
    this.#deps = deps;
  }

  async start(body: StartRunBody): Promise<StartRunOutcome | StartRunRefused> {
    const stored =
      typeof body.planId === "string" ? this.#deps.plans.get(body.planId) : undefined;
    if (!stored) return { ok: false, status: 404, message: "Unknown plan. Create a plan first." };
    const plan = stored.plan;
    if (
      body.approved !== undefined &&
      !(Array.isArray(body.approved) && body.approved.every((a) => typeof a === "string"))
    ) {
      return { ok: false, status: 400, message: "approved must be a list of scenario ids." };
    }
    for (const flag of ["allowDestructive", "headed"] as const) {
      if (body[flag] !== undefined && typeof body[flag] !== "boolean") {
        return { ok: false, status: 400, message: `${flag} must be true or false.` };
      }
    }
    if (body.headed === true && !this.#deps.canShowBrowser) {
      return { ok: false, status: 400, message: NO_DISPLAY_MESSAGE };
    }
    const approved = body.approved;
    const unknown = (approved ?? []).filter((id) => !plan.scenarios.some((s) => s.id === id));
    if (unknown.length > 0) {
      return { ok: false, status: 400, message: `Unknown scenario id(s): ${redactSecrets(unknown.join(", "))}.` };
    }
    const approvedIds =
      approved ?? plan.scenarios.filter((s) => s.defaultSelected).map((s) => s.id);
    if (approvedIds.length === 0) {
      return { ok: false, status: 400, message: "Select at least one scenario to run." };
    }
    let accounts: import("../../interfaces/accounts.js").AccountsConfig | undefined;
    if (plan.account) {
      const { config, status } = await resolveAccounts();
      const why = notReadyMessage(status.accounts[plan.account.id]);
      if (why) return { ok: false, status: 400, message: redactSecrets(why) };
      accounts = config;
    }
    const session = stored.ai ? (await aiForRequest(true)).ai : undefined;
    const started = this.#deps.runs.startRun(plan, approvedIds, {
      allowDestructive: body.allowDestructive === true,
      headed: body.headed === true,
      ai: stored.ai,
      session,
      ...(accounts ? { accounts } : {}),
    });
    if ("error" in started) return { ok: false, status: 409, message: started.error };
    return { ok: true, runId: started.runId };
  }

  async list(): Promise<RunListSummary[]> {
    return this.#deps.runs.listRuns();
  }

  async stop(runId: string): Promise<StopOutcome> {
    const state = await this.#deps.runs.runState(runId);
    if (!state) return { ok: false, message: "Unknown run.", status: 404 };
    if (state.status !== "running" || !state.controller) {
      return { ok: false, message: "This run has already ended.", status: 409 };
    }
    if (state.controller.signal.aborted) {
      return { ok: false, message: "This run is already stopping.", status: 409 };
    }
    state.controller.abort();
    state.live.updatedAt = new Date().toISOString();
    return { ok: true, runId };
  }

  async rerun(runId: string, signal: AbortSignal): Promise<StartRunOutcome | StartRunRefused> {
    const state = await this.#deps.runs.runState(runId);
    if (!state) return { ok: false, status: 404, message: "Unknown run." };
    if (this.#deps.runs.isRedactedPlan(state)) {
      return {
        ok: false,
        status: 400,
        message:
          "This run's address had a secret in it (a token or key), which is hidden in saved reports, so the run can't be planned again from here. Start a new run with the full address.",
      };
    }
    const running = countRunning(this.#deps.runs.map.values());
    if (running >= this.#deps.runs.maxConcurrentRuns) {
      return { ok: false, status: 409, message: concurrentRunsMessage(running) };
    }

    const planned = await rerunPlanFor({
      state,
      signal,
      discoverAndPlan: this.#deps.discoverAndPlan,
      aiPlanBudgetMs: this.#deps.host.aiPlanBudgetMs(),
      checks: this.#deps.options.checks,
      allowedHosts: this.#deps.options.allowedHosts,
    });
    try {
      if (!planned.ok) return { ok: false, status: planned.error.status, message: planned.error.message };
      const known = new Set(planned.plan.scenarios.map((s) => s.id));
      const approved = state.approved.filter((id) => known.has(id));
      if (approved.length === 0) {
        return {
          ok: false,
          message:
            "None of this run's scenarios are in the new plan (the page has changed). Start a new run instead.",
          status: 400,
        };
      }
      const started = this.#deps.runs.startRun(planned.plan, approved, {
        allowDestructive: state.allowDestructive,
        headed: state.headed && this.#deps.canShowBrowser,
        ai: planned.session !== undefined,
        session: planned.session,
        ...(planned.signedIn ? { accounts: planned.signedIn.accounts } : {}),
      });
      if ("error" in started) return { ok: false, status: 409, message: started.error };
      return { ok: true, runId: started.runId };
    } finally {
      planned.unregister();
    }
  }

  async runStatus(runId: string): Promise<RunStatusView | { notFound: true }> {
    const state = await this.#deps.runs.runState(runId);
    if (!state) return { notFound: true };
    const { dir: _dir, live: _live, plan: _plan, approved: _a, allowDestructive: _d, headed: _h, ai: _ai, controller: _c, ...status } = state;
    return status as RunStatusView;
  }

  async runLive(runId: string): Promise<RunLiveView | { notFound: true }> {
    const state = await this.#deps.runs.runState(runId);
    if (!state) return { notFound: true };
    const { frame: _frame, ...live } = state.live;
    const elapsedMs = state.durationMs ?? Math.max(0, Date.now() - Date.parse(state.startedAt));
    return { status: state.status, startedAt: state.startedAt, elapsedMs, ...live };
  }

  runFrame(runId: string): { frame: Uint8Array | undefined } {
    return { frame: this.#deps.runs.map.get(runId)?.live.frame };
  }

  async reportFile(runId: string, file: string): Promise<ReportFile | null> {
    const state = await this.#deps.runs.runState(runId);
    const type = REPORT_FILES[file];
    if (!state || state.status !== "done" || !type) return null;
    const body = await readFile(join(state.dir, file), "utf8");
    return { body, contentType: type, ...(file === "report.html" ? { contentSecurityPolicy: REPORT_CSP } : {}) };
  }

  async specFile(runId: string, file: string): Promise<FileFetchOutcome<SpecFile>> {
    const state = await this.#deps.runs.runState(runId);
    if (!state || state.status !== "done") return { notFound: true };
    if (!SAFE_FILE.test(file)) return { invalidName: true };
    try {
      const body = await readFile(join(state.dir, "specs", file), "utf8");
      return { ok: true, file: { body } };
    } catch {
      return { notFound: true };
    }
  }

  async artifactFile(runId: string, file: string): Promise<FileFetchOutcome<ArtifactFile>> {
    const state = await this.#deps.runs.runState(runId);
    if (!state || state.status !== "done") return { notFound: true };
    const type = ARTIFACT_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()];
    if (!SAFE_FILE.test(file) || !type) return { invalidName: true };
    try {
      const bytes = await readFile(join(state.dir, "artifacts", file));
      return { ok: true, file: { bytes: new Uint8Array(bytes), contentType: type } };
    } catch {
      return { notFound: true };
    }
  }
}

/** Inputs for re-planning a stored run's target under the same account. */
export interface RerunPlanRequest {
  state: RunState;
  signal: AbortSignal;
  discoverAndPlan: DiscoverAndPlan;
  aiPlanBudgetMs: number;
  checks?: unknown;
  allowedHosts?: string[];
}

/** Result of re-planning. */
export type RerunPlanOutcome =
  | { ok: true; plan: Plan; signedIn?: SignedInForPlanning; session?: import("../../ai/session.js").AiSession; unregister: () => void }
  | { ok: false; error: FlowError; unregister: () => void };

/** Re-plan a stored run's target under its prior account. The caller has already checked the run isn't redacted and
 * there aren't too many concurrent runs (so we don't open a browser we won't use); the caller runs `unregister` in
 * `finally`. */
export async function rerunPlanFor(request: RerunPlanRequest): Promise<RerunPlanOutcome> {
  const { state, signal, discoverAndPlan, aiPlanBudgetMs, checks, allowedHosts } = request;
  const account = planAccount(state.plan);
  let signedIn: SignedInForPlanning | undefined;
  if (account) {
    const { config, status } = await resolveAccounts();
    const why = notReadyMessage(status.accounts[account.id]);
    if (why) {
      return {
        ok: false,
        error: { message: redactSecrets(why), status: 400 },
        unregister: () => undefined,
      };
    }
    signedIn = { id: account.id, accounts: config };
  }
  const unregister = signedIn
    ? registerPasswords(signedIn.accounts, [signedIn.id])
    : () => undefined;
  try {
    const { ai: session } = await aiForRequest(state.ai);
    const plan = (
      await planBounded(
        state.plan.target,
        session,
        signal,
        aiPlanBudgetMs,
        (target, opts) =>
          discoverAndPlan(target, { checks: checks as never, allowedHosts, ...opts }),
        signedIn,
      )
    ).plan;
    return { ok: true, plan, signedIn, session, unregister };
  } catch (err) {
    const hide = usernameHider(signedIn?.accounts);
    const cleaned = hide(
      redactSecrets(cleanErrorMessage(err instanceof Error ? err.message : String(err))),
    );
    if (isUserError(err)) {
      return { ok: false, error: { message: cleaned, status: 400 }, unregister };
    }
    return {
      ok: false,
      error: { message: `Could not plan the run again: ${cleaned}`, status: 500 },
      unregister,
    };
  }
}

/** How many of the given runs are currently running. */
export function countRunning(runs: Iterable<RunState>): number {
  let n = 0;
  for (const r of runs) if (r.status === "running") n += 1;
  return n;
}

/** The "N runs are already in progress" message the controller can answer 409 with. */
export function concurrentRunsMessage(running: number): string {
  return `${running} run${running === 1 ? " is" : "s are"} already in progress. Wait for ${running === 1 ? "it" : "one"} to finish.`;
}