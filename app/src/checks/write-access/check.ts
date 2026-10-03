/**
 * write-access (0.6.0, docs/v2-spec.md "`write-access`" and "`write-access` amendments") orchestrator. The focused
 * modules under this directory hold the pieces (identity, record/URL matching, body helpers, write construction,
 * anti-CSRF tokens, URL credentials, version-stamp refresh, effect classification, restoration, finding/spec,
 * secret registrar). The time limits live in `config/`; the regexes, status sets, identity names and salt live
 * in `constants/`; the type aliases in `types/`; the interfaces in `interfaces/`.
 */
import { setTimeout as delay } from "node:timers/promises";
import { isLocalOrigin, isSameOrigin, tokenKey } from "../../core/saves.js";
import type { Capture, Check, CheckContext, Finding, PlanEnv, Scenario } from "../../core/types.js";
import { endpointOf, errorResult, guarded, result } from "../../checks/lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, waitForQuiet, type FieldValue } from "../../checks/lib/functional-form.js";
import { cookieDrift } from "../../checks/lib/csrf-token-jar.js";
import { tokenSources, type TokenSource } from "../../checks/lib/csrf-tokens.js";
import {
  changedFields,
  editsExistingRecord,
  EXISTING_RECORD,
  findOwnRecord,
  getsBefore,
  holdExistingEdits,
  neverWritten,
  parseJson,
  putBackEdited,
  readsBefore,
  readsList,
  recordQueryStamps,
  recordWrites,
  rereadRecord,
  savesOwnRecord,
  snapshotFrom,
  snapshotRecord,
  stoppedByHold,
  type CapturedRequest,
  type JsonObject,
} from "../../checks/lib/record-state.js";
import { LATE_MS } from "../../config/write-access.js";
import {
  CONFLICT,
  INTERRUPTED_NOTE,
  SALT,
  TOKEN_REFUSALS,
  WHO,
  WRITE_ACCESS_ID,
} from "../../constants/write-access-constants.js";
import type { PutBack, Sent, Write } from "../../interfaces/write-access.js";
import type { Who } from "../../types/write-access.js";
import { identityOf } from "./identity.js";
import { addressesRecord, collectionOf, namesOwnId, pathCollectionOf, resourceOf } from "./record-match.js";
import { isTheRecord, kindOf, sensitiveBody, wholeRecordDiff } from "./record-body.js";
import { send, updateFrom } from "./write-build.js";
import { withOwnTokens, tokenFieldsOf } from "./csrf-tokens.js";
import { withOwnHeaderTokens } from "./header-tokens.js";
import { withOwnCredentials } from "./write-credentials.js";
import { credentialParams, credentialValues, credentialsSent } from "./credentials.js";
import { withFreshStamps } from "./stamps.js";
import { changedSummary, effectOf, lateHit, lateNote } from "./effect.js";
import { putBack, stillMoving } from "./restore.js";
import { finding } from "./finding.js";
import { heldSecrets } from "./secrets.js";
import { endpoints, joinFields } from "./format.js";
import { acceptedOrUnknown, mayRefuseStale } from "./predicates.js";
import { PUT_BACK_NOTHING } from "../../constants/write-access-constants.js";

const ID = WRITE_ACCESS_ID;

export const check: Check = {
  id: ID,
  title: "Other accounts and visitors can't change your records",
  category: "security",
  scope: "form",
  interruptedNote: INTERRUPTED_NOTE,

  plan(form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn || !savesOwnRecord(form)) return [];
    const scenario = (who: Who, description: string): Scenario => ({
      id: `${ID}:${WHO[who].slug}`,
      checkId: ID,
      title: `${WHO[who].subject} can't change Account A's records`,
      description,
      kind: "danger",
      priority: "high",
      destructive: false,
      defaultSelected: false,
    });
    return [
      ...(env.otherAccount
        ? [
            scenario(
              "other",
              "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) as Account B. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
            ),
          ]
        : []),
      scenario(
        "signed-out",
        "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) with no session. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
      ),
    ];
  },

  run(ctx, scenario) {
    // Decided as the runner decides whether Account B signs in (identityOf): on a page's later form ("@form-<n>") and
    // under a collided id ("#<n>") the other-account scenario still runs as Account B, never signed out.
    const identity = identityOf(scenario);
    // Credentials the app puts in its URLs (?access_token=) are secrets for as long as this scenario runs.
    const secrets = heldSecrets();
    const outcome = guarded(ID, scenario, ctx, async (started) => {
      const form = ctx.form;
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");
      if (!identity) return skip("Skipped: this scenario names neither Account B nor a signed-out visitor, so Run Hound doesn't know who to send its writes as.");
      const who: Who = identity;
      if (ctx.accounts && !ctx.accounts.self) return skip("Skipped: this run isn't signed in, so there is no Account A record to protect.");
      if (who === "other" && !ctx.accounts?.other) return skip("Skipped: this run has no Account B signed in, so nothing can be sent as another account.");
      if (form.fields.length === 0 || !submitControl(form)) return skip("Skipped: this form has no fields that save a record.");

      // 1. As Account A, save a new test record through the form (this scenario's own values). The form's writes are
      //    held and judged before they reach the app (holdExistingEdits): a save that would change a record Account A
      //    already had is stopped, and the scenario is skipped with nothing written.
      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      const salt = SALT[who];
      const values: FieldValue[] = canaryValues(form, ctx.runToken, salt.create);
      await fillForm(page, values);
      const hold = await holdExistingEdits(ctx, page, capture);
      try {
        await submitForm(page, form);
        await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
        // What the page sends once its save has answered (its update or delete of the new record) comes a moment later,
        // later still on a busy machine: the reload below would cut it off. Still under the hold, so each write is judged.
        await waitForQuiet(capture);
      } finally {
        await hold.release();
      }
      secrets.add(credentialValues(capture, ctx.runToken));
      const stopped = hold.verdict();
      if (stopped) return skip(stopped);
      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter(
        (r) => (isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl)) && !stoppedByHold(hold, r),
      );
      const save = creates.find((r) => r.postData && r.method.toUpperCase() === "POST") ?? creates.find((r) => r.postData);
      if (!save) return skip("Skipped: submitting the form sent no save request, so there is no test record to protect.");
      if (neverWritten(save.url)) {
        return skip(`Skipped: this form saves to ${endpointOf(save.method, save.url)}, an endpoint Run Hound never writes to (sign-out, password, email, payment, invitations or sharing).`);
      }
      // What the page read before the save (with its reads of an API on another local origin, made again as Account A
      // while the save was held): a record id it held then belongs to one of Account A's own records.
      const heldBefore = hold.before();
      const before = heldBefore.length > 0 ? heldBefore : getsBefore(capture, save);
      const reads = heldBefore.length > 0 ? hold.reads() : readsBefore(capture, save);
      const saveAt = capture.requests.indexOf(save);

      // 2. The record endpoint and a snapshot of the new test record, read as Account A.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      secrets.add(credentialValues(capture, ctx.runToken));
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      // A GET after the save (the record didn't exist before it), the reload's first: never a search that echoes the
      // typed value back.
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true, save });
      const snap = recordGet ? await snapshotRecord(ctx, recordGet.url, testValues) : null;
      if (!recordGet || !snap) {
        // The form's save reached the app (the hold let it go): without a read, Run Hound can't tell what it changed, so
        // the note never lets it pass for "nothing was changed" (as csrf says it; 0.6.0 close-out round 1).
        const reached =
          save.status !== null
            ? ` The form's own save (${endpointOf(save.method, save.url)}) reached the app, and without a read Run Hound can't tell whether it changed a record Account A already had: check Account A.`
            : "";
        return skip(`Skipped: Run Hound couldn't read the saved record back as Account A, so it couldn't tell whether a write as someone else changed it.${reached}`);
      }
      // The save went through and turned out to change a record Account A already had (its id was in an answer from
      // before the save, its URL or body named the id, or the record is a single one read at a URL without its id):
      // put it back as the page read it before the save, and say what the save changed.
      if (editsExistingRecord(save, snap, recordGet, before, ctx.runToken, reads)) {
        ctx.step("Putting back the record the form changed", page);
        return skip([EXISTING_RECORD, ...(await putBackEdited(ctx, { capture, save, snap, before }))].join(" "));
      }
      const firstJson = parseJson(recordGet.body);
      const firstSnap = snapshotFrom(recordGet.url, firstJson, testValues, ctx.runToken);
      const listed = firstSnap ? readsList(firstJson, firstSnap.record) : false;
      const id = snap.id;
      if (!id) return skip("Skipped: the test record has no id, so Run Hound can't tell which of the app's writes are for it.");

      // 3. The writes to send: only those the app itself sent for the test record's own URL; the DELETE last. The id
      //    didn't exist before the save, so only what the app sent after it counts; and a write must belong to the
      //    test record: to its collection (the save's, or the record read's), or, at a URL that names the id itself,
      //    with the record itself in its body or answer (isTheRecord: the same run-token field and value, never an
      //    object that only mentions a test value) and a URL that reads as the whole record (wholeRecordDiff, below).
      //    Another of Account A's records that shares the id (numeric ids, another table), even one the page copied the
      //    new title into verbatim, or a create into one named by a foreign key (?listId=3), is never taken for it.
      const key = tokenKey(ctx.runToken);
      const afterSave: Capture = { ...capture, requests: saveAt < 0 ? [] : capture.requests.slice(saveAt + 1) };
      // The save's URL never names the id (a save that does is skipped above), so nothing is cut from it. The read's
      // collection has the id cut out only when the read is the record at its own URL (GET /api/tasks/3, ?id=3). A
      // list read's URL may name another of Account A's records by the same id (GET /api/tasks?listId=3,
      // GET /api/lists/3): only its path counts, with nothing cut out, so that record's writes stay outside it.
      const readCollection = !listed && namesOwnId(recordGet.url, id) ? collectionOf(recordGet.url, id) : pathCollectionOf(recordGet.url);
      const collections = new Set([collectionOf(save.url, id), readCollection].filter((c): c is string => c !== null));
      const inCollection = (r: CapturedRequest) => collections.has(collectionOf(r.url, id) ?? "");
      const forRecord = (r: CapturedRequest) =>
        inCollection(r) || (namesOwnId(r.url, id) && (isTheRecord(r.postData, snap, id, key, false) || isTheRecord(r.responseBody, snap, id, key, true)));
      const candidates = recordWrites(afterSave, snap, ctx.targetUrl).filter((r) => addressesRecord(r.url, id) && forRecord(r));
      // Outside the record's collections, a write is the record's only when its URL reads, as Account A, as the record
      // itself in full (wholeRecordDiff): its id and every field the snapshot has, with the same run-token values. A
      // write to another of Account A's records that shares the id (a note the page copied the new title into, verbatim,
      // under the same key) reads as that record, not this one. The write's own answer is never enough on its own: an
      // answer may hold the new record beside, or instead of, the one written. Each URL is read once, a GET as Account A
      // (recordWrites has already left out every URL that acts when loaded).
      const readsAsRecord = new Map<string, string[] | null>();
      const own: CapturedRequest[] = [];
      // A thin snapshot (the record read shows only its id and the values Run Hound typed, as a list's {id, title}
      // projection does) can't tell the test record from another of Account A's records that shares its id and was
      // given the same values (a note the page copied the new title into). Outside the record's collections, a write is
      // then the record's own only in a collection of the same resource (PATCH /api/task/3 for /api/tasks), never in
      // another one (PATCH /api/notes/3): that one is left untried, with a note.
      const runFields = new Set(Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key)));
      const thin = Object.keys(snap.record).every((k) => k === id.key || runFields.has(k));
      const ownResources = new Set([resourceOf(save.url, id), resourceOf(recordGet.url, id)].flatMap((r) => r));
      const sameResource = (r: CapturedRequest) => resourceOf(r.url, id).some((n) => ownResources.has(n));
      // A fuller snapshot ({id, title, createdAt}) still can't, when the other record has each of its keys: in another
      // resource, a write is the record's own only when its URL reads with the snapshot's own values too (never
      // another createdAt), leaving out the fields the app sets on every save. One that differs is left untried, with
      // a note naming what differs.
      const elsewhere: CapturedRequest[] = [];
      const differing: { r: CapturedRequest; fields: string[] }[] = [];
      for (const r of candidates) {
        if (inCollection(r)) {
          own.push(r);
          continue;
        }
        const same = sameResource(r);
        if (thin && !same) {
          if (!elsewhere.some((e) => e.method === r.method && e.url === r.url)) elsewhere.push(r);
          continue;
        }
        if (!readsAsRecord.has(r.url)) {
          const read = await ctx.request("self", { method: "GET", url: r.url }).catch(() => null);
          readsAsRecord.set(
            r.url,
            !!read && read.status >= 200 && read.status < 300 ? wholeRecordDiff(parseJson(read.body), snap, id, key, ctx.runToken) : null,
          );
        }
        const diff = readsAsRecord.get(r.url) ?? null;
        if (diff === null) continue;
        if (same || diff.length === 0) own.push(r);
        else if (!differing.some((e) => e.r.method === r.method && e.r.url === r.url)) differing.push({ r, fields: diff });
      }
      const observedUpdates = own.filter((r) => r.method.toUpperCase() !== "DELETE");
      const observedDelete = own.find((r) => r.method.toUpperCase() === "DELETE");
      if (observedUpdates.length === 0 && !observedDelete) {
        return skip(`Skipped: the app showed no update or delete for its test record, so there is nothing to try as ${WHO[who].words}.`);
      }
      const updates = observedUpdates
        .map((r, i) => updateFrom(r, snap, key, `${salt.mark}${i === 0 ? "" : i + 1}`))
        .filter((w): w is Write => w !== null);
      const unusable = observedUpdates.filter((r) => !updates.some((w) => w.observed === r));
      // Why an update isn't sent: a body with a password or email key never is, whatever else it holds.
      const sensitive = unusable.filter((r) => sensitiveBody(r.postData));
      const noField = unusable.filter((r) => !sensitive.includes(r));
      const why = (rs: CapturedRequest[], reason: string) => `${endpoints(rs)} (${rs.length === 1 ? "its body has" : "their bodies have"} ${reason})`;
      const reasons = [
        ...(noField.length > 0 ? [why(noField, "no field Run Hound can set to a test value")] : []),
        ...(sensitive.length > 0 ? [why(sensitive, "a password or email field, which Run Hound never sends")] : []),
      ];
      let writes: Write[] = [...updates, ...(observedDelete ? [{ method: "DELETE", url: observedDelete.url, body: null, kind: null, observed: observedDelete }] : [])];
      // An anti-CSRF token in a write's body is Account A's: Account B's replay carries B's own token where a page
      // opened as B shows one, so a refusal is the app's ownership check and not A's token being refused.
      // A page opened as the scenario's identity, once: where its own anti-CSRF token and URL credentials are read.
      let opened: Awaited<ReturnType<CheckContext["openPage"]>> | null | undefined;
      const identityPage = async () => {
        if (opened === undefined) {
          opened = await ctx.openPage({ as: who }).catch(() => null);
          if (opened) await settle(opened.page);
        }
        return opened;
      };
      // So does one in a header the app's own request carried (Django's X-CSRFToken, axios' X-XSRF-TOKEN): B's replay
      // carries B's own in it, read where A's came from, and never A's.
      const ours = await tokenSources(page, key);
      const oursSet = new Set(ours.map((t) => t.value));
      const inBody = writes.some((w) => tokenFieldsOf(w.body, w.kind, oursSet, key).length > 0);
      const inHeader = writes.some((w) => Object.keys(w.observed.csrfHeaders ?? {}).length > 0);
      if (inBody || inHeader) {
        let theirs: TokenSource[] = [];
        // The cookies the page set anew, which the replay (sent with the saved session's cookies) may not carry.
        let drift = new Set<string>();
        if (who === "other") {
          ctx.step("Reading Account B's own anti-CSRF token", page);
          const mine = await identityPage();
          if (mine) {
            theirs = await tokenSources(mine.page, key);
            drift = await cookieDrift(mine.page, mine.capture, ctx.targetUrl);
          }
        }
        writes = withOwnHeaderTokens(withOwnTokens(writes, ours, theirs, key, drift), ours, theirs, drift);
      }
      // A credential in a write's URL (?access_token=, ?api_token=, ?auth=) is Account A's: sent as it is, the replay
      // would still be Account A's own request. It goes as the identity's own where a page opened as it sent the same
      // parameter, and is left out otherwise (a signed-out visitor has none). A write whose URL then no longer names the
      // test record is not tried.
      const carried = [...new Set(writes.flatMap((w) => credentialParams(w.url, ctx.runToken).map((c) => c.name)))];
      let lost: Write[] = [];
      if (carried.length > 0) {
        ctx.step(who === "other" ? "Reading Account B's own credentials" : "Opening the app signed out", page);
        const mine = await identityPage();
        if (mine) secrets.add(credentialValues(mine.capture, ctx.runToken));
        const theirs = mine ? credentialsSent(mine.capture, ctx.runToken) : new Map<string, string>();
        const rewritten = writes.map((w) => withOwnCredentials(w, theirs, ctx.runToken));
        lost = rewritten.filter((w) => w.credentials && !addressesRecord(w.url, id));
        writes = rewritten.filter((w) => !lost.includes(w));
        if (lost.length > 0) {
          reasons.push(
            `${endpoints(lost.map((w) => w.observed))} (its URL carries Account A's credential in ${joinFields(carried)}, and without it no longer names the test record)`,
          );
        }
      }
      if (writes.length === 0) {
        if (lost.length > 0) {
          return skip(
            `Skipped: the app's update for its test record carries Account A's credential in its URL (${joinFields(carried)}), and without it the request no longer names the test record, so there is nothing to try as ${WHO[who].words}. Not tried: ${reasons.join("; ")}.`,
          );
        }
        if (sensitive.length === 0) {
          const one = unusable.length === 1;
          return skip(
            `Skipped: the app's ${one ? "update" : "updates"} for its test record (${endpoints(unusable)}) ${one ? "has" : "have"} no field Run Hound can set to a test value, so there is nothing to try as ${WHO[who].words}.`,
          );
        }
        return skip(`Skipped: none of the app's updates for its test record can be sent, so there is nothing to try as ${WHO[who].words}. Not tried: ${reasons.join("; ")}.`);
      }
      if (elsewhere.length > 0) {
        reasons.push(
          `${endpoints(elsewhere)} (outside the test record's collection, and the record as read shows only its id and the values Run Hound typed, so another of Account A's records with the same id can't be told from it)`,
        );
      }
      for (const { r, fields } of differing) {
        reasons.push(
          `${endpointOf(r.method, r.url)} (outside the test record's collection, and its URL reads as Account A with another ${joinFields(fields)} than the test record, so it may be another of Account A's records with the same id)`,
        );
      }
      const unusableNote = reasons.length > 0 ? `Not tried: ${reasons.join("; ")}.` : "";
      // The app's own update with a body, for putting changed fields back (never one with a password or email key).
      const restoreWith = observedUpdates.find((r) => kindOf(r.postData) !== null && !sensitiveBody(r.postData));
      // The parameters of each of the app's own updates' URLs that carry the record's own version (recordQueryStamps):
      // a value the record showed before the update was sent. Another by a stamp's name (an API version) is never
      // rewritten, in an attempt or a put-back.
      const queryStampsOf = new Map<CapturedRequest, Set<string>>();
      const stampsOf = (r: CapturedRequest): Set<string> => {
        let found = queryStampsOf.get(r);
        if (!found) {
          found = recordQueryStamps(capture, save, r, snap, ctx.runToken);
          queryStampsOf.set(r, found);
        }
        return found;
      };
      const restoreStamps = restoreWith ? stampsOf(restoreWith) : undefined;

      const notes: string[] = [];
      /** Adds a put-back's notes, each once: the same leftover after two attempts is said once. */
      const noteOnce = (more: string[]) => {
        for (const n of more) if (!notes.includes(n)) notes.push(n);
      };
      const findings: Finding[] = [];
      const tried: string[] = [];
      /**
       * Fields that change on their own: those that differ between the snapshot and a re-read before any attempt, and
       * any found still changing later while nothing was sent.
       */
      const volatile = new Set<string>();
      /**
       * Fields never taken for ones that change on their own: the record's run-token fields and those a probe sets.
       * They are always put back, and named when they can't be.
       */
      const pinned = new Set<string>([
        ...Object.keys(snap.record).filter((k) => typeof snap.record[k] === "string" && (snap.record[k] as string).toLowerCase().includes(key)),
        ...writes.flatMap((w) => (w.field ? [w.field] : [])),
      ]);
      const markVolatile = (fields: Iterable<string>) => {
        for (const k of fields) if (!pinned.has(k)) volatile.add(k);
      };
      /**
       * Other fields of the record an attempt changed while the value it set (or, for a DELETE, the record) stayed: the
       * put-back undoes them, but the scenario is then inconclusive, never a pass.
       */
      const sideChanges: string[] = [];
      /** What was left that couldn't be put back: only fields the app sets itself on every save, or record values too. */
      let leftover: "none" | "server" | "values" = "none";
      /** The server-managed fields a put-back left, for the summary. */
      const serverLeft = new Set<string>();
      /** Set when writes were left untried because Account A's test record couldn't be read before them. */
      let unread = "";
      let sentAny = false;
      /** Every write sent as the identity, in order, with the app's answer. */
      const sent: Sent[] = [];
      /** Whether the last write sent was looked at once more after a quiet wait (LATE_MS). */
      let lookedAfterLast = false;
      /** Set when the record was deleted and created again (a new id): no later look can find it by the old one. */
      let recreated = false;
      /** Set when the look after a quiet wait, before the verdict, failed. */
      let lateUnread = "";
      /**
       * Writes the app accepted (2xx) that left the record unchanged, whose field Run Hound added to the app's own body
       * (Write.addedField): no proof either way.
       */
      const ignoredFields: { write: string; field: string }[] = [];
      /** The read just before the attempt under way: what a put-back is judged against. */
      let lastPre: JsonObject = snap.record;
      /**
       * Writes refused (TOKEN_REFUSALS: 400, 403, 419, 422) while they still carried Account A's body token or went
       * without the anti-CSRF header the app's own request carried: no proof either way.
       */
      const tokenRefusals: string[] = [];
      /** A token refusal where no token of the identity's own went (not only one whose cookie drifted). */
      let tokenUnmatched = false;
      /** Writes answered with a conflict (409, 412, 428) that left the record unchanged: no proof either way. */
      const conflicts: string[] = [];
      /**
       * Writes refused as a stale version may be (400, 422, 5xx: mayRefuseStale; a 404 the same write as Account A didn't
       * prove was a refusal of the sender, compareAsOwner) that left the record unchanged while they carried a version or
       * lock the record as read doesn't show (Write.staleStamps): no proof either way.
       */
      const staleRefusals: { write: string; fields: string[] }[] = [];
      /**
       * Writes Account B sent without Account A's URL credential and with none of its own, that the app refused (401,
       * 403): the refusal may be the app asking for a credential, not checking who owns the record.
       */
      const credentialRefusals: { write: string; params: string[] }[] = [];
      /** Writes that got no answer (the connection dropped or timed out) and left the record unchanged: no proof either way. */
      const noAnswers: string[] = [];
      /**
       * Writes the app answered 2xx that left the record unchanged while they carried a version or lock the record as
       * read doesn't show (Write.staleStamps), and that the same write as Account A didn't prove were refused for who
       * sent them (compareAsOwner): the app may ignore a stale version that way. No proof either way.
       */
      const staleAccepted: { write: string; fields: string[] }[] = [];
      /** The writes Run Hound sent as Account A to compare an answer with (compareAsOwner), with the app's answer. */
      const compared: string[] = [];
      /**
       * A 404 to an attempt that carried a stamp the record as read doesn't show (Write.staleStamps) may be the app's
       * version check too: UPDATE … WHERE id = $1 AND lock_version = $2 matched no row, or Prisma's P2025 answered 404
       * (close-out review, round 1). So may a 2xx that left the record unchanged: the same UPDATE, answered 200 or 204
       * (round 2). The same attempt is sent as Account A: the app's own update as Account A's page sent it (its
       * anti-CSRF token, in its body or a header, and its URL credential), with the same stamps and a test value of
       * Account A's own (SALT compare) in the same field, never a write that changes nothing (an app may answer that
       * 200 at once, or refuse it with 422, before it looks at the version). Judged by a re-read as Account A: when it
       * shows Account A's value, the app takes that version from the record's owner, so it refused the sender; so it did
       * when the app answers Account A with a conflict (409, 412, 428). A 404, a 2xx that left the record unchanged, a
       * 400, 422 or 5xx, or no answer proves nothing: inconclusive (staleRefusals for a 404, staleAccepted for a 2xx).
       * A DELETE is never sent as Account A to compare. What the comparison changed is put back, and it counts like any
       * attempt's put-back. `applied`: the re-read showed Account A's value.
       */
      const compareAsOwner = async (w: Write, attempt: Write, status: number): Promise<{ back: PutBack; applied: boolean }> => {
        const sentAt = endpointOf(w.method, attempt.url);
        const write = `${sentAt} (${status})`;
        const fields = attempt.staleStamps ?? [];
        const stamps = joinFields(fields);
        const unproven = () => (status === 404 ? staleRefusals : staleAccepted).push({ write, fields });
        const nothing = { back: PUT_BACK_NOTHING, applied: false };
        if (w.method === "DELETE") {
          unproven();
          notes.push(`Run Hound never sends a delete as Account A to compare, so it can't tell the ${status} to ${WHO[who].words}'s ${sentAt} from the app's answer to a stale version.`);
          return nothing;
        }
        const cmpPre = await rereadRecord(ctx, snap);
        if (cmpPre === null || cmpPre === "gone") {
          unproven();
          notes.push(`Run Hound couldn't read Account A's test record to compare the ${status} to ${WHO[who].words}'s ${sentAt} with the same write sent as Account A.`);
          return nothing;
        }
        // The same write, from Account A's own request: its body with a test value of Account A's own in the field the
        // attempt set (updateFrom picks the same one), its URL, and its anti-CSRF headers (Account A's own).
        const n = updates.findIndex((u) => u.observed === w.observed);
        const tag = `${salt.compare}${n <= 0 ? "" : n + 1}`;
        const marked = updateFrom(w.observed, snap, key, tag);
        if (!marked || marked.field !== w.field) {
          unproven();
          notes.push(`Run Hound couldn't make the same write as Account A to compare the ${status} to ${WHO[who].words}'s ${sentAt} with.`);
          return nothing;
        }
        const ownHeaders = w.observed.csrfHeaders && Object.keys(w.observed.csrfHeaders).length > 0 ? { headers: { ...w.observed.csrfHeaders } } : {};
        const own = withFreshStamps({ ...marked, ...ownHeaders }, cmpPre[0]!, ctx.runToken, stampsOf(w.observed));
        const field = marked.field!;
        const ownAt = endpointOf(own.method, own.url);
        ctx.step(`Sending the same ${ownAt} as Account A, with a test value of its own, to compare`, page);
        const answered = await send(ctx, "self", own);
        compared.push(`${ownAt} (${answered ?? "no answer"})`);
        const shows = (read: JsonObject[] | "gone" | null) => {
          const v = read === null || read === "gone" ? undefined : read[0]![field];
          return typeof v === "string" && v.toLowerCase().includes(`${key}${tag}`);
        };
        let after = await rereadRecord(ctx, snap);
        // A write the app accepted may be applied a moment later (202 Accepted, a queued job): looked at once more after a
        // quiet wait before it is judged.
        if (after !== null && after !== "gone" && acceptedOrUnknown(answered) && !shows(after)) {
          await delay(LATE_MS);
          after = await rereadRecord(ctx, snap);
        }
        const applied = shows(after);
        const back = await putBack(ctx, snap, cmpPre[0]!, restoreWith, save, volatile, pinned, restoreStamps);
        noteOnce(back.notes);
        const lead = `Run Hound also sent the same ${ownAt} as Account A, with the same ${stamps} and a test value of its own in ${field}, and`;
        const whom = WHO[who].words;
        if (applied) {
          notes.push(`${lead} the app applied it (${answered ?? "no answer"}): it takes that ${stamps} from the record's owner, so its ${status} to ${whom} was about the sender, not the version.`);
        } else if (answered !== null && CONFLICT.has(answered)) {
          notes.push(`${lead} the app answered ${answered}, a conflict with the version, not ${status}: its ${status} to ${whom} was about the sender, not the version.`);
        } else {
          unproven();
          const accepted = answered !== null && answered >= 200 && answered < 300;
          const unseen = after === null ? ", and Run Hound couldn't read the record back" : after === "gone" ? "" : " and left the record unchanged";
          const why =
            answered === null
              ? "no answer came"
              : answered === status
                ? `the app answered Account A the same way (${answered})${accepted ? unseen : ""}`
                : accepted
                  ? `the app answered ${answered}${unseen}`
                  : `the app answered ${answered}, which doesn't show how it answers a stale version`;
          notes.push(`${lead} ${why}, so the ${status} to ${whom} may be the app's answer to a stale version.`);
        }
        return { back, applied };
      };
      try {
        for (const [i, w] of writes.entries()) {
          const rest = writes.slice(i + 1);
          // Each attempt is judged against the record as it is just before it, read as Account A.
          const pre = await rereadRecord(ctx, snap);
          if (pre === null || pre === "gone") {
            if (i === 0) {
              return skip("Skipped: Run Hound couldn't read the saved record back as Account A, so it couldn't tell whether a write as someone else changed it.");
            }
            unread = `Inconclusive: Run Hound couldn't read Account A's test record before sending ${endpoints([w, ...rest])} as ${WHO[who].words}, so it didn't send ${rest.length === 0 ? "it" : "them"}: check Account A.`;
            break;
          }
          if (i === 0) markVolatile(changedFields(snap.record, pre[0]!));
          lastPre = pre[0]!;

          // A version or lock the app's own update carried is stale by now: the replay carries the record's current one
          // (in its body, or its URL's query). Every note names the request as it was sent.
          const attempt = withFreshStamps(w, lastPre, ctx.runToken, stampsOf(w.observed));
          const at = endpointOf(w.method, attempt.url);
          ctx.step(`Sending ${at} as ${WHO[who].words}`, page);
          sentAny = true;
          const sideAt = sideChanges.length;
          const status = await send(ctx, who, attempt);
          tried.push(`${at} (${status ?? "no answer"})`);
          sent.push({ w: attempt, status });
          let now = await rereadRecord(ctx, snap);
          // The app may accept a write and apply it a moment later (202 Accepted, a queued job): an accepted write (or
          // one with no answer) that shows no effect yet is looked at once more after a quiet wait before it is judged.
          let lookedLate = false;
          if (now !== null && now !== "gone" && acceptedOrUnknown(status) && !effectOf(w, lastPre, now, volatile)) {
            await delay(LATE_MS);
            now = await rereadRecord(ctx, snap);
            lookedLate = true;
          }
          lookedAfterLast = lookedLate;
          if (now === null) {
            const back = await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned, restoreStamps);
            noteOnce(back.notes);
            const unknown = `Inconclusive: the re-read as Account A failed after ${at} was sent as ${WHO[who].words}, so Run Hound can't tell whether it worked: check Account A.`;
            // An earlier attempt's confirmed finding stands.
            if (findings.length > 0) return result(ID, scenario, started, findings, [changedSummary(who, findings), unknown, ...sideChanges, ...notes].join(" "));
            return skip([unknown, ...sideChanges, ...notes].join(" "));
          }
          let effect = effectOf(w, lastPre, now, volatile);
          if (effect && lookedLate) notes.push(lateNote(who, attempt, status));
          if (w.method === "DELETE" && effect && !effect.gone && now !== "gone") {
            // A DELETE that left the record there, changed (a soft delete): confirm the change holds while nothing is
            // sent, so a field that changes on its own now and then is never taken for one.
            const watched = await stillMoving(ctx, snap, effect.changed, now[0]!);
            if (watched?.again === "gone") effect = { gone: true, changed: [] };
            else if (watched) {
              markVolatile(watched.moving);
              const changed = effect.changed.filter((k) => !volatile.has(k));
              effect = changed.length > 0 ? { gone: false, changed } : null;
            }
          }
          if (!effect && now !== "gone") {
            // The value the attempt set didn't change (nor did a DELETE remove the record), but did anything else of
            // the record? A refused write that still stamps it (flagged, a soft delete the words above don't know) is
            // no pass. Watched while nothing is sent first, so a field that changes on its own is left out.
            const side = changedFields(lastPre, now[0]!).filter((k) => !volatile.has(k) && k !== w.field);
            if (side.length > 0) {
              const watched = await stillMoving(ctx, snap, side, now[0]!);
              if (watched?.again === "gone") effect = { gone: true, changed: [] };
              else {
                if (watched) markVolatile(watched.moving);
                const stays = side.filter((k) => !volatile.has(k));
                if (stays.length > 0) {
                  sideChanges.push(
                    `${joinFields(stays)} of Account A's test record changed after ${WHO[who].words} sent ${at}, though ${
                      w.method === "DELETE" ? "the record is still there" : "the value Run Hound set didn't"
                    }.`,
                  );
                }
              }
            }
          }
          const unswapped = (w.tokens ?? []).filter((t) => !t.swapped).map((t) => t.field);
          const unsent = (w.headerTokens ?? []).filter((t) => !t.swapped).map((t) => t.name);
          // A token of the identity's own that went, read from a page that set the cookie it goes with anew: the replay
          // carries the saved session's cookies, so the app's CSRF check may have refused the pair (0.6.0 round 3).
          const adrift = [...(w.tokens ?? []).map((t) => ({ at: t.field, t })), ...(w.headerTokens ?? []).map((t) => ({ at: t.name, t }))].filter(
            ({ t }) => t.swapped && (t.drifted ?? []).length > 0,
          );
          if (!effect && status !== null && TOKEN_REFUSALS.has(status) && (unswapped.length > 0 || unsent.length > 0 || adrift.length > 0)) {
            const cookies = [...new Set(adrift.flatMap(({ t }) => t.drifted!))];
            const why = [
              ...(unswapped.length > 0 ? [`whose body still carried Account A's anti-CSRF token in ${joinFields(unswapped)}`] : []),
              ...(unsent.length > 0 ? [`sent without the anti-CSRF header the app's own request carried (${joinFields(unsent)})`] : []),
              ...(adrift.length > 0
                ? [
                    `whose ${joinFields(adrift.map(({ at }) => at))} carried ${WHO[who].words}'s own anti-CSRF token, read from a page that set the ${joinFields(cookies)} ${
                      cookies.length === 1 ? "cookie" : "cookies"
                    } anew, which the replay, sent with ${WHO[who].words}'s saved session, may not carry at the same value`,
                  ]
                : []),
            ];
            tokenRefusals.push(`${at} (${status}), ${why.join(" and ")}`);
            if (unswapped.length > 0 || unsent.length > 0) tokenUnmatched = true;
          }
          if (!effect && status === null) noAnswers.push(at);
          if (!effect && status !== null && CONFLICT.has(status)) conflicts.push(`${at} (${status})`);
          // Refused another way while it carried a version the record as read doesn't show (so Run Hound could only
          // send the app's own, stale by now): the refusal may be the version check, not a check of who sent it.
          else if (!effect && status !== null && mayRefuseStale(status) && attempt.staleStamps) {
            staleRefusals.push({ write: `${at} (${status})`, fields: attempt.staleStamps });
          }
          // Accepted, and the record unchanged, but the field Run Hound set isn't one the app's own update sends: an app
          // with a strict schema ignores it, so nothing here shows an ownership check. A refusal (401, 403, 404) still can.
          if (!effect && w.addedField && status !== null && status >= 200 && status < 300) {
            ignoredFields.push({ write: `${at} (${status})`, field: w.field! });
          }
          const dropped = (w.credentials ?? []).filter((c) => !c.swapped).map((c) => c.param);
          if (!effect && who === "other" && (status === 401 || status === 403) && dropped.length > 0) {
            credentialRefusals.push({ write: `${at} (${status})`, params: dropped });
          }
          // Put the record back first, then write the finding up (rendering its evidence takes a while).
          let back = await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned, restoreStamps);
          noteOnce(back.notes);
          if (effect) findings.push(await finding(ctx, scenario, who, attempt, status, findings.length + 1, effect, snap.url, id));
          // A 404, or a 2xx that left the record unchanged, to a write that carried a version the record as read doesn't
          // show: compared with the same write as Account A (compareAsOwner). Not when this attempt already can't pass
          // (it changed something, or wasn't undone).
          const quiet = status === 404 || (status !== null && status >= 200 && status < 300);
          if (!effect && quiet && attempt.staleStamps && sideChanges.length === sideAt && !back.failed && !back.recreated) {
            const cmp = await compareAsOwner(w, attempt, status!);
            back = cmp.back;
            // Account A's copy set the same field the app's own update doesn't send, and the app applied it: the field
            // isn't one a strict schema ignores.
            if (cmp.applied && w.addedField) {
              const at2 = `${at} (${status})`;
              const k = ignoredFields.findIndex((f) => f.write === at2);
              if (k >= 0) ignoredFields.splice(k, 1);
            }
          }
          if (back.failed) {
            if (back.serverOnly) {
              // The record's own values are back; only fields the app sets on every save differ, so the next write
              // is still judged against a record in a known state. The scenario can't pass, but goes on.
              if (leftover === "none") leftover = "server";
              for (const k of back.left) serverLeft.add(k);
            } else {
              leftover = "values";
              if (rest.length > 0) notes.push(`Not tried after a change that couldn't be undone: ${endpoints(rest)}.`);
              break;
            }
          }
          if (back.recreated) {
            // The record made again has a new id, and the app's remaining writes name the old one.
            recreated = true;
            if (rest.length > 0) notes.push(`Not tried after Account A's test record was deleted and created again with a new id: ${endpoints(rest)}.`);
            break;
          }
        }
        // Before the verdict, one more look after a quiet wait when a write the app accepted wasn't the last one looked
        // at that way: its effect may land later still (a queued job). A late change is a finding, and is put back.
        if (sent.some((s) => acceptedOrUnknown(s.status)) && !lookedAfterLast && !unread && leftover !== "values" && !recreated) {
          await delay(LATE_MS);
          const later = await rereadRecord(ctx, snap);
          if (later === null) {
            lateUnread = `Inconclusive: Run Hound couldn't read Account A's test record again a moment after it sent ${tried.join(", ")} as ${WHO[who].words}, so it can't tell whether one of them was applied later: check Account A.`;
          } else {
            const hit = lateHit(sent, later, lastPre, volatile);
            if (hit) {
              const back = await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned, restoreStamps);
              notes.push(lateNote(who, hit.w, hit.status));
              noteOnce(back.notes);
              findings.push(await finding(ctx, scenario, who, hit.w, hit.status, findings.length + 1, hit.effect, snap.url, id));
              if (back.failed) leftover = back.serverOnly ? (leftover === "none" ? "server" : leftover) : "values";
              for (const k of back.serverOnly ? back.left : []) serverLeft.add(k);
            }
          }
        }
      } catch (error) {
        // A write may already have been sent: put the test record back first, then say what may be left.
        const message = error instanceof Error ? error.message : String(error);
        const back = sentAny
          ? await putBack(ctx, snap, lastPre, restoreWith, save, volatile, pinned, restoreStamps).catch(() => PUT_BACK_NOTHING)
          : PUT_BACK_NOTHING;
        noteOnce(back.notes);
        throw new Error([message.replace(/\.?$/, "."), ...sideChanges, ...notes, INTERRUPTED_NOTE].join(" "));
      }
      if (unusableNote) notes.push(unusableNote);

      if (findings.length > 0) {
        return result(
          ID,
          scenario,
          started,
          findings,
          [changedSummary(who, findings), ...sideChanges, ...(unread ? [unread] : []), ...(lateUnread ? [lateUnread] : []), ...notes].join(" "),
        );
      }
      if (lateUnread) return skip([lateUnread, ...sideChanges, ...(unread ? [unread] : []), ...notes].join(" "));
      if (leftover === "values") {
        return skip(
          [
            `Inconclusive: Account A's test record differs from how it was before the test and Run Hound couldn't put all of it back, so it can't call this a pass: check Account A.`,
            ...sideChanges,
            ...notes,
          ].join(" "),
        );
      }
      if (sideChanges.length > 0) {
        // The value a write set held, but the write changed something else of the record: not a confirmed finding (a
        // clean app may stamp a refused attempt, an audit field), and never a pass.
        return skip(
          [
            `Inconclusive: Account A's test record changed while Run Hound sent ${tried.join(", ")} as ${WHO[who].words}, so it can't call this a pass: check Account A.`,
            ...sideChanges,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (leftover === "server") {
        // No write changed a value the test watches, but the record was saved while they were sent: never a pass.
        return skip(
          [
            `Inconclusive: ${joinFields([...serverLeft])} of Account A's test record, which the app sets itself when the record is saved, changed while Run Hound sent ${tried.join(", ")} as ${WHO[who].words}${
              compared.length > 0 ? ` and ${compared.join(", ")} as Account A to compare` : ""
            }, so it can't call this a pass: check Account A.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (tokenRefusals.length > 0) {
        // The app refused a write that carried Account A's token, not one of the identity's own: its CSRF check may be
        // what refused it, so nothing here shows an ownership check. Never a pass.
        return skip(
          [
            `Inconclusive: the app refused ${tokenRefusals.join("; ")}. ${
              who === "signed-out"
                ? "A signed-out visitor has no token of its own to put there"
                : tokenUnmatched
                  ? `Run Hound couldn't match a token of ${WHO[who].words}'s own to the one Account A's request carried`
                  : `Run Hound couldn't send ${WHO[who].words}'s own token with the cookie it goes with`
            }, so the refusal may be the app's CSRF check rather than a check that the record belongs to the sender, and Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (conflicts.length > 0) {
        // A conflict with the record's version (optimistic locking) comes before any check of who sends the write: the
        // record is unchanged, but nothing here shows an ownership check. Never a pass.
        return skip(
          [
            `Inconclusive: the app answered ${conflicts.join(", ")}, a conflict with the test record's version (optimistic locking: a version the record as read doesn't show, or an If-Match) rather than a refusal of ${WHO[who].words}, and Account A's test record was unchanged, so Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (staleRefusals.length > 0) {
        // The same, for an app that refuses a stale version with a validation error or an unhandled one: the write
        // carried the version the app's own update sent, and the record as read doesn't show the current one.
        const fields = [...new Set(staleRefusals.flatMap((s) => s.fields))];
        return skip(
          [
            `Inconclusive: the app refused ${staleRefusals.map((s) => s.write).join(", ")}, which carried ${joinFields(fields)} as the app's own update had sent ${fields.length === 1 ? "it" : "them"}. Run Hound couldn't send the current value (the test record as read doesn't show ${fields.length === 1 ? "it" : "them"}, or never showed the value the app sent), so the refusal may be the app's version check (optimistic locking) rather than a refusal of ${WHO[who].words}. Account A's test record was unchanged, so Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (staleAccepted.length > 0) {
        // The app answered 2xx and changed nothing while the write carried a version Run Hound couldn't refresh: the app
        // may ignore a stale version that way (an update that matched no row). Never a pass.
        const fields = [...new Set(staleAccepted.flatMap((s) => s.fields))];
        const it = fields.length === 1 ? "it" : "them";
        return skip(
          [
            `Inconclusive: the app answered ${staleAccepted.map((s) => s.write).join(", ")} to ${WHO[who].words} and left Account A's test record unchanged, but the write carried ${joinFields(fields)} as the app's own update had sent ${it}. Run Hound couldn't send the current value (the test record as read doesn't show ${it}, or never showed the value the app sent), so the app may have ignored the write for its stale version (an update that matched no row) rather than for who sent it, and Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (noAnswers.length > 0) {
        // No answer came (the connection dropped, or the request timed out) and the record is unchanged: nothing shows
        // that the app refused the sender. Never a pass.
        return skip(
          [
            `Inconclusive: no answer came to ${noAnswers.join(", ")} from ${WHO[who].words} (the connection dropped or timed out), and Account A's test record was unchanged, so Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (credentialRefusals.length > 0) {
        const params = [...new Set(credentialRefusals.flatMap((c) => c.params))];
        return skip(
          [
            `Inconclusive: the app refused ${credentialRefusals.map((c) => c.write).join(", ")}, sent without Account A's credential in its URL (${joinFields(params)}) and with none of Account B's own (no page opened as Account B sent one), so the refusal may be the app asking for a credential rather than a check that the record belongs to the sender, and Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (ignoredFields.length > 0) {
        // The app accepted the write, but the field Run Hound set isn't one its own update sends: a strict schema ignores
        // it, so the record being unchanged shows nothing about who may change it. Never a pass.
        const fields = [...new Set(ignoredFields.map((f) => f.field))];
        return skip(
          [
            `Inconclusive: the app accepted ${ignoredFields.map((f) => f.write).join(", ")} from ${WHO[who].words}, but the field Run Hound set (${joinFields(fields)}) isn't one the app's own update sends, so the app may have ignored it. Account A's test record was unchanged, and Run Hound can't call this a pass.`,
            ...(unread ? [unread] : []),
            ...notes,
          ].join(" "),
        );
      }
      if (unread) return skip([unread, ...(tried.length > 0 ? [`Sent as ${WHO[who].words}: ${tried.join(", ")}.`] : []), ...notes].join(" "));
      const summary = `Account A's test record was unchanged after ${WHO[who].words} sent ${tried.join(", ")}.`;
      return result(ID, scenario, started, [], [summary, ...notes].join(" "));
    });
    return outcome.then((r) => secrets.redact(r)).finally(() => secrets.release());
  },
};
