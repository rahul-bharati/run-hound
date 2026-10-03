/**
 * Restoration for write-access: puts the test record back from a re-read as Account A (putBack) and watches a
 * field to tell a self-changing one from a write's (stillMoving). The PUT_BACK_NOTHING sentinel and the
 * server-managed field regex live in `constants/write-access-constants.ts`; the joinFields helper and the
 * sameValue predicate live in `./format.ts` and `./id-pattern.ts`; the time limit WATCH_MS lives in
 * `config/write-access.ts`. The other focused modules (identity, record matching, record body, write build,
 * CSRF tokens, credentials, version stamps) live alongside this one.
 */
import { setTimeout as delay } from "node:timers/promises";
import { changesOnSave, changedFields, rereadRecord, restoreRecord, type CapturedRequest, type JsonObject, type RecordSnapshot } from "../../checks/lib/record-state.js";
import { PUT_BACK_NOTHING, SERVER_MANAGED } from "../../constants/write-access-constants.js";
import { WATCH_MS } from "../../config/write-access.js";
import type { CheckContext } from "../../core/types.js";
import type { PutBack } from "../../interfaces/write-access.js";
import { joinFields } from "./format.js";
import { sameValue } from "./id-pattern.js";

/**
 * Puts the test record back from a re-read as Account A, judged against `before` (the read just before the attempt):
 * changed fields through the app's own update for it, a deleted record by sending the create again. Fields in
 * `volatile` change on their own, so they are neither restored nor named; a field still changed after the put-back
 * that keeps changing with nothing sent joins them, unless it is `pinned` (a run-token field or one a probe sets: those
 * are always restored and, when they can't be, named). The notes say what was restored and what could not be undone.
 * `queryStamps`: the parameters of `update`'s URL that carry the record's own version (recordQueryStamps); only those
 * are sent at their value now.
 */
export async function putBack(
  ctx: CheckContext,
  snap: RecordSnapshot,
  before: JsonObject,
  update: CapturedRequest | undefined,
  save: CapturedRequest,
  volatile: Set<string>,
  pinned: ReadonlySet<string>,
  queryStamps?: ReadonlySet<string>,
): Promise<PutBack> {
  const now = await rereadRecord(ctx, snap);
  if (now === null) {
    return { ...PUT_BACK_NOTHING, notes: ["Run Hound couldn't read Account A's test record back to put it back: check Account A."], failed: true };
  }
  const differs = now === "gone" ? ["the record"] : changedFields(before, now[0]!).filter((k) => !volatile.has(k));
  if (differs.length === 0) return PUT_BACK_NOTHING;
  // An update of this record puts changed fields back; the create is only ever sent to make a deleted record again.
  const outcome =
    now === "gone" || update
      ? await restoreRecord(ctx, snap, { save: update ?? save, create: save, ...(update && queryStamps ? { queryStamps } : {}) })
      : { restored: [], notRestored: differs };
  // Only what this attempt changed is named: a field that already differed from the snapshot before it isn't its doing.
  const ours = (k: string) => !volatile.has(k) && differs.includes(k);
  const restored = outcome.restored.filter(ours);
  let left = outcome.notRestored.filter(ours);
  const notes: string[] = [];
  if (now === "gone") {
    if (restored.length > 0) notes.push("Created Account A's test record again after it was deleted (it has a new id).");
    else notes.push("Could not be undone: Account A's test record was deleted and couldn't be created again: check Account A.");
    return { notes, failed: left.length > 0, serverOnly: false, recreated: restored.length > 0, left };
  }
  if (left.length > 0) {
    const watched = await stillMoving(ctx, snap, left);
    if (watched) {
      for (const k of watched.moving) if (!pinned.has(k)) volatile.add(k);
      // A put-back the app applies a moment later (202 Accepted, a queued job): a field that reads as it did before the
      // attempt by the end of the watch was put back.
      const later = watched.again === "gone" ? null : watched.again[0]!;
      const late = later ? left.filter((k) => !volatile.has(k) && sameValue(later[k], before[k])) : [];
      restored.push(...late);
      left = left.filter((k) => !volatile.has(k) && !late.includes(k));
    }
  }
  if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
  if (left.length === 0) return { ...PUT_BACK_NOTHING, notes };
  if (left.every((k) => SERVER_MANAGED.test(k) || changesOnSave(snap, k, ctx.runToken))) {
    notes.push(`Account A's test record is back to its values except ${joinFields(left)}, which the app sets itself.`);
    return { notes, failed: true, serverOnly: true, recreated: false, left };
  }
  notes.push(
    update
      ? `Could not be undone: ${left.join(", ")} of Account A's test record: check Account A.`
      : `Could not be undone: ${left.join(", ")} of Account A's test record changed, and the app sent no update for it that Run Hound could reuse: check Account A.`,
  );
  return { notes, failed: true, serverOnly: false, recreated: false, left };
}

/**
 * Of `fields`, those that change on their own: the record re-read as Account A WATCH_MS after `first` (a read of it,
 * made now when not given), with no write sent in between, holds other values for them. Also the later read. Null when
 * a read failed, or the record was gone at the first one.
 */
export async function stillMoving(
  ctx: CheckContext,
  snap: RecordSnapshot,
  fields: string[],
  first?: JsonObject,
): Promise<{ moving: string[]; again: JsonObject[] | "gone" } | null> {
  let from = first;
  if (!from) {
    const read = await rereadRecord(ctx, snap);
    if (read === null || read === "gone") return null;
    from = read[0]!;
  }
  await delay(WATCH_MS);
  const again = await rereadRecord(ctx, snap);
  if (again === null) return null;
  if (again === "gone") return { moving: [], again };
  const moved = new Set(changedFields(from, again[0]!));
  return { moving: fields.filter((k) => moved.has(k)), again };
}
