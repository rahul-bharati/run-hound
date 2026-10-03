/** Interfaces for the csrf check. */

import type { ForgeEncoding, ForgeOutcome } from "../checks/lib/cross-site.js";
import type { CapturedRequest, RecordSnapshot } from "../checks/lib/record-state.js";
import type { ReadVia } from "../types/csrf.js";

/** Token values the app gave Account A's page: all of them, and those Run Hound can place as a token. */
export interface PageTokens {
  all: Set<string>;
  /** From a csrf/xsrf <meta> or cookie, or a hidden input whose name says token (csrf-tokens.ts TOKEN_FIELD). */
  placed: Set<string>;
}

/** The forged bodies of a save, the field that carries the forged value, and the token fields left out. */
export interface ForgedBodies {
  /** How the app's own save was encoded. */
  kind: "form" | "multipart" | "json";
  /** Form-encoded: for a form post, and for a JSON save's form-encoded attempt (its top-level fields). */
  form: string;
  /** The JSON payload (a JSON save only): sent as text/plain, or as JSON when CORS allows it. */
  json?: string;
  /** The top-level field that carries the (first) forged value. */
  marked: string;
  /** The top-level fields the forged body keeps (token fields left out), in order. */
  fields: string[];
  /** Fields left out because they carry an anti-CSRF token, or may (`unplaced`). */
  dropped: string[];
  /** Fields among `dropped` left out by their value alone: a value Run Hound can't place as a token. */
  unplaced: string[];
  /** Among `unplaced`, the fields whose value no hidden input held, only the save's URL. */
  urlOnly: string[];
  /** Among `unplaced`, the fields that look like a reference (cross-site-query.ts looksLikeReference). */
  references: string[];
}

/** One forge attempt the orchestrator sent: a note, an encoding, and the observed outcome. */
export interface ForgeAttempt {
  note: string;
  encoding: ForgeEncoding;
  outcome: ForgeOutcome;
}

/** Input to `putBack`: the snapshot, the captured writes, the marker, the via, and the fresh-record predicate. */
export interface PutBackInput {
  snap: RecordSnapshot;
  updates: CapturedRequest[];
  create: CapturedRequest;
  marker: string;
  via: ReadVia;
  /** True when a read shows a record carrying the run's values that the first read didn't (see newRunRecord). */
  fresh: (json: unknown) => boolean;
}