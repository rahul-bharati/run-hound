/**
 * Execution grant unions (G1, docs/execution-grants.md, "Action taxonomy"): the classes of privileged action a grant
 * can permit. Contract only: nothing enforces grants yet (G2 and G3 do; agent runs first, through A3).
 */

/**
 * - `observation`: reads only (opening a page, a GET request, reading console and network), never a change.
 * - `test-data-creation`: records the run creates, as `isAcceptedSave` counts them (engine/context.ts).
 * - `modification`: changes to records or settings that existed before the run.
 * - `deletion`: removing records or accounts.
 * - `credential-change`: passwords, sessions, API keys or other auth material on the target app.
 * - `external-communication`: requests to an origin other than the target (one of the grant's dependency origins).
 */
export type ActionClass =
  | "observation"
  | "test-data-creation"
  | "modification"
  | "deletion"
  | "credential-change"
  | "external-communication";
