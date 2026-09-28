"use client";

import { Fragment, useId, useRef } from "react";
import { cx } from "./class-names";
import { commandsText, selectContents, type CodeBlockData, type CopyState } from "./copy";
import { primitiveLabels } from "./labels";
import { useCopy } from "./use-copy";

/**
 * A multi-line terminal block (DESIGN.md §2.5): a comment, the commands, then the real output they print. Copy copies
 * the commands only, one per line: never the prompts (drawn by CSS, so they aren't text), the comment or the output
 * (dim). The block scrolls sideways inside itself as a focusable region named by `label`, which is also shown above it
 * and must be unique on the page; it also describes Copy, so a page's Copy buttons can be told apart (WCAG 2.4.6). `initialState` is the state it starts in (/_design/ shows each). The block stays out
 * of the search index (§3.16: data-pagefind-ignore).
 */
export function CodeBlock({
  commands,
  output,
  comment,
  label,
  initialState = "idle",
  className,
}: CodeBlockData & { label: string; initialState?: CopyState; className?: string }) {
  const lines = useRef<HTMLSpanElement>(null);
  const labelId = useId();
  const { state, shortcut, copy } = useCopy(commandsText({ commands }), initialState);
  const button = state === "copied" ? primitiveLabels.copied : state === "failed" ? primitiveLabels.pressCopy(shortcut) : primitiveLabels.copy;
  const status =
    state === "copied" ? primitiveLabels.copiedStatus() : state === "failed" ? primitiveLabels.commandsFailedStatus(shortcut) : "";

  return (
    <div className={cx("code-block", className)} data-state={state} data-pagefind-ignore="">
      <div className="code-block-bar">
        <span className="code-block-label" id={labelId}>
          {label}
        </span>
        <button type="button" className="copy-btn" aria-describedby={labelId} onClick={() => copy(() => selectContents(lines.current))}>
          {button}
        </button>
      </div>
      <pre className="code-block-pre" tabIndex={0} role="region" aria-label={label}>
        <code>
          {comment ? (
            <>
              <span className="code-comment"># {comment}</span>
              {"\n"}
            </>
          ) : null}
          <span data-commands="" ref={lines}>
            {commands.map((command, i) => (
              <Fragment key={i}>
                {i > 0 ? "\n" : null}
                <span className="code-cmd">{command}</span>
              </Fragment>
            ))}
          </span>
          {output?.map((line, i) => (
            <Fragment key={i}>
              {"\n"}
              <span className="code-out">{line}</span>
            </Fragment>
          ))}
        </code>
      </pre>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}
