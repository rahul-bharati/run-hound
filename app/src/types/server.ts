/**
 * Server-wide types and runtime constants. The REDACTED regex matches "[REDACTED:<kind>]" as redactSecrets writes it.
 * State types come from the state/ module so the rest of the app stays free of server-internal shapes.
 */
export type {
  RunState,
  RunSummary,
  LiveState,
  StoredPlan,
  SignedInAs,
  DiskSummaryEntry,
} from "../server/state/server-internal-types.js";

/** A redacted secret in a URL, as redactSecrets writes it: "[REDACTED:github-token]". */
export const REDACTED = /\[REDACTED:[\w-]*\]/;