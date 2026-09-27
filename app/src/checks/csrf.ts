/**
 * csrf (0.5.0, docs/v2-spec.md "`csrf`"): can a page on another site make Account A's browser change Account A's data?
 * A real browser page on a different *site* from the target (localhost vs 127.0.0.1) submits the save this form makes
 * for the run's test record, with a new run-token value, in Account A's own browser context. The browser attaches
 * cookies for itself, so a SameSite=Lax cookie stays home and a SameSite=None cookie rides along. Only requests a
 * cross-site page can send without a CORS preflight are sent (form-encoded, then a JSON save's payload as text/plain;
 * a JSON body only when the app's own answer to a real preflight allows the attacker origin with credentials), and
 * never with a CSRF token. The verdict is a re-read as Account A (through A's own browser page for a cookie session,
 * through CheckContext.request and the app's own credential headers for a session its scripts send as a header, such
 * as a bearer token kept in sessionStorage): a finding only when the forged value is stored; a failed re-read is
 * inconclusive, never a pass. Then the test record is restored, only through an update the app
 * itself sent for it (through Account A's own page when the request context can't carry the session: a Secure cookie
 * on 127.0.0.1). A form that edits a record Account A already had is never used, as in write-access: its save is held
 * in the page and stopped before it reaches the app, and one that went through and only then shows it changed such a
 * record is put back and skipped before anything is forged. Unticked by default: it changes Account A's data and
 * restores it.
 */
import { isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Page } from "playwright";
import type { Check, CheckContext, Evidence, Finding, PlanEnv, Scenario } from "../core/types.js";
import { crossSitePage, type ForgeEncoding, type ForgeOutcome, type TargetCookie } from "./lib/cross-site.js";
import { endpointOf, errorResult, guarded, result, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import {
  changedFields,
  changesOnSave,
  editsExistingRecord,
  EXISTING_RECORD,
  findOwnRecord,
  getsBefore,
  holdExistingEdits,
  jsonObjectBody,
  locateRecord,
  neverWritten,
  putBackEdited,
  readsList,
  recordChains,
  recordWrites,
  requestIO,
  restoreRecord,
  savesOwnRecord,
  snapshotFrom,
  stoppedByHold,
  type CapturedRequest,
  type RecordIO,
  type RecordSnapshot,
} from "./lib/record-state.js";

const ID = "csrf" as const;

const INTERRUPTED_NOTE =
  "If Run Hound had already sent the forged request, Account A's test record may still hold the value it changed: check Account A.";

/**
 * Body fields that carry an anti-CSRF token (a hidden `_csrf`, `authenticity_token` or `__RequestVerificationToken`
 * input, a `csrfToken`/`_token` JSON key). A page on another site can't know Account A's token, so the forged body
 * never carries one: it is left out, and the notes say so.
 */
const TOKEN_FIELD = /csrf|xsrf|authenticity_token|requestverificationtoken|^_token$/i;

/** A body encoded as `application/x-www-form-urlencoded` (name=value pairs joined by "&"), judged from the body itself. */
function looksFormEncoded(body: string | null | undefined): body is string {
  return Boolean(body) && /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body!);
}

/** A value with "csrf" inserted right after the run token, so it still carries the token but is a new, unique value. */
function markValue(value: string, key: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value}${key}csrf`;
  return `${value.slice(0, i + key.length)}csrf${value.slice(i + key.length)}`;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The forged bodies of a save, the field that carries the forged value, and the token fields left out. */
interface ForgedBodies {
  /** Form-encoded: for a form post, and for a JSON save's form-encoded attempt (its top-level fields). */
  form: string;
  /** The JSON payload (a JSON save only): sent as text/plain, or as JSON when CORS allows it. */
  json?: string;
  /** The field whose value was changed to the forged one. */
  marked: string;
  /** The fields the forged body keeps (token fields left out), in order. */
  fields: string[];
  /** Fields left out because they carry an anti-CSRF token. */
  dropped: string[];
}

/**
 * The forged bodies for `save`, with one run-token field changed to a new value that carries `marker`. Every field that
 * carries an anti-CSRF token is left out: by name (TOKEN_FIELD), or by value (`tokens`, the token values the app gave
 * Account A's page), since a page on another site can't read them. Null when the body is neither JSON nor form-encoded
 * (a multipart body can't be rebuilt without its headers).
 */
function forgedBodies(save: CapturedRequest, key: string, tokens: Set<string>): ForgedBodies | null {
  const isToken = (k: string, v: unknown) => TOKEN_FIELD.test(k) || (typeof v === "string" && v !== "" && tokens.has(v));
  let entries: [string, unknown][];
  const json = jsonObjectBody(save.postData);
  if (json) entries = Object.entries(json);
  else if (looksFormEncoded(save.postData)) entries = [...new URLSearchParams(save.postData)];
  else return null;

  const dropped = [...new Set(entries.filter(([k, v]) => isToken(k, v)).map(([k]) => k))];
  const kept = entries.filter(([k, v]) => !isToken(k, v));
  // The field that carries the forged value: the first run-token value, else the first text value.
  const withToken = kept.findIndex(([, v]) => typeof v === "string" && v.toLowerCase().includes(key));
  const at = withToken >= 0 ? withToken : kept.findIndex(([, v]) => typeof v === "string");
  if (at < 0) return null;
  const forged = kept.map(([k, v], i): [string, unknown] => [k, i === at ? markValue(v as string, key) : v]);
  const params = new URLSearchParams();
  for (const [k, v] of forged) params.append(k, asText(v));
  return {
    form: params.toString(),
    ...(json ? { json: JSON.stringify(Object.fromEntries(forged)) } : {}),
    marked: forged[at]![0],
    fields: [...new Set(forged.map(([k]) => k))],
    dropped,
  };
}

/**
 * Anti-CSRF token values the app gave Account A: a <meta> whose name says csrf/xsrf (Rails, Laravel, Django templates)
 * and a cookie whose name does (double-submit cookies). Held in memory only, to leave them out of the forged body;
 * never put in a page Run Hound serves, never written anywhere.
 */
async function tokenValues(page: Page): Promise<Set<string>> {
  const meta = await page
    .evaluate(() =>
      [...document.querySelectorAll("meta[name]")]
        .filter((m) => /csrf|xsrf/i.test(m.getAttribute("name") ?? ""))
        .map((m) => m.getAttribute("content") ?? ""),
    )
    .catch(() => [] as string[]);
  const cookies = await page
    .context()
    .cookies()
    .catch(() => []);
  return new Set([...meta, ...cookies.filter((c) => /csrf|xsrf/i.test(c.name)).map((c) => c.value)].filter(Boolean));
}

/** A read of the record endpoint as Account A: its JSON, "gone" for a 404 or 410, null when the read failed. */
type Reread = { json: unknown } | "gone" | null;

/** A record endpoint's answer as a Reread. */
function asReread(answer: { status: number; body: string } | null): Reread {
  if (!answer) return null;
  if (answer.status === 404 || answer.status === 410) return "gone";
  if (answer.status < 200 || answer.status >= 300) return null;
  try {
    return { json: JSON.parse(answer.body) as unknown };
  } catch {
    return null;
  }
}

/**
 * GETs the record endpoint from Account A's own browser page. The re-read of a cookie session goes through the browser,
 * not CheckContext.request, on purpose: a SameSite=None cookie is `Secure`, and the request context does not send a
 * `Secure` cookie over http to 127.0.0.1, while the browser does (localhost and 127.0.0.1 are potentially
 * trustworthy). So this is a real re-read as Account A, as long as A's session is a cookie.
 */
async function readInPage(page: Page, url: string): Promise<Reread> {
  const answer = await page
    .evaluate(async (u) => {
      const res = await fetch(u, { credentials: "include" });
      return { status: res.status, body: await res.text() };
    }, url)
    .catch(() => null);
  return asReread(answer);
}

/**
 * GETs the record endpoint through CheckContext.request as Account A, which sends the credential headers the app's own
 * pages sent (an `Authorization: Bearer` token the app's scripts add from sessionStorage or localStorage). A bare fetch
 * in the page carries A's cookies but never such a header, so on an app whose session is a token it can't read as A.
 */
async function readThroughRequest(ctx: CheckContext, url: string): Promise<Reread> {
  const answer = await ctx.request("self", { method: "GET", url }).catch(() => null);
  return asReread(answer);
}

/**
 * How the check reads as Account A, picked once by the first read (firstRead) and kept for every re-read and the
 * put-back: "page" (A's cookies, through its browser page) or "request" (the app's own credential headers).
 */
type ReadVia = "page" | "request";

const readAsA = (ctx: CheckContext, page: Page, url: string, via: ReadVia): Promise<Reread> =>
  via === "page" ? readInPage(page, url) : readThroughRequest(ctx, url);

/** Sends a write from Account A's own browser page (same origin, A's cookies): its status, or null when it failed. */
async function sendInPage(page: Page, r: { method: string; url: string; contentType: string; body: string }): Promise<number | null> {
  return page
    .evaluate(async (x) => {
      const res = await fetch(x.url, { method: x.method, headers: { "content-type": x.contentType }, body: x.body, credentials: "include" });
      return res.status;
    }, r)
    .catch(() => null);
}

/**
 * How the put-back reads and writes as Account A (record-state's RecordIO): reads the way every other read of this
 * scenario is made (`via`); writes through CheckContext.request, which adds the app's own credential headers, and, for
 * a cookie session ("page") whose write that refuses (an answer that isn't 2xx), once more from Account A's own page.
 * Playwright's request context sends a `Secure` cookie over http only to localhost, never to 127.0.0.1, so on a
 * 127.0.0.1 target a SameSite=None (so Secure) session only rides on Account A's page. A write with no answer at all is
 * never sent again: it may have been applied, and a create sent twice would make two records.
 */
function ioAsA(ctx: CheckContext, page: Page, via: ReadVia): RecordIO {
  const viaRequest = requestIO(ctx);
  return {
    read: (url) => readAsA(ctx, page, url, via),
    send: async (r) => {
      const status = await viaRequest.send(r);
      if (via !== "page" || status === null || (status >= 200 && status < 300)) return status;
      return (await sendInPage(page, r)) ?? status;
    },
  };
}

/**
 * The first read of the record endpoint as Account A, and the snapshot of the test record in it. Through A's browser
 * page first (a cookie session, see readInPage); when that doesn't show the test record, through CheckContext.request
 * (a session the app's scripts send as a header, see readThroughRequest). Null when neither shows it.
 */
async function firstRead(
  ctx: CheckContext,
  page: Page,
  url: string,
  testValues: string[],
): Promise<{ via: ReadVia; json: unknown; snap: RecordSnapshot } | null> {
  for (const via of ["page", "request"] as const) {
    const read = await readAsA(ctx, page, url, via);
    const snap = read && read !== "gone" ? snapshotFrom(url, read.json, testValues, ctx.runToken) : null;
    if (read && read !== "gone" && snap) return { via, json: read.json, snap };
  }
  return null;
}

/**
 * True when the app's own server lets a page on `origin` send a credentialed JSON POST to `url`: a real CORS preflight,
 * sent outside the browser (without cookies, as a browser sends one), answered 2xx with that exact origin, credentials
 * allowed, and the content-type header allowed. The browser's own preflight can't decide this: Run Hound's request
 * interception makes Playwright answer it with the origin reflected and credentials allowed, whatever the app says.
 */
async function corsAllows(ctx: CheckContext, url: string, origin: string): Promise<boolean> {
  const answer = await ctx
    .request("signed-out", {
      method: "OPTIONS",
      url,
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    })
    .catch(() => null);
  if (!answer || answer.status < 200 || answer.status >= 300) return false;
  const h = answer.headers;
  const headers = (h["access-control-allow-headers"] ?? "").split(",").map((v) => v.trim().toLowerCase());
  return h["access-control-allow-origin"] === origin && (h["access-control-allow-credentials"] ?? "").toLowerCase() === "true" && headers.includes("content-type");
}

/** "form-encoded (403)", "text/plain (no answer Run Hound could see)". */
function tried(attempts: { note: string; outcome: ForgeOutcome }[]): string {
  return attempts.map((a) => `${a.note} (${a.outcome.status ?? "no answer Run Hound could see"})`).join(", ");
}

const answeredOk = (o: ForgeOutcome) => o.status === null || (o.status >= 200 && o.status < 300);

/**
 * Puts the test record back after the forge, from a re-read as Account A (the same way as every other read, `via`): it
 * restores the test record when the forge changed it (only through an update the app itself sent for its id, never
 * the create), or creates it again when it is gone, and names a new record the forge created. The notes say what could
 * not be undone.
 */
async function putBack(
  ctx: CheckContext,
  page: Page,
  o: { snap: RecordSnapshot; updates: CapturedRequest[]; create: CapturedRequest; marker: string; via: ReadVia },
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
    // The create is never sent to put a record back: it would make another record. It only makes a gone one again.
    const { restored, notRestored } =
      now === "gone" || update
        ? await restoreRecord(ctx, o.snap, { save: update ?? o.create, create: o.create }, ioAsA(ctx, page, o.via))
        : { restored: [], notRestored: changed };
    if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
    // A field the app changes again itself on every save (updatedAt, version, rowVersion …: record-state's
    // changesOnSave) can never read as before after the put-back, which is a save too: it is named as the app's own.
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
    if (created.length > 0) {
      notes.push("The forged request created a new test record under Account A (it carries the run's test values, and Run Hound doesn't delete records): check Account A.");
    }
  }
  return notes;
}

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

      // 1. As Account A, create the test record through the form and capture its save request. The form's writes are
      //    held and judged before they reach the app (holdExistingEdits): a save that would change a record Account A
      //    already had is stopped, and the scenario is skipped with nothing written.
      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      // Salt "xsite": the marker below inserts "csrf" after the run token, so the salt must not itself contain "csrf",
      // or Account A's own saved values would already match the marker and every run would look like a finding.
      const values: FieldValue[] = canaryValues(form, ctx.runToken, "xsite");
      await fillForm(page, values);
      const hold = await holdExistingEdits(ctx, page, capture);
      try {
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
      // A cross-site page can only send a GET or a POST without a preflight, so only a POST save can be forged.
      const save = creates.find((r) => r.postData && r.method.toUpperCase() === "POST");
      if (!save) {
        if (creates.length > 0) {
          return skip("Skipped: this form's save isn't a POST (a cross-site page can only send a GET or a POST without a preflight), so it can't be forged from another site.");
        }
        return skip("Skipped: submitting the form sent no save request, so there was nothing a cross-site page could forge.");
      }
      const saveEndpoint = endpointOf(save.method, save.url);
      if (neverWritten(save.url)) {
        return skip(`Skipped: this form saves to ${saveEndpoint}, an endpoint Run Hound never writes to from another site (sign-out, password, email, payment, invitations or sharing).`);
      }

      // 2. Reload, find the record endpoint (a list such as GET /api/tasks counts) and snapshot the test record, so the
      // verdict can come from a re-read as Account A.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true });
      if (!recordGet) {
        return skip("Skipped: Run Hound couldn't find an endpoint that reads the saved record back as Account A, so it can't tell whether a forged write worked.");
      }
      // The first read picks how every later one is made: through A's page (a cookie session) or, when that doesn't
      // show the test record, through CheckContext.request (a session the app's scripts send as a header).
      const first = await firstRead(ctx, page, recordGet.url, testValues);
      if (!first) {
        return skip("Skipped: Run Hound couldn't read the test record back as Account A, so it can't tell whether a forged write worked.");
      }
      const { via, snap } = first;
      // The save went through and turned out to change a record Account A already had (as write-access judges it):
      // nothing is forged at it. Put it back as the page read it before the save, and say what the save changed.
      const heldBefore = hold.before();
      const before = heldBefore.length > 0 ? heldBefore : getsBefore(capture, save);
      if (editsExistingRecord(save, snap, recordGet, before, ctx.runToken)) {
        ctx.step("Putting back the record the form changed", page);
        return skip([EXISTING_RECORD, ...(await putBackEdited(ctx, { capture, save, snap, before, io: ioAsA(ctx, page, via) }))].join(" "));
      }
      // The app's own updates of the test record: the only requests a restore may use (the create would add a record).
      const updates = recordWrites(capture, snap, ctx.targetUrl).filter((r) => r.method.toUpperCase() !== "DELETE");

      // 3. Build the forged bodies (no CSRF token: a page on another site can't know it) and a page on a different site.
      const key = tokenKey(ctx.runToken);
      const marker = `${key}csrf`;
      const bodies = forgedBodies(save, key, await tokenValues(page));
      if (!bodies) {
        return skip("Skipped: this form's save isn't form-encoded or JSON, so a cross-site page can't rebuild it (a multipart body needs a preflight).");
      }
      const cross = await crossSitePage(ctx, ctx.targetUrl);
      if ("inconclusive" in cross) {
        // Never confirmed and never a pass: without a cross-site origin, CSRF simply can't be judged here.
        return errorResult(ID, scenario, started, `Inconclusive. ${cross.inconclusive}`, "skipped");
      }

      const wasJson = Boolean(bodies.json);
      // A JSON save can only be a finding when the app also takes it form-encoded or as text/plain (the classic
      // JSON-sent-as-text vector: the JSON payload with a CORS-safelisted content-type), which a real cross-site page can
      // send without a preflight, or when the app's CORS lets the attacker origin send the JSON with credentials.
      const cors = wasJson ? await corsAllows(ctx, save.url, cross.origin) : false;
      const attempts: { encoding: ForgeEncoding; body: string; note: string }[] = [
        { encoding: "form", body: bodies.form, note: "form-encoded" },
        ...(wasJson ? [{ encoding: "text" as ForgeEncoding, body: bodies.json!, note: "JSON sent as text/plain" }] : []),
        ...(cors ? [{ encoding: "json" as ForgeEncoding, body: bodies.json!, note: "JSON (the app's CORS allows this origin with credentials)" }] : []),
      ];

      // Chromium's 2-minute window for a new Lax-by-default cookie (docs/v2-spec.md "Cookies") only opens for a
      // top-level cross-site POST navigation. Every forge here is a form posted into an iframe, or a fetch, never a
      // top-level navigation, so that window can't carry a Lax cookie and there is nothing to wait out: a Lax cookie
      // stays home, whatever the session's age.
      const cookies: TargetCookie[] = await cross.targetCookies();
      const sent: { note: string; encoding: ForgeEncoding; outcome: ForgeOutcome }[] = [];
      let stored: (typeof sent)[number] | null = null;
      let rereadFailed = false;
      try {
        for (const attempt of attempts) {
          ctx.step(`Sending the forged save from another site (${attempt.note})`, page);
          const outcome = await cross.forge({ method: "POST", url: save.url, body: attempt.body, encoding: attempt.encoding });
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
        }
      } catch (error) {
        // A forge may already have been sent: put the test record back first, then say what may be left.
        const message = error instanceof Error ? error.message : String(error);
        const put = sent.length > 0 ? await putBack(ctx, page, { snap, updates, create: save, marker, via }).catch(() => [] as string[]) : [];
        throw new Error([message.replace(/\.?$/, "."), ...put, sent.length > 0 ? INTERRUPTED_NOTE : ""].filter(Boolean).join(" "));
      } finally {
        await cross.dispose();
      }

      // 4. Restore when something may have changed, then the verdict from the re-read.
      const restoreNotes = stored || rereadFailed ? await putBack(ctx, page, { snap, updates, create: save, marker, via }) : [];
      const droppedNote =
        bodies.dropped.length > 0
          ? `The forged body left out ${bodies.dropped.join(", ")}, which carr${bodies.dropped.length === 1 ? "ies" : "y"} Account A's anti-CSRF token: a page on another site can't know it.`
          : "";

      if (stored) {
        const carried = stored.outcome.cookies;
        const sameSite = (name: string) => cookies.find((c) => c.name === name)?.sameSite ?? "unknown";
        const why = carried.length > 0
          ? `the browser attached Account A's cookie${carried.length === 1 ? "" : "s"} ${carried.map((n) => `${n} (SameSite=${sameSite(n)})`).join(", ")} to a request from another site, and the server accepted it with no CSRF token and no Origin check`
          : "the server stored the value in Account A's data although the browser attached no cookie to the request at all: the save doesn't need Account A's session, and it has no CSRF token or Origin check";
        const viaCors = stored.encoding === "json";
        // No cookie rode on the forged request and it was still stored: the save doesn't need Account A's session at
        // all, so a CSRF defence alone (a SameSite cookie, a token) wouldn't fix it. The session comes first.
        const noSession = carried.length === 0;
        const requireSession = `Require Account A's session on ${saveEndpoint} (answer 401 without it, and save only to the signed-in account's own records), then add a CSRF defence`;
        const evidence = await forgedCard(ctx, saveEndpoint, stored.note, carried, cookies, bodies.dropped);
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
            `Re-reading the record as Account A showed the new value: ${why}.` +
            (viaCors ? " The app's CORS answer allows that origin with credentials, which is also a CORS issue (cors): any site can send this JSON save and read the answer." : ""),
          impact: noSession
            ? "Any web page Account A visits, or anyone at all, can make this change (or any other this form makes) in Account A's data without Account A's session: the save doesn't check who sends it. A page on another site can do it silently, without Account A ever submitting the form."
            : "Any web page Account A visits could silently make this change (or any other this form makes) on their behalf, without them ever submitting the form. This is a cross-site request forgery (CSRF) flaw.",
          fix: noSession
            ? viaCors
              ? `Ask your AI or developer: "The save at ${saveEndpoint} changes Account A's data with no session at all, and it can be sent from another site: the CORS config reflects any origin with Access-Control-Allow-Credentials. ${requireSession}: allow only your own origins in CORS, and for a cookie session use a SameSite=Lax (or Strict) cookie plus a CSRF token or an Origin check."`
              : `Ask your AI or developer: "The save at ${saveEndpoint} changes Account A's data with no session at all: a request from another site with no cookie and no token was stored. ${requireSession} for a cookie session: a SameSite=Lax (or Strict) cookie, plus a per-request CSRF token the server checks, or an Origin/Referer check that rejects requests from other sites."`
            : viaCors
              ? `Ask your AI or developer: "The save at ${saveEndpoint} can be sent from another site: the CORS config reflects any origin with Access-Control-Allow-Credentials. Allow only your own origins, and add a CSRF defence: a SameSite=Lax (or Strict) session cookie plus a CSRF token or an Origin check."`
              : `Ask your AI or developer: "The save at ${saveEndpoint} can be sent from another site. Add a CSRF defence: a SameSite=Lax (or Strict) session cookie, plus a per-request CSRF token the server checks, or an Origin/Referer check that rejects requests from other sites. Accept only application/json for JSON saves."`,
          location: saveEndpoint,
          evidence,
          spec: {
            filename: `${ID}-cross-site.spec.ts`,
            source: replaySpec({
              target: ctx.targetUrl,
              save: save.url,
              record: recordGet.url,
              fields: bodies.fields,
              marked: bodies.marked,
              encoding: stored.encoding,
              attackerOrigin: cross.origin,
              // A token session only when A's browser holds no cookie for the target at all; a cookie session whose
              // reads need a header the page adds (a CSRF or API-key header) is still a cookie session.
              tokenSession: via === "request" && cookies.length === 0,
              headerRead: via === "request",
            }),
          },
        };
        const notes = [`The forged ${stored.note} request from ${cross.origin} was stored.`, droppedNote, ...restoreNotes].filter(Boolean).join(" ");
        return result(ID, scenario, started, [finding], notes);
      }

      if (rereadFailed) {
        return skip(
          [
            "Inconclusive: the re-read as Account A failed after the forged request was sent, so Run Hound can't tell whether it was stored: check Account A.",
            ...restoreNotes,
          ].join(" "),
        );
      }

      // The app said yes (or Run Hound saw no answer), and the record endpoint reads only this record: a record the
      // forged create may have made elsewhere wouldn't show in the re-read, so this can't be a pass.
      const unseen = sent.filter((a) => answeredOk(a.outcome));
      if (unseen.length > 0 && !readsList(first.json, snap.record)) {
        return skip(
          `Inconclusive: the app answered the forged ${tried(unseen)} request from ${cross.origin}, and the record endpoint reads only the test record, so Run Hound can't see whether the forged request created a new one: check Account A.`,
        );
      }

      // Pass: the re-read shows no forged value. A's session is a token the app's scripts send as a header, not a cookie,
      // only when A's own page couldn't read as A with its cookies (via "request"), A's browser holds no cookie for the
      // target, and none rode on a forged request: then nothing could sign the forge in as A, whatever else the save
      // checks. A cookie session whose reads also need a header the page adds (such as an X-CSRF-Token) is re-read the
      // same way, but a SameSite cookie, a CSRF token or an Origin check is what stopped the forge there.
      const tokenSession = via === "request" && cookies.length === 0 && sent.every((a) => a.outcome.cookies.length === 0);
      const passNote = tokenSession
        ? `A page on ${cross.origin} could not change Account A's data: Account A's session is a token the app's own scripts add to each request (such as a bearer token), not a cookie, so there is no cookie for the browser to attach to a request from another site, and the forged save wasn't stored.` +
          (wasJson && !cors ? " The save is also sent as JSON, which needs a preflight from another site." : "")
        : wasJson
          ? `A page on ${cross.origin} could not change Account A's data. The save is sent as JSON, which needs a preflight from another site${cors ? "" : " (the app's CORS doesn't allow that origin)"}, and the app didn't take the forged save otherwise.`
          : `A page on ${cross.origin} could not change Account A's data: the forged cross-site request was rejected or had no effect (a SameSite cookie, a CSRF token or an Origin check stopped it).`;
      const notes = [passNote, `Tried: ${tried(sent)}.`, droppedNote].filter(Boolean).join(" ");
      return result(ID, scenario, started, [], notes);
    });
  },
};

/** A card of the forged request and the cookies it carried (names and SameSite only; the context redacts the text). */
async function forgedCard(
  ctx: CheckContext,
  saveEndpoint: string,
  via: string,
  carried: string[],
  cookies: TargetCookie[],
  dropped: string[],
): Promise<Evidence[]> {
  const sameSite = (name: string) => cookies.find((c) => c.name === name)?.sameSite ?? "unknown";
  return tryCard(ctx, "The forged cross-site request", {
    title: `${saveEndpoint} forged from another site`,
    subtitle: "Sent from a page on a different site in Account A's browser, with a new value.",
    lines: [
      { text: `Sent as: ${via}`, mark: true },
      { text: carried.length > 0 ? `Cookies the browser attached: ${carried.join(", ")}` : "The browser attached no cookie.", mark: true },
      { text: "No CSRF token and no Origin check stopped it.", mark: true },
    ],
    facts: [
      { label: "How it was sent", value: via },
      { label: "Cookies attached (SameSite)", value: carried.length > 0 ? carried.map((n) => `${n} (${sameSite(n)})`).join(", ") : "none" },
      ...(dropped.length > 0 ? [{ label: "Token fields left out", value: dropped.join(", ") }] : []),
    ],
  });
}

/**
 * A standalone spec: signs in as Account A from environment variables, serves a blank page from a real server on the
 * other site (a routed page would count as public and be blocked from loopback), posts the save from it with a made-up
 * value in the forged field and the other fields empty, and re-reads the record endpoint as Account A: the re-read
 * must be let in (a re-read that isn't signed in proves nothing), and the made-up value must not be there. With
 * `tokenSession` (Account A's session is a token the app's scripts send as a header, not a cookie) a comment says to
 * add it to the re-read; with `headerRead` alone (a cookie session whose reads also need a header the app's scripts add,
 * such as a CSRF or API-key header) a comment says to add those headers. No value Run Hound typed, no token and no
 * credential is written into it.
 */
function replaySpec(o: {
  target: string;
  save: string;
  record: string;
  fields: string[];
  marked: string;
  encoding: ForgeEncoding;
  attackerOrigin: string;
  tokenSession?: boolean;
  headerRead?: boolean;
}): string {
  const q = (v: unknown) => JSON.stringify(v);
  const path = (u: string) => {
    const p = new URL(u);
    return `${p.pathname}${p.search}`;
  };
  return [
    `import { test, expect, chromium, request } from "@playwright/test";`,
    `import { createServer } from "node:http";`,
    `import type { AddressInfo } from "node:net";`,
    ``,
    `// Exported by Run Hound. Set Account A's environment variables before running:`,
    `//   RUNHOUND_ACCOUNT_A_LOGIN_URL, RUNHOUND_ACCOUNT_A_USERNAME, RUNHOUND_ACCOUNT_A_PASSWORD.`,
    `// The save was stored when sent ${o.encoding === "form" ? "form-encoded" : o.encoding === "text" ? "as JSON with a text/plain content-type" : "as JSON (CORS allowed the other site)"} from another site.`,
    `const TARGET = ${q(o.target)};`,
    `const SAVE = ${q(path(o.save))}; // the form's own save`,
    `const RECORD = ${q(path(o.record))}; // reads the saved record back as Account A`,
    `const FIELDS = ${q(o.fields)} as string[];`,
    `const FORGED_FIELD = ${q(o.marked)};`,
    `const ENCODING = ${q(o.encoding)} as "form" | "text" | "json";`,
    `// A different SITE from the target: localhost and 127.0.0.1 are different sites of each other.`,
    `const ATTACKER_HOST = ${q(new URL(o.attackerOrigin).hostname)};`,
    ``,
    `// Sign in through the app's own login and return the session as storage state (cookies + localStorage).`,
    `async function sessionFor(slot: "A") {`,
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
    `test("a page on another site can't change Account A's data", async () => {`,
    `  const forged = "runhound-forged-" + Date.now();`,
    `  const server = createServer((_req, res) => {`,
    `    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });`,
    `    res.end("<!doctype html><title>Another site</title>");`,
    `  });`,
    `  await new Promise<void>((resolve) => server.listen(0, ATTACKER_HOST, resolve));`,
    `  const attacker = "http://" + ATTACKER_HOST + ":" + (server.address() as AddressInfo).port;`,
    `  const browser = await chromium.launch();`,
    `  try {`,
    `    const context = await browser.newContext({ storageState: await sessionFor("A") });`,
    `    const page = await context.newPage();`,
    `    await page.goto(attacker + "/");`,
    `    const values = Object.fromEntries(FIELDS.map((f) => [f, f === FORGED_FIELD ? forged : ""]));`,
    `    await page.evaluate(async ({ url, values, encoding }) => {`,
    `      if (encoding === "form") {`,
    `        const iframe = document.createElement("iframe"); iframe.name = "forged"; document.body.append(iframe);`,
    `        const form = document.createElement("form"); form.method = "POST"; form.action = url; form.target = "forged";`,
    `        for (const [k, v] of Object.entries(values)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = String(v); form.append(i); }`,
    `        document.body.append(form);`,
    `        await new Promise((resolve) => { iframe.addEventListener("load", resolve); form.submit(); setTimeout(resolve, 5000); });`,
    `      } else {`,
    `        const type = encoding === "text" ? "text/plain" : "application/json";`,
    `        await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": type }, body: JSON.stringify(values) }).catch(() => undefined);`,
    `      }`,
    `    }, { url: new URL(SAVE, TARGET).href, values, encoding: ENCODING });`,
    `    // Re-read as Account A, from a page of the app itself: the forged value must NOT be stored.`,
    ...(o.tokenSession
      ? [`    // Account A's session is a token the app's own scripts send in a header, not a cookie: add it to this re-read.`]
      : o.headerRead
        ? [`    // Run Hound read the record back with the headers the app's own scripts add to its requests (such as a CSRF or API-key header): add them to this re-read.`]
        : []),
    `    const own = await context.newPage();`,
    `    await own.goto(TARGET);`,
    `    const reread = await own.evaluate(async (u) => {`,
    `      const res = await fetch(u, { credentials: "include" });`,
    `      return { ok: res.ok, text: await res.text() };`,
    `    }, new URL(RECORD, TARGET).href);`,
    // With a token session or a header read, Account A is signed in but the bare fetch lacks what the comment names.
    `    expect(reread.ok, ${q(o.tokenSession || o.headerRead ? "the re-read as Account A failed: add what the comment above says to it, signed in as Account A" : "the re-read as Account A failed: sign in as Account A so the record can be read")}).toBe(true);`,
    `    expect(reread.text, "the value sent from another site was stored").not.toContain(forged);`,
    `  } finally {`,
    `    await browser.close();`,
    `    server.close();`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}
