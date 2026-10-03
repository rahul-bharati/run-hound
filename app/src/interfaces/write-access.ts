/**
 * Interfaces for the write-access check. The type aliases live in `types/write-access.ts`; the configurable limits
 * live in `config/write-access.ts`; the reusable fixed values (regexes, status sets, identity names, salt) live
 * in `constants/write-access-constants.ts`; the focused modules live under `checks/write-access/`.
 */

import type { CapturedRequest } from "../checks/lib/record-state.js";

/**
 * A request this scenario sends as its identity: one the app itself sent for the test record, with a marker body.
 */
export interface Write {
  method: string;
  url: string;
  /** The body sent (null for a DELETE). */
  body: string | null;
  kind: "json" | "form" | null;
  /** For an update: the record field set to `value`. */
  field?: string;
  value?: string;
  /** For a JSON update whose body holds the record one level down ({"task": {...}}): that key ("task"). */
  nest?: string;
  /** For a form update that nests the record under the model's name (Rails' task[title]): the key the marker went in. */
  formKey?: string;
  /**
   * For a JSON update: `field` isn't a key of the app's own body, so Run Hound added it. An app with a strict schema
   * (zod, strong params) may accept the write and ignore the field, so an accepted write that left the record unchanged
   * proves nothing.
   */
  addedField?: boolean;
  /**
   * The body's anti-CSRF token fields (csrf-tokens.ts isTokenField): each by name, and whether this identity's own
   * token was put in it (`swapped`) or it still holds Account A's. `drifted`: the swapped token was read from a page
   * that set these cookies anew (csrf-token-jar.ts cookieDrift), so the replay, which carries the saved session's
   * cookies, may not carry the one it goes with.
   */
  tokens?: { field: string; swapped: boolean; drifted?: string[] }[];
  /**
   * The anti-CSRF headers the app's own request carried (Capture csrfHeaders: Django's X-CSRFToken, axios'
   * X-XSRF-TOKEN, Rails' X-CSRF-Token), each by lower-case name, and whether this identity's own token was put in it
   * (`swapped`) or it was left out (Account A's is never sent as someone else). `drifted`: as for `tokens`.
   */
  headerTokens?: { name: string; swapped: boolean; drifted?: string[] }[];
  /** Headers sent besides the content type: this identity's own anti-CSRF tokens (headerTokens). In memory only. */
  headers?: Record<string, string>;
  /**
   * The credentials the app's URL carried in its query (?access_token=: credentialParams), each by name, and whether
   * this identity's own value was put in it (`swapped`) or it was left out.
   */
  credentials?: { param: string; swapped: boolean }[];
  /**
   * The version or lock stamps (saveStamp) the body or the URL's query carries at the value the app's own update sent,
   * because the record as re-read doesn't show them (withFreshStamps): with optimistic locking that value is stale, and
   * a refusal may be a conflict with the record's version rather than a refusal of the sender.
   */
  staleStamps?: string[];
  /** The app's own request this write was made from. */
  observed: CapturedRequest;
}

/** What an attempt did to the test record, as a re-read as Account A shows it. */
export interface Effect {
  /** The record is no longer there. */
  gone: boolean;
  /** The fields that changed (none when it is gone). */
  changed: string[];
}

/**
 * What a put-back did: its notes, whether something could not be undone (the scenario is then never a pass), whether
 * all of that is fields the app sets itself on every save (the record's own values are back), and whether a deleted
 * record was created again (it then has a new id, so no later write can address it).
 */
export interface PutBack {
  notes: string[];
  failed: boolean;
  serverOnly: boolean;
  recreated: boolean;
  /** The fields left changed that couldn't be put back ("the record" when it is gone). */
  left: string[];
}

/** A write sent as the scenario's identity, with the app's answer (null: none came). */
export interface Sent {
  w: Write;
  status: number | null;
}

/** The record's id, by its field name and the value it holds. */
export interface RecordIdOf {
  key: string;
  value: string | number;
}

/** The input to the exported spec (`replaySpec` in `checks/write-access/finding.ts`). */
export interface SpecInput {
  target: string;
  write: Write;
  who: "other" | "signed-out";
  verb: "change" | "delete";
  /** The record endpoint: a GET as Account A that holds the record. */
  readUrl: string;
  id: RecordIdOf;
  /** The record's fields that must read the same after the write (for any write, the record must still be there). */
  watch: string[];
}
