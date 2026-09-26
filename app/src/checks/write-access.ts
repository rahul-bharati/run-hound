/**
 * write-access (0.5.0, docs/v2-spec.md "`write-access`"): can another account (B), or a signed-out visitor, change or
 * delete Account A's records? As Account A the scenario saves a new test record through the form, then sends the
 * app's own update for that record (and its delete, only when the app itself showed one) as the other identity. The
 * verdict is a re-read as Account A: a finding only when the record changed or is gone. Then the test record is
 * restored. Only the run's own test record is ever written: never one of Account A's records, never an id found by
 * listing or guessing. Unticked by default: it changes Account A's data and restores it.
 */
import { isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Check, CheckContext, Evidence, Finding, Identity, PlanEnv, Scenario } from "../core/types.js";
import { endpointOf, errorResult, guarded, result, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import {
  changedFields,
  findOwnRecord,
  jsonObjectBody,
  neverWritten,
  recordWrites,
  rereadRecord,
  restoreRecord,
  savesOwnRecord,
  snapshotRecord,
  type CapturedRequest,
  type RecordSnapshot,
} from "./lib/record-state.js";

const ID = "write-access" as const;

const INTERRUPTED_NOTE = "If Run Hound had already sent a write, Account A's test record may still hold the value it changed, or be deleted: check Account A.";

type Who = Exclude<Identity, "self">;

/** "Account B" / "a signed-out visitor", and the title's subject. */
const WHO: Record<Who, { words: string; subject: string }> = {
  other: { words: "Account B", subject: "Account B" },
  "signed-out": { words: "a signed-out visitor", subject: "Signed-out visitors" },
};

/** A value with "wa" inserted right after the run token: still a run-token value, but new and unique. */
function markValue(value: string, key: string, tag: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value}${key}${tag}`;
  return `${value.slice(0, i + key.length)}${tag}${value.slice(i + key.length)}`;
}

/** The body kind of a save, from the body itself (the capture keeps no request headers). */
function kindOf(body: string | null): "json" | "form" | null {
  if (!body) return null;
  if (jsonObjectBody(body)) return "json";
  return /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body) ? "form" : null;
}

const CONTENT_TYPE = { json: "application/json", form: "application/x-www-form-urlencoded" } as const;

/** A write the scenario sends: the app's own update or delete for the test record, with a changed body. */
interface Write {
  method: string;
  url: string;
  /** The body to send (null for a DELETE). */
  body: string | null;
  kind: "json" | "form" | null;
  /** The record field it changes to `value`, for an update. */
  field?: string;
  value?: string;
  /** True when the app itself sent this request for the record; false for the conventional <save URL>/<id> update. */
  observed: boolean;
}

/**
 * The update this scenario sends for the test record: the app's own update for its id when it sent one (the latest
 * body it sent, with the field changed), else the conventional `<save URL>/<id>` (PATCH) with only that field. The id
 * is always the test record's own. Null when there is no text field to change or the save's body can't be rebuilt.
 */
function updateFor(snap: RecordSnapshot, save: CapturedRequest, observed: CapturedRequest | undefined, key: string, tag: string): Write | null {
  const record = snap.record;
  const field = Object.keys(record).find((k) => typeof record[k] === "string" && (record[k] as string).toLowerCase().includes(key));
  if (!field) return null;
  const value = markValue(record[field] as string, key, tag);
  if (observed) {
    const kind = kindOf(observed.postData) ?? kindOf(save.postData);
    if (!kind) return null;
    let body: string;
    if (kind === "json") {
      const sent = jsonObjectBody(observed.postData) ?? {};
      body = JSON.stringify({ ...sent, [field]: value });
    } else {
      const params = new URLSearchParams(observed.postData ?? "");
      params.set(field, value);
      body = params.toString();
    }
    return { method: observed.method.toUpperCase(), url: observed.url, body, kind, field, value, observed: true };
  }
  if (!snap.id) return null;
  const kind = kindOf(save.postData);
  if (!kind) return null;
  const base = new URL(save.url);
  base.search = "";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(String(snap.id.value))}`;
  const body = kind === "json" ? JSON.stringify({ [field]: value }) : new URLSearchParams({ [field]: value }).toString();
  return { method: "PATCH", url: base.href, body, kind, field, value, observed: false };
}

/** Sends `w` as `who`; its status, or null when no answer came. */
async function send(ctx: CheckContext, who: Identity, w: Write): Promise<number | null> {
  const answer = await ctx
    .request(who, { method: w.method, url: w.url, ...(w.body !== null && w.kind ? { headers: { "content-type": CONTENT_TYPE[w.kind] }, body: w.body } : {}) })
    .catch(() => null);
  return answer ? answer.status : null;
}

/** True when the re-read record holds the update's new value (or, for a delete, when the record is gone). */
function tookEffect(w: Write, now: Awaited<ReturnType<typeof rereadRecord>>): boolean {
  if (now === null) return false;
  if (w.method === "DELETE") return now === "gone";
  return now !== "gone" && now[0]![w.field!] === w.value;
}

/** The request the restore puts the record back with: the write itself (its URL names the record's id). */
function asCaptured(w: Write, save: CapturedRequest): CapturedRequest {
  return { ...save, method: w.method, url: w.url, postData: w.body, status: 200 };
}

/** Puts the test record back from a re-read as Account A; the notes say what could not be undone. */
async function putBack(ctx: CheckContext, snap: RecordSnapshot, update: Write | null, save: CapturedRequest): Promise<string[]> {
  const now = await rereadRecord(ctx, snap);
  if (now === null) return ["Run Hound couldn't read Account A's test record back to put it back: check Account A."];
  if (now !== "gone" && changedFields(snap.record, now[0]!).length === 0) return [];
  const how = update && update.method !== "DELETE" ? { save: asCaptured(update, save), create: save } : { save, create: save };
  const { restored, notRestored } = await restoreRecord(ctx, snap, how);
  const notes: string[] = [];
  if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
  if (notRestored.length > 0) notes.push(`Could not be undone: ${notRestored.join(", ")} of Account A's test record: check Account A.`);
  return notes;
}

/** True when `id` appeared in any answer the page got before the save: the form changed an existing record. */
function seenBefore(bodies: string[], id: { key: string; value: string | number }): boolean {
  const needle = `"${id.key}":${JSON.stringify(id.value)}`;
  return bodies.some((b) => b.replace(/\s+/g, "").includes(needle));
}

export const check: Check = {
  id: ID,
  title: "Other accounts can't change Account A's records",
  category: "security",
  scope: "form",
  interruptedNote: INTERRUPTED_NOTE,

  plan(form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn || !savesOwnRecord(form)) return [];
    const scenario = (who: Who, id: string, description: string): Scenario => ({
      id: `${ID}:${id}`,
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
              "other-account",
              "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) as Account B. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
            ),
          ]
        : []),
      scenario(
        "signed-out",
        "signed-out",
        "Save a test record as Account A, then send the app's own update for it (and its delete, if the app shows one) with no session. Re-read as Account A: the record must be unchanged. Run Hound restores the record. Off by default: it changes Account A's data.",
      ),
    ];
  },

  run(ctx, scenario) {
    const who: Who = scenario.id.includes(":other-account") ? "other" : "signed-out";
    return guarded(ID, scenario, ctx, async (started) => {
      const form = ctx.form;
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");
      if (form.fields.length === 0 || !submitControl(form)) return skip("Skipped: this form has no fields that save a record.");

      // 1. As Account A, save a new test record through the form. What the page read before the save tells a new
      // record from one of Account A's existing ones (a profile form changes an existing record).
      const { page, capture } = await ctx.openPage({ as: "self" });
      const before = capture.requests.filter((r) => r.method.toUpperCase() === "GET" && r.responseBody).map((r) => r.responseBody!);
      ctx.step("Saving a test record as Account A", page);
      // Each scenario saves its own test record (its own values), so it never takes the other scenario's for its own.
      const values: FieldValue[] = canaryValues(form, ctx.runToken, who === "other" ? "wab" : "was");
      await fillForm(page, values);
      await submitForm(page, form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter((r) => isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl));
      const save = creates.find((r) => r.postData && r.method.toUpperCase() === "POST") ?? creates.find((r) => r.postData);
      if (!save) return skip("Skipped: submitting the form sent no save request, so there is no test record to protect.");
      if (neverWritten(save.url)) {
        return skip(`Skipped: this form saves to ${endpointOf(save.method, save.url)}, an endpoint Run Hound never writes to (sign-out, password, email, payment, invitations or sharing).`);
      }

      // 2. The record endpoint and a snapshot of the new test record, read as Account A.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true });
      const snap = recordGet ? await snapshotRecord(ctx, recordGet.url, testValues) : null;
      if (!recordGet || !snap) return skip("Skipped: Run Hound couldn't read the saved record back as Account A, so it can't tell whether another write changed it.");
      if (snap.id && seenBefore(before, snap.id)) {
        return skip("Skipped: this form changes a record Account A already had, not a new one, and Run Hound only ever writes to a record it created in this run.");
      }

      // 3. The writes to send: the app's own update for the test record, else the conventional <save URL>/<id> update
      // (proved first as Account A, so a missing endpoint is never a pass); the delete only when the app showed one.
      const key = tokenKey(ctx.runToken);
      const own = recordWrites(capture, snap, ctx.targetUrl);
      const observedUpdate = own.find((r) => r.method.toUpperCase() !== "DELETE");
      const observedDelete = own.find((r) => r.method.toUpperCase() === "DELETE");
      const update = updateFor(snap, save, observedUpdate, key, "wab");
      if (!update || neverWritten(update.url)) return skip("Skipped: Run Hound found no update for the test record it could send.");
      const notes: string[] = [];
      const findings: Finding[] = [];
      try {
        if (!update.observed) {
          const probe = updateFor(snap, save, undefined, key, "waa")!;
          ctx.step(`Updating the test record as Account A (${endpointOf(probe.method, probe.url)})`, page);
          await send(ctx, "self", probe);
          const now = await rereadRecord(ctx, snap);
          const works = tookEffect(probe, now);
          notes.push(...(await putBack(ctx, snap, probe, save)));
          if (!works) {
            return skip(
              [`Skipped: the app showed no update for the test record, and ${endpointOf(probe.method, probe.url)} didn't update it as Account A either, so there is no write to try as ${WHO[who].words}.`, ...notes].join(" "),
            );
          }
        }

        const writes = [update, ...(observedDelete ? [{ method: "DELETE", url: observedDelete.url, body: null, kind: null, observed: true } as Write] : [])];
        const tried: string[] = [];
        for (const w of writes) {
          ctx.step(`Sending ${endpointOf(w.method, w.url)} as ${WHO[who].words}`, page);
          const status = await send(ctx, who, w);
          tried.push(`${endpointOf(w.method, w.url)} (${status ?? "no answer"})`);
          const now = await rereadRecord(ctx, snap);
          if (now === null) {
            notes.push(...(await putBack(ctx, snap, update, save)));
            return skip(
              [`Inconclusive: the re-read as Account A failed after ${endpointOf(w.method, w.url)} was sent as ${WHO[who].words}, so Run Hound can't tell whether it worked: check Account A.`, ...notes].join(" "),
            );
          }
          if (tookEffect(w, now)) {
            findings.push(await finding(ctx, scenario, who, w, status, findings.length + 1));
          }
          notes.push(...(await putBack(ctx, snap, update, save)));
        }
        const summary =
          findings.length > 0
            ? `${WHO[who].subject.replace("visitors", "visitor")} changed Account A's test record: ${findings.map((f) => f.location).join(", ")}.`
            : `Account A's test record was unchanged after ${WHO[who].words} sent ${tried.join(", ")}.`;
        return result(ID, scenario, started, findings, [summary, ...notes].join(" "));
      } catch (error) {
        // A write may already have been sent: put the test record back first, then say what may be left.
        const message = error instanceof Error ? error.message : String(error);
        const put = await putBack(ctx, snap, update, save).catch(() => [] as string[]);
        throw new Error([message.replace(/\.?$/, "."), ...put, INTERRUPTED_NOTE].join(" "));
      }
    });
  },
};

/** The finding for a write `who` got through on Account A's test record. */
async function finding(ctx: CheckContext, scenario: Scenario, who: Who, w: Write, status: number | null, n: number): Promise<Finding> {
  const endpoint = endpointOf(w.method, w.url);
  const deleted = w.method === "DELETE";
  const verb = deleted ? "delete" : "change";
  const title = `${WHO[who].subject} can ${verb} Account A's records`;
  const evidence: Evidence[] = await tryCard(ctx, `${endpoint} as ${WHO[who].words}`, {
    title: `${endpoint} sent as ${WHO[who].words}`,
    subtitle: deleted ? "Re-read as Account A: the record is gone." : `Re-read as Account A: ${w.field} holds the value ${WHO[who].words} sent.`,
    lines: [
      { text: `Sent as: ${WHO[who].words}`, mark: true },
      { text: `Answer: ${status ?? "none"}` },
      { text: deleted ? "Account A's test record was deleted." : `Account A's test record now holds ${WHO[who].words}'s value.`, mark: true },
    ],
    facts: [
      { label: "Request", value: endpoint },
      { label: "Sent as", value: WHO[who].words },
      { label: "Status", value: status === null ? "none" : String(status) },
      ...(w.field ? [{ label: "Field changed", value: w.field }] : []),
    ],
  });
  return {
    checkId: ID,
    id: `${ID}#${scenario.id}-${n}`,
    title,
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: `Run Hound saved a test record as Account A, then sent ${endpoint} as ${WHO[who].words}. Re-reading the record as Account A showed it ${deleted ? "was deleted" : `changed: ${w.field} now holds the value that request sent`}. The server doesn't check that the record belongs to whoever sends the ${deleted ? "delete" : "update"}.`,
    impact:
      who === "other"
        ? `Any signed-in user can ${verb} other users' records by sending their ids (insecure direct object reference).`
        : `Anyone, without signing in, can ${verb} users' records by sending their ids.`,
    fix: `Ask your AI or developer: "${endpoint} must only let the signed-in owner of the record ${verb} it: require a session, look the record up by id AND the session user's id, and answer 404 (or 403) otherwise. The same for every update and delete route."`,
    location: endpoint,
    evidence,
    spec: {
      filename: `${ID}-${who === "other" ? "other-account" : "signed-out"}-${n}.spec.ts`,
      source: replaySpec(ctx.targetUrl, w, who),
    },
  };
}

/**
 * A standalone spec: signs in as Account A (and B) from environment variables, creates nothing itself, and sends the
 * same request as the other identity to a record id you fill in. No value Run Hound typed and no credential is in it.
 */
function replaySpec(target: string, w: Write, who: Who): string {
  const q = (v: unknown) => JSON.stringify(v);
  const url = new URL(w.url);
  return [
    `import { test, expect, request } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Set the accounts' environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD${who === "other" ? ", and the same with _B_" : ""}.`,
    `// RECORD_URL: a record Account A owns (create a test one first), in the form Run Hound used.`,
    `const TARGET = ${q(target)};`,
    `const RECORD_URL = process.env.RECORD_URL ?? ${q(`${url.pathname}${url.search}`)};`,
    `const METHOD = ${q(w.method)};`,
    ``,
    `async function sessionFor(slot: "A" | "B") {`,
    `  const loginUrl = process.env["RUNHOUND_ACCOUNT_" + slot + "_LOGIN_URL"]!;`,
    `  const username = process.env["RUNHOUND_ACCOUNT_" + slot + "_USERNAME"]!;`,
    `  const password = process.env["RUNHOUND_ACCOUNT_" + slot + "_PASSWORD"]!;`,
    `  const ctx = await request.newContext();`,
    `  // Replace with your app's sign-in call; it must set the session cookie or return a token.`,
    `  await ctx.post(new URL("/api/login", loginUrl).href, { data: { username, password } });`,
    `  const state = await ctx.storageState();`,
    `  await ctx.dispose();`,
    `  return state;`,
    `}`,
    ``,
    `test(${q(`${WHO[who].subject} can't ${w.method === "DELETE" ? "delete" : "change"} Account A's records`)}, async () => {`,
    who === "other" ? `  const ctx = await request.newContext({ storageState: await sessionFor("B") });` : `  const ctx = await request.newContext(); // no session`,
    w.method === "DELETE"
      ? `  const res = await ctx.fetch(new URL(RECORD_URL, TARGET).href, { method: METHOD });`
      : `  const res = await ctx.fetch(new URL(RECORD_URL, TARGET).href, { method: METHOD, data: { ${q(w.field)}: "runhound-" + Date.now() } });`,
    `  expect(res.ok(), "the server accepted the write from someone who doesn't own the record").toBe(false);`,
    `  await ctx.dispose();`,
    `});`,
    ``,
  ].join("\n");
}
