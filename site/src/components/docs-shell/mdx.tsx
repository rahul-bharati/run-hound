import { Children, isValidElement, type ReactNode } from "react";
import { Callout } from "@/components/primitives/callout";
import { CodeBlock } from "@/components/primitives/code-block";
import { TextLink } from "@/components/primitives/links";
import { commands, type ShellBlock } from "@/content/commands";
import { parseTerminal } from "./terminal";

/**
 * The components the docs MDX renders with (src/mdx-components.tsx registers them; DESIGN.md §3.5: "only registered
 * MDX components"). src/content/docs.test.ts fails a tag in the MDX that isn't one of these or a table's HTML.
 */

/** A block of content/commands.ts with Copy: <Shell block="run" label="Docker, from any folder" />. */
export function Shell({ block, label }: { block: string; label: string }) {
  const data: ShellBlock | undefined = commands.blocks[block as keyof typeof commands.blocks];
  if (!data) throw new Error(`docs MDX: <Shell block="${block}"> names no block of content/commands.ts`);
  return <CodeBlock label={label} commands={data.commands} {...(data.output ? { output: data.output } : {})} {...(data.comment ? { comment: data.comment } : {})} />;
}

/**
 * A fenced block (```sh label="…") as a CodeBlock: "$ " lines are the commands Copy copies, other lines real output
 * (components/docs-shell/terminal.ts). The fence's label reaches the <code> as data-label (remark-docs.mjs).
 */
export function DocCode({ children }: { children?: ReactNode }) {
  const code = Children.only(children);
  const props = (isValidElement(code) ? code.props : {}) as { children?: unknown; "data-label"?: string };
  const text = typeof props.children === "string" ? props.children : "";
  const label = props["data-label"];
  if (!label) throw new Error(`docs MDX: a fenced block needs label="…": ${text.slice(0, 60)}`);
  const { commands: lines, output, comment } = parseTerminal(text);
  if (lines.length === 0) throw new Error(`docs MDX: a fenced block needs a "$ " command: ${text.slice(0, 60)}`);
  return <CodeBlock label={label} commands={lines} {...(output.length ? { output } : {})} {...(comment ? { comment } : {})} />;
}

/** A Markdown link: a TextLink (next/link, prefetched on intent, for a page of the site; ↗ for one off it). */
export function DocLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  const github = /^https:\/\/github\.com\//.test(href);
  return (
    <TextLink href={href} prefetch="intent" opens={github ? "GitHub" : undefined}>
      {children}
    </TextLink>
  );
}

/** A table that scrolls sideways inside itself when it can't fit: a focusable region named by `label`. */
export function TableRegion({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="table-region" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** A note or a warning in the prose (the Callout primitive). */
export function DocCallout({ tone, title, children }: { tone?: "note" | "warn"; title?: string; children?: ReactNode }) {
  return (
    <Callout tone={tone} title={title}>
      {children}
    </Callout>
  );
}
