/** Interfaces for the record-state helpers shared by the write-side checks. */

import type { JsonObject } from "../types/record-state.js";

/** Account A's test record as it was before an attempt: where it is read, how it is recognised, and its values. */
export interface RecordSnapshot {
  /** The record endpoint (a GET as Account A). */
  url: string;
  /** The test values that identify the record; every one carries the run token. */
  testValues: string[];
  /** The record's own id, when it has one: a re-read finds the record by it, whatever its values are then. */
  id: { key: string; value: string | number } | null;
  /** The record and its parents, deepest first, as parsed from the snapshot's read. */
  chain: JsonObject[];
  /** The record itself (chain[0]). */
  record: JsonObject;
}

/**
 * How a check reads and writes as Account A for rereadRecord and restoreRecord. The default goes through
 * CheckContext.request. csrf passes its own (see csrf.ts ioAsA): Playwright's request context sends a `Secure` cookie
 * over http only to localhost, never to 127.0.0.1, so on such a target a SameSite=None session only works through
 * Account A's own browser page.
 */
export interface RecordIO {
  /** GET `url` as Account A: its JSON, "gone" for a 404 or 410, null when the read failed. */
  read(url: string): Promise<{ json: unknown } | "gone" | null>;
  /** Sends a write as Account A: its status, or null when no answer came. */
  send(req: { method: string; url: string; contentType: string; body: string }): Promise<number | null>;
}

/**
 * A JSON answer the page got before a save: a GET's, or a GraphQL read's sent as a POST (`post`: the query body it
 * sent, so it can be sent again to re-read). `graphql`: a GraphQL answer to a POST that may read but can't be sent again
 * (a persisted operation, by hash or document id, with no query text: it may be a mutation). Its ids count, never its path.
 */
export interface ReadAnswer {
  url: string;
  body: string;
  post?: string | null;
  graphql?: boolean;
}

/** What the page had read before a save: every record id in a JSON answer, and each read's path as a list or one record. */
export interface ReadBeforeSave {
  /** Every id of an object in a JSON answer, as text: under one of ID_KEYS or any other id-like key (projectId too). */
  ids: Set<string>;
  /**
   * The ids read as an object's own id (recordId, with the names the object is read as: taskId of a task in
   * GET /api/tasks), by the key they were read under.
   */
  own: Map<string, Set<string>>;
  /** origin + path (no query, no trailing "/") of each read that answered a list. */
  lists: Set<string>;
  /** The same for each read that answered one record, and never a list. */
  records: Set<string>;
}

/** A write the hold stopped before it reached the app. */
export interface StoppedWrite {
  method: string;
  url: string;
  /** Its body carries the run's test values: it is the form's own save. */
  carriesValues: boolean;
  /**
   * Set when it was stopped as a GraphQL mutation whose name doesn't say it creates a record (unclearGraphQlSave), not
   * for an id or path the page read: the names of those fields, for the note.
   */
  graphql?: string;
}

/**
 * Holds the writes the form's submit sends (see holdExistingEdits) and judges each before it reaches the app.
 */
export interface SaveHold {
  /** The writes stopped before they reached the app, in order: each would have changed a record Account A already had. */
  readonly stopped: StoppedWrite[];
  /** The answers the page had read (as Account A) when the form's save was judged, for editsExistingRecord and putBackEdited. */
  before(): string[];
  /** The same answers with their URLs (and a GraphQL read's query body), for editsExistingRecord. */
  reads(): ReadAnswer[];
  /**
   * The note for a form whose save was stopped (its save changes a record Account A already had), or null to go on. Also
   * null when an earlier write carrying the test values went through and, read again on release(), a record the page
   * had read now holds them (or the re-read failed): the caller then reads the record back and puts it back.
   */
  verdict(): string | null;
  /**
   * Ends the hold: later requests reach the app as usual. When a write carrying the test values was stopped after one
   * went through, first re-reads what the page had read, as Account A (see verdict).
   */
  release(): Promise<void>;
}