import { MAX_BRIEFS } from "../../config/agent.js";
import type { BriefDraft } from "../../interfaces/agent.js";

/** Briefs in memory (A2), the oldest dropped first past MAX_BRIEFS, like plans. */
export class BriefsModel {
  readonly #briefs = new Map<string, BriefDraft>();

  set(id: string, draft: BriefDraft): void {
    this.#briefs.delete(id);
    this.#briefs.set(id, draft);
    for (const old of [...this.#briefs.keys()].slice(0, Math.max(0, this.#briefs.size - MAX_BRIEFS))) this.#briefs.delete(old);
  }

  get(id: string): BriefDraft | undefined {
    return this.#briefs.get(id);
  }
}
