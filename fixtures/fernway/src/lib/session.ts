/**
 * Who is signed in, on the client (CONTRACT.md "Accounts"). The server decides: GET /api/me answers the session user
 * or 401. Only the signed-in pages (/app, /app/settings, through <RequireSession>) ask, so a signed-out visit to a
 * public page never makes a failing request. Nothing about the session is kept in localStorage: the session is the
 * server's cookie, or in FERNWAY_SESSION=session-storage mode a token kept in sessionStorage (./session-token.ts).
 * Every client-side account and session detail lives in this module and that one.
 */
import { useSyncExternalStore } from "react";
import { apiGet, apiPost, isApiError } from "./api";
import { clearSessionToken, saveSessionToken } from "./session-token";

/** What GET /api/me answers. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** The user's workspace name ("Rivera Studio"). */
  workspace: string;
}

export type SessionState =
  /** Nobody has asked yet (a public page, or the first render of a signed-in page). */
  | { status: "unknown" }
  | { status: "loading" }
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out" }
  /** GET /api/me failed for another reason (network, 5xx): the guard offers "Try again". */
  | { status: "error"; message: string };

const UNKNOWN: SessionState = { status: "unknown" };
const EMPTY_USER: SessionUser = Object.freeze({ id: "", name: "", email: "", workspace: "" });

let state: SessionState = UNKNOWN;
let pending: Promise<SessionState> | undefined;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  for (const fn of listeners) fn();
}

export function getSession(): SessionState {
  return state;
}

/**
 * Asks GET /api/me (once; concurrent callers share the request). `force` asks again even when the answer is known
 * (after signing in, signing up or renaming the workspace).
 */
export function loadSession(force = false): Promise<SessionState> {
  if (pending) return pending;
  if (!force && state.status !== "unknown" && state.status !== "error") return Promise.resolve(state);
  if (state.status !== "signed-in") set({ status: "loading" });
  pending = apiGet<SessionUser>("/api/me")
    .then(
      (user): SessionState => ({ status: "signed-in", user }),
      (err: unknown): SessionState => {
        if (!isApiError(err) || err.status !== 401) return { status: "error", message: isApiError(err) ? err.message : "We couldn't check your session." };
        // A kept token the server no longer knows (it restarted, or the session ended elsewhere) is of no use.
        clearSessionToken();
        return { status: "signed-out" };
      },
    )
    .then((next) => {
      pending = undefined;
      set(next);
      return next;
    });
  return pending;
}

/** Re-reads GET /api/me (after onboarding renamed the workspace, for example). */
export const refreshSession = () => loadSession(true);

/**
 * After POST /api/login, /api/login/demo or /api/signup succeeded: keeps the answer's token (session-storage mode; in
 * cookie mode the server already set the cookie and there is none), then re-reads GET /api/me.
 */
export function startSession(answer: { token?: unknown }): Promise<SessionState> {
  if (typeof answer.token === "string" && answer.token) saveSessionToken(answer.token);
  return loadSession(true);
}

/**
 * "Sign out": POST /api/logout ends the session on the server (and removes the cookie, or the client forgets its
 * token); the client then knows it is signed out, so <RequireSession> sends the page to /login. Rejects (and changes
 * nothing) when the request fails.
 */
export async function signOut(): Promise<void> {
  await apiPost("/api/logout");
  clearSessionToken();
  set({ status: "signed-out" });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook for the session state. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSession, () => UNKNOWN);
}

/** The signed-in user. Only for components under <RequireSession> (empty strings anywhere else). */
export function useSessionUser(): SessionUser {
  const session = useSession();
  return session.status === "signed-in" ? session.user : EMPTY_USER;
}

/** "Signed in as Alex Rivera · Rivera Studio" */
export function sessionLabel(user: SessionUser): string {
  return `Signed in as ${user.name} · ${user.workspace}`;
}

/**
 * Where a signed-out visitor to a signed-in page goes: /login?next=<path>, the path readable ("/app/settings", not
 * "%2Fapp%2Fsettings") and everything else in it escaped.
 */
export function loginPath(location: { pathname: string; search?: string; hash?: string }): string {
  const next = `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
  return `/login?next=${encodeURIComponent(next).replace(/%2F/gi, "/")}`;
}
