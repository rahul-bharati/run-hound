/**
 * Host allow-list, allowed-host safety list, and AI plan budget — the server's per-instance configuration that
 * controllers don't read from process.env directly. Created once by createApp (composition root) and passed by
 * reference through the model facade.
 */
import { resolve } from "node:path";
import { AI_PLAN_BUDGET_MS } from "../../ai/session.js";
import type { ServerOptions } from "../../interfaces/server.js";
import { extraHostsOf, hostAllowedOf } from "../middleware/host.js";

export interface HostStateOptions {
  allowedHosts?: string[];
  serverHosts?: string[];
  publicUrl?: string;
  boundHost?: string;
  runsDir?: string;
  aiPlanBudgetMs?: number;
}

export class HostState {
  readonly #runsDir: string;
  readonly #aiPlanBudgetMs: number;
  readonly #extraHosts: string[];
  readonly #hostAllowed: (host: string) => boolean;
  /** Hosts the server's allowedHosts was set to (the safety gate for /api/accounts and /api/plan). */
  readonly #allowedHosts: () => string[];

  constructor(options: HostStateOptions) {
    this.#runsDir = resolve(options.runsDir ?? "runs");
    this.#aiPlanBudgetMs = options.aiPlanBudgetMs ?? AI_PLAN_BUDGET_MS;
    this.#extraHosts = extraHostsOf(options);
    this.#hostAllowed = hostAllowedOf(this.#extraHosts);
    const explicit = options.allowedHosts;
    this.#allowedHosts = () =>
      explicit ?? (process.env.RUNHOUND_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
  }

  /** Resolved runs directory (absolute). */
  get runsDir(): string {
    return this.#runsDir;
  }

  /** AI plan budget in ms (per POST /api/plan and rerun). */
  get aiPlanBudgetMs(): number {
    return this.#aiPlanBudgetMs;
  }

  /** The extra hosts the server answers to besides loopback (RUNHOUND_SERVER_HOSTS, publicUrl host, boundHost). */
  get extraHosts(): string[] {
    return this.#extraHosts;
  }

  /** Host predicate used by the hostAllow middleware. */
  get hostAllowed(): (host: string) => boolean {
    return this.#hostAllowed;
  }

  /** Current allowed-hosts list (the safety gate's input). */
  allowedHosts(): string[] {
    return this.#allowedHosts();
  }
}

/** Build a HostState from ServerOptions. */
export function hostStateFromOptions(options: ServerOptions): HostState {
  return new HostState(options);
}
