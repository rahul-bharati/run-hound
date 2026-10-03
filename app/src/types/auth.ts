/**
 * Type aliases for the auth engine (canonical home for SessionState, CookieJar). Pure data shapes — no behavior,
 * no Playwright. The session interfaces (SignedIn, Sent, FirstStep, StepEnv) live in `interfaces/auth.ts`.
 */

/** A browser session as Playwright's storageState(): cookies plus localStorage per origin. In memory only. */
export type SessionState = Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>;

/** A browser context's cookies, as context.cookies() returns them. */
export type CookieJar = SessionState["cookies"];

/** What the page did after a two-step sign-in's first step. */
export type StepOutcome =
  | { kind: "password" }
  | { kind: "elsewhere"; url: string }
  | { kind: "closed" }
  | { kind: "code" }
  | { kind: "captcha" }
  | { kind: "alert"; texts: string[] }
  | { kind: "none" };