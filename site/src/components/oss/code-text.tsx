import type { ReactNode } from "react";

/**
 * Text from a content module with its `code` marks shown as code: the FAQ's answers, the compare table's cells and
 * the roadmap's note keep commands, flags and addresses in backticks, which their plain-text copies (the FAQPage
 * structured data, llms-full.txt) drop. Code keeps the text's size. A short one never breaks inside (a flag such as
 * --plan-only); a long one (an address) may break anywhere, so nothing overflows at 320 px.
 */
export function CodeText({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/`([^`]*)`/).map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className={`font-mono text-fg ${part.length <= 24 ? "whitespace-nowrap" : "wrap-anywhere"}`}>
        {part}
      </code>
    ) : (
      part
    ),
  );
  return <>{parts}</>;
}
