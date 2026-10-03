/**
 * Interfaces for the auth engine: the public shape of a signed-in session (re-exported by engine/auth.ts), the
 * session-detection input shapes used by `engine/auth/session-detection.ts`, and the request / first-step / browser-guard
 * interfaces consumed by `engine/auth/password-detection.ts`, `engine/auth/form-detection.ts` and
 * `engine/auth/browser-guards.ts`. The data shapes (SessionState, CookieJar, StepOutcome) live in `types/auth.ts`.
 */
import type { SessionState } from "../types/auth.js";

export interface SignedIn {
  state: SessionState;
  /** Where the browser landed after submitting (redacted). */
  landedOn: string;
  /**
   * Values that identify this session (cookie values, bearer tokens found in localStorage) for redaction: the
   * runner registers them as literal secrets together with the password.
   */
  secrets: string[];
  /**
   * sessionStorage items the app kept after signing in, per origin: the sign-in origin and the landing origin. Every
   * new browser context for this identity seeds them before any page script runs. Absent when the app keeps nothing
   * there, and when the session doesn't live there.
   */
  sessionStorage?: { origin: string; items: { name: string; value: string }[] }[];
}

/** One IndexedDB database as storageState({ indexedDB: true }) returns it (only what sessionSecrets reads). */
export interface IndexedDbState {
  stores?: { name?: string; records?: { key?: unknown; value: unknown }[] }[];
}

/** How sessionSecrets reads sessionStorage (0.6.0 review, round 1). */
export interface SessionStorageReading {
  sessionStorageSession?: boolean;
  addressValues?: ReadonlySet<string>;
}

/**
 * What a request sends, as a route or the DevTools protocol sees it (a WebSocket message as its body).
 */
export interface Sent {
  url: string;
  body: string;
  headers: Record<string, string>;
  /**
   * Whether this is a navigation (a page load, a form submit): only a navigation puts the password in the address
   * the way a GET form does (the URL bar, the history, the server's access log). A same-origin fetch or image whose
   * query happens to equal a weak password ("demo") is not a GET-form leak and must not fail the sign-in.
   */
  navigation: boolean;
}

/** A two-step sign-in's first step (0.6.0): the form, the field the identifier goes in, and the control that moves on. */
export interface FirstStep {
  form: import("../core/types.js").DiscoveredForm;
  field: import("../core/types.js").FormField;
  control: import("../core/types.js").FormControl;
}

/** Inputs to a two-step sign-in's first step. */
export interface StepEnv {
  label: string;
  shownUrl: string;
  loginOrigin: string;
  username: string;
  guard: import("../engine/guard.js").NavigationGuard;
}

/** What guardSignInBrowser needs from the sign-in. */
export interface BrowserGuardOptions {
  /** Whether a request (any tab's, frame's or worker's) must be stopped for the password's sake. */
  stops: (sent: Sent) => boolean;
  /** Told what was stopped from running: "a shared worker". */
  refuse: (what: string) => void;
  /**
   * Asked about each new tab of the sign-in context, before it runs: true lets it run, else it is closed. `opener`: the
   * tab was opened by a page (window.open, a link or form with a target), not by Playwright (storageState's own page).
   */
  admitTab?: (tab: { opener: boolean }) => boolean;
  /** Told when a new tab of the sign-in context is refused: every request of it fails, and it is being closed. */
  tabClosed?: () => void;
}