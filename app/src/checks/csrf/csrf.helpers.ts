/** Pure predicates and small helpers for the csrf check: status → words, verdict predicates, note builders. */

import type { ForgeAttempt } from "../../interfaces/csrf.js";
import { forgeWaitMs } from "../lib/cross-site.js";
import { SIGN_IN_PATH } from "../../constants/csrf-constants.js";
import type { ForgeOutcome } from "../lib/cross-site.js";
import type { DroppedParam } from "../lib/cross-site-query.js";

/** How long a forge waits for its answer, in words: "30 seconds". */
export function waitWords(): string {
  const s = forgeWaitMs() / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} second${s === 1 ? "" : "s"}`;
}

/** A failed forge, in words: the connection closed after it went out, or the browser couldn't send it at all. */
export const failedWords = (o: ForgeOutcome) =>
  o.sent ? "the connection closed with no answer" : `the browser couldn't send it${o.failure ? `: ${o.failure}` : ""}`;

/** Why a forge has no answer, in words: as a status ("no answer within 30 seconds"), or as a reason ("none came …"). */
export const noAnswer = (o: ForgeOutcome) => (o.unanswered === "failed" ? failedWords(o) : `no answer within ${waitWords()}`);
export const whyNoAnswer = (o: ForgeOutcome) => (o.unanswered === "failed" ? failedWords(o) : `none came within ${waitWords()}`);

/** "form-encoded (403)", "text/plain (no answer within 30 seconds)". */
export function tried(attempts: ForgeAttempt[]): string {
  return attempts.map((a) => `${a.note} (${a.outcome.status ?? noAnswer(a.outcome)})`).join(", ");
}

/** True when the app may have taken the forge: a 2xx, a 3xx that isn't a redirect to a sign-in page, or no answer. */
export const answeredOk = (o: ForgeOutcome) =>
  o.status === null || (o.status >= 200 && o.status < 300) || (o.status >= 300 && o.status < 400 && !SIGN_IN_PATH.test(o.location ?? ""));

/** An answer a value missing from the body doesn't explain: a CSRF defence (403, 419), a refused session (401, sign-in), or a refused encoding (415). */
export const refusesRequest = (o: ForgeOutcome) =>
  o.status === 401 ||
  o.status === 403 ||
  o.status === 415 ||
  o.status === 419 ||
  (o.status !== null && o.status >= 300 && o.status < 400 && SIGN_IN_PATH.test(o.location ?? ""));

/** "a, b and c". */
export const listed = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A URL's query parameters, in order; none when it can't be parsed. */
export function queryOf(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams];
  } catch {
    return [];
  }
}

/** The note naming the query parameters left out of the forged request's URL, by what they carry. */
export function queryNote(dropped: DroppedParam[]): string {
  if (dropped.length === 0) return "";
  const what = [
    dropped.some((d) => d.kind === "csrf") ? "Account A's anti-CSRF token" : "",
    dropped.some((d) => d.kind === "credential") ? "Account A's credential" : "",
    dropped.some((d) => d.kind === "secret") ? "a random value the app's own page added" : "",
  ].filter(Boolean);
  return `The forged request's URL left out ${listed(dropped.map((d) => d.name))}, which carr${dropped.length === 1 ? "ies" : "y"} ${listed(what)}: a page on another site can't know ${dropped.length === 1 ? "it" : "them"}.`;
}

/** The note naming the fields Run Hound left out by their value alone, said for where the value came from. */
export function unplacedWhat(ks: string[], urlOnly: readonly string[]): string {
  const part = (xs: string[], where: string) => `${listed(xs)}, ${xs.length === 1 ? "a random value" : "random values"} ${where} Run Hound can't place`;
  const inUrl = ks.filter((k) => urlOnly.includes(k));
  const inPage = ks.filter((k) => !inUrl.includes(k));
  const parts = [inPage.length > 0 ? part(inPage, "in a hidden input") : "", inUrl.length > 0 ? part(inUrl, "from the save's URL") : ""].filter(Boolean);
  return `${parts.join(", and ")} (a token, or a reference such as an id)`;
}