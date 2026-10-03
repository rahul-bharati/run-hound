/**
 * Anti-CSRF cookie drift for write-access: the cookies a token read from a page opened as the scenario identity
 * goes with that the replay (sent with the saved session's cookies) may not carry. Used by the body and header
 * anti-CSRF swap helpers (`./csrf-tokens.ts`, `./header-tokens.ts`).
 */

/**
 * The cookies a token read from a page opened as the scenario identity goes with that the replay may not carry
 * (`drift`: csrf-token-jar.ts cookieDrift): a cookie token's own cookie, and for a <meta> or hidden-input token,
 * which the app may check against any cookie (Django's against csrftoken, Rails' against its session cookie), every
 * one the page set anew.
 */
export function driftedFor(mine: { kind: "cookie" | "meta" | "input"; name: string; value: string }, drift: ReadonlySet<string>): string[] {
  if (mine.kind === "cookie") return drift.has(mine.name) ? [mine.name] : [];
  return [...drift];
}
