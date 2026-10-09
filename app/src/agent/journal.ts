/**
 * The agent's journal (A3a, docs/agent-spec.md "Journal"): one AgentStep per line in <runDir>/agent/journal.jsonl,
 * append-only, every line passed through the run's `hide` before it is written.
 */

import type { AgentStep } from "../interfaces/agent.js";

export interface Journal {
  /** The journal file's path. */
  readonly file: string;
  /** Appends one step as one line. */
  append(step: AgentStep): Promise<void>;
}

/** The journal of the run in `runDir`; creates `agent/` when the first step is written. */
export function createJournal(runDir: string, hide: (text: string) => string): Journal {
  void runDir, hide;
  throw new Error("not implemented (A3a)");
}
