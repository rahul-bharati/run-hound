/** Runner engine interfaces: how a run is asked for (RunOptions) and what signing-in produced (Signing). RunOptions is data only — the runtime values it points to live in config/runner.ts. */

import type { AccountId } from "../core/types.js";
import type { AccountsConfig, TestAccount } from "./accounts.js";
import type { SafetyOptions } from "../engine/safety.js";

export interface RunOptions {
  signal?: AbortSignal;
  checks?: import("../core/types.js").Check[];
  approved?: string[];
  allowDestructive?: boolean;
  runsDir?: string;
  allowedHosts?: string[];
  lookup?: SafetyOptions["lookup"];
  log?: (line: string) => void;
  scenarioTimeoutMs?: number;
  onProgress?: (event: import("../types/runner.js").ProgressEvent) => void;
  runId?: string;
  live?: boolean;
  headed?: boolean;
  ai?: import("../ai/session.js").AiSession;
  signInAs?: AccountId;
  accounts?: AccountsConfig;
}

export interface Signing {
  config: AccountsConfig;
  account: TestAccount;
  /** The other slot, when it can be signed in and the user said A and B must not see each other's data. */
  other: TestAccount | null;
}
