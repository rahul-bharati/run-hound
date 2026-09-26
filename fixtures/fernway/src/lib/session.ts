/**
 * Who is signed in, on the client (CONTRACT.md "Accounts"). The server decides: GET /api/me answers the session user
 * or 401. Only the signed-in pages (/app, /app/settings, through <RequireSession>) ask, so a signed-out visit to a
 * public page never makes a failing request. Nothing about the session is kept in localStorage. Every client-side
 * account and session detail lives in this module.
 */
import { useSyncExternalStore } from "react";
import { apiGet, apiPost, isApiError } from "./api";

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
      (err: unknown): SessionState =>
        isApiError(err) && err.status === 401 ? { status: "signed-out" } : { status: "error", message: isApiError(err) ? err.message : "We couldn't check your session." },
    )
    .then((next) => {
      pending = undefined;
      set(next);
      return next;
    });
  return pending;
}

/** Re-reads GET /api/me: call after POST /api/login, /api/login/demo or /api/signup succeeded. */
export const refreshSession = () => loadSession(true);

/**
 * "Sign out": POST /api/logout ends the session on the server (and removes the cookie); the client then knows it is
 * signed out, so <RequireSession> sends the page to /login. Rejects (and changes nothing) when the request fails.
 */
export async function signOut(): Promise<void> {
  await apiPost("/api/logout");
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
