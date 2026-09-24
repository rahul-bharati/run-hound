/**
 * The visitor's analytics choice, kept in localStorage (not a cookie). Asked again after 12 months.
 * Every access is wrapped: storage can be unavailable (private windows, blocked site data).
 */
export type ConsentChoice = "granted" | "denied";

const KEY = "rh-analytics-consent";
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Fired on window when the choice changes or the settings are reopened. */
export const CONSENT_EVENT = "rh-consent";

export function readConsent(): ConsentChoice | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { choice, at } = JSON.parse(raw) as { choice?: unknown; at?: unknown };
    if ((choice !== "granted" && choice !== "denied") || typeof at !== "number") return null;
    return Date.now() - at > MAX_AGE_MS ? null : choice;
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { choice } }));
}

/** Reopens the consent banner (the footer's "Cookie settings" button). */
export function openConsentSettings() {
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { open: true } }));
}

/** Removes Google Analytics cookies after consent is withdrawn. */
export function clearAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name || !(name === "_ga" || name.startsWith("_ga_"))) continue;
    const domains = ["", location.hostname, `.${location.hostname.split(".").slice(-2).join(".")}`];
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
    }
  }
}
