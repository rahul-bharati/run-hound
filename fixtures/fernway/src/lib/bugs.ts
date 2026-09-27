import { useSyncExternalStore } from "react";

/**
 * Fernway's runtime config (GET /api/__config): the planted bugs (CONTRACT.md; clean mode has none, and V01-V09 live on
 * the server only) and the sign-in and session modes.
 */
export type BugId =
  | "W01"
  | "W02"
  | "W03"
  | "W04"
  | "W05"
  | "W06"
  | "W07"
  | "W08"
  | "W09"
  | "W10"
  | "V01"
  | "V02"
  | "V03"
  | "V04"
  | "V05"
  | "V06"
  | "V07"
  | "V08"
  | "V09";

/**
 * FERNWAY_LOGIN (CONTRACT.md "Sign-in and session modes"): "two-step" asks for the email first (Continue), then the
 * password on the same page.
 */
export type LoginMode = "one-step" | "two-step";
/**
 * FERNWAY_SESSION: "session-storage" keeps the session token in sessionStorage and sends it as
 * "Authorization: Bearer <token>" (the server sets no cookie).
 */
export type SessionMode = "cookie" | "session-storage";

let enabled: ReadonlySet<string> = new Set();
let modes: { login: LoginMode; session: SessionMode } = { login: "one-step", session: "cookie" };
let loading: Promise<ReadonlySet<string>> | undefined;
const listeners = new Set<() => void>();

/**
 * Loads GET /api/__config once (later calls share the first request): the enabled bugs and the sign-in and session
 * modes. main.tsx awaits it before the first render, so `bugOn`, `loginMode` and `sessionMode` are accurate from the
 * first paint. A failed request means clean mode, one-step sign-in and a cookie session.
 */
export function loadBugs(): Promise<ReadonlySet<string>> {
  loading ??= fetch("/api/__config", { headers: { accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return new Set<string>();
      const body = (await res.json()) as { bugs?: unknown; login?: unknown; session?: unknown };
      modes = {
        login: body.login === "two-step" ? "two-step" : "one-step",
        session: body.session === "session-storage" ? "session-storage" : "cookie",
      };
      return new Set(Array.isArray(body.bugs) ? body.bugs.filter((b): b is string => typeof b === "string") : []);
    })
    .catch(() => new Set<string>())
    .then((set) => {
      enabled = set;
      for (const fn of listeners) fn();
      return set;
    });
  return loading;
}

/** How /login signs in (FERNWAY_LOGIN). Known before the first render (main.tsx awaits loadBugs). */
export function loginMode(): LoginMode {
  return modes.login;
}

/** Where the session lives (FERNWAY_SESSION). Known before the first render (main.tsx awaits loadBugs). */
export function sessionMode(): SessionMode {
  return modes.session;
}

/** True when FERNWAY_BUGS enables this bug. Safe anywhere (render, handlers); false until the config loads. */
export function bugOn(id: BugId): boolean {
  return enabled.has(id);
}

/** Every enabled id, sorted. */
export function enabledBugs(): string[] {
  return [...enabled].sort();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook form of bugOn: re-renders if the config arrives after mount. */
export function useBug(id: BugId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled.has(id),
    () => false,
  );
}
