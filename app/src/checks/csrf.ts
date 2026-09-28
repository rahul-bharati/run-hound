/**
 * csrf (0.5.0, docs/v2-spec.md "`csrf`"): can a page on another site make Account A's browser change Account A's data?
 * A real browser page on a different *site* from the target (localhost vs 127.0.0.1) submits the save this form makes
 * for the run's test record, with a new run-token value, in Account A's own browser context. The browser attaches
 * cookies for itself, so a SameSite=Lax cookie stays home and a SameSite=None cookie rides along. Only requests a
 * cross-site page can send without a CORS preflight are sent (form-encoded, a multipart form for a multipart save, then
 * a JSON save's payload as text/plain; a JSON body only when the app's own answer to a real preflight allows the
 * attacker origin with credentials), with every run-token value forged at any depth, and never with a CSRF token. The
 * app's answer to each forge is read from the network, waited for up to 30 s (3xx, 400 and 2xx each weigh on the
 * verdict; a forge with no answer says nothing about the cookies it carried, and with nothing stored it is inconclusive,
 * never a pass: the app may still store it). A field left out by its value alone (a random value in a hidden input or
 * the save's URL, which may be a token or a reference such as an id) makes a refusal that a missing value explains
 * (400, 404, 409, 422, a 5xx, a 2xx or 3xx that stored nothing) inconclusive too, and a 403 as well when the value looks
 * like a reference (an id-like name, a UUID or an ObjectId: an authorization check answers a missing one with 403); a
 * pass after such a refusal never names a defence Run Hound didn't see. The verdict is a re-read as Account A (through A's own browser page for a cookie session, through
 * CheckContext.request and the app's own credential headers for a session its scripts send as a header, such as a
 * bearer token kept in sessionStorage): a finding only when the forged value is stored; a failed re-read is
 * inconclusive, never a pass. Then the test record is restored, only through an update the app itself sent for it
 * (through Account A's own page when the request context can't carry the session: a Secure cookie on 127.0.0.1). A form that edits a record Account A already had is never used, as in write-access: its save is held
 * in the page and stopped before it reaches the app, and one that went through and only then shows it changed such a
 * record is put back and skipped before anything is forged. Unticked by default: it changes Account A's data and
 * restores it.
 */
import { carriesTestValues, isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Page } from "playwright";
import type { Check, CheckContext, Evidence, Finding, PlanEnv, Scenario } from "../core/types.js";
import { crossSitePage, forgeWaitMs, type ForgeEncoding, type ForgeOutcome, type TargetCookie } from "./lib/cross-site.js";
import { looksLikeReference, redactValues, withoutQueryCredentials, type DroppedParam } from "./lib/cross-site-query.js";
import { isTokenField, TOKEN_FIELD, tokenSources } from "./lib/csrf-tokens.js";
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
  holdsId,
  jsonObjectBody,
  locateRecord,
  neverWritten,
  putBackEdited,
  readsBefore,
  readsList,
  recordChains,
  recordWrites,
  requestIO,
  restoreRecord,
  savesOwnRecord,
  snapshotFrom,
  stoppedByHold,
  type CapturedRequest,
  type JsonObject,
  type RecordIO,
  type RecordSnapshot,
} from "./lib/record-state.js";

const ID = "csrf" as const;

const INTERRUPTED_NOTE =
  "If Run Hound had already sent the forged request, Account A's test record may still hold the value it changed: check Account A.";

/** A body encoded as `application/x-www-form-urlencoded` (name=value pairs joined by "&"), judged from the body itself. */
function looksFormEncoded(body: string | null | undefined): body is string {
  return Boolean(body) && /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body!);
}

/**
 * A value with "csrf" right after the run token, so it still carries the token but is a new, unique value, and as long
 * as the value the app accepted: "csrf" takes the place of the four characters after the token (or, when fewer follow
 * it, of the last ones before it), so a maxlength the server enforces never refuses the forge for its length alone.
 */
function markValue(value: string, key: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value}${key}csrf`;
  const token = value.slice(i, i + key.length);
  const tail = value.slice(i + key.length);
  if (tail.length >= 4) return `${value.slice(0, i)}${token}csrf${tail.slice(4)}`;
  const before = value.slice(0, i);
  return `${before.slice(Math.min(before.length, 4 - tail.length))}${token}csrf`;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The forged bodies of a save, the field that carries the forged value, and the token fields left out. */
interface ForgedBodies {
  /** How the app's own save was encoded. */
  kind: "form" | "multipart" | "json";
  /** Form-encoded: for a form post, and for a JSON save's form-encoded attempt (its top-level fields). */
  form: string;
  /** The JSON payload (a JSON save only): sent as text/plain, or as JSON when CORS allows it. */
  json?: string;
  /** The top-level field that carries the (first) forged value. */
  marked: string;
  /** The top-level fields the forged body keeps (token fields left out), in order. */
  fields: string[];
  /** Fields left out because they carry an anti-CSRF token, or may (`unplaced`). */
  dropped: string[];
  /**
   * The fields among `dropped` left out by their value alone, a value Run Hound can't place as a token: a random value
   * in a hidden input (or in the save's URL) under a name that doesn't say token, held in no csrf/xsrf <meta> or cookie.
   * It may be a token, or a reference such as an id (a UUID list_id) the save needs and a page on another site could know.
   */
  unplaced: string[];
  /** Among `unplaced`, the fields whose value no hidden input held, only the save's URL. */
  urlOnly: string[];
  /** Among `unplaced`, the fields that look like a reference (cross-site-query.ts looksLikeReference). */
  references: string[];
}

/**
 * A multipart/form-data body's text fields in order, read from the body itself (its first line is the boundary). An
 * empty file part (a file input left empty) is left out; null when the body isn't multipart or carries a file, which a
 * page on another site can't rebuild from here.
 */
function multipartEntries(body: string | null | undefined): [string, string][] | null {
  const first = body ? /^--([^\r\n]+)\r?\n/.exec(body) : null;
  if (!body || !first) return null;
  const entries: [string, string][] = [];
  for (const part of body.split(`--${first[1]!}`).slice(1)) {
    if (part.startsWith("--")) break;
    const m = /^\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)\r?\n$/.exec(part);
    if (!m) return null;
    const name = /\bname="([^"]*)"/i.exec(m[1]!)?.[1];
    if (name === undefined) return null;
    const file = /\bfilename="([^"]*)"/i.exec(m[1]!);
    if (file) {
      if (file[1] === "" && m[2] === "") continue;
      return null;
    }
    entries.push([name, m[2]!]);
  }
  return entries.length > 0 ? entries : null;
}

/**
 * The forged bodies for `save`, with every run-token value, at any depth, changed to a new value that carries `marker`
 * (a field the app doesn't keep never hides the forge), or, when none carries the run token, the first text value.
 * Every field that carries an anti-CSRF token is left out (a page on another site can't read it): by name (csrf-tokens.ts
 * TOKEN_FIELD: _csrf, authenticity_token, task[_token], _wpnonce, form_key, token, nonce …, unless Run Hound typed the
 * value), or by value (`tokens`: the token values the app gave Account A's page, a random value in a hidden input, and
 * the credentials left out of the save's URL). A field left out by a value that isn't in `placed` (the values Run Hound
 * can place as a token: a csrf/xsrf <meta> or cookie, a hidden input or query parameter whose name says token, a
 * credential) is also listed in `unplaced`, and in `urlOnly` when `fromPage` (the values the app's page gave) doesn't
 * hold it. Null when the body is neither JSON, form-encoded nor multipart text fields.
 */
function forgedBodies(
  save: CapturedRequest,
  key: string,
  tokens: ReadonlySet<string>,
  placed: ReadonlySet<string>,
  fromPage: ReadonlySet<string>,
): ForgedBodies | null {
  const dropped = new Set<string>();
  const unplaced = new Set<string>();
  const urlOnly = new Set<string>();
  const references = new Set<string>();
  const isToken = (k: string, v: unknown) => {
    if (!isTokenField(k, v, tokens, key)) return false;
    dropped.add(k);
    const text = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
    if (!TOKEN_FIELD.test(k) && text !== null && !placed.has(text)) {
      unplaced.add(k);
      if (!fromPage.has(text)) urlOnly.add(k);
      if (looksLikeReference(k, text)) references.add(k);
    }
    return true;
  };
  const leftOut = () => ({ dropped: [...dropped], unplaced: [...unplaced], urlOnly: [...urlOnly], references: [...references] });
  const json = jsonObjectBody(save.postData);
  const marked: string[] = [];

  if (json) {
    // Every string that carries the run token is marked, however deep; token fields are left out at every level.
    const walk = (v: unknown, top: string): unknown => {
      if (typeof v === "string") {
        if (!v.toLowerCase().includes(key)) return v;
        marked.push(top);
        return markValue(v, key);
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, top));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
          if (!isToken(k, x)) out[k] = walk(x, top);
        }
        return out;
      }
      return v;
    };
    const forged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json)) {
      if (!isToken(k, v)) forged[k] = walk(v, k);
    }
    if (marked.length === 0) {
      const first = Object.keys(forged).find((k) => typeof forged[k] === "string");
      if (first === undefined) return null;
      forged[first] = markValue(forged[first] as string, key);
      marked.push(first);
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(forged)) params.append(k, asText(v));
    return {
      kind: "json",
      form: params.toString(),
      json: JSON.stringify(forged),
      marked: marked[0]!,
      fields: Object.keys(forged),
      ...leftOut(),
    };
  }

  const multipart = looksFormEncoded(save.postData) ? null : multipartEntries(save.postData);
  const entries = multipart ?? (looksFormEncoded(save.postData) ? [...new URLSearchParams(save.postData)] : null);
  if (!entries) return null;
  const kept = entries.filter(([k, v]) => !isToken(k, v));
  const withToken = kept.map(([, v], i) => (v.toLowerCase().includes(key) ? i : -1)).filter((i) => i >= 0);
  const at = withToken.length > 0 ? withToken : kept.length > 0 ? [0] : [];
  if (at.length === 0) return null;
  const forged = kept.map(([k, v], i): [string, string] => [k, at.includes(i) ? markValue(v, key) : v]);
  return {
    kind: multipart ? "multipart" : "form",
    form: new URLSearchParams(forged).toString(),
    marked: forged[at[0]!]![0],
    fields: [...new Set(forged.map(([k]) => k))],
    ...leftOut(),
  };
}

/** Token values the app gave Account A's page: all of them, and those Run Hound can place as a token. */
interface PageTokens {
  all: Set<string>;
  /** From a csrf/xsrf <meta> or cookie, or a hidden input whose name says token (csrf-tokens.ts TOKEN_FIELD). */
  placed: Set<string>;
}

/**
 * Anti-CSRF token values the app gave Account A (csrf-tokens.ts tokenSources): a <meta> whose name says csrf/xsrf
 * (Rails, Laravel, Django templates), a cookie whose name does (double-submit cookies), and a hidden input with a
 * token's name or a random-looking value Run Hound didn't type (Moodle's sesskey, a home-made formToken, but also a
 * UUID reference such as list_id, which is why a value only a hidden input holds, under a name that doesn't say token,
 * isn't `placed`). Held in memory only, to leave them out of the forged body; never put in a page Run Hound serves,
 * never written anywhere.
 */
async function tokenValues(page: Page, key: string): Promise<PageTokens> {
  const sources = await tokenSources(page, key);
  return {
    all: new Set(sources.map((s) => s.value)),
    placed: new Set(sources.filter((s) => s.kind !== "input" || TOKEN_FIELD.test(s.name)).map((s) => s.value)),
  };
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

/** How long a forge waits for its answer, in words: "30 seconds". */
function waitWords(): string {
  const s = forgeWaitMs() / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} second${s === 1 ? "" : "s"}`;
}

/** A failed forge, in words: the connection closed after it went out, or the browser couldn't send it at all. */
const failedWords = (o: ForgeOutcome) =>
  o.sent ? "the connection closed with no answer" : `the browser couldn't send it${o.failure ? `: ${o.failure}` : ""}`;

/** Why a forge has no answer, in words: as a status ("no answer within 30 seconds"), or as a reason ("none came …"). */
const noAnswer = (o: ForgeOutcome) => (o.unanswered === "failed" ? failedWords(o) : `no answer within ${waitWords()}`);
const whyNoAnswer = (o: ForgeOutcome) => (o.unanswered === "failed" ? failedWords(o) : `none came within ${waitWords()}`);

/** "form-encoded (403)", "text/plain (no answer within 30 seconds)". */
function tried(attempts: { note: string; outcome: ForgeOutcome }[]): string {
  return attempts.map((a) => `${a.note} (${a.outcome.status ?? noAnswer(a.outcome)})`).join(", ");
}

/** A redirect to a sign-in page: the app's answer to a request that isn't signed in, so a refusal. */
const SIGN_IN_PATH = /\/(?:log[-_]?in|sign[-_]?in|auth|authenticate|sessions?\/new|users\/sign_in)(?:[/?#.]|$)/i;

/**
 * True when the app may have taken the forge: a 2xx, a 3xx that isn't a redirect to a sign-in page (Post/Redirect/Get
 * answers a stored post with a 303), or no answer Run Hound could see.
 */
const answeredOk = (o: ForgeOutcome) =>
  o.status === null || (o.status >= 200 && o.status < 300) || (o.status >= 300 && o.status < 400 && !SIGN_IN_PATH.test(o.location ?? ""));

/**
 * An answer a value missing from the body doesn't explain: a CSRF defence's (403, Laravel's 419), a refused session
 * (401, a redirect to a sign-in page) or a refused encoding (415). Any other refusal (400, 404, 409, 422, a 5xx, or a
 * 2xx or 3xx that stored nothing) may be the app refusing a value Run Hound left out.
 */
const refusesRequest = (o: ForgeOutcome) =>
  o.status === 401 ||
  o.status === 403 ||
  o.status === 415 ||
  o.status === 419 ||
  (o.status !== null && o.status >= 300 && o.status < 400 && SIGN_IN_PATH.test(o.location ?? ""));

/** An origin that is no loopback name or address: a CORS allowlist that trusts it trusts any site. */
const OTHER_SITE = "http://run-hound-other-site.invalid";

/**
 * Puts the test record back after the forge, from a re-read as Account A (the same way as every other read, `via`): it
 * restores the test record when the forge changed it (only through an update the app itself sent for its id, never
 * the create), or creates it again when it is gone, and names a new record the forge created. The notes say what could
 * not be undone.
 */
async function putBack(
  ctx: CheckContext,
  page: Page,
  o: {
    snap: RecordSnapshot;
    updates: CapturedRequest[];
    create: CapturedRequest;
    marker: string;
    via: ReadVia;
    /** True when a read shows a record carrying the run's values that the first read didn't (see newRunRecord). */
    fresh: (json: unknown) => boolean;
  },
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
    if (created.length > 0 || o.fresh(read.json)) {
      notes.push("The forged request created a new test record under Account A (it carries the run's test values, and Run Hound doesn't delete records): check Account A.");
    }
  }
  return notes;
}

/**
 * The save this form made for the test record, among `candidates` (the POSTs it sent that carry the typed values, in
 * the order sent): the one whose answer holds the record's id, answered 201 Created, or holds the typed values (in that
 * order of weight; the last one on a tie), so a POST sent before the save (a validation or a lookup that stores
 * nothing) is never taken for it. `tied` is false when several carry the values and no answer ties any of them to the
 * record: then it is the last one sent before the record first showed in a read the page made, and the caller never
 * calls the result a pass.
 */
function pickSave(
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

/**
 * Why a save's body can't be forged (forgedBodies returned null), said for what the body is: a JSON array or bare JSON
 * value (no named fields a cross-site form could carry, and Run Hound doesn't rebuild one), a JSON object with no text
 * field to forge (the page encoded the typed value), a multipart body with a file, or another body type.
 */
function unforgeable(body: string | null | undefined): string {
  let json: unknown;
  try {
    json = body ? (JSON.parse(body) as unknown) : undefined;
  } catch {
    json = undefined;
  }
  if (Array.isArray(json)) {
    return "this form's save is a JSON array, not an object with named fields, and Run Hound doesn't rebuild one on a cross-site page, so this save wasn't forged.";
  }
  if (json === null || (json !== undefined && typeof json !== "object")) {
    return "this form's save is a bare JSON value, not an object with named fields, and Run Hound doesn't rebuild one on a cross-site page, so this save wasn't forged.";
  }
  if (json !== undefined) {
    return "this form's save is a JSON object with no text field Run Hound can forge (the typed value isn't in it as text, as when the page encodes it before sending it), so this save wasn't forged.";
  }
  if (body && /^--[^\r\n]+\r?\n/.test(body) && /\bfilename="[^"]/i.test(body)) {
    return "this form's save is a multipart body that carries a file, which Run Hound doesn't rebuild on a cross-site page, so this save wasn't forged.";
  }
  return "this form's save isn't form-encoded, multipart text fields or a JSON object, so a cross-site page can't rebuild it.";
}

/** "a, b and c". */
const listed = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A URL's query parameters, in order; none when it can't be parsed. */
function queryOf(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams];
  } catch {
    return [];
  }
}

/** The note naming the query parameters left out of the forged request's URL, by what they carry; "" when none was. */
function queryNote(dropped: DroppedParam[]): string {
  if (dropped.length === 0) return "";
  const what = [
    dropped.some((d) => d.kind === "csrf") ? "Account A's anti-CSRF token" : "",
    dropped.some((d) => d.kind === "credential") ? "Account A's credential" : "",
    dropped.some((d) => d.kind === "secret") ? "a random value the app's own page added" : "",
  ].filter(Boolean);
  return `The forged request's URL left out ${listed(dropped.map((d) => d.name))}, which carr${dropped.length === 1 ? "ies" : "y"} ${listed(what)}: a page on another site can't know ${dropped.length === 1 ? "it" : "them"}.`;
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
      //    held and judged before they reach the app (holdExistingEdits) from the first keystroke, so a write the page
      //    fires while Run Hound types (an autosave on change) is judged too: a save that would change a record Account A
      //    already had is stopped, and the scenario is skipped with nothing written.
      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      // Salt "xsite": the marker below inserts "csrf" after the run token, so the salt must not itself contain "csrf",
      // or Account A's own saved values would already match the marker and every run would look like a finding.
      const values: FieldValue[] = canaryValues(form, ctx.runToken, "xsite");
      const key = tokenKey(ctx.runToken);
      // Anti-CSRF token values the app gave Account A's page, read before the submit too: a native form post leaves the
      // page, and the page it lands on may hold no copy of the token the save carried (a hidden input under a name no
      // list knows is then left out by its value alone).
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
      // A cross-site page can only send a GET or a POST without a preflight, so only a POST save can be forged. Which of
      // the POSTs is the save for the test record is decided once the record is read back (pickSave): a POST the form
      // sends before its save (a validation that stores nothing) is never the one forged.
      const posts = creates.filter((r) => r.postData && r.method.toUpperCase() === "POST");
      if (posts.length === 0) {
        if (creates.length > 0) {
          return skip("Skipped: this form's save isn't a POST (a cross-site page can only send a GET or a POST without a preflight), so it can't be forged from another site.");
        }
        return skip("Skipped: submitting the form sent no save request, so there was nothing a cross-site page could forge.");
      }
      const carrying = posts.filter((r) => carriesTestValues(r.postData, ctx.runToken));
      const candidates = carrying.length > 0 ? carrying : posts;
      // Anti-CSRF token values the app gave Account A's page, before and after the submit: left out of the forged body
      // and the forged URL.
      const tokensAfter = await tokenValues(page, key);
      const tokens = new Set([...tokensBefore.all, ...tokensAfter.all]);
      const placedTokens = new Set([...tokensBefore.placed, ...tokensAfter.placed]);
      // Every URL the finding, the notes or the spec names is cleaned of the tokens and credentials the app's own page
      // put in its query (Spring's ?_csrf=, ?access_token=): none of them is ever written anywhere.
      const clean = (url: string) => withoutQueryCredentials(url, tokens, key);
      const endpoint = (r: CapturedRequest) => endpointOf(r.method, clean(r.url).url);
      const neverAt = candidates.find((r) => neverWritten(r.url));
      if (neverAt) {
        return skip(`Skipped: this form saves to ${endpoint(neverAt)}, an endpoint Run Hound never writes to from another site (sign-out, password, email, payment, invitations or sharing).`);
      }

      // 2. Reload, find the record endpoint (a list such as GET /api/tasks counts) and snapshot the test record, so the
      // verdict can come from a re-read as Account A.
      ctx.step("Reloading to read the saved record", page);
      await page.reload({ waitUntil: "load" }).catch(() => undefined);
      await settle(page);
      const testValues = values.filter((v) => v.canary && v.value).map((v) => v.value);
      const recordGet = await findOwnRecord(ctx, capture, testValues, { arrays: true });
      // The form's own writes reached the app (none was held): without a read, Run Hound can't tell what they changed,
      // so the note never lets it pass for "nothing was changed".
      const reached = [...new Set(creates.filter((r) => r.status !== null).map(endpoint))];
      const reachedNote =
        reached.length > 0
          ? ` The form's own save (${listed(reached)}) reached the app, and without a read Run Hound can't tell whether it changed a record Account A already had: check Account A.`
          : "";
      if (!recordGet) {
        return skip(`Skipped: Run Hound couldn't find an endpoint that reads the saved record back as Account A, so it can't tell whether a forged write worked.${reachedNote}`);
      }
      // The first read picks how every later one is made: through A's page (a cookie session) or, when that doesn't
      // show the test record, through CheckContext.request (a session the app's scripts send as a header).
      const first = await firstRead(ctx, page, recordGet.url, testValues);
      if (!first) {
        return skip(`Skipped: Run Hound couldn't read the test record back as Account A, so it can't tell whether a forged write worked.${reachedNote}`);
      }
      const { via, snap } = first;
      const { save, tied } = pickSave(candidates, capture.requests, testValues, snap);
      const saveEndpoint = endpoint(save);
      // The save went through and turned out to change a record Account A already had (as write-access judges it):
      // nothing is forged at it. Put it back as the page read it before the save, and say what the save changed.
      const heldBefore = hold.before();
      const before = heldBefore.length > 0 ? heldBefore : getsBefore(capture, save);
      const reads = heldBefore.length > 0 ? hold.reads() : readsBefore(capture, save);
      if (editsExistingRecord(save, snap, recordGet, before, ctx.runToken, reads)) {
        ctx.step("Putting back the record the form changed", page);
        return skip([EXISTING_RECORD, ...(await putBackEdited(ctx, { capture, save, snap, before, io: ioAsA(ctx, page, via) }))].join(" "));
      }
      // The app's own updates of the test record: the only requests a restore may use (the create would add a record).
      const updates = recordWrites(capture, snap, ctx.targetUrl).filter((r) => r.method.toUpperCase() !== "DELETE");

      // 3. Build the forged request (no CSRF token and no credential: a page on another site can't know them, in its
      //    body or its URL) and a page on a different site.
      const marker = `${key}csrf`;
      const forgedUrl = clean(save.url);
      const recordUrl = clean(recordGet.url);
      // Values that must never be written: a finding, a note or the spec built below from the cleaned URLs never holds
      // them, and every text is also passed through `hide` in case one rides somewhere else (an error message).
      const secrets = [...new Set([...forgedUrl.values, ...recordUrl.values])];
      const hide = (text: string) => (secrets.length > 0 ? redactValues(text, secrets) : text);
      // A query parameter left out only because its value matched a random value in a hidden input (not by its name,
      // and held in no csrf/xsrf <meta> or cookie) is a value Run Hound can't place, as a random one it found only in
      // the URL is ("secret").
      const saveParams = queryOf(save.url);
      const urlDropped: DroppedParam[] = forgedUrl.dropped.map((d) => {
        if (d.kind !== "csrf" || TOKEN_FIELD.test(d.name)) return d;
        const vs = saveParams.filter(([n, v]) => n === d.name && v !== "").map(([, v]) => v);
        return vs.length > 0 && vs.every((v) => !placedTokens.has(v)) ? { ...d, kind: "secret" } : d;
      });
      // The values the body may leave out as a token Run Hound can place: the page's own, and the URL's tokens and
      // credentials.
      const placedUrl = saveParams.filter(([n]) => urlDropped.some((d) => d.name === n && d.kind !== "secret")).map(([, v]) => v);
      const bodies = forgedBodies(save, key, new Set([...tokens, ...forgedUrl.values]), new Set([...placedTokens, ...placedUrl]), tokens);
      if (!bodies) return skip(`Skipped: ${unforgeable(save.postData)}`);
      const cross = await crossSitePage(ctx, ctx.targetUrl);
      if ("inconclusive" in cross) {
        // Never confirmed and never a pass: without a cross-site origin, CSRF simply can't be judged here.
        return errorResult(ID, scenario, started, `Inconclusive. ${cross.inconclusive}`, "skipped");
      }

      const wasJson = bodies.kind === "json";
      // A JSON save can only be a finding when the app also takes it form-encoded or as text/plain (the classic
      // JSON-sent-as-text vector: the JSON payload with a CORS-safelisted content-type), which a real cross-site page can
      // send without a preflight, or when the app's CORS lets the attacker origin send the JSON with credentials.
      const cors = wasJson ? await corsAllows(ctx, forgedUrl.url, cross.origin) : false;
      // The attacker page is on loopback too, so CORS that allows it may trust loopback origins only: a second preflight
      // from an origin that is no loopback name tells an allowlist of loopback origins from one that reflects any site.
      const loopbackOnly = cors && !(await corsAllows(ctx, forgedUrl.url, OTHER_SITE));
      // A multipart save is forged as a multipart form (a page on another site posts one without a preflight).
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
      // The encoding of the app's own save: a 400 to a forge sent that way refuses the value, not the request.
      const ownEncoding: ForgeEncoding = bodies.kind === "multipart" ? "multipart" : wasJson ? "json" : "form";

      // A record carrying the run's values that the first read didn't show: the forge made it, even when the app
      // rewrote the forged value (a sanitiser, a slug) so the marker isn't there. By the test record's id key when it has
      // one, else by count; never without the run token (every value would match).
      const runRecords = (json: unknown) => (key ? recordChains(json, [key]).map((c) => c[0]!) : []);
      const idKey = snap.id?.key;
      const firstRun = runRecords(first.json);
      const firstIds = new Set(idKey ? firstRun.map((r) => JSON.stringify(r[idKey])) : []);
      const fresh = (json: unknown): boolean => {
        const now = runRecords(json);
        return idKey ? now.some((r: JsonObject) => r[idKey] !== undefined && !firstIds.has(JSON.stringify(r[idKey]))) : now.length > firstRun.length;
      };

      // Chromium's 2-minute window for a new Lax-by-default cookie (docs/v2-spec.md "Cookies") only opens for a
      // top-level cross-site POST navigation. Every forge here is a form posted into an iframe, or a fetch, never a
      // top-level navigation, so that window can't carry a Lax cookie and there is nothing to wait out: a Lax cookie
      // stays home, whatever the session's age.
      const cookies: TargetCookie[] = await cross.targetCookies();
      const sent: { note: string; encoding: ForgeEncoding; outcome: ForgeOutcome }[] = [];
      let stored: (typeof sent)[number] | null = null;
      /** The forge was found by a new record carrying the run's values, not by the forged value. */
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
          // Only a forge the app may have taken counts: a record that shows up after a refusal came from elsewhere.
          if (read !== "gone" && answeredOk(outcome) && fresh(read.json)) {
            stored = sent[sent.length - 1]!;
            storedAsNew = true;
            break;
          }
          // No answer (none within FORGE_WAIT_MS, or the connection closed): the app may still be storing it, so no
          // other forge is sent on top of it, and the verdict can't be a pass.
          if (outcome.status === null) break;
        }
      } catch (error) {
        // A forge may already have been sent: put the test record back first, then say what may be left.
        const message = error instanceof Error ? error.message : String(error);
        const put = sent.length > 0 ? await putBack(ctx, page, { snap, updates, create: save, marker, via, fresh }).catch(() => [] as string[]) : [];
        throw new Error(hide([message.replace(/\.?$/, "."), ...put, sent.length > 0 ? INTERRUPTED_NOTE : ""].filter(Boolean).join(" ")));
      } finally {
        await cross.dispose();
      }

      // 4. Restore when something may have changed, then the verdict from the re-read.
      const restoreNotes = stored || rereadFailed ? await putBack(ctx, page, { snap, updates, create: save, marker, via, fresh }) : [];
      // The body's fields left out, each said for what Run Hound knows it to be: a token (by its name, or a value the
      // app also gave as a token), or a random value it can't place (a token, or a reference such as an id), named by
      // where the value came from (a hidden input, or only the save's URL).
      const named = bodies.dropped.filter((k) => !bodies.unplaced.includes(k));
      const unplacedWhat = (ks: string[]) => {
        const part = (xs: string[], where: string) => `${listed(xs)}, ${xs.length === 1 ? "a random value" : "random values"} ${where} Run Hound can't place`;
        const inUrl = ks.filter((k) => bodies.urlOnly.includes(k));
        const inPage = ks.filter((k) => !inUrl.includes(k));
        const parts = [inPage.length > 0 ? part(inPage, "in a hidden input") : "", inUrl.length > 0 ? part(inUrl, "from the save's URL") : ""].filter(Boolean);
        return `${parts.join(", and ")} (a token, or a reference such as an id)`;
      };
      const droppedNote = [
        named.length > 0
          ? `The forged body left out ${named.join(", ")}, which carr${named.length === 1 ? "ies" : "y"} Account A's anti-CSRF token: a page on another site can't know it.`
          : "",
        bodies.unplaced.length > 0 ? `${named.length > 0 ? "It also left out" : "The forged body left out"} ${unplacedWhat(bodies.unplaced)}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const urlNote = queryNote(urlDropped);
      const credentials = urlDropped.filter((d) => d.kind === "credential").map((d) => d.name);

      if (stored && stored.outcome.cookies.length === 0 && credentials.length > 0) {
        // No cookie rode (or Run Hound never saw which did) and the credential the app's own page put in the URL was
        // left out, yet the value was stored: "the save needs no session" can't be claimed, since the credential may also
        // ride elsewhere in the request (a body field, a path segment) that Run Hound didn't strip. Never confirmed,
        // never a pass.
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
        // CORS allowed the attacker page because it is on loopback, and refused an origin that isn't: an allowlist of
        // loopback origins (every localhost and 127.0.0.1 port), never "any site". Only a page served from Account A's
        // own machine can send it, so the finding is advisory.
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
        // Cookies a browser attaches to a request from another site: the ones that may have ridden on an unseen forge.
        const mayRide = cookies.filter((c) => c.sameSite === "None").map((c) => c.name);
        const why = !seen
          ? `Run Hound didn't see the app's answer to the forged request, so it can't say which of Account A's cookies the browser attached${mayRide.length > 0 ? ` (Account A's browser holds ${listed(mayRide.map((n) => `${n} (SameSite=None)`))}, which a browser attaches to a request from another site)` : ""}; either way the server stored a request from another site with no CSRF token and no Origin check`
          : carried.length > 0
            ? `the browser attached Account A's cookie${carried.length === 1 ? "" : "s"} ${carried.map((n) => `${n} (SameSite=${sameSite(n)})`).join(", ")} to a request from another site, and the server accepted it with no CSRF token and no Origin check`
            : "the server stored the value in Account A's data although the browser attached no cookie to the request at all: the save doesn't need Account A's session, and it has no CSRF token or Origin check";
        const viaCors = stored.encoding === "json";
        // No cookie rode on the forged request and it was still stored: the save doesn't need Account A's session at
        // all, so a CSRF defence alone (a SameSite cookie, a token) wouldn't fix it. The session comes first. Only when
        // the request's cookies were seen: an answer Run Hound never saw says nothing about the cookies it carried.
        const noSession = seen && carried.length === 0;
        // Unseen cookies: the fix also asks to make sure the save needs the session, as it can't be told either way.
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
              // A token session only when A's browser holds no cookie for the target at all; a cookie session whose
              // reads need a header the page adds (a CSRF or API-key header) is still a cookie session.
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

      // A forge the app didn't answer (none within FORGE_WAIT_MS, or the connection closed), and nothing it sent is
      // stored yet: the app may still store it after this re-read (a slow save, a queue), and no answer says nothing
      // about what stopped it. Never a pass, never a defence named; A is sent to look.
      const unanswered = sent.filter((a) => a.outcome.status === null);
      if (unanswered.length > 0 && unanswered.every((a) => !a.outcome.sent)) {
        // The browser couldn't send it at all (the connection was refused, the host didn't resolve): nothing reached
        // the app, so nothing may still be stored, and nothing was learned either.
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

      // The app said yes, and the record endpoint reads only this record: a record the forged create may have made
      // elsewhere wouldn't show in the re-read, so this can't be a pass.
      const unseen = sent.filter((a) => answeredOk(a.outcome));
      if (unseen.length > 0 && !readsList(first.json, snap.record)) {
        return skip(
          hide(
            `Inconclusive: the app answered the forged ${tried(unseen)} request from ${cross.origin}, and the record endpoint reads only the test record, so Run Hound can't see whether the forged request created a new one: check Account A.`,
          ),
        );
      }

      // A forge sent the way the app's own save is (form-encoded for a form post), carrying Account A's cookie and with
      // nothing left out, answered 400: the app refused the forged value (a rule it breaks that the value the app
      // accepted didn't), not the request, so no defence was seen. Never a pass. With a token field or a query token left
      // out, a 400 may be the app's CSRF defence answering (ASP.NET's), so the usual verdict stands.
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

      // Pass: the re-read shows no forged value. A's session is a token the app's scripts send as a header, not a cookie,
      // only when A's own page couldn't read as A with its cookies (via "request"), A's browser holds no cookie for the
      // target, and none rode on a forged request: then nothing could sign the forge in as A, whatever else the save
      // checks. A cookie session whose reads also need a header the page adds (such as an X-CSRF-Token) is re-read the
      // same way, but a SameSite cookie, a CSRF token or an Origin check is what stopped the forge there.
      const tokenSession = via === "request" && cookies.length === 0 && sent.every((a) => a.outcome.cookies.length === 0);
      // A forge that carried Account A's cookie, or may have (its answer wasn't seen and A's browser holds one).
      const rode = (a: (typeof sent)[number]) => a.outcome.cookies.length > 0 || (!a.outcome.cookiesSeen && cookies.length > 0);
      // A random value Run Hound can't place was left out and a forge that rode on A's cookie was refused anyway: the
      // refusal is taken for a CSRF defence's answer to a missing token, but the value may be one the save needs, so
      // the pass never names a defence Run Hound didn't see.
      const unsure = bodies.unplaced.length > 0 && sent.some(rode);
      const passNote = tokenSession
        ? `A page on ${cross.origin} could not change Account A's data: Account A's session is a token the app's own scripts add to each request (such as a bearer token), not a cookie, so there is no cookie for the browser to attach to a request from another site, and the forged save wasn't stored.` +
          (wasJson && !cors ? " The save is also sent as JSON, which needs a preflight from another site." : "")
        : wasJson
          ? `A page on ${cross.origin} could not change Account A's data. The save is sent as JSON, which needs a preflight from another site${cors ? "" : " (the app's CORS doesn't allow that origin)"}, and the app didn't take the forged save otherwise.`
          : sent.some((a) => a.outcome.status !== null && answeredOk(a.outcome))
            ? // The app said yes and stored nothing: no defence was seen, so none is named.
              `A page on ${cross.origin} could not change Account A's data: the app answered the forged cross-site request as if it succeeded, but re-reading as Account A shows nothing it sent was stored.`
            : unsure
              ? `A page on ${cross.origin} could not change Account A's data: the app refused the forged cross-site request although it carried Account A's cookie, with an answer a missing value doesn't usually explain (403, 419, 401, 415 or a redirect to sign-in). Run Hound takes that for a defence, but it left out a random value it can't place (below), so it can't rule out that the app refused a missing value the save needs instead.`
              : `A page on ${cross.origin} could not change Account A's data: the forged cross-site request was rejected or had no effect (a SameSite cookie, a CSRF token or an Origin check stopped it).`;
      const triedNote = `Tried: ${tried(sent)}.`;

      // Several POSTs carried the typed values and no answer tied one to the test record: the one forged may not be the
      // save, so nothing stored is not a pass.
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

      // A random value the app's own page put in the URL was left out, and the forge carried Account A's cookie and was
      // refused: the value may be an identifier a page on another site could know, not a token, so the refusal may be
      // the missing value rather than a CSRF defence.
      const unplaced = urlDropped.filter((d) => d.kind === "secret").map((d) => d.name);
      // A forge whose answer wasn't seen may have carried a cookie Account A's browser holds for the target.
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

      // A field left out of the body by its value alone (a random value in a hidden input Run Hound can't place: a
      // token, or a reference such as a UUID list_id), and a forge that carried (or may have carried) Account A's cookie
      // was refused the way an app refuses a missing or bad value (400, 404, 409, 422, a 5xx, or a 2xx or 3xx that
      // stored nothing): the missing value may be what stopped it, not a CSRF defence. Never a pass. A 403 counts too
      // when a field left out looks like a reference (an id-like name, a UUID or an ObjectId): an authorization check
      // (Pundit, CanCanCan, a Laravel Gate) answers a missing or foreign reference with 403 as readily as a CSRF defence
      // answers a request from another site. A 419 (Laravel's answer to a missing CSRF token), a 401 or a redirect to
      // sign-in (the session refused) and a 415 (the encoding refused) are answers a missing value doesn't explain, so
      // the usual verdict stands for them; so does a 403 when nothing says the value is a reference (a home-made token
      // under a name no list knows), and the pass then names no defence (passNote).
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
              `Inconclusive: the forged body left out ${unplacedWhat(bodies.unplaced)}. The forged ${tried(byValue)} request from ${cross.origin} ${carried ? "carried Account A's cookie" : "may have carried Account A's cookie (Run Hound didn't see which cookies rode on it)"} and wasn't stored, and an app answers a missing or bad value that way as readily as a request from another site, so Run Hound can't tell whether a CSRF defence or the missing value stopped it: check who may send ${saveEndpoint}.${refNote}`,
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

/** A card of the forged request and the cookies it carried (names and SameSite only; the context redacts the text). */
async function forgedCard(
  ctx: CheckContext,
  saveEndpoint: string,
  via: string,
  outcome: ForgeOutcome,
  cookies: TargetCookie[],
  bodies: Pick<ForgedBodies, "dropped" | "unplaced">,
): Promise<Evidence[]> {
  const named = bodies.dropped.filter((k) => !bodies.unplaced.includes(k));
  const sameSite = (name: string) => cookies.find((c) => c.name === name)?.sameSite ?? "unknown";
  const carried = outcome.cookies;
  // An answer Run Hound never saw says nothing about the cookies the request carried: never "no cookie".
  const attached = !outcome.cookiesSeen
    ? "Run Hound didn't see the app's answer, so which cookies the browser attached isn't known."
    : carried.length > 0
      ? `Cookies the browser attached: ${carried.join(", ")}`
      : "The browser attached no cookie.";
  return tryCard(ctx, "The forged cross-site request", {
    title: `${saveEndpoint} forged from another site`,
    subtitle: "Sent from a page on a different site in Account A's browser, with a new value.",
    lines: [
      { text: `Sent as: ${via}`, mark: true },
      { text: attached, mark: true },
      { text: "No CSRF token and no Origin check stopped it.", mark: true },
    ],
    facts: [
      { label: "How it was sent", value: via },
      {
        label: "Cookies attached (SameSite)",
        value: !outcome.cookiesSeen ? "not seen" : carried.length > 0 ? carried.map((n) => `${n} (${sameSite(n)})`).join(", ") : "none",
      },
      ...(named.length > 0 ? [{ label: "Token fields left out", value: named.join(", ") }] : []),
      ...(bodies.unplaced.length > 0 ? [{ label: "Random values left out (a token, or a reference)", value: bodies.unplaced.join(", ") }] : []),
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
  /** Query parameters left out of SAVE and RECORD (a token or a credential the app's own page put there). */
  saveLeftOut?: string[];
  recordLeftOut?: string[];
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
    `// The save was stored when sent ${o.encoding === "form" ? "form-encoded" : o.encoding === "multipart" ? "as a multipart form (multipart/form-data)" : o.encoding === "text" ? "as JSON with a text/plain content-type" : "as JSON (CORS allowed the other site)"} from another site.`,
    `const TARGET = ${q(o.target)};`,
    `const SAVE = ${q(path(o.save))}; // the form's own save`,
    ...(o.saveLeftOut && o.saveLeftOut.length > 0
      ? [`// Run Hound left ${o.saveLeftOut.join(", ")} out of SAVE: the app's own page adds Account A's token or credential there, which a page on another site can't know.`]
      : []),
    `const RECORD = ${q(path(o.record))}; // reads the saved record back as Account A`,
    ...(o.recordLeftOut && o.recordLeftOut.length > 0
      ? [`// Run Hound left ${o.recordLeftOut.join(", ")} out of RECORD: add Account A's own value${o.recordLeftOut.length === 1 ? "" : "s"} to the re-read.`]
      : []),
    `const FIELDS = ${q(o.fields)} as string[];`,
    `const FORGED_FIELD = ${q(o.marked)};`,
    `const ENCODING = ${q(o.encoding)} as "form" | "multipart" | "text" | "json";`,
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
    `      if (encoding === "form" || encoding === "multipart") {`,
    `        const iframe = document.createElement("iframe"); iframe.name = "forged"; document.body.append(iframe);`,
    `        const form = document.createElement("form"); form.method = "POST"; form.action = url; form.target = "forged";`,
    `        if (encoding === "multipart") form.enctype = "multipart/form-data";`,
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
