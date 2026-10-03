/**
 * Dependency-light URL and value helpers shared by the paywall-trust modules: hostOf, pathOf, pageKey, placeOf,
 * isPaymentProvider, ofTheApp, leavesTheApp, startsFrom, stepNoun, shown, listed, q, excerpt, pathWords.
 */
import { isSameOrigin, isLocalOrigin } from "../../core/saves.js";
import { urlWords } from "../lib/acting-links.js";
import { PAYMENT_PROVIDERS, PORTAL_STEP, START_STEP, SUCCESS_WORDS, SIGN_IN_PAGE, CHECKOUT_OR_PORTAL, PROVIDER_NAME } from "../../constants/paywall-trust-constants.js";

/** Lower-case hostname of `url`, or "" when it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True when `url` goes to a payment provider (PAYMENT_PROVIDERS, or a subdomain of one). */
export function isPaymentProvider(url: string): boolean {
  const host = hostOf(url);
  return host !== "" && PAYMENT_PROVIDERS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Pathname of `url`, or its original value when it doesn't parse. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Path and query of `url`: two links to the same page (with another hash) are one. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** A URL as a note names it: its path on `base`'s origin, else its host and path (`localhost:5174/checkout/start`). */
export function placeOf(url: string, base: string): string {
  if (isSameOrigin(url, base)) return pathOf(url);
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** The path's words, in urlWords form, for the regexes (START_STEP, RESTORE_HOLD, ...). */
export function pathWords(url: string): string {
  try {
    const u = new URL(url);
    return urlWords(`${u.origin}${u.pathname}`);
  } catch {
    return "";
  }
}

/** The app itself: this origin, or the app's API on another local origin. */
export function ofTheApp(to: string, url: string): boolean {
  return isSameOrigin(to, url) || isLocalOrigin(to, url);
}

/** A page load that would leave the app (`target`'s, see ofTheApp): an http(s) address of another site. */
export function leavesTheApp(to: string, target: string): boolean {
  return /^https?:/i.test(to) && !ofTheApp(to, target);
}

/**
 * Where a page opened at `url` may not go on its own while Run Hound has it open: another page of the app (ofTheApp)
 * whose path starts a checkout, a subscription or a billing portal session (START_STEP, PORTAL_STEP), unless that path
 * names the result (`/checkout/success`) or is the sign-in page.
 */
export function startsFrom(url: string): (to: string) => boolean {
  return (to) => {
    if (!ofTheApp(to, url) || pageKey(to) === pageKey(url) || SIGN_IN_PAGE.test(pathOf(to))) return false;
    const words = pathWords(to);
    return (PORTAL_STEP.test(words) || START_STEP.test(words)) && !SUCCESS_WORDS.test(words);
  };
}

/** What a held path is, as a note says it. */
export function stepNoun(url: string): string {
  const words = pathWords(url);
  if (CHECKOUT_OR_PORTAL.test(words)) return "a checkout or billing portal start";
  if (PROVIDER_NAME.test(words)) return "a path that names the payment provider";
  return "a path that may start a checkout or a subscription";
}

/** JSON-stringify `v`. */
export const q = (v: unknown) => JSON.stringify(v);

/** A value as a note or a card shows it: strings quoted, a missing field named, long values cut. */
export function shown(v: unknown): string {
  if (v === undefined) return "missing";
  const text = JSON.stringify(v) ?? String(v);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** `["a", "b", "c"]` as "a, b and c". */
export function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Text as a note quotes it: whitespace collapsed, at most 80 characters. */
export function excerpt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}