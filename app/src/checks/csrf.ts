/**
 * csrf (0.5.0, docs/v2-spec.md "`csrf`"): can a page on another site make Account A's browser change Account A's data?
 * A real browser page on a different *site* from the target (localhost vs 127.0.0.1) submits the save this form makes
 * for the run's test record, with a new run-token value, in Account A's own browser context. The browser attaches
 * cookies for itself, so a SameSite=Lax cookie stays home and a SameSite=None cookie rides along. Only requests a
 * cross-site page can send without a CORS preflight are sent (form-encoded, then a JSON save's payload as text/plain;
 * a JSON body only when the app's own answer to a real preflight allows the attacker origin with credentials), and
 * never with a CSRF token. The verdict is a re-read as Account A: a finding only when the forged value is stored; a
 * failed re-read is inconclusive, never a pass. Then the test record is restored, only through an update the app
 * itself sent for it. Unticked by default: it changes Account A's data and restores it.
 */
import { isLocalOrigin, isSameOrigin, tokenKey } from "../core/saves.js";
import type { Page } from "playwright";
import type { Check, CheckContext, Evidence, Finding, PlanEnv, Scenario } from "../core/types.js";
import { crossSitePage, type ForgeEncoding, type ForgeOutcome, type TargetCookie } from "./lib/cross-site.js";
import { endpointOf, errorResult, guarded, result, tryCard } from "./lib/functional-finding.js";
import { canaryValues, createRequests, fillForm, settle, submitControl, submitForm, waitForCreates, type FieldValue } from "./lib/functional-form.js";
import {
  changedFields,
  findOwnRecord,
  jsonObjectBody,
  locateRecord,
  neverWritten,
  readsList,
  recordChains,
  recordWrites,
  restoreRecord,
  savesOwnRecord,
  snapshotFrom,
  type CapturedRequest,
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

/**
 * GETs the record endpoint from Account A's own browser page: its JSON, "gone" for a 404 or 410, null when the read
 * failed. The re-read goes through the browser, not CheckContext.request, on purpose: a SameSite=None cookie is
 * `Secure`, and the request context does not send a `Secure` cookie over http to 127.0.0.1, while the browser does
 * (localhost and 127.0.0.1 are potentially trustworthy). So this is a real re-read as Account A.
 */
async function readInPage(page: Page, url: string): Promise<{ json: unknown } | "gone" | null> {
  const answer = await page
    .evaluate(async (u) => {
      const res = await fetch(u, { credentials: "include" });
      return { status: res.status, body: await res.text() };
    }, url)
    .catch(() => null);
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
 * Puts the test record back after the forge, from a re-read as Account A through its browser page: it restores the
 * test record when the forge changed it (only through an update the app itself sent for its id, never the create), or
 * creates it again when it is gone, and names a new record the forge created. The notes say what could not be undone.
 */
async function putBack(
  ctx: CheckContext,
  page: Page,
  o: { snap: RecordSnapshot; updates: CapturedRequest[]; create: CapturedRequest; marker: string },
): Promise<string[]> {
  const read = await readInPage(page, o.snap.url);
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
      now === "gone" || update ? await restoreRecord(ctx, o.snap, { save: update ?? o.create, create: o.create }) : { restored: [], notRestored: changed };
    if (restored.length > 0) notes.push(`Restored ${restored.join(", ")} of Account A's test record.`);
    if (notRestored.length > 0) {
      notes.push(
        update || now === "gone"
          ? `Could not be undone: ${notRestored.join(", ")} of Account A's test record: check Account A.`
          : `Could not be undone: the forged request changed ${notRestored.join(", ")} of Account A's test record, and the app sent no update for it that Run Hound could reuse: check Account A.`,
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

      // 1. As Account A, create the test record through the form and capture its save request.
      const { page, capture } = await ctx.openPage({ as: "self" });
      ctx.step("Saving a test record as Account A", page);
      // Salt "xsite": the marker below inserts "csrf" after the run token, so the salt must not itself contain "csrf",
      // or Account A's own saved values would already match the marker and every run would look like a finding.
      const values: FieldValue[] = canaryValues(form, ctx.runToken, "xsite");
      await fillForm(page, values);
      await submitForm(page, form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken).filter(
        (r) => isSameOrigin(r.url, ctx.targetUrl) || isLocalOrigin(r.url, ctx.targetUrl),
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
      const first = await readInPage(page, recordGet.url);
      const snap = first && first !== "gone" ? snapshotFrom(recordGet.url, first.json, testValues, ctx.runToken) : null;
      if (!first || first === "gone" || !snap) {
        return skip("Skipped: Run Hound couldn't read the test record back as Account A, so it can't tell whether a forged write worked.");
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
          const read = await readInPage(page, recordGet.url);
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
        const put = sent.length > 0 ? await putBack(ctx, page, { snap, updates, create: save, marker }).catch(() => [] as string[]) : [];
        throw new Error([message.replace(/\.?$/, "."), ...put, sent.length > 0 ? INTERRUPTED_NOTE : ""].filter(Boolean).join(" "));
      } finally {
        await cross.dispose();
      }

      // 4. Restore when something may have changed, then the verdict from the re-read.
      const restoreNotes = stored || rereadFailed ? await putBack(ctx, page, { snap, updates, create: save, marker }) : [];
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
        const evidence = await forgedCard(ctx, saveEndpoint, stored.note, carried, cookies, bodies.dropped);
        const finding: Finding = {
          checkId: ID,
          id: `${ID}#${scenario.id}-1`,
          title: "A page on another site can change Account A's data (no CSRF protection)",
          severity: "high",
          category: "security",
          confidence: "confirmed",
          meaning:
            `Run Hound opened a page on a different site (${cross.origin}) in Account A's browser and sent ${saveEndpoint} again with a new value (${stored.note}). ` +
            `Re-reading the record as Account A showed the new value: ${why}.` +
            (viaCors ? " The app's CORS answer allows that origin with credentials, which is also a CORS issue (cors): any site can send this JSON save and read the answer." : ""),
          impact:
            "Any web page Account A visits could silently make this change (or any other this form makes) on their behalf, without them ever submitting the form. This is a cross-site request forgery (CSRF) flaw.",
          fix: viaCors
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

      // Pass: the re-read shows no forged value.
      const passNote = wasJson
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
 * value in the forged field and the other fields empty, and re-reads the record endpoint as Account A: the made-up
 * value must not be there. No value Run Hound typed, no token and no credential is written into it.
 */
function replaySpec(o: {
  target: string;
  save: string;
  record: string;
  fields: string[];
  marked: string;
  encoding: ForgeEncoding;
  attackerOrigin: string;
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
    `    const own = await context.newPage();`,
    `    await own.goto(TARGET);`,
    `    const text = await own.evaluate(async (u) => (await fetch(u, { credentials: "include" })).text(), new URL(RECORD, TARGET).href);`,
    `    expect(text, "the value sent from another site was stored").not.toContain(forged);`,
    `  } finally {`,
    `    await browser.close();`,
    `    server.close();`,
    `  }`,
    `});`,
    ``,
  ].join("\n");
}
