import { MAX_PLANS } from "../../config/server.js";
import type { StoredPlan } from "../state/server-internal-types.js";

/** A plan store with bounded retention. */
export class PlansModel {
  readonly #plans = new Map<string, StoredPlan>();

  set(id: string, plan: StoredPlan): void {
    this.#plans.set(id, plan);
    this.prune();
  }

  get(id: string): StoredPlan | undefined {
    return this.#plans.get(id);
  }

  prune(): void {
    for (const id of [...this.#plans.keys()].slice(
      0,
      Math.max(0, this.#plans.size - MAX_PLANS),
    ))
      this.#plans.delete(id);
  }
}