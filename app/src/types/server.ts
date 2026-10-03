/** Server-wide types. State shapes come from the state/ module so the rest of the app stays free of server-internal shapes. */
import type { AccountId, Plan } from "../core/types.js";
import type { AccountsConfig } from "../interfaces/accounts.js";
import type { AiSession } from "../ai/session.js";

export type {
  RunState,
  RunSummary,
  LiveState,
  StoredPlan,
  SignedInAs,
  DiskSummaryEntry,
} from "../server/state/server-internal-types.js";

/** Re-exports for flow callers that still reach into types/ for the ready-account shape. */
export type { AccountReadiness, ReadyAccount } from "../interfaces/server.js";

/** Result of re-planning a stored run. */
export type RerunPlanOutcome =
  | { ok: true; plan: Plan; signedIn?: { id: AccountId; accounts: AccountsConfig }; session?: AiSession; unregister: () => void }
  | { ok: false; error: { message: string; status: 400 | 500 }; unregister: () => void };