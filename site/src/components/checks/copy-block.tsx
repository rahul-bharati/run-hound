"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/primitives/class-names";
import { copyShortcut, runCopy, scheduleReset, selectContents, selectionMatches, type CopyState } from "@/components/primitives/copy";
import { primitiveLabels } from "@/components/primitives/labels";
import styles from "./checks.module.css";

/**
 * A block of text with Copy (DESIGN.md §3.6): the run's Playwright test at #reproduce, and the fix to ask your AI for.
 * The CodeBlock primitive copies shell commands and draws a "$" before each line; this copies text as it is: exactly
 * what `children` shows, with `before` and `after` shown around it but never copied (the fix's `Ask your AI or
 * developer: "…"`). The page renders the text once, and Copy reads it from the block when clicked: the block holds no
 * second copy of it. The flow is the primitives' (copy.ts, as useCopy runs it: "Copied" for 2 s; when the browser
 * refuses, the text is selected and the reader told which keys copy it), with the text read from the page instead of
 * passed up front. `label` names the block, is shown above it, and describes Copy, so it must be unique on the page.
 * `wrap` sets prose (the fix) instead of code that scrolls sideways in a focusable region. `failed` is said when copying
 * fails, with {shortcut} for the keys; a client component can't read content/*, so the words come as props.
 */
export function CopyBlock({
  label,
  children,
  before = "",
  after = "",
  wrap = false,
  searchable = false,
  failed,
  className,
}: {
  label: string;
  /** The text Copy copies, as the page shows it. */
  children: ReactNode;
  before?: string;
  after?: string;
  wrap?: boolean;
  /** Leave it in the search index (prose); code stays out (§3.16). */
  searchable?: boolean;
  failed: string;
  className?: string;
}) {
  const shown = useRef<HTMLSpanElement>(null);
  const labelId = useId();
  const [state, setState] = useState<CopyState>("idle");
  const [shortcut, setShortcut] = useState<"Ctrl+C" | "⌘C">("Ctrl+C");
  // One pending reset at a time: a new copy (or unmounting) cancels the last one.
  const [copies, setCopies] = useState(0);
  const busy = useRef(false);

  useEffect(() => (copies === 0 ? undefined : scheduleReset(setState)), [copies]);

  // After a failure, the reader's own copy of this block's text counts as copied; a copy of anything else doesn't.
  useEffect(() => {
    if (state !== "failed") return;
    const onCopy = () => {
      if (!selectionMatches(document.getSelection()?.toString(), shown.current?.textContent ?? "")) return;
      setState("copied");
      setCopies((n) => n + 1);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [state]);

  async function copy() {
    if (busy.current) return;
    busy.current = true;
    const result = await runCopy(shown.current?.textContent ?? "", navigator.clipboard, () => selectContents(shown.current));
    busy.current = false;
    if (result === "copied") {
      setState("copied");
      setCopies((n) => n + 1);
      return;
    }
    setShortcut(copyShortcut(navigator.platform || navigator.userAgent));
    setState("failed");
  }

  const button = state === "copied" ? primitiveLabels.copied : state === "failed" ? primitiveLabels.pressCopy(shortcut) : primitiveLabels.copy;
  const status = state === "copied" ? primitiveLabels.copiedStatus() : state === "failed" ? failed.replace("{shortcut}", shortcut) : "";
  const scroll = wrap ? {} : ({ tabIndex: 0, role: "region", "aria-label": label } as const);

  return (
    <div className={cx("code-block", className)} data-state={state} data-pagefind-ignore={searchable ? undefined : ""}>
      <div className="code-block-bar">
        <span className="code-block-label" id={labelId}>
          {label}
        </span>
        <button type="button" className="copy-btn" aria-describedby={labelId} onClick={copy}>
          {button}
        </button>
      </div>
      <pre className={cx("code-block-pre", wrap && styles.wrap)} {...scroll}>
        <code>
          {before}
          <span ref={shown}>{children}</span>
          {after}
        </code>
      </pre>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}

/**
 * A run of one character, written out where it renders: the page's HTML holds each of its characters once, as the
 * reader sees it, while the RSC payload that hydrates the page carries only the character and the count (check-page.tsx,
 * withRuns). A component can return a string, so this adds no element around the run.
 */
export function Repeat({ char, count }: { char: string; count: number }) {
  return char.repeat(count);
}
