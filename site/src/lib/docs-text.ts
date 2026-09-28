import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTerminal } from "@/components/docs-shell/terminal";
import { commands } from "@/content/commands";

/**
 * The text of the docs MDX (src/content/docs/<slug>.mdx), read without compiling it: the headings and their pinned ids
 * (the docs shell's "On this page"), the opening paragraph, the prose and its word count (the docs tests' 50- and
 * 1,000-word gates, the task pages' "About N minutes"), and the same page as plain Markdown for llms-full.txt.
 *
 * It reads the subset of MDX the docs are written in (DESIGN.md §3.5): Markdown paragraphs, lists and headings with a
 * pinned id (`## Requirements \{#requirements\}`), fenced terminal blocks (components/docs-shell/terminal.ts), and the
 * registered components on lines of their own: <Shell block="…" label="…" /> (a block of content/commands.ts),
 * <Callout title="…">…</Callout> and <TableRegion label="…"> around a <table>. src/content/docs.test.ts keeps the MDX
 * to that subset.
 *
 * Server-only (it reads files, at build time: the docs are prerendered). Plain .ts, so node --test loads it too.
 */

/** The docs MDX folder: the build and the tests both run in site/. */
export const docsDir = () => join(process.cwd(), "src", "content", "docs");

/** A docs page's MDX source. */
export const docSource = (slug: string): string => readFileSync(join(docsDir(), `${slug}.mdx`), "utf8");

export type DocHeading = { depth: number; text: string; id?: string };

type Block =
  | { type: "heading"; depth: number; text: string; id?: string }
  | { type: "para"; text: string }
  | { type: "list"; items: { marker: string; text: string }[] }
  | { type: "code"; lang: string; body: string }
  | { type: "shell"; block: string; label: string }
  | { type: "callout"; title?: string; blocks: Block[] }
  | { type: "table"; rows: string[][] };

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const pinned = /\s*\\\{#([a-z0-9-]+)\\\}\s*$/;

/** The MDX as blocks, one level deep (a Callout holds its own). */
function blocks(mdx: string): Block[] {
  const lines = mdx.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const until = (end: RegExp) => {
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !end.test(lines[i])) body.push(lines[i++]);
    i += 1;
    return body;
  };
  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      i += 1;
    } else if ((m = /^```(\w*)/.exec(line))) {
      out.push({ type: "code", lang: m[1], body: until(/^```\s*$/).join("\n") });
    } else if (/^<Shell\b.*\/>\s*$/.test(line)) {
      out.push({ type: "shell", block: attr(line, "block") ?? "", label: attr(line, "label") ?? "" });
      i += 1;
    } else if (/^<Callout\b/.test(line)) {
      const title = attr(line, "title");
      out.push({ type: "callout", ...(title ? { title } : {}), blocks: blocks(until(/^<\/Callout>\s*$/).join("\n")) });
    } else if (/^<TableRegion\b/.test(line)) {
      const table = until(/^<\/TableRegion>\s*$/).join("\n");
      const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
        [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => cell[1].trim()),
      );
      out.push({ type: "table", rows });
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const id = pinned.exec(m[2])?.[1];
      out.push({ type: "heading", depth: m[1].length, text: m[2].replace(pinned, ""), ...(id ? { id } : {}) });
      i += 1;
    } else if (listItem.test(line)) {
      const items: { marker: string; text: string }[] = [];
      while (i < lines.length && lines[i].trim()) {
        const item = listItem.exec(lines[i]);
        if (item) items.push({ marker: item[2], text: item[3] });
        else if (items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
        i += 1;
      }
      out.push({ type: "list", items });
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|<[A-Z])/.test(lines[i]) && !listItem.test(lines[i])) {
        para.push(lines[i++].trim());
      }
      if (para.length === 0) {
        para.push(line.trim());
        i += 1;
      }
      out.push({ type: "para", text: para.join(" ") });
    }
  }
  return out;
}

/** Braces the MDX escapes (\{ \}) as they read. */
const unescape = (text: string) => text.replace(/\\([{}<>*_`[\]\\])/g, "$1");

/** Inline Markdown as plain words: code, emphasis and links reduced to their text. */
function plain(text: string): string {
  return unescape(
    text
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** The headings, with their pinned ids. */
export function docHeadings(mdx: string): DocHeading[] {
  return blocks(mdx).flatMap((b) => (b.type === "heading" ? [{ depth: b.depth, text: plain(b.text), ...(b.id ? { id: b.id } : {}) }] : []));
}

/** The opening: the page's first block, as plain text, when it is a paragraph ("" otherwise). */
export function docOpening(mdx: string): string {
  const first = blocks(mdx)[0];
  return first?.type === "para" ? plain(first.text) : "";
}

/** The prose a reader reads: headings, paragraphs, lists, callouts and tables; commands and their output left out. */
export function docPlainText(mdx: string): string {
  const text = (list: Block[]): string[] =>
    list.flatMap((b) => {
      switch (b.type) {
        case "heading":
        case "para":
          return [plain(b.text)];
        case "list":
          return b.items.map((item) => plain(item.text));
        case "callout":
          return [...(b.title ? [plain(b.title)] : []), ...text(b.blocks)];
        case "table":
          return b.rows.map((row) => row.map(plain).join(" "));
        default:
          return [];
      }
    });
  return text(blocks(mdx)).join("\n");
}

/** The brief's word regex (scripts/lab/lib/page-measures.mjs WORD_SOURCE): a letter or digit, then letters, digits and ' ’ . : / _ -. */
const word = /[\p{L}\p{N}][\p{L}\p{N}'’.:/_-]*/gu;
export const wordCount = (text: string): number => text.match(word)?.length ?? 0;

/** "About N minutes" on a task page: the word count at 200 words a minute, at least 1. */
export const readingMinutes = (words: number): number => Math.max(1, Math.ceil(words / 200));

/**
 * The minutes a task page gives where §3.5 names them instead of the reading time: the Quick start's "About 5 minutes"
 * is the time to do it, a 260 MB pull included, not to read its 480 words.
 */
const taskMinutes: Readonly<Record<string, number>> = { "quick-start": 5 };

/** A task page's "About N minutes": §3.5's figure where it gives one, otherwise the reading time. */
export const docMinutes = (slug: string, mdx: string): number => taskMinutes[slug] ?? readingMinutes(wordCount(docPlainText(mdx)));

/**
 * The prose as sentences, for docs/brand.md's length rule: each paragraph, list item and table cell split after
 * . ! or ? before a space; headings, callout titles and every other line of prose as they are; code left out.
 */
export function docSentences(mdx: string): string[] {
  const split = (text: string) => plain(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const of = (list: Block[]): string[] =>
    list.flatMap((b) => {
      switch (b.type) {
        case "heading":
        case "para":
          return split(b.text);
        case "list":
          return b.items.flatMap((item) => split(item.text));
        case "callout":
          return [...(b.title ? split(b.title) : []), ...of(b.blocks)];
        case "table":
          return b.rows.flatMap((row) => row.flatMap(split));
        default:
          return [];
      }
    });
  return of(blocks(mdx));
}

/** The MDX with code (fenced blocks and code spans) blanked out, so a placeholder in code is never read as a tag. */
const withoutCode = (mdx: string) => mdx.replace(/^```[\s\S]*?^```\s*$/gm, "").replace(/`[^`\n]*`/g, "");

/** The tags the MDX writes outside code (opening tags, each name once): MDX reads each as JSX. */
export function docTags(mdx: string): string[] {
  return [...new Set([...withoutCode(mdx).matchAll(/<([A-Za-z][\w.-]*)/g)].map((m) => m[1]))];
}

/** The Markdown links' targets, outside code. */
export function docLinks(mdx: string): string[] {
  return [...withoutCode(mdx).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** The names of the commands.ts blocks the page shows, in order. */
export function shellBlocks(mdx: string): string[] {
  return [...mdx.matchAll(/<Shell\b[^>]*\bblock="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The page as plain Markdown for llms-full.txt: headings without their ids (deeper by `depthShift`), terminal blocks
 * as their commands only (a Shell block from content/commands.ts), a Callout as a quote, a table as a Markdown table,
 * and site paths made absolute with `absolute`.
 */
export function docMarkdown(mdx: string, { absolute, depthShift = 0 }: { absolute: (path: string) => string; depthShift?: number }): string {
  const inline = (text: string) =>
    unescape(text.replace(/\]\((\/[^)\s]*)\)/g, (_, path: string) => `](${absolute(path)})`))
      .replace(/\s+/g, " ")
      .trim();
  const fence = (lines: readonly string[]) => ["```sh", ...lines, "```"].join("\n");
  const render = (list: Block[]): string[] =>
    list.flatMap((b): string[] => {
      switch (b.type) {
        case "heading":
          return [`${"#".repeat(Math.min(6, b.depth + depthShift))} ${inline(b.text)}`];
        case "para":
          return [inline(b.text)];
        case "list":
          return [b.items.map((item) => `${/\d/.test(item.marker) ? item.marker : "-"} ${inline(item.text)}`).join("\n")];
        case "code":
          return [fence(parseTerminal(b.body).commands)];
        case "shell": {
          const block = commands.blocks[b.block as keyof typeof commands.blocks];
          if (!block) throw new Error(`docs-text: no commands.blocks.${b.block}`);
          return [fence(block.commands)];
        }
        case "callout":
          return [
            [...(b.title ? [`**${inline(b.title)}**`] : []), ...render(b.blocks)]
              .join("\n\n")
              .split("\n")
              .map((line) => (line ? `> ${line}` : ">"))
              .join("\n"),
          ];
        case "table": {
          const [head, ...rows] = b.rows.map((row) => `| ${row.map((cell) => inline(cell.replace(/<[^>]+>/g, "")) || " ").join(" | ")} |`);
          if (!head) return [];
          return [[head, `|${b.rows[0].map(() => " --- |").join("")}`, ...rows].join("\n")];
        }
      }
    });
  return render(blocks(mdx)).join("\n\n");
}
