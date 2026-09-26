import { useSyncExternalStore } from "react";

/** Fernway's planted bugs (CONTRACT.md). Clean mode has none. V01-V05 live on the server only. */
export type BugId = "W01" | "W02" | "W03" | "W04" | "W05" | "W06" | "W07" | "W08" | "W09" | "W10" | "V01" | "V02" | "V03" | "V04" | "V05";

let enabled: ReadonlySet<string> = new Set();
let loading: Promise<ReadonlySet<string>> | undefined;
const listeners = new Set<() => void>();

/**
 * Loads GET /api/__config once (later calls share the first request). main.tsx awaits it before the first render,
 * so `bugOn` is accurate from the first paint. A failed request means clean mode.
 */
export function loadBugs(): Promise<ReadonlySet<string>> {
  loading ??= fetch("/api/__config", { headers: { accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return new Set<string>();
      const body = (await res.json()) as { bugs?: unknown };
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
