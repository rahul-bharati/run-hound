import { useCallback, useEffect, useState } from "react";
import { apiGet, isApiError } from "@/lib/api";

export type LoadState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

/**
 * Loads one or more GET endpoints in parallel on mount (and again on `reload()`). `setData` updates the loaded value
 * after a save, so the page shows the saved record without another request.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): {
  state: LoadState<T>;
  reload: () => void;
  setData: (update: (current: T) => T) => void;
} {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: isApiError(err) ? err.message : "We couldn't load this page's data." });
      },
    );
    return () => controller.abort();
    // `load` is a module-level function at every call site; `attempt` re-runs it.
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((update: (current: T) => T) => {
    setState((s) => (s.status === "ready" ? { status: "ready", data: update(s.data) } : s));
  }, []);
  return { state, reload, setData };
}

export const getJson = <T>(path: string) => (signal: AbortSignal) => apiGet<T>(path, { signal });
