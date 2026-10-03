/** csrf orchestrator: plan/run, the four-step scenario (save → snapshot → forge loop → restore and verdict). The forge construction lives in ./forged-bodies.ts, the Account-A re-read and CORS preflight in ./forge-attempt.ts, the probe lifecycle and restore in ./lifecycle.ts, the finding shape and exported spec in ./finding.ts, and the pure predicates and notes in ./csrf.helpers.ts. */

import { carriesTestValues, isLocalOrigin, isSameOrigin, tokenKey } from "../../core/saves.js";
import type { Check, Finding, PlanEnv, Scenario } from "../../core/types.js";
import { crossSitePage, type ForgeEncoding, type ForgeOutcome, type TargetCookie } from "../lib/cross-site.js";
import { redactValues, withoutQueryCredentials, type DroppedParam } from "../lib/cross-site-query.js";
import { TOKEN_FIELD } from "../lib/csrf-tokens.js";
import { endpointOf, errorResult, guarded, result } from "../lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "../lib/functional-form.js";
import {
  editsExistingRecord,
  EXISTING_RECORD,
  findOwnRecord,
  getsBefore,
  holdExistingEdits,
  neverWritten,
  putBackEdited,
  readsBefore,
  readsList,
  recordChains,
  recordWrites,
  savesOwnRecord,
  stoppedByHold,
  type CapturedRequest,
  type JsonObject,
} from "../lib/record-state.js";
import { CSRF_ID, INTERRUPTED_NOTE, MARKER_SUFFIX, OTHER_SITE, SALT } from "../../constants/csrf-constants.js";
import type { ForgeAttempt } from "../../interfaces/csrf.js";
import { forgedBodies, unforgeable } from "./forged-bodies.js";
import { corsAllows, firstRead, ioAsA, readAsA } from "./forge-attempt.js";
import { pickSave, putBack, tokenValues } from "./lifecycle.js";
import { forgedCard, replaySpec } from "./finding.js";
import { answeredOk, listed, queryNote, queryOf, refusesRequest, tried, unplacedWhat, whyNoAnswer } from "./csrf.helpers.js";

const ID = CSRF_ID;

export const check: Check = {
  id: ID,
  title: "A page on another site can't change Account A's data",
  category: "security",
  scope: "form",
  interruptedNote: INTERRUPTED_NOTE,

  plan(form, _page, env?: PlanEnv): Scenario[] {
    if (!env?.signedIn) return [];
    if (!savesOwnRecord(form)) return [];
    return [
      {
        id: `${ID}:cross-site`,
        checkId: ID,
        title: "A page on another site can't change Account A's data",
        description:
          "Save a test record as Account A, then, from a page on a different site (localhost vs 127.0.0.1) opened in Account A's browser, send the same save again with a new value. The browser attaches cookies as it would for a real cross-site request. Re-read as Account A: the forged value must not be stored. Run Hound restores the record. Off by default: it changes Account A's data.",
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
      const skip = (notes: string) => errorResult(ID, scenario, started, notes, "skipped");
      if (form.fields.length === 0 || !submitControl(form)) {
        return skip("Skipped: this form has no fields that save a record, so there is nothing a cross-site page could forge.");
      }

      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      const values: FieldValue[] = canaryValues(form, ctx.runToken, SALT);
      const key = tokenKey(ctx.runToken);
      const tokensBefore = await tokenValues(page, key);
      const hold = await holdExistingEdits(ctx, page, capture);
      try {
        await fillForm(page, values);
        await submitForm(page, form);
        await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);
      } finally {
        await hold.release();
      }
      const stopped = hold.verdict();
      if (stopped) return skip(stopped);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter(
        (r) => (isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl)) && !stoppedByHold(hold, r),
      );
      const posts = creates.filter((r) => r.postData && r.method.toUpperCase() === "POST");
      if (posts.length === 0) {
        if (creates.length > 0) {
          return skip("Skipped: this form's save isn't a POST (a cross-site page can only send a GET or a POST without a preflight), so it can't be forged from another site.");
        }
        return skip("Skipped: submitting the form sent no save request, so there was nothing a cross-site page could forge.");
      }
      const carrying = posts.filter((r) => carriesTestValues(r.postData, ctx.runToken));
      const candidates = carrying.length > 0 ? carrying : posts;
      const tokensAfter = await tokenValues(page, key);
      const tokens = new Set([...tokensBefore.all, ...tokensAfter.all]);
      const placedTokens = new Set([...tokensBefore.placed, ...tokensAfter.placed]);
      const clean = (url: string) => withoutQueryCredentials(url, tokens, key);
      const endpoint = (r: CapturedRequest) => endpointOf(r.method, clean(r.url).url);
      const neverAt = candidates.find((r) => neverWritten(r.url));
      if (neverAt) {
        return skip(`Skipped: this form saves to ${endpoint(neverAt)}, an endpoint Run Hound never writes to from another site (sign-out, password, email, payment, invitations or sharing).`);
      }

      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true });
      const reached = [...new Set(creates.filter((r) => r.status !== null).map(endpoint))];
      const reachedNote =
        reached.length > 0
          ? ` The form's own save (${listed(reached)}) reached the app, and without a read Run Hound can't tell whether it changed a record Account A already had: check Account A.`
          : "";
      if (!recordGet) {
        return skip(`Skipped: Run Hound couldn't find an endpoint that reads the saved record back as Account A, so it can't tell whether a forged write worked.${reachedNote}`);
      }
      const first = await firstRead(ctx, page, recordGet.url, testValues);
      if (!first) {
        return skip(`Skipped: Run Hound couldn't read the test record back as Account A, so it can't tell whether a forged write worked.${reachedNote}`);
      }
      const { via, snap } = first;
      const { save, tied } = pickSave(candidates, capture.requests, testValues, snap);
      const saveEndpoint = endpoint(save);
      const heldBefore = hold.before();
      const before = heldBefore.length > 0 ? heldBefore : getsBefore(capture, save);
      const reads = heldBefore.length > 0 ? hold.reads() : readsBefore(capture, save);
      if (editsExistingRecord(save, snap, recordGet, before, ctx.runToken, reads)) {
        ctx.step("Putting back the record the form changed", page);
        return skip([EXISTING_RECORD, ...(await putBackEdited(ctx, { capture, save, snap, before, io: ioAsA(ctx, page, via) }))].join(" "));
      }
      const updates = recordWrites(capture, snap, ctx.targetUrl).filter((r) => r.method.toUpperCase() !== "DELETE");

      const marker = `${key}${MARKER_SUFFIX}`;
      const forgedUrl = clean(save.url);
      const recordUrl = clean(recordGet.url);
      const secrets = [...new Set([...forgedUrl.values, ...recordUrl.values])];
      const hide = (text: string) => (secrets.length > 0 ? redactValues(text, secrets) : text);
      const saveParams = queryOf(save.url);
      const urlDropped: DroppedParam[] = forgedUrl.dropped.map((d) => {
        if (d.kind !== "csrf" || TOKEN_FIELD.test(d.name)) return d;
        const vs = saveParams.filter(([n, v]) => n === d.name && v !== "").map(([, v]) => v);
        return vs.length > 0 && vs.every((v) => !placedTokens.has(v)) ? { ...d, kind: "secret" as const } : d;
      });
      const placedUrl = saveParams.filter(([n]) => urlDropped.some((d) => d.name === n && d.kind !== "secret")).map(([, v]) => v);
      const bodies = forgedBodies(save, key, new Set([...tokens, ...forgedUrl.values]), new Set([...placedTokens, ...placedUrl]), tokens);
      if (!bodies) return skip(`Skipped: ${unforgeable(save.postData)}`);
      const cross = await crossSitePage(ctx, ctx.targetUrl);
      if ("inconclusive" in cross) {
        return errorResult(ID, scenario, started, `Inconclusive. ${cross.inconclusive}`, "skipped");
      }

      const wasJson = bodies.kind === "json";
      const cors = wasJson ? await corsAllows(ctx, forgedUrl.url, cross.origin) : false;
      const loopbackOnly = cors && !(await corsAllows(ctx, forgedUrl.url, OTHER_SITE));
      const attempts: { encoding: ForgeEncoding; body: string; note: string }[] =
        bodies.kind === "multipart"
          ? [{ encoding: "multipart", body: bodies.form, note: "multipart form" }]
          : [
              { encoding: "form", body: bodies.form, note: "form-encoded" },
              ...(wasJson ? [{ encoding: "text" as ForgeEncoding, body: bodies.json!, note: "JSON sent as text/plain" }] : []),
              ...(cors
                ? [{ encoding: "json" as ForgeEncoding, body: bodies.json!, note: `JSON (the app's CORS allows this origin with credentials${loopbackOnly ? ", as it allows loopback origins" : ""})` }]
                : []),
            ];
      const ownEncoding: ForgeEncoding = bodies.kind === "multipart" ? "multipart" : wasJson ? "json" : "form";

      const runRecords = (json: unknown) => (key ? recordChains(json, [key]).map((c) => c[0]!) : []);
      const idKey = snap.id?.key;
      const firstRun = runRecords(first.json);
      const firstIds = new Set(idKey ? firstRun.map((r) => JSON.stringify(r[idKey])) : []);
      const fresh = (json: unknown): boolean => {
        const now = runRecords(json);
        return idKey ? now.some((r: JsonObject) => r[idKey] !== undefined && !firstIds.has(JSON.stringify(r[idKey]))) : now.length > firstRun.length;
      };

      const cookies: TargetCookie[] = await cross.targetCookies();
      const sent: ForgeAttempt[] = [];
      let stored: ForgeAttempt | null = null;
      let storedAsNew = false;
      let rereadFailed = false;
      try {
        for (const attempt of attempts) {
          ctx.step(`Sending the forged save from another site (${attempt.note})`, page);
          const outcome = await cross.forge({ method: "POST", url: forgedUrl.url, body: attempt.body, encoding: attempt.encoding });
          sent.push({ note: attempt.note, encoding: attempt.encoding, outcome });
          const read = await readAsA(ctx, page, recordGet.url, via);
          if (read === null) {
            rereadFailed = true;
            break;
          }
          if (read !== "gone" && recordChains(read.json, [marker]).length > 0) {
            stored = sent[sent.length - 1]!;
            break;
          }
          if (read !== "gone" && answeredOk(outcome) && fresh(read.json)) {
            stored = sent[sent.length - 1]!;
            storedAsNew = true;
            break;
          }
          if (outcome.status === null) break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const put = sent.length > 0 ? await putBack(ctx, page, { snap, updates, create: save, marker, via, fresh }).catch(() => [] as string[]) : [];
        throw new Error(hide([message.replace(/\.?$/, "."), ...put, sent.length > 0 ? INTERRUPTED_NOTE : ""].filter(Boolean).join(" ")));
      } finally {
        await cross.dispose();
      }

      const restoreNotes = stored || rereadFailed ? await putBack(ctx, page, { snap, updates, create: save, marker, via, fresh }) : [];
      const named = bodies.dropped.filter((k) => !bodies.unplaced.includes(k));
      const droppedNote = [
        named.length > 0
          ? `The forged body left out ${named.join(", ")}, which carr${named.length === 1 ? "ies" : "y"} Account A's anti-CSRF token: a page on another site can't know it.`
          : "",
        bodies.unplaced.length > 0 ? `${named.length > 0 ? "It also left out" : "The forged body left out"} ${unplacedWhat(bodies.unplaced, bodies.urlOnly)}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const urlNote = queryNote(urlDropped);
      const credentials = urlDropped.filter((d) => d.kind === "credential").map((d) => d.name);

      if (stored && stored.outcome.cookies.length === 0 && credentials.length > 0) {
        const how = stored.outcome.cookiesSeen ? "with no cookie attached" : "and Run Hound didn't see the app's answer, so it can't tell which cookies the browser attached";
        return skip(
          hide(
            [
              `Inconclusive: the save's URL carried Account A's credential (${listed(credentials)}), which Run Hound left out of the forged request, and the forged ${stored.note} request from ${cross.origin} was still stored ${how}, so Run Hound can't tell what signed it in as Account A: check who may send ${saveEndpoint}.`,
              droppedNote,
              ...restoreNotes,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }

      if (stored && stored.encoding === "json" && loopbackOnly) {
        const evidence = await forgedCard(ctx, saveEndpoint, stored.note, stored.outcome, cookies, bodies);
        const finding: Finding = {
          checkId: ID,
          id: `${ID}#${scenario.id}-1`,
          title: "Another local origin can change Account A's data (CORS trusts loopback origins)",
          severity: "medium",
          category: "security",
          confidence: "advisory",
          meaning:
            `Run Hound opened a page on ${cross.origin} in Account A's browser and sent ${saveEndpoint} again as JSON with a new value, and re-reading the record as Account A showed it: the app's CORS answer allows that origin with credentials. ` +
            `The same preflight from ${OTHER_SITE} was refused, so the allowlist trusts loopback origins (localhost and 127.0.0.1, on any port) rather than only the app's own origin. ` +
            "Only a page served from Account A's own machine (another local app or dev server) can send this save, so this is advisory.",
          impact: "Any other app or tool Account A runs on localhost or 127.0.0.1 could change Account A's data through this save, without Account A submitting the form.",
          fix: `Ask your AI or developer: "The CORS config for ${saveEndpoint} allows every localhost and 127.0.0.1 origin with credentials. Allow only the app's own origin (its exact scheme, host and port), and add a CSRF defence: a SameSite=Lax (or Strict) session cookie plus a CSRF token or an Origin check."`,
          location: saveEndpoint,
          evidence,
        };
        const notes = [`The forged ${stored.note} request from ${cross.origin} was stored.`, urlNote, droppedNote, ...restoreNotes].filter(Boolean).join(" ");
        const hidden: Finding = { ...finding, title: hide(finding.title), meaning: hide(finding.meaning), fix: hide(finding.fix), location: hide(finding.location ?? "") };
        return result(ID, scenario, started, [hidden], hide(notes));
      }

      if (stored) {
        const carried = stored.outcome.cookies;
        const seen = stored.outcome.cookiesSeen;
        const sameSite = (name: string) => cookies.find((c) => c.name === name)?.sameSite ?? "unknown";
        const mayRide = cookies.filter((c) => c.sameSite === "None").map((c) => c.name);
        const why = !seen
          ? `Run Hound didn't see the app's answer to the forged request, so it can't say which of Account A's cookies the browser attached${mayRide.length > 0 ? ` (Account A's browser holds ${listed(mayRide.map((n) => `${n} (SameSite=None)`))}, which a browser attaches to a request from another site)` : ""}; either way the server stored a request from another site with no CSRF token and no Origin check`
          : carried.length > 0
            ? `the browser attached Account A's cookie${carried.length === 1 ? "" : "s"} ${carried.map((n) => `${n} (SameSite=${sameSite(n)})`).join(", ")} to a request from another site, and the server accepted it with no CSRF token and no Origin check`
            : "the server stored the value in Account A's data although the browser attached no cookie to the request at all: the save doesn't need Account A's session, and it has no CSRF token or Origin check";
        const viaCors = stored.encoding === "json";
        const noSession = seen && carried.length === 0;
        const checkSession = seen ? "" : `Make sure it requires Account A's session (answer 401 without it). `;
        const requireSession = `Require Account A's session on ${saveEndpoint} (answer 401 without it, and save only to the signed-in account's own records), then add a CSRF defence`;
        const evidence = await forgedCard(ctx, saveEndpoint, stored.note, stored.outcome, cookies, bodies);
        const finding: Finding = {
          checkId: ID,
          id: `${ID}#${scenario.id}-1`,
          title: noSession
            ? "A page on another site can change Account A's data (the save needs no session)"
            : "A page on another site can change Account A's data (no CSRF protection)",
          severity: "high",
          category: "security",
          confidence: "confirmed",
          meaning:
            `Run Hound opened a page on a different site (${cross.origin}) in Account A's browser and sent ${saveEndpoint} again with a new value (${stored.note}). ` +
            (storedAsNew
              ? `Re-reading Account A's records showed a new record carrying the run's test values that only the forged request could have made (the app stored it with the value changed): ${why}.`
              : `Re-reading the record as Account A showed the new value: ${why}.`) +
            (viaCors ? " The app's CORS answer allows that origin with credentials, which is also a CORS issue (cors): any site can send this JSON save and read the answer." : ""),
          impact: noSession
            ? "Any web page Account A visits, or anyone at all, can make this change (or any other this form makes) in Account A's data without Account A's session: the save doesn't check who sends it. A page on another site can do it silently, without Account A ever submitting the form."
            : "Any web page Account A visits could silently make this change (or any other this form makes) on their behalf, without them ever submitting the form. This is a cross-site request forgery (CSRF) flaw.",
          fix: noSession
            ? viaCors
              ? `Ask your AI or developer: "The save at ${saveEndpoint} changes Account A's data with no session at all, and it can be sent from another site: the CORS config reflects any origin with Access-Control-Allow-Credentials. ${requireSession}: allow only your own origins in CORS, and for a cookie session use a SameSite=Lax (or Strict) cookie plus a CSRF token or an Origin check."`
              : `Ask your AI or developer: "The save at ${saveEndpoint} changes Account A's data with no session at all: a request from another site with no cookie and no token was stored. ${requireSession} for a cookie session: a SameSite=Lax (or Strict) cookie, plus a per-request CSRF token the server checks, or an Origin/Referer check that rejects requests from other sites."`
            : viaCors
              ? `Ask your AI or developer: "The save at ${saveEndpoint} can be sent from another site: the CORS config reflects any origin with Access-Control-Allow-Credentials. ${checkSession}Allow only your own origins, and add a CSRF defence: a SameSite=Lax (or Strict) session cookie plus a CSRF token or an Origin check."`
              : `Ask your AI or developer: "The save at ${saveEndpoint} can be sent from another site. ${checkSession}Add a CSRF defence: a SameSite=Lax (or Strict) session cookie, plus a per-request CSRF token the server checks, or an Origin/Referer check that rejects requests from other sites. Accept only application/json for JSON saves."`,
          location: saveEndpoint,
          evidence,
          spec: {
            filename: `${ID}-cross-site.spec.ts`,
            source: replaySpec({
              target: ctx.targetUrl,
              save: forgedUrl.url,
              record: recordUrl.url,
              saveLeftOut: urlDropped.map((d) => d.name),
              recordLeftOut: recordUrl.dropped.map((d) => d.name),
              fields: bodies.fields,
              marked: bodies.marked,
              encoding: stored.encoding,
              attackerOrigin: cross.origin,
              tokenSession: via === "request" && cookies.length === 0,
              headerRead: via === "request",
            }),
          },
        };
        const notes = [`The forged ${stored.note} request from ${cross.origin} was stored.`, urlNote, droppedNote, ...restoreNotes].filter(Boolean).join(" ");
        const hidden: Finding = { ...finding, title: hide(finding.title), meaning: hide(finding.meaning), fix: hide(finding.fix), location: hide(finding.location ?? "") };
        return result(ID, scenario, started, [hidden], hide(notes));
      }

      if (rereadFailed) {
        return skip(
          hide(
            [
              "Inconclusive: the re-read as Account A failed after the forged request was sent, so Run Hound can't tell whether it was stored: check Account A.",
              ...restoreNotes,
            ].join(" "),
          ),
        );
      }

      const unanswered = sent.filter((a) => a.outcome.status === null);
      if (unanswered.length > 0 && unanswered.every((a) => !a.outcome.sent)) {
        return skip(
          hide(
            [
              `Inconclusive: the browser couldn't send the forged ${listed(unanswered.map((a) => a.note))} request from ${cross.origin} (${listed([...new Set(unanswered.map((a) => a.outcome.failure ?? "no reason given"))])}), so Run Hound can't tell whether the app takes a request from another site.`,
              `Tried: ${tried(sent)}.`,
              urlNote,
              droppedNote,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }
      if (unanswered.length > 0) {
        const late = unanswered.some((a) => a.outcome.unanswered !== "failed");
        return skip(
          hide(
            [
              `Inconclusive: the app didn't answer the forged ${listed(unanswered.map((a) => a.note))} request from ${cross.origin} (${listed([...new Set(unanswered.map((a) => whyNoAnswer(a.outcome)))])}), and re-reading as Account A shows nothing it sent stored yet. The app may still store it${late ? " when it answers" : ""}, so this is not a pass: check Account A (a record the forged request made carries this run's test values).`,
              `Tried: ${tried(sent)}.`,
              urlNote,
              droppedNote,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }

      const unseen = sent.filter((a) => answeredOk(a.outcome));
      if (unseen.length > 0 && !readsList(first.json, snap.record)) {
        return skip(
          hide(
            `Inconclusive: the app answered the forged ${tried(unseen)} request from ${cross.origin}, and the record endpoint reads only the test record, so Run Hound can't see whether the forged request created a new one: check Account A.`,
          ),
        );
      }

      const valueRefused = sent.filter((a) => a.encoding === ownEncoding && a.outcome.status === 400 && a.outcome.cookies.length > 0);
      if (valueRefused.length > 0 && bodies.dropped.length === 0 && urlDropped.length === 0) {
        const names = [...new Set(valueRefused.flatMap((a) => a.outcome.cookies))];
        return skip(
          hide(
            [
              `Inconclusive: the app answered the forged ${tried(valueRefused)} request from ${cross.origin} with 400 although the browser attached Account A's cookie${names.length === 1 ? "" : "s"} ${listed(names)}. A 400 refuses the forged value, not a request from another site, so Run Hound can't tell whether a forge with a value the app accepts would be stored: check who may send ${saveEndpoint}.`,
              `Tried: ${tried(sent)}.`,
            ].join(" "),
          ),
        );
      }

      const tokenSession = via === "request" && cookies.length === 0 && sent.every((a) => a.outcome.cookies.length === 0);
      const rode = (a: ForgeAttempt) => a.outcome.cookies.length > 0 || (!a.outcome.cookiesSeen && cookies.length > 0);
      const unsure = bodies.unplaced.length > 0 && sent.some(rode);
      const passNote = tokenSession
        ? `A page on ${cross.origin} could not change Account A's data: Account A's session is a token the app's own scripts add to each request (such as a bearer token), not a cookie, so there is no cookie for the browser to attach to a request from another site, and the forged save wasn't stored.` +
          (wasJson && !cors ? " The save is also sent as JSON, which needs a preflight from another site." : "")
        : wasJson
          ? `A page on ${cross.origin} could not change Account A's data. The save is sent as JSON, which needs a preflight from another site${cors ? "" : " (the app's CORS doesn't allow that origin)"}, and the app didn't take the forged save otherwise.`
          : sent.some((a) => a.outcome.status !== null && answeredOk(a.outcome))
            ? `A page on ${cross.origin} could not change Account A's data: the app answered the forged cross-site request as if it succeeded, but re-reading as Account A shows nothing it sent was stored.`
            : unsure
              ? `A page on ${cross.origin} could not change Account A's data: the app refused the forged cross-site request although it carried Account A's cookie, with an answer a missing value doesn't usually explain (403, 419, 401, 415 or a redirect to sign-in). Run Hound takes that for a defence, but it left out a random value it can't place (below), so it can't rule out that the app refused a missing value the save needs instead.`
              : `A page on ${cross.origin} could not change Account A's data: the forged cross-site request was rejected or had no effect (a SameSite cookie, a CSRF token or an Origin check stopped it).`;
      const triedNote = `Tried: ${tried(sent)}.`;

      if (!tied) {
        const others = candidates.filter((r) => r !== save).map(endpoint);
        return skip(
          hide(
            [
              `Inconclusive: the form sent ${candidates.length} POSTs that carry the typed values (${listed([...new Set([...others, saveEndpoint])])}), and no answer ties one of them to the test record, so Run Hound forged the last one sent before the record appeared (${saveEndpoint}). A page on ${cross.origin} could not change Account A's data through it, but another of them may be the save, so this is not a pass.`,
              triedNote,
              urlNote,
              droppedNote,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }

      const unplaced = urlDropped.filter((d) => d.kind === "secret").map((d) => d.name);
      if (unplaced.length > 0 && sent.some((a) => a.outcome.cookies.length > 0 || (!a.outcome.cookiesSeen && cookies.length > 0))) {
        return skip(
          hide(
            [
              `Inconclusive: the save's URL carries ${listed(unplaced)}, a random value the app's own page added that Run Hound can't place (a token, or an identifier a page on another site could know). Run Hound left it out, and the forged request from ${cross.origin} ${sent.some((a) => a.outcome.cookies.length > 0) ? "carried Account A's cookie" : "may have carried Account A's cookie (Run Hound didn't see the app's answer)"} and wasn't stored, so it can't tell whether a CSRF defence or the missing value stopped it.`,
              triedNote,
              droppedNote,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }

      const refByStatus = (o: ForgeOutcome) => bodies.references.length > 0 && o.status === 403;
      const byValue = sent.filter((a) => rode(a) && (!refusesRequest(a.outcome) || refByStatus(a.outcome)));
      if (bodies.unplaced.length > 0 && byValue.length > 0) {
        const carried = byValue.some((a) => a.outcome.cookies.length > 0);
        const refs = bodies.references;
        const refNote = byValue.some((a) => refByStatus(a.outcome))
          ? ` ${listed(refs)} ${refs.length === 1 ? "looks" : "look"} like a reference (an id-like name, a UUID or an ObjectId), and an authorization check answers a missing or foreign reference with 403 as readily as a CSRF defence answers a request from another site.`
          : "";
        return skip(
          hide(
            [
              `Inconclusive: the forged body left out ${unplacedWhat(bodies.unplaced, bodies.urlOnly)}. The forged ${tried(byValue)} request from ${cross.origin} ${carried ? "carried Account A's cookie" : "may have carried Account A's cookie (Run Hound didn't see which cookies rode on it)"} and wasn't stored, and an app answers a missing or bad value that way as readily as a request from another site, so Run Hound can't tell whether a CSRF defence or the missing value stopped it: check who may send ${saveEndpoint}.${refNote}`,
              triedNote,
              urlNote,
              named.length > 0
                ? `The forged body also left out ${named.join(", ")}, which carr${named.length === 1 ? "ies" : "y"} Account A's anti-CSRF token: a page on another site can't know it.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          ),
        );
      }

      const notes = [passNote, triedNote, urlNote, droppedNote].filter(Boolean).join(" ");
      return result(ID, scenario, started, [], hide(notes));
    });
  },
};