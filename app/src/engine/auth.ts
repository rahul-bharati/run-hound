/**
 * Public facade for the auth engine: keeps the same import surface for existing consumers (signIn, SignInError,
 * accountLabel, firstStepForm, samePage, SessionState, SignedIn, plus the test internals) while the implementation
 * lives in focused modules under ./auth/. New code should import from the canonical homes directly
 * (engine/auth/sign-in.ts, types/auth.ts, interfaces/auth.ts).
 */
export { signIn, SignInError, accountLabel, samePage } from "./auth/sign-in.js";
export { firstStepForm } from "./auth/form-detection.js";

// Re-exports for the auth tests, which probe internals (form detection, password matching, browser guards).
export { sessionSecrets, sessionInStorage } from "./auth/session-detection.js";
export { identifierField, signInForm } from "./auth/form-detection.js";
export { guardSignInBrowser, stopUnrouted } from "./auth/browser-guards.js";

export type { SessionState } from "../types/auth.js";
export type { SignedIn } from "../interfaces/auth.js";
