/**
 * client-only-validation: capture the form's save request (answered by the check, so the valid record is
 * never stored), then replay it to the real server with the end date moved before the start date (or, when
 * the form has no date range, a field the form refuses when empty, emptied). Which fields those are is learnt by
 * submitting the form empty with every write answered by Run Hound (probeEmptySubmit: nothing reaches the app), so a
 * schema-validated form that marks nothing as required is covered, and an optional field is never emptied (the server
 * rightly accepts it empty); fields marked required come after them. Pass when the server rejects it with 4xx (or answers
 * with a redirect, which is not followed and counts as "not accepted"); fail on 2xx (accepted) and on 5xx (the
 * server broke instead of rejecting it). Localhost targets only: on any other target the scenario is still planned,
 * so the plan and the report say why it did not run, and it is skipped. Creates at most one test record.
 * The replay is sent from inside the page (fetch with redirect: "manual"), so it goes through the same pinned
 * browser and navigation guard as everything else, never through a separate HTTP client with its own DNS lookup.
 */
import type { Request } from "playwright";
import { isPagePost, isSameOrigin } from "../core/saves.js";
import type { Check, DiscoveredForm, Scenario } from "../core/types.js";
import { bodyLines, clip, endpointOf, errorResult, evidence, findingFactory, guarded, result, specSource, tryCard } from "./lib/functional-finding.js";
import {
  armFieldErrors,
  canaryValues,
  fieldName,
  fillForm,
  isCreatePlaywrightRequest,
  isSearchForm,
  MULTI_STEP_NOTE,
  PAGE_POST_NOTE,
  probeEmptySubmit,
  shiftDay,
  simulatedResponse,
  STOPPED_PAGE_POST_HTML,
  submitForm,
  waitFor,
  watchNextStep,
  whyNothingSent,
  type EmptySubmit,
  type FieldValue,
} from "./lib/functional-form.js";
import { fieldKind } from "./lib/widgets.js";

const ID = "client-only-validation" as const;

/**
 * Headers the browser sets on its own (fetch refuses to set them, or sets them from the page): everything else is
 * replayed as captured. Cookies still go with the request, because it is sent from the page.
 */
const DROP_HEADERS = /^(:|content-length$|host$|connection$|cookie$|accept-encoding$|accept-language$|origin$|referer$|user-agent$|sec-|proxy-|keep-alive$|te$|trailer$|transfer-encoding$|upgrade$|via$|date$|expect$|dnt$)/i;

/**
 * Sent from the page so the request uses the pinned browser; redirect "manual" means a 3xx is never followed. A server
 * that never answers is given 10 seconds (page.evaluate has no timeout of its own): status -2.
 */
const REPLAY = `async (args) => {
  try {
    const res = await fetch(args.url, { method: args.method, headers: args.headers, body: args.body, redirect: "manual", credentials: "same-origin", signal: AbortSignal.timeout(10000) });
    if (res.type === "opaqueredirect") return { status: 0, redirected: true, text: "" };
    return { status: res.status, redirected: false, text: (await res.text()).slice(0, 4000) };
  } catch (err) {
    if (err && err.name === "TimeoutError") return { status: -2, redirected: false, text: "" };
    return { status: -1, redirected: false, text: String(err && err.message || err) };
  }
}`;

/** The host of `url` for plan text, or the URL itself when it does not parse. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Why the check does not run on a non-localhost target; shown as the skipped scenario's note. */
export const LOCAL_ONLY_NOTE =
  "Skipped: replaying requests straight to the server only runs against localhost targets (even when the host is allowed through RUNHOUND_ALLOWED_HOSTS).";

export function isLocalTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1";
  } catch {
    return false;
  }
}

interface Mutation {
  /** Human description, e.g. "End date (2026-10-03) before Start date (2026-10-06)". */
  describe: string;
  /** Field name for the finding. */
  field: string;
  /** Key in the body that was changed, and the value sent instead. */
  key: string;
  value: string;
  body: string;
}

/** Headers whose values are credentials: shown on evidence as masked. */
const SECRET_HEADERS = /csrf|xsrf|cookie|authorization|token|api-?key|session/i;

/** A captured body as fields, and how to turn changed fields back into a body. JSON objects and urlencoded bodies. */
interface ParsedBody {
  fields: Record<string, unknown>;
  encode(fields: Record<string, unknown>): string;
}

function parseBody(body: string): ParsedBody | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { fields: { ...(parsed as Record<string, unknown>) }, encode: (f) => JSON.stringify(f) };
  } catch {
    const params = new URLSearchParams(body);
    if ([...params.keys()].length === 0) return null;
    return { fields: Object.fromEntries(params.entries()), encode: (f) => new URLSearchParams(f as Record<string, string>).toString() };
  }
}

/** The key of `body` holding `value` exactly, if any. */
function keyFor(body: ParsedBody, value: string): string | undefined {
  return Object.keys(body.fields).find((k) => body.fields[k] === value);
}

/** The end date moved before the start date, when the form has a date range the body carries. */
function dateMutation(body: ParsedBody, values: FieldValue[]): Mutation | null {
  const dates = values.filter((v) => v.field.type === "date");
  const start = dates[0];
  const end = dates.find((d) => d.value !== start?.value);
  if (!start || !end) return null;
  const startKey = keyFor(body, start.value);
  const endKey = keyFor(body, end.value);
  if (!startKey || !endKey) return null;
  const before = shiftDay(start.value, -3);
  return {
    describe: `${fieldName(end.field)} (${before}) set before ${fieldName(start.field)} (${start.value})`,
    field: fieldName(end.field),
    key: endKey,
    value: before,
    body: body.encode({ ...body.fields, [endKey]: before }),
  };
}

/**
 * The first of `candidates` (fields the form refuses empty) that the body carries, emptied: a text field by its typed
 * value, a choice by its name when the body holds a non-empty string under it.
 */
function emptyMutation(body: ParsedBody, candidates: FieldValue[]): Mutation | null {
  for (const v of candidates) {
    const kind = fieldKind(v.field);
    let key: string | undefined;
    if (kind === "text" && v.value) key = keyFor(body, v.value);
    else if (kind === "select" || kind === "radio" || kind === "combobox" || kind === "custom") {
      const held = body.fields[v.field.key];
      if (typeof held === "string" && held !== "") key = v.field.key;
    }
    if (key) return { describe: `required ${fieldName(v.field)} left empty`, field: fieldName(v.field), key, value: "", body: body.encode({ ...body.fields, [key]: "" }) };
  }
  return null;
}

/** The fields to try emptying: the ones the form refused when empty, then the ones marked required, in form order. */
function emptyCandidates(values: FieldValue[], empty: EmptySubmit): FieldValue[] {
  const refused = values.filter((v) => empty.refused.includes(v.field));
  return [...refused, ...values.filter((v) => v.field.required && !refused.includes(v))];
}

/** Why no field could be made invalid (a skipped scenario's note). */
function noRuleNote(values: FieldValue[], empty: EmptySubmit): string {
  const candidates = emptyCandidates(values, empty);
  if (candidates.length > 0) {
    const names = candidates.slice(0, 4).map((v) => `"${fieldName(v.field)}"`);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]!;
    const one = candidates.length === 1;
    return `Skipped: the form needs ${list}${candidates.length > 4 ? " and more" : ""}, but its save request doesn't carry ${one ? "that field" : "those fields"} as typed, so Run Hound couldn't send the request with ${one ? "it" : "one of them"} left empty. The form has no date range to break either.`;
  }
  const sent = empty.sent ? " (the page sent it as it was; Run Hound answered that request itself, so nothing was saved)" : "";
  return `Skipped: submitting the form empty showed no error on any field${sent}, and the form has no date range, so there was no rule of the form's own to break when sending its save request straight to the server.`;
}

export const check: Check = {
  id: ID,
  title: "The server validates input too",
  category: "validation",

  plan(form: DiscoveredForm): Scenario[] {
    // A search form saves nothing, so there is no saved record to test (V1: every form on the page is planned).
    if (isSearchForm(form)) return [];
    const hasRange = form.fields.filter((f) => f.type === "date").length >= 2;
    // Planned on every target so a non-localhost run shows it (and why it was skipped) instead of silently leaving it out.
    const local = isLocalTarget(form.url);
    return [
      {
        id: "replay-invalid",
        checkId: ID,
        title: hasRange ? "Send an end date before the start date straight to the server" : "Send an invalid request straight to the server",
        description: `Capture the save request from ${form.name ?? "the form"} (it is answered by Run Hound, so nothing is saved), then send it to the server with one field made invalid${hasRange ? " (end date before start date)" : ""}. The server must reject it. ${
          local ? "Localhost only; creates at most one test record." : `Will be skipped: this check only runs against localhost targets, and ${safeHost(form.url)} is not one.`
        }`,
        kind: "danger",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      if (!isLocalTarget(ctx.targetUrl)) return errorResult(ID, scenario, started, LOCAL_ONLY_NOTE, "skipped");
      const { page, capture } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "replay");

      // The page may write to more than one of its own endpoints on submit (telemetry, a log). The request
      // that carries the typed values is the save request; anything else is let through untouched.
      const typed = values.filter((v) => v.value).map((v) => v.value);
      let captured: Request | null = null;
      let firstWrite: Request | null = null;
      let pagePost = false;
      await page.route("**/*", async (route, request) => {
        if (captured || pagePost || !isCreatePlaywrightRequest(request, ctx.targetUrl, ctx.runToken)) return route.fallback();
        const body = request.postData() ?? "";
        if (isPagePost({ resourceType: request.resourceType() })) {
          // A classic form post: its answer is a page, and a redirect is how it says "saved", so a replay could not
          // tell an accepted request from a rejected one. Stopped here so nothing is saved; the scenario is skipped.
          pagePost = true;
          return route.fulfill(simulatedResponse(request, 200, STOPPED_PAGE_POST_HTML, "text/html; charset=utf-8"));
        }
        if (!typed.some((value) => body.includes(value))) {
          // Only a write to the page's own origin is a candidate without the typed values (another origin never is).
          if (isSameOrigin(request.url(), ctx.targetUrl)) firstWrite ??= request;
          return route.fallback();
        }
        captured = request;
        // Answer it ourselves so the valid record is never created.
        await route.fulfill(simulatedResponse(request, 201, body || "{}"));
      });
      ctx.step("Filling the form and capturing its save request (answered by Run Hound)", page);
      const unset = await fillForm(page, values);
      const step = await watchNextStep(page, capture, ctx.targetUrl, ctx.runToken);
      await armFieldErrors(page);
      await submitForm(page, ctx.form);
      await waitFor(() => captured !== null || pagePost, 5000);

      if (pagePost && !captured) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        return errorResult(ID, scenario, started, PAGE_POST_NOTE, "skipped");
      }
      const request = (captured ?? firstWrite) as Request | null;
      if (!request) {
        // The first step of a wizard saves nothing: it shows the next step. That is not a refusal.
        const moved = await step.moved();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        if (moved) return errorResult(ID, scenario, started, MULTI_STEP_NOTE, "skipped");
        const why = await whyNothingSent(page, ctx.form, values, unset);
        return errorResult(
          ID,
          scenario,
          started,
          `Skipped: submitting the form sent no save request (nothing carrying the typed values reached a server), so there was nothing to replay. ${why}`,
          "skipped",
        );
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (!isLocalTarget(request.url())) {
        return errorResult(ID, scenario, started, `Skipped: the form saves to ${safeHost(request.url())}, which is not on this machine; replaying requests only runs against localhost.`, "skipped");
      }
      const body = parseBody(request.postData() ?? "");
      if (!body) {
        return errorResult(ID, scenario, started, "Skipped: the save request's body is neither JSON nor form data, so Run Hound can't make one of its fields invalid.", "skipped");
      }
      let mutation = dateMutation(body, values);
      if (!mutation) {
        // Which fields does the form itself refuse empty? Submitting it empty (every write answered by Run Hound, so
        // nothing reaches the app) says so; an optional field is never emptied, since the server may rightly accept it.
        ctx.step("Submitting the form empty to learn which fields it refuses (answered by Run Hound, nothing is saved)", page);
        const empty = await probeEmptySubmit(ctx);
        mutation = emptyMutation(body, emptyCandidates(values, empty));
        if (!mutation) return errorResult(ID, scenario, started, noRuleNote(values, empty), "skipped");
      }

      const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([k]) => !DROP_HEADERS.test(k)));
      ctx.step(`Sending ${endpointOf(request.method(), request.url())} to the server with ${mutation.describe}`, page);
      // Sent from the page with redirect "manual": the replay must reach the target's own endpoint, never wherever it
      // redirects to, and it goes through the pinned browser like every other request.
      const replay = (await page.evaluate(`(${REPLAY})(${JSON.stringify({ url: request.url(), method: request.method(), headers, body: mutation.body })})`)) as {
        status: number;
        redirected: boolean;
        text: string;
      };
      if (replay.status === -1) return errorResult(ID, scenario, started, `The replayed request could not be sent: ${replay.text}`);
      if (replay.status === -2) {
        return errorResult(
          ID,
          scenario,
          started,
          `The server did not answer within 10 seconds when Run Hound sent ${endpointOf(request.method(), request.url())} with ${mutation.describe}, so it is unknown whether the server checks it. A server that never answers bad input is worth a look too.`,
        );
      }
      const status = replay.status;
      const responseText = replay.text.slice(0, 2000);
      if (replay.redirected) {
        return result(ID, scenario, started, [], `Server answered a redirect (not followed, counts as not accepted) to a request with ${mutation.describe}.`);
      }
      const replayEvidence = evidence("network", `Replayed ${request.method()} ${request.url()} with ${mutation.describe} → ${status}`, {
        method: request.method(),
        url: request.url(),
        change: mutation.describe,
        requestBody: mutation.body,
        status,
        responseBody: responseText,
      });

      if ((status >= 300 && status < 500) || status < 200) {
        return result(ID, scenario, started, [], `Server answered ${status} to a request with ${mutation.describe}.`);
      }
      // 2xx: the server accepted invalid data. 5xx: it broke instead of rejecting it; still not a validation.
      const crashed = status >= 500;

      // Only the headers that matter to the server's decision; credentials are masked.
      const sentHeaders = Object.entries(headers)
        .filter(([k]) => /^(content-type|origin)$/i.test(k) || SECRET_HEADERS.test(k))
        .map(([k, v]) => `${k}: ${SECRET_HEADERS.test(k) ? "[masked]" : clip(v, 100)}`);
      const changedLine = (line: string) => line.includes(JSON.stringify(mutation.key)) || line.startsWith(`${mutation.key}=`);
      const card = await tryCard(ctx, "replayed request and response", {
        title: `${endpointOf(request.method(), request.url())} with ${mutation.describe} → ${status}`,
        subtitle: `${request.url()} (sent by Run Hound, skipping the browser's checks)`,
        lines: [
          { text: `${request.method()} ${request.url()}` },
          ...sentHeaders.map((text) => ({ text })),
          { text: "" },
          ...bodyLines(mutation.body).map((line) => ({ text: clip(line), mark: changedLine(line) })),
          { text: "" },
          { text: `Response ${status} (${crashed ? "server error, not a validation message" : "accepted"})`, mark: true },
          ...bodyLines(responseText, 16).map((line) => ({ text: clip(line), mark: changedLine(line) })),
        ],
        facts: [
          { label: "Field changed", value: mutation.field },
          { label: "Value sent", value: mutation.value === "" ? "(empty)" : mutation.value },
          { label: "Rule broken", value: mutation.describe },
          { label: "Response status", value: crashed ? `${status} (the server failed instead of rejecting it with 4xx)` : `${status} (the server accepted it)` },
          { label: "Request", value: endpointOf(request.method(), request.url()) },
        ],
      });
      const make = findingFactory(ID, "validation", scenario);
      const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => /^content-type$|csrf|xsrf/i.test(k)));
      const finding = make({
        title: crashed ? `The server fails with ${status} on ${mutation.describe} instead of rejecting it` : `The server accepts ${mutation.describe}`,
        severity: crashed ? "medium" : "high",
        location: `"${mutation.field}" field`,
        meaning: crashed
          ? `Run Hound sent the form's save request straight to the server with ${mutation.describe}, skipping any checks in the browser. The server answered ${status} (a server error) instead of a 4xx validation error, so it does not check this rule itself; it breaks on it.`
          : `Run Hound sent the form's save request straight to the server with ${mutation.describe}, skipping any checks in the browser, and the server saved it (${status}). Anyone who sends the request directly (a script, a modified page, an old app version) can save invalid data.`,
        impact: crashed
          ? "Invalid input causes server errors instead of a clear message; depending on where it breaks, part of the record may still be written, and the error may reveal internals."
          : "Invalid records end up in your database, which can break reports, billing or schedules, and a check that only runs in the browser gives a false sense of safety.",
        fix: `Ask your AI or developer: "Repeat the ${mutation.field} validation on the server for ${new URL(request.url()).pathname} and answer 400 with a clear message when it fails. Never rely on browser-only checks."`,
        evidence: [...card, replayEvidence],
        spec: {
          name: "server-rejects-invalid",
          source: specSource(ctx.targetUrl, `the server rejects ${mutation.describe}`, [
            `const response = await page.request.fetch(${JSON.stringify(request.url())}, {`,
            `  method: ${JSON.stringify(request.method())},`,
            `  headers: ${JSON.stringify(safeHeaders)},`,
            `  data: ${JSON.stringify(mutation.body)},`,
            `});`,
            `expect(response.status()).toBeGreaterThanOrEqual(400);`,
            `expect(response.status()).toBeLessThan(500);`,
          ]),
        },
      });
      return result(ID, scenario, started, [finding]);
    });
  },
};
