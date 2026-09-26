/**
 * mass-assignment (0.4.0, docs/v2-spec.md "mass-assignment"): does the server accept fields the form never sends, such
 * as `role` or `plan`? Fills the form as the run account and captures its JSON save, replays that save with the
 * privilege fields added, re-reads the record, and reports the fields the server stored (critical for role/admin, high
 * for plan/billing). Then it restores the fields it changed to their previous values and says what it could not
 * restore. Unticked by default: it changes account A's data and restores it.
 */
import { isLocalOrigin, isSameOrigin } from "../core/saves.js";
import type { Capture, Check, CheckContext, Evidence, Finding, PlanEnv, Scenario, Severity } from "../core/types.js";
import { isDestructiveControl } from "./dead-control.js";
import { endpointOf, errorResult, guarded, result, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, isSearchForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import { findOwnRecord, jsonObjectBody, nearest, parseJson, recordChains, type JsonObject } from "./lib/record-state.js";

const ID = "mass-assignment" as const;

/** The privilege fields Run Hound adds to the form's own save, and the values it injects. */
const INJECTED: Record<string, unknown> = {
  role: "admin",
  isAdmin: true,
  is_admin: true,
  admin: true,
  plan: "pro",
  tier: "pro",
  credits: 999999,
  verified: true,
  emailVerified: true,
};

/** Injected fields that grant admin rights (critical) versus plan/billing/verification fields (high). */
const ADMIN_FIELDS = new Set(["role", "isAdmin", "is_admin", "admin"]);
const VERIFICATION_FIELDS = new Set(["verified", "emailVerified"]);

/** What the accepted non-admin fields are, for the finding's title: "plan or billing", "verification", or both. */
function otherFieldsKind(fields: string[]): string {
  const verification = fields.some((f) => VERIFICATION_FIELDS.has(f));
  const billing = fields.some((f) => !VERIFICATION_FIELDS.has(f));
  return verification && billing ? "plan, billing or verification" : verification ? "verification" : "plan or billing";
}

const q = (v: unknown) => JSON.stringify(v);

/** True when some record of `chains` holds `key` equal to `value`. */
function holds(chains: JsonObject[][], key: string, value: unknown): boolean {
  return chains.some((chain) => {
    const n = nearest(chain, key);
    return n.found && n.value === value;
  });
}

/** The records of `json` holding the test values, or, when none does, its top-level object as the record. */
function recordsOrTop(json: unknown, needles: string[]): JsonObject[][] {
  const chains = recordChains(json, needles);
  if (chains.length > 0) return chains;
  return json !== null && typeof json === "object" && !Array.isArray(json) ? [[json as JsonObject]] : [];
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Card lines from an object body, at most `maxLines`, marking the injected fields. */
function objectLines(obj: Record<string, unknown>, mark: Set<string>, maxLines = 24): { text: string; mark?: boolean }[] {
  const entries = Object.entries(obj);
  const lines = entries.slice(0, maxLines).map(([k, v]) => ({ text: `  ${q(k)}: ${JSON.stringify(v)}`, mark: mark.has(k) }));
  if (entries.length > maxLines) lines.push({ text: `  … ${entries.length - maxLines} more`, mark: false });
  return [{ text: "{" }, ...lines, { text: "}" }];
}

type MakeFinding = (input: {
  title: string;
  severity: Severity;
  confidence: Finding["confidence"];
  meaning: string;
  impact: string;
  fix: string;
  locations: string[];
  evidence: Evidence[];
  specName: string;
  specSource: string;
}) => Finding;

function findings(scenario: Scenario): MakeFinding {
  let n = 0;
  return (input) => {
      n += 1;
      return {
        checkId: ID,
        id: `${ID}#${scenario.id}-${n}`,
        title: input.title,
        severity: input.severity,
        category: "security",
        confidence: input.confidence,
        meaning: input.meaning,
        impact: input.impact,
        fix: input.fix,
        location: input.locations[0]!,
        ...(input.locations.length > 1 ? { locations: input.locations } : {}),
        evidence: input.evidence,
        spec: { filename: `${ID}-${input.specName}.spec.ts`, source: input.specSource },
      };
  };
}

/** A standalone spec: replay the form's save with the privilege fields added and assert the server rejects them. */
function replaySpec(target: string, endpoint: string, fields: string[]): string {
  return [
    `import { test, expect, request } from "@playwright/test";`,
    ``,
    `// Exported by Run Hound. Sign in as your test account first (see the account environment variables).`,
    `const TARGET = ${q(target)};`,
    `const SAVE = ${q(endpoint)}; // the form's own save request`,
    `const PRIVILEGE_FIELDS = ${q(fields)} as unknown as string[];`,
    ``,
    `test("the server ignores privilege fields the form never sends", async () => {`,
    `  const ctx = await request.newContext(); // add your signed-in storage state here`,
    `  const [method, path] = SAVE.split(" ");`,
    `  const body = { /* the values your form sends */ };`,
    `  const injected = { ...body, role: "admin", isAdmin: true, plan: "pro" };`,
    `  const res = await ctx.fetch(new URL(path, TARGET).href, { method, data: injected });`,
    `  const stored = await res.json();`,
    `  for (const field of PRIVILEGE_FIELDS) {`,
    `    expect(JSON.stringify(stored), field + " was accepted from the browser").not.toContain(field);`,
    `  }`,
    `  await ctx.dispose();`,
    `});`,
    ``,
  ].join("\n");
}

export const check: Check = {
  id: ID,
  title: "The server ignores fields the form never sends (role, plan)",
  category: "security",
  scope: "form",
  interruptedNote:
    "If Run Hound had already replayed the save, Account A may still hold the privilege fields it injected (role, plan, isAdmin, …): check Account A.",

  plan(form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn) return [];
    if (isSearchForm(form) || form.fields.length === 0 || !submitControl(form)) return [];
    // Its save is replayed as Account A: never a form whose submit deletes, cancels or signs out (as access-control).
    if (isDestructiveControl(submitControl(form)!)) return [];
    return [
      {
        id: `${ID}:privilege-fields`,
        checkId: ID,
        title: "The server ignores fields the form never sends (role, plan)",
        description:
          "Fill the form as Account A and save it, then replay the same save with privilege fields added (role: admin, plan: pro, …). Re-read the record: any of those fields the server stored is a mass-assignment bug. Run Hound restores what it changed. Off by default: it changes Account A's data.",
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: false,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      const form = ctx.form;
      if (form.fields.length === 0 || !submitControl(form)) {
        return errorResult(ID, scenario, started, "Skipped: this form has no fields to save, so there is nothing to add fields to.", "skipped");
      }
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");

      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving the form as Account A", page);
      const values: FieldValue[] = canaryValues(form, ctx.runToken, "mass");
      await fillForm(page, values);
      await submitForm(page, form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      // The form's own save: a write to this app carrying a JSON object body.
      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter((r) => isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl));
      const save = creates.find((r) => jsonObjectBody(r.postData));
      if (!save) {
        if (creates.length > 0) return skip("Skipped: this form doesn't send JSON, so extra fields can't be added.");
        return skip("Skipped: submitting the form sent no save request, so there was nothing to add fields to.");
      }
      const saveBody = jsonObjectBody(save.postData)!;
      const saveEndpoint = endpointOf(save.method, save.url);

      // Reload, so a GET refetches the record; the record endpoint is a GET whose JSON holds a test value.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues);
      const beforeChains = recordGet ? recordChains(parseJson(recordGet.body), testValues) : [];

      // Replay the save with the privilege fields added. From here on Account A's record may hold injected values, so a
      // failure first puts back what the record held before (putBack). A stop or the time limit ends the scenario from
      // outside, with no chance to do that: the runner adds interruptedNote to its notes instead.
      const injectedBody = { ...saveBody, ...INJECTED };
      const injectedKeys = Object.keys(INJECTED);
      let accepted: string[] = [];
      const notes: string[] = [];
      const make = findings(scenario);
      const found: Finding[] = [];
      // Re-reads the record (null when it can't): a field it didn't hold with the injected value before, and holds
      // now, was accepted.
      const readRecord = async (): Promise<JsonObject[][] | null> => {
        if (!recordGet) return null;
        const answer = await ctx.request("self", { method: "GET", url: recordGet.url }).catch(() => null);
        return answer && answer.status >= 200 && answer.status < 300 ? recordChains(parseJson(answer.body), testValues) : null;
      };
      let settled = false;
      try {
        ctx.step("Replaying the save with privilege fields added", page);
        const replay = await ctx.request("self", { method: save.method, url: save.url, headers: { "content-type": "application/json" }, body: JSON.stringify(injectedBody) });

        if (recordGet) {
          const afterChains = await readRecord();
          if (afterChains === null) {
            settled = true;
            const put = await putBack(ctx, { save, saveBody, beforeChains });
            return errorResult(ID, scenario, started, `Run Hound couldn't read Account A's record back after the replay, so it can't tell which privilege fields the server kept. ${put}`);
          }
          const already = injectedKeys.filter((k) => holds(beforeChains, k, INJECTED[k]));
          accepted = injectedKeys.filter((k) => !already.includes(k) && holds(afterChains, k, INJECTED[k]));
          if (already.length > 0) {
            notes.push(
              `Account A's record already held ${listOf(already)} with the value${already.length === 1 ? "" : "s"} Run Hound injects, so the replay can't show whether the server accepts ${already.length === 1 ? "it" : "them"}.`,
            );
          }

          if (accepted.length === 0) {
            notes.push("The server kept only the fields the form sends; every other injected privilege field was ignored.");
          } else if (afterChains.length > beforeChains.length) {
            // The replay made a new record (a save that creates): the injected fields are on that test record.
            notes.push("The replay created a new test record rather than changing one, so there is nothing to restore: the injected fields are on that test record, which carries the run's test values.");
          } else {
            notes.push(...(await restore(ctx, { save, saveBody, accepted, beforeChains, readRecord, page })));
          }
        } else {
          // No record endpoint: an echo of the injected values in the replay's own answer is an advisory finding.
          const echo = recordsOrTop(parseJson(replay.body), testValues);
          accepted = injectedKeys.filter((k) => holds(echo, k, INJECTED[k]));
          notes.push(
            accepted.length > 0
              ? "No endpoint reads this record back, so this is advisory: the server echoed the injected fields, which suggests it stored them."
              : "The server's answer did not echo the injected fields, and no endpoint reads this record back.",
          );
        }
        settled = true;
      } catch (error) {
        if (settled) throw error;
        settled = true;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message.replace(/\.?$/, ".")} ${await putBack(ctx, { save, saveBody, beforeChains })}`);
      }

      if (accepted.length === 0) {
        return result(ID, scenario, started, [], notes.join(" ") || "The server ignored every injected privilege field.");
      }

      const confidence: Finding["confidence"] = recordGet ? "confirmed" : "advisory";
      const adminAccepted = accepted.filter((k) => ADMIN_FIELDS.has(k));
      const otherAccepted = accepted.filter((k) => !ADMIN_FIELDS.has(k));

      const ownCard = await tryCard(ctx, "The form's own save", {
        title: `${saveEndpoint} (the form's own save)`,
        subtitle: "The fields the form itself sends.",
        lines: objectLines(saveBody, new Set()),
      });
      const injectedCard = await tryCard(ctx, "Replayed with privilege fields added", {
        title: `${saveEndpoint} replayed with privilege fields`,
        subtitle: "The same save, plus fields the form never sends.",
        lines: objectLines(injectedBody, new Set(injectedKeys)),
      });
      const storedCard = await tryCard(ctx, "Fields the server stored", {
        title: recordGet ? "The record after the replay" : "The server's answer to the replay",
        subtitle: recordGet ? "These injected fields were stored (values shown are Run Hound's, not Account A's)." : "These injected fields were echoed back.",
        lines: [{ text: "{" }, ...accepted.map((k) => ({ text: `  ${q(k)}: ${JSON.stringify(INJECTED[k])}  ← ${recordGet ? "stored" : "echoed"}`, mark: true })), { text: "}" }],
        facts: [
          { label: recordGet ? "Fields stored" : "Fields echoed", value: listOf(accepted) },
          { label: "Where", value: recordGet ? endpointOf("GET", recordGet.url) : saveEndpoint },
        ],
      });
      const evidence = [...ownCard, ...injectedCard, ...storedCard];

      // No record endpoint: one medium advisory finding for the echo, since we can't confirm the fields were stored.
      if (!recordGet) {
        found.push(
          make({
            title: `The server echoed privilege fields the form never sends: ${listOf(accepted)}`,
            severity: "medium",
            confidence: "advisory",
            locations: [saveEndpoint],
            meaning: `Run Hound added ${listOf(accepted)} to the form's own save, and the server echoed ${accepted.length === 1 ? "it" : "them"} back. No endpoint reads this record back, so Run Hound can't confirm the fields were stored, but echoing them suggests the server accepts fields the form never sends.`,
            impact: "If these fields are stored, a user could set their own role, plan or verification by editing the save request in their browser. Worth checking by hand, since Run Hound can't read the record back.",
            fix: `Ask your AI or developer: "The save at ${saveEndpoint} echoes ${listOf(accepted)}, which the form never sends. On the server, accept only the fields the form is meant to change and ignore everything else, so role, plan and similar fields can never be set by the client."`,
            evidence,
            specName: "echo-fields",
            specSource: replaySpec(ctx.targetUrl, saveEndpoint, accepted),
          }),
        );
        return result(ID, scenario, started, found, notes.join(" "));
      }

      if (adminAccepted.length > 0) {
        found.push(
          make({
            title: `The server accepted admin fields the form never sends: ${listOf(adminAccepted)} (mass assignment)`,
            severity: "critical",
            confidence,
            locations: [saveEndpoint],
            meaning: `Run Hound added ${listOf(adminAccepted)} to the form's own save, and the server stored ${adminAccepted.length === 1 ? "it" : "them"}. The form never offers ${adminAccepted.length === 1 ? "this field" : "these fields"}, but the server takes whatever the browser sends. Anyone can make themselves an admin by adding one field to a request.`,
            impact: "A normal user can give themselves admin rights, or any other role, by editing the save request in their browser. This is one of the most serious flaws an app can have.",
            fix: `Ask your AI or developer: "The save at ${saveEndpoint} accepts ${listOf(adminAccepted)} from the browser. On the server, accept only the fields the form is meant to change and ignore everything else (an allow-list), so role and admin flags can never be set by the client."`,
            evidence,
            specName: "admin-fields",
            specSource: replaySpec(ctx.targetUrl, saveEndpoint, adminAccepted),
          }),
        );
      }
      if (otherAccepted.length > 0) {
        found.push(
          make({
            title: `The server accepted ${otherFieldsKind(otherAccepted)} fields the form never sends: ${listOf(otherAccepted)}`,
            severity: "high",
            confidence,
            locations: [saveEndpoint],
            meaning: `Run Hound added ${listOf(otherAccepted)} to the form's own save, and the server stored ${otherAccepted.length === 1 ? "it" : "them"}. The form never offers ${otherAccepted.length === 1 ? "this field" : "these fields"}; the server takes whatever the browser sends.`,
            impact: "A user can upgrade their own plan, mark themselves verified or give themselves credits by editing the save request in their browser, bypassing payment or verification.",
            fix: `Ask your AI or developer: "The save at ${saveEndpoint} accepts ${listOf(otherAccepted)} from the browser. On the server, accept only the fields the form is meant to change and ignore everything else, so plan, tier, credits and verification can never be set by the client."`,
            evidence,
            specName: "plan-fields",
            specSource: replaySpec(ctx.targetUrl, saveEndpoint, otherAccepted),
          }),
        );
      }

      return result(ID, scenario, started, found, notes.join(" "));
    });
  },
};

/**
 * After a failure part-way through, when which injected fields the server kept is unknown: sends the save again with
 * every injected field the record held before set back to that value, and says what Account A may still hold.
 */
async function putBack(
  ctx: CheckContext,
  o: { save: Capture["requests"][number]; saveBody: Record<string, unknown>; beforeChains: JsonObject[][] },
): Promise<string> {
  const before = o.beforeChains[0] ?? [];
  const present = Object.keys(INJECTED).filter((k) => nearest(before, k).found);
  const check = "check Account A for injected privilege fields (role, plan, isAdmin, …).";
  if (present.length === 0) return `Run Hound has nothing to put back (the record held none of them before): ${check}`;
  const restoreBody = { ...o.saveBody, ...Object.fromEntries(present.map((k) => [k, nearest(before, k).value])) };
  const sent = await ctx
    .request("self", { method: o.save.method, url: o.save.url, headers: { "content-type": "application/json" }, body: JSON.stringify(restoreBody) })
    .then(
      (answer) => answer.status >= 200 && answer.status < 300,
      () => false,
    );
  return sent
    ? `Run Hound sent ${listOf(present)} back to ${present.length === 1 ? "its previous value" : "their previous values"}; ${check}`
    : `Run Hound couldn't put the previous values back: ${check}`;
}

/**
 * Puts back the accepted fields the record held before (a save that changes a record), re-reads it, and says what
 * happened: what is back to its previous value, what the server kept, and what was not there before (Run Hound can't
 * remove a field).
 */
async function restore(
  ctx: CheckContext,
  o: {
    save: Capture["requests"][number];
    saveBody: Record<string, unknown>;
    accepted: string[];
    beforeChains: JsonObject[][];
    readRecord: () => Promise<JsonObject[][] | null>;
    page: import("playwright").Page;
  },
): Promise<string[]> {
  const before = o.beforeChains[0] ?? [];
  const present = o.accepted.filter((k) => nearest(before, k).found);
  const notRestorable = o.accepted.filter((k) => !present.includes(k));
  const notes: string[] = [];
  if (present.length > 0) {
    const restoreBody = { ...o.saveBody, ...Object.fromEntries(present.map((k) => [k, nearest(before, k).value])) };
    ctx.step("Restoring the fields Run Hound changed", o.page);
    await ctx.request("self", { method: o.save.method, url: o.save.url, headers: { "content-type": "application/json" }, body: JSON.stringify(restoreBody) }).catch(() => undefined);
    const now = (await o.readRecord()) ?? [];
    const back = present.filter((k) => now.some((chain) => { const n = nearest(chain, k); return n.found && n.value === nearest(before, k).value; }));
    const kept = present.filter((k) => !back.includes(k));
    if (back.length > 0) notes.push(`Restored ${listOf(back)} to ${back.length === 1 ? "its previous value" : "their previous values"}.`);
    if (kept.length > 0) {
      notes.push(`${listOf(kept)} still ${kept.length === 1 ? "holds" : "hold"} the injected value: the server didn't take the restore. Check Account A.`);
    }
  }
  if (notRestorable.length > 0) {
    notes.push(`${listOf(notRestorable)} ${notRestorable.length === 1 ? "was" : "were"} not there before; Run Hound can't remove ${notRestorable.length === 1 ? "it" : "them"}: check Account A.`);
  }
  return notes;
}
