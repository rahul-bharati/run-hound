/**
 * Record-effect helpers for write-access: classifies what a write did (effectOf) by looking at a re-read as
 * Account A, and notes/late-hit helpers for the verdict (saysRemoved, lateNote, lateHit, changedSummary). The
 * "removed" word regexes and the identity-name table live in `constants/write-access-constants.ts`; the
 * same-value helper lives in `./id-pattern.ts`. The other focused modules (identity, record matching, record
 * body, write build, CSRF tokens, credentials, version stamps, restoration) live alongside this one.
 */
import { endpointOf } from "../../checks/lib/functional-finding.js";
import { changedFields } from "../../checks/lib/record-state.js";
import { REMOVED_VALUE, REMOVED_WORD, SHOWN_WORD, WHO } from "../../constants/write-access-constants.js";
import type { JsonObject } from "../../checks/lib/record-state.js";
import type { Effect, Sent, Write } from "../../interfaces/write-access.js";
import type { Who } from "../../types/write-access.js";
import { sameValue } from "./id-pattern.js";

/** The words of a field name, lowercased: "deletedAt" and "deleted_at" are both ["deleted", "at"]. */
export function wordsOf(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when `field` now holding `after` says the record was removed: what a soft delete leaves. A field that changes
 * on its own (a "viewed 3 minutes ago", a counter, updatedAt) says nothing of the kind.
 */
export function saysRemoved(field: string, after: unknown): boolean {
  const words = wordsOf(field);
  if (words.some((w) => REMOVED_WORD.test(w))) return true;
  if (typeof after === "boolean" && words.some((w) => SHOWN_WORD.test(w))) return true;
  return typeof after === "string" && words.some((w) => w === "status" || w === "state") && REMOVED_VALUE.test(after);
}

/**
 * What the re-read `now` shows `w` did, judged against `before` (the record re-read just before the attempt), or null
 * when it took no effect. Gone counts for any write. For an update, the field it set no longer holds its value (a
 * server that stores the value altered still changed it). For a DELETE that left the record there, a field other
 * than the `volatile` ones that changed and says the record was removed (a soft delete: deletedAt, archived).
 */
export function effectOf(w: Write, before: JsonObject, now: JsonObject[] | "gone", volatile: ReadonlySet<string>): Effect | null {
  if (now === "gone") return { gone: true, changed: [] };
  const after = now[0]!;
  if (w.method === "DELETE") {
    const changed = changedFields(before, after).filter((k) => !volatile.has(k) && saysRemoved(k, after[k]));
    return changed.length > 0 ? { gone: false, changed } : null;
  }
  return sameValue(after[w.field!], before[w.field!]) ? null : { gone: false, changed: [w.field!] };
}

/** The note for a write whose effect showed only after a quiet wait (LATE_MS). */
export function lateNote(who: Who, w: Write, status: number | null): string {
  return `${WHO[who].words.replace(/^a /, "A ")}'s ${endpointOf(w.method, w.url)} (${status ?? "no answer"}) changed Account A's test record a moment later: a re-read right after it showed no change yet.`;
}

/**
 * The write a look after a quiet wait shows landed late, with what it did, judged against `pre` (the record read just
 * before the last attempt, which every earlier put-back left it as): the record gone (the DELETE sent, else the last
 * write), else an update whose field no longer holds its value in `pre` (the one whose marker it holds first). Null when
 * nothing changed.
 */
export function lateHit(sent: Sent[], later: JsonObject[] | "gone", pre: JsonObject, volatile: ReadonlySet<string>): (Sent & { effect: Effect }) | null {
  if (sent.length === 0) return null;
  if (later === "gone") {
    const by = sent.find((s) => s.w.method === "DELETE") ?? sent[sent.length - 1]!;
    return { ...by, effect: { gone: true, changed: [] } };
  }
  const now = later[0]!;
  const moved = sent.filter((s) => s.w.field !== undefined && !volatile.has(s.w.field) && !sameValue(now[s.w.field], pre[s.w.field]));
  const by = moved.find((s) => sameValue(now[s.w.field!], s.w.value)) ?? moved[0];
  return by ? { ...by, effect: { gone: false, changed: [by.w.field!] } } : null;
}

/** The notes' first sentence when `who` got writes through: the requests that did. */
export function changedSummary(who: Who, findings: { location?: string }[]): string {
  return `${WHO[who].subject.replace("visitors", "visitor")} changed Account A's test record: ${findings.map((f) => f.location).join(", ")}.`;
}
