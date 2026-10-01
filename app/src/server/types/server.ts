/**
 * Public runtime types of the server (request bodies, paths). Mirrors the app pattern (interfaces/, types/).
 * Anything that crosses a module boundary but stays internal to the server goes here. Re-exports the state types
 * that the controller layer reads through the model facade.
 */
export type {
  RunState,
  RunSummary,
  LiveState,
  StoredPlan,
  SignedInAs,
  DiskSummaryEntry,
} from "../state/server-internal-types.js";

/** A redacted secret in a URL, as redactSecrets writes it: "[REDACTED:github-token]". */
export const REDACTED = /\[REDACTED:[\w-]*\]/;
