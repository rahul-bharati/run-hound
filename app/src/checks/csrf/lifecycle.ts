/** Probe lifecycle and restore for the csrf check: page token harvesting, save pick, the put-back. */

import { tokenSources, TOKEN_FIELD } from "../lib/csrf-tokens.js";
import { holdsId, changedFields, changesOnSave, locateRecord, recordChains, restoreRecord, type CapturedRequest, type RecordSnapshot } from "../lib/record-state.js";
import type { Page } from "playwright";
import type { CheckContext } from "../../core/types.js";
import type { PageTokens, PutBackInput } from "../../interfaces/csrf.js";
import { ioAsA, readAsA } from "./forge-attempt.js";

/** Anti-CSRF token values the app gave Account A's page. Held in memory only, never put in a page Run Hound serves. */
export async function tokenValues(page: Page, key: string): Promise<PageTokens> {
  const sources = await tokenSources(page, key);
  return {
    all: new Set(sources.map((s) => s.value)),
    placed: new Set(sources.filter((s) => s.kind !== "input" || TOKEN_FIELD.test(s.name)).map((s) => s.value)),
  };
}

/** The save this form made for the test record, among `candidates`: the one whose answer holds the record's id, answered 201 Created, or holds the typed values. */
export function pickSave(
  candidates: CapturedRequest[],
  requests: CapturedRequest[],
  testValues: string[],
  snap: RecordSnapshot,
): { save: CapturedRequest; tied: boolean } {
  if (candidates.length === 1) return { save: candidates[0]!, tied: true };
  const holdsValues = (body: string) => testValues.some((v) => v !== "" && body.includes(v));
  const score = (r: CapturedRequest) => {
    const body = r.responseBody ?? "";
    return (snap.id && body && holdsId(body, snap.id) ? 4 : 0) + (r.status === 201 ? 2 : 0) + (body && holdsValues(body) ? 1 : 0);
  };
  let best: CapturedRequest | null = null;
  let bestScore = 0;
  for (const r of candidates) {
    const s = score(r);
    if (s > 0 && s >= bestScore) {
      best = r;
      bestScore = s;
    }
  }
  if (best) return { save: best, tied: true };
  const appears = requests.findIndex((r) => r.method.toUpperCase() === "GET" && Boolean(r.responseBody) && holdsValues(r.responseBody!));
  const before = appears >= 0 ? candidates.filter((r) => requests.indexOf(r) < appears) : [];
  return { save: (before.length > 0 ? before : candidates).at(-1)!, tied: false };
}

/** Puts the test record back after the forge, from a re-read as Account A. */
export async function putBack(
  ctx: CheckContext,
  page: Page,
  o: PutBackInput,
): Promise<string[]> {
  const read = await readAsA(ctx, page, o.snap.url, o.via);
  if (read === null) return ["Run Hound couldn't read Account A's test record back to put it back, so it may still hold the forged value: check Account A."];
  const notes: string[] = [];
  const now = read === "gone" ? "gone" : locateRecord(read.json, o.snap, ctx.runToken);
  const update = o.updates[0];
  if (now === null) {
    notes.push("Run Hound couldn't tell which record is its test record after the forged request: check Account A.");
  } else if (now === "gone" || changedFields(o.snap.record, now[0]!).length > 0) {
    ctx.step("Restoring the test record", page);
    const changed = now === "gone" ? ["the record"] : changedFields(o.snap.record, now[0]!);
    const { restored, notRestored } =
      now === "gone" || update
        ? await restoreRecord(ctx, o.snap, { save: update ?? o.create, create: o.create }, ioAsA(ctx, page, o.via))
        : { restored: [], notRestored: changed };
    if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
    const appSet = notRestored.filter((k) => changesOnSave(o.snap, k, ctx.runToken));
    const rest = notRestored.filter((k) => !appSet.includes(k));
    const fields = (ks: string[]) => (ks.length <= 1 ? ks.join("") : `${ks.slice(0, -1).join(", ")} and ${ks[ks.length - 1]}`);
    if (rest.length > 0) {
      notes.push(
        update || now === "gone"
          ? `Could not be undone: ${rest.join(", ")} of Account A's test record: check Account A.`
          : `Could not be undone: the forged request changed ${rest.join(", ")} of Account A's test record, and the app sent no update for it that Run Hound could reuse: check Account A.`,
      );
    }
    if (appSet.length > 0) {
      notes.push(
        rest.length > 0
          ? `${fields(appSet)} of Account A's test record, which the app sets itself when it is saved, changed too.`
          : `Account A's test record is back to its values except ${fields(appSet)}, which the app sets itself.`,
      );
    }
  }
  if (read !== "gone") {
    const created = recordChains(read.json, [o.marker]).filter((c) => !(o.snap.id && c[0]![o.snap.id.key] === o.snap.id.value));
    if (created.length > 0 || o.fresh(read.json)) {
      notes.push("The forged request created a new test record under Account A (it carries the run's test values, and Run Hound doesn't delete records): check Account A.");
    }
  }
  return notes;
}