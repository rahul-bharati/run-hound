/**
 * In-memory plan cache. Plans stay in memory so /api/runs can accept them, keep the unredacted target for the run,
 * and remember whether they were made with AI (so the run explains its findings). The newest 50 are kept (oldest first
 * out, by insertion order, which Map preserves). Maps keep insertion order — never sort or restructure.
 */
import type { StoredPlan } from "../state/server-internal-types.js";

export const MAX_PLANS = 50;

/** A plan store with bounded retention. */
export class PlansModel {
  readonly #plans = new Map<string, StoredPlan>();

  /** Stores the plan, dropping the oldest once over MAX_PLANS. */
  set(id: string, plan: StoredPlan): void {
    this.#plans.set(id, plan);
    this.prune();
  }

  /** The plan (and its AI flag) for `id`, or undefined. */
  get(id: string): StoredPlan | undefined {
    return this.#plans.get(id);
  }

  /** Drops the oldest plans first (Maps keep insertion order). */
  prune(): void {
    for (const id of [...this.#plans.keys()].slice(
      0,
      Math.max(0, this.#plans.size - MAX_PLANS),
    ))
      this.#plans.delete(id);
  }
}
