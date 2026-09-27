/**
 * Anti-CSRF tokens the app gives a signed-in page (0.6.0 round 1), shared by csrf (a forged body never carries Account
 * A's token: a page on another site can't know it) and write-access (a write sent as Account B carries B's own token,
 * never A's). Token values are held in memory only: never put in a page Run Hound serves, never written anywhere.
 */
import type { Page } from "playwright";

/**
 * Field names that carry an anti-CSRF token: anything with csrf or xsrf in it (_csrf, csrfToken, Django's
 * csrfmiddlewaretoken), Rails' authenticity_token, ASP.NET's __RequestVerificationToken, and, as a whole name or nested
 * under a model (Symfony's task[_token]), token, _token, nonce, WordPress's _wpnonce, Magento's form_key and Drupal's
 * form_token.
 */
export const TOKEN_FIELD = /csrf|xsrf|authenticity_token|requestverificationtoken|(^|\[)_?(token|nonce|wpnonce|form_key|form_token)\]?$/i;

/** A value random enough to be a token: 16 or more characters, letters and digits mixed, no spaces. */
export function looksRandom(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

/** Where a page got a token from, by name: a <meta>, a cookie, or a hidden input. */
export interface TokenSource {
  kind: "meta" | "cookie" | "input";
  name: string;
  value: string;
}

/**
 * The anti-CSRF tokens `page` holds: a <meta> whose name says csrf/xsrf (Rails, Laravel, Django templates), a cookie
 * whose name does (double-submit cookies, Django's csrftoken), and a hidden input with a token's name (TOKEN_FIELD) or
 * a random-looking value (looksRandom) that Run Hound didn't type (its value doesn't carry `runKey`, the run token).
 */
export async function tokenSources(page: Page, runKey: string): Promise<TokenSource[]> {
  const inPage = await page
    .evaluate(
      (field) => {
        const re = new RegExp(field, "i");
        const random = (v: string) => v.length >= 16 && !/\s/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v);
        const metas = [...document.querySelectorAll("meta[name]")]
          .filter((m) => /csrf|xsrf/i.test(m.getAttribute("name") ?? ""))
          .map((m) => ({ kind: "meta" as const, name: m.getAttribute("name") ?? "", value: m.getAttribute("content") ?? "" }));
        const inputs = [...document.querySelectorAll<HTMLInputElement>("input[type=hidden][name]")]
          .filter((i) => re.test(i.name) || random(i.value))
          .map((i) => ({ kind: "input" as const, name: i.name, value: i.value }));
        return [...metas, ...inputs];
      },
      TOKEN_FIELD.source,
    )
    .catch(() => [] as TokenSource[]);
  const cookies = await page
    .context()
    .cookies()
    .catch(() => []);
  const all: TokenSource[] = [...inPage, ...cookies.filter((c) => /csrf|xsrf/i.test(c.name)).map((c) => ({ kind: "cookie" as const, name: c.name, value: c.value }))];
  const key = runKey.toLowerCase();
  return all.filter((s) => s.value !== "" && (key === "" || !s.value.toLowerCase().includes(key)));
}

/** True when `key` holding `value` carries an anti-CSRF token: by name (unless Run Hound typed the value) or by value. */
export function isTokenField(key: string, value: unknown, tokens: ReadonlySet<string>, runKey: string): boolean {
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  if (text !== null && text !== "" && tokens.has(text)) return true;
  if (!TOKEN_FIELD.test(key)) return false;
  return text === null || runKey === "" || !text.toLowerCase().includes(runKey.toLowerCase());
}
