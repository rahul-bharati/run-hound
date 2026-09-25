/**
 * Who is signed in, on the client. V0 has no real accounts: /app and /app/settings work without signing in as a
 * demo workspace, and signing in (or signing up) only changes the name shown. Keep every client-side account and
 * session detail in this module so V2's real accounts can grow here.
 */
import { useSyncExternalStore } from "react";

export interface SessionUser {
  name: string;
  email: string;
  workspace: string;
  /** True for the built-in demo user (nobody has signed in on this browser). */
  demo: boolean;
}

export const DEMO_USER: SessionUser = Object.freeze({
  name: "Alex Rivera",
  email: "alex@fernway.test",
  workspace: "Demo workspace",
  demo: true,
});

const STORAGE_KEY = "fernway.session";
const listeners = new Set<() => void>();
let cached: SessionUser | undefined;

function read(): SessionUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO_USER;
    const v = JSON.parse(raw) as Partial<SessionUser>;
    if (typeof v.name !== "string" || typeof v.email !== "string") return DEMO_USER;
    return { name: v.name, email: v.email, workspace: typeof v.workspace === "string" ? v.workspace : DEMO_USER.workspace, demo: false };
  } catch {
    return DEMO_USER;
  }
}

function emit() {
  cached = undefined;
  for (const fn of listeners) fn();
}

/** The current user (the demo user when nobody signed in). */
export function getSessionUser(): SessionUser {
  cached ??= read();
  return cached;
}

/** Call after a successful POST /api/signup or /api/login. */
export function setSessionUser(user: { name: string; email: string; workspace?: string }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: user.name, email: user.email, workspace: user.workspace ?? DEMO_USER.workspace }));
  } catch {
    // Storage can be unavailable (private mode); the name then falls back to the demo user on reload.
  }
  emit();
}

/** "Sign out": back to the demo user. */
export function signOut(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** React hook for the current user. */
export function useSessionUser(): SessionUser {
  return useSyncExternalStore(subscribe, getSessionUser, () => DEMO_USER);
}

/** "Signed in as Alex Rivera · Demo workspace" */
export function sessionLabel(user: SessionUser): string {
  return `Signed in as ${user.name} · ${user.workspace}`;
}
