"use client";

import { useId, useRef, type ReactNode } from "react";
import { cx } from "./class-names";
import { selectContents, type CopyState } from "./copy";
import { primitiveLabels } from "./labels";
import { useCopy } from "./use-copy";

/**
 * One command on one scrolling line, with Copy (DESIGN.md §2.5): the dim "$", the command in <code>, and a fade at the
 * right edge while more of it is hidden. The line is a focusable region, so the keyboard can scroll it. The hint below
 * never changes; the result of a copy is spoken by an sr-only status elsewhere in the component, never stacked over the
 * hint. On copy the label reads "Copied" and the "$" turns accent; when copying fails the command is selected and the
 * label says which keys copy it.
 *
 * `next` is the step after copying, spoken with "Copied." ("Paste it in a terminal, then open localhost:4000.").
 * `label` names the region: a second Command on a page needs its own. It also describes Copy (an sr-only copy of it), so
 * a page's Copy buttons can be told apart (WCAG 2.4.6). `initialState` is the state it starts in
 * (/_design/ shows each). The whole block, hint included, stays out of the search index (§3.16: data-pagefind-ignore).
 */
export function Command({
  command,
  next,
  hint,
  label = primitiveLabels.commandRegion,
  initialState = "idle",
  className,
}: {
  command: string;
  next?: string;
  hint?: ReactNode;
  label?: string;
  initialState?: CopyState;
  className?: string;
}) {
  const code = useRef<HTMLElement>(null);
  const labelId = useId();
  const { state, shortcut, copy } = useCopy(command, initialState);
  const button = state === "copied" ? primitiveLabels.copied : state === "failed" ? primitiveLabels.pressCopy(shortcut) : primitiveLabels.copy;
  const status =
    state === "copied" ? primitiveLabels.copiedStatus(next) : state === "failed" ? primitiveLabels.commandFailedStatus(shortcut) : "";

  return (
    <div className={cx("command", className)} data-state={state} data-pagefind-ignore="">
      <div className="command-box">
        <div className="command-line" tabIndex={0} role="region" aria-label={label}>
          <span className="command-prompt" aria-hidden="true">
            $
          </span>
          <code ref={code}>{command}</code>
        </div>
        <button type="button" className="copy-btn" aria-describedby={labelId} onClick={() => copy(() => selectContents(code.current))}>
          {button}
        </button>
      </div>
      {hint ? <p className="command-hint">{hint}</p> : null}
      <span className="sr-only" id={labelId}>
        {label}
      </span>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}
