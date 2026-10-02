/**
 * Narrow contracts the local server's controllers consume. Each controller depends on a per-feature interface here, not
 * on the composition root's full Services object. The composition root (server/app.ts) binds them to concrete
 * implementations. The public ServerOptions type (used by tests, CLI, and createApp callers) lives here too.
 *
 * Flow input/output types live next to each flow's class in server/models/, not here — the interface files only carry
 * the controller-facing contracts and the public configuration.
 */
import type { RunOptions } from "../engine/runner.js";
import type { Plan } from "../core/types.js";
import type { AccountsStatus, SignInCheck } from "./accounts.js";
import type { AccountId } from "../types/accounts.js";

/** The discoverAndPlan function the flows depend on (typed). */
export type DiscoverAndPlan = (target: string, options: Partial<RunOptions>) => Promise<Plan>;

export interface ServerOptions extends Pick<RunOptions, "checks" | "runsDir" | "allowedHosts"> {
  /** Runs allowed at the same time (each one drives its own Chromium). Default 2; more are refused with 409. */
  maxConcurrentRuns?: number;
  /** Whether a visible browser window can open on this machine. Detected (canShowBrowser) when omitted. */
  canShowBrowser?: boolean;
  /**
   * Extra host names and addresses this server answers to, besides loopback ones (RUNHOUND_SERVER_HOSTS).
   * Everything else is refused: a public domain that resolves to 127.0.0.1 (DNS rebinding) can't drive Run Hound
   * from a web page, and another container on the same network can't reach it by the server's IP address.
   */
  serverHosts?: string[];
  /** The address people open (RUNHOUND_PUBLIC_URL, set by the compose files); its host is accepted too. */
  publicUrl?: string;
  /**
   * The address `serve --host` bound to. A specific address is accepted (you chose to serve on it); a wildcard
   * (0.0.0.0, ::) adds nothing, so binding to every interface in a container doesn't open the API to its network.
   */
  boundHost?: string;
  /** How long the AI part of planning (review + suggest) may take per plan. Default AI_PLAN_BUDGET_MS (4 minutes). */
  aiPlanBudgetMs?: number;
}

/** Result of starting a run (202 Accepted). */
export interface StartRunOutcome {
  ok: true;
  runId: string;
}

/** Refused starting a run (400 validation, 404 unknown plan, 409 concurrent, 500 internal). */
export interface StartRunRefused {
  ok: false;
  status: 400 | 404 | 409 | 500;
  message: string;
}

/** What the plan controller needs: build a plan for a target and store it under a fresh id. */
export interface IPlanFlow {
  planForRequest(request: PlanFlowRequest): Promise<PlanFlowOutcome>;
}

/** Inputs to the plan flow as the controller hands them. */
export interface PlanFlowRequest {
  url: string;
  ai?: boolean;
  signInAs?: AccountId | null;
  signal: AbortSignal;
}

/** Result of the plan flow. */
export type PlanFlowOutcome =
  | {
      ok: true;
      planId: string;
      plan: Plan;
      checks: Record<string, string>;
      warnings: string[];
      unregister: () => void;
    }
  | { ok: false; error: FlowError; unregister: () => void };

/** A user-facing error (already redacted, cleaned, hidden). */
export interface FlowError {
  message: string;
  status: 400 | 500;
}

/** What the runs controller needs: every /api/runs and /api/runs/:id operation. */
export interface IRunsFlow {
  start(body: StartRunBody): Promise<StartRunOutcome | StartRunRefused>;
  list(): Promise<RunListSummary[]>;
  stop(runId: string): Promise<StopOutcome>;
  rerun(runId: string, signal: AbortSignal): Promise<StartRunOutcome | StartRunRefused>;
  runStatus(runId: string): Promise<RunStatusView | { notFound: true }>;
  runLive(runId: string): Promise<RunLiveView | { notFound: true }>;
  runFrame(runId: string): { frame: Uint8Array | undefined };
  reportFile(runId: string, file: string): Promise<ReportFile | null>;
  specFile(runId: string, file: string): Promise<FileFetchOutcome<SpecFile>>;
  artifactFile(runId: string, file: string): Promise<FileFetchOutcome<ArtifactFile>>;
}

/** The runs controller parses this into the flow. */
export interface StartRunBody {
  planId?: unknown;
  approved?: unknown;
  allowDestructive?: unknown;
  headed?: unknown;
}

/** Summary of a run, for GET /api/runs. */
export interface RunListSummary {
  runId: string;
  target: string;
  formName: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: unknown;
  completed: number;
  total: number;
  account?: { id: AccountId; label: string };
}

/** Result of POST /api/runs/:id/stop. */
export type StopOutcome =
  | { ok: true; runId: string }
  | { ok: false; message: string; status: 404 | 409 };

/** Result of GET /api/runs/:id (the public status). */
export interface RunStatusView {
  status: "running" | "done" | "error";
  completed: number;
  total: number;
  report?: unknown;
  error?: string;
  durationMs?: number;
  startedAt: string;
}

/** Result of GET /api/runs/:id/live. */
export interface RunLiveView {
  status: "running" | "done" | "error";
  startedAt: string;
  elapsedMs: number;
  scenarioId: string | null;
  scenarioTitle: string | null;
  scenarioIndex: number;
  group: string | null;
  groupLabel: string | null;
  step: string | null;
  url: string | null;
  frameSeq: number;
  updatedAt: string;
  steps: { scenarioId: string; label: string; url: string; at: string }[];
  pagesVisited: string[];
  finished: { scenarioId: string; status: string; durationMs: number }[];
  scenarios: { id: string; title: string; group: string | null; groupLabel: string | null }[];
  browser: string | null;
}

/** A report file (json/md/html) ready to serve with its content type. */
export interface ReportFile {
  body: string;
  contentType: string;
  contentSecurityPolicy?: string;
}

/** A spec file ready to serve. */
export interface SpecFile {
  body: string;
}

/** Outcome of fetching a spec/artifact for a run: ok, invalid name (400), or not found (404). */
export type FileFetchOutcome<T> =
  | { ok: true; file: T }
  | { invalidName: true }
  | { notFound: true };

/** An artifact file (PNG/GIF) ready to serve as bytes. */
export interface ArtifactFile {
  bytes: Uint8Array;
  contentType: string;
}

/** What the accounts controller needs: read, save and test the test accounts. */
export interface IAccountsFlow {
  status(): Promise<AccountsStatus>;
  save(patch: unknown): Promise<SaveAccountsOutcome>;
  testSignIn(id: unknown): Promise<TestSignInOutcome>;
}

export type SaveAccountsOutcome =
  | { ok: true; status: AccountsStatus }
  | { ok: false; message: string; status: 400 | 500 };

export type TestSignInOutcome =
  | { ok: true; check: SignInCheck }
  | { ok: false; message: string; status: 400 | 409 };

/** What the AI controller needs. */
export interface IAiFlow {
  getSettings(): Promise<AiSettingsView>;
  getAi(): Promise<unknown>;
  putAi(patch: unknown): Promise<PutAiOutcome>;
  postAiTest(): Promise<AiTestOutcome>;
  getAiModels(query: AiModelsQuery): Promise<AiModelsOutcome>;
}

export interface AiSettingsView {
  version: string;
  runsDir: string;
  allowedHosts: string[];
  serverHosts: string[];
  ai: unknown;
}

export interface AiModelsQuery {
  provider?: string;
  baseUrl?: string;
  allowRemote?: string;
}

export type PutAiOutcome =
  | { ok: true; status: unknown; notice?: string }
  | { ok: false; message: string; status: 400 };

export type AiTestOutcome = { ok: true; model?: string } | { ok: false; error: string };

export type AiModelsOutcome =
  | { ok: true; list: { models?: unknown; error?: string | null } }
  | { ok: false; message: string; status: 400 };

/** What the UI controller needs. */
export interface IUiFlow {
  uiHtml(): string;
  uiPolicy(): string;
}