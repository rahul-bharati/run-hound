/**
 * The agent's journal (A3a, docs/agent-spec.md "Journal"): one AgentStep per line in <runDir>/agent/journal.jsonl,
 * append-only, every line passed through the run's `hide` before it is written.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentStep } from "../interfaces/agent.js";

export interface Journal {
  /** The journal file's path. */
  readonly file: string;
  /** Appends one step as one line. */
  append(step: AgentStep): Promise<void>;
}

/** The journal of the run in `runDir`; creates `agent/` when the first step is written. */
export function createJournal(runDir: string, hide: (text: string) => string): Journal {
  const dir = join(runDir, "agent");
  const file = join(dir, "journal.jsonl");
  // One write at a time, in the order append() was called.
  let queue: Promise<void> = Promise.resolve();
  return {
    file,
    append(step: AgentStep): Promise<void> {
      const line = `${hide(JSON.stringify(step))}\n`;
      const write = queue.then(async () => {
        await mkdir(dir, { recursive: true });
        await appendFile(file, line, { mode: 0o600 });
      });
      queue = write.catch(() => undefined);
      return write;
    },
  };
}
