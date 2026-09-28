import { useCallback, useEffect, useRef, useState } from "react";
import { copyShortcut, runCopy, scheduleReset, selectionMatches, type CopyState } from "./copy";

/**
 * The copy state of a Command or a CodeBlock (client components only), for `text`, what its Copy copies. copy(select)
 * runs runCopy (copy.ts, where the tests check the flow): on success the state is "copied" for 2 s, then "idle"
 * (scheduleReset). When the Clipboard API is missing or refuses, runCopy has called `select`, the component's text is
 * selected, and the state is "failed": the label and the status name the keys that copy it. The failed state lasts
 * until the reader copies: their own copy of that same text (selectionMatches) then counts as copied, and a copy of
 * anything else on the page doesn't.
 */
export function useCopy(text: string, initialState: CopyState = "idle") {
  const [state, setState] = useState<CopyState>(initialState);
  const [shortcut, setShortcut] = useState<"Ctrl+C" | "⌘C">("Ctrl+C");
  // One pending reset at a time: a new copy (or unmounting) cancels the last one.
  const [resetAt, setResetAt] = useState(0);

  const markCopied = useCallback(() => {
    setState("copied");
    setResetAt((n) => n + 1);
  }, []);

  useEffect(() => (resetAt === 0 ? undefined : scheduleReset(setState)), [resetAt]);

  useEffect(() => {
    if (state !== "failed") return;
    const onCopy = () => {
      if (selectionMatches(document.getSelection()?.toString(), text)) markCopied();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [state, text, markCopied]);

  const busy = useRef(false);
  async function copy(select: () => void) {
    if (busy.current) return;
    busy.current = true;
    const result = await runCopy(text, typeof navigator === "undefined" ? undefined : navigator.clipboard, select);
    busy.current = false;
    if (result === "copied") {
      markCopied();
      return;
    }
    setShortcut(copyShortcut(navigator.platform || navigator.userAgent));
    setState("failed");
  }

  return { state, shortcut, copy };
}
