/**
 * A remark plugin for the docs MDX (DESIGN.md §3.5), with no dependencies: next.config.ts names it by its path, as
 * Turbopack needs plugins named as strings (@next/mdx 16.3.5's loader imports it).
 *
 * - A heading ending in a pinned id, written `## Requirements \{#requirements\}` (MDX reads `\{` as a brace), gets that
 *   id and loses the text: the id never changes when the heading's words do, so links from other sites keep landing.
 * - A fenced code block's `label="…"` (```sh label="Start Kennel") reaches the rendered <code> as data-label, where
 *   mdx-components.tsx reads it for the CodeBlock's label (MDX drops a fence's meta otherwise).
 * - An <InlineTocSlot /> goes right after the page's opening paragraph: the docs page fills it with "On this page" as
 *   an inline box (1024 to 1279 px, §3.5), so it sits under the opening in the reading and focus order alike.
 *   mdx-components.tsx renders nothing for it by default.
 */
const pinnedId = /\s*\{#([a-z0-9]+(?:-[a-z0-9]+)*)\}\s*$/;

/** Moves a heading's trailing {#id} into its id. */
export function pinHeading(heading) {
  const last = heading.children?.at(-1);
  if (!last || last.type !== "text") return;
  const match = pinnedId.exec(last.value);
  if (!match) return;
  last.value = last.value.slice(0, match.index);
  if (!last.value) heading.children.pop();
  heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id: match[1] } };
}

/** Passes a fence's label="…" to the <code> element as data-label. */
export function labelCode(code) {
  const label = /\blabel="([^"]*)"/.exec(code.meta ?? "")?.[1];
  if (label === undefined) return;
  code.data = { ...code.data, hProperties: { ...code.data?.hProperties, "data-label": label } };
}

function visit(node) {
  if (node.type === "heading") pinHeading(node);
  else if (node.type === "code") labelCode(node);
  for (const child of node.children ?? []) visit(child);
}

/** Puts an <InlineTocSlot /> after the first paragraph at the top level of the page. */
export function addTocSlot(tree) {
  const at = tree.children?.findIndex((node) => node.type === "paragraph") ?? -1;
  if (at < 0) return;
  tree.children.splice(at + 1, 0, { type: "mdxJsxFlowElement", name: "InlineTocSlot", attributes: [], children: [] });
}

export default function remarkDocs() {
  return (tree) => {
    visit(tree);
    addTocSlot(tree);
  };
}
