/** Server-wide types. State shapes come from the state/ module so the rest of the app stays free of server-internal shapes. */
export type {
  RunState,
  RunSummary,
  LiveState,
  StoredPlan,
  SignedInAs,
  DiskSummaryEntry,
} from "../server/state/server-internal-types.js";