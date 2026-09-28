/**
 * The search dialog's logic (DESIGN.md §3.16), apart from React so `pnpm test` checks it: the shortcut, the status
 * text, the empty state, Pagefind's excerpts as text parts, and arrow-key movement. Plain .ts with no imports: the
 * trigger (initial JS on every page) and the lazy dialog both use it.
 */

/** A keydown as the shortcut reads it. */
type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: unknown;
};

/** Whether the element a key was pressed in is somewhere the reader types. */
function isTyping(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const { tagName, isContentEditable } = target as { tagName?: string; isContentEditable?: boolean };
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || Boolean(isContentEditable);
}

/** Ctrl+K or ⌘K, with no Alt or Shift, and not while typing in a field. There is no "/" shortcut (WCAG 2.1.4). */
export function isSearchShortcut(event: KeyLike): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k" &&
    !isTyping(event.target)
  );
}

/** The dialog's own status: "1 result", "12 results", "No results". */
export function countText(count: number): string {
  if (count === 0) return "No results";
  return `${count} ${count === 1 ? "result" : "results"}`;
}

/** What the dialog says when nothing matches, in parts: `link` is the text of the link to the docs hub. */
export function emptyParts(query: string): { before: string; link: string; after: string } {
  return { before: `No results for “${query}”. Try a check id like double-submit, or `, link: "browse the docs", after: "." };
}

/** What the dialog says when nothing matches, as one sentence. */
export function emptyText(query: string): string {
  const { before, link, after } = emptyParts(query);
  return before + link + after;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => entities[name]);

/**
 * A Pagefind excerpt ("… <mark>word</mark> …", the page's text escaped) as parts to render as text, marked or not,
 * so no HTML from the index is ever parsed: anything that isn't a <mark> stays literal text.
 */
export function excerptParts(excerpt: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  const re = /<mark>([\s\S]*?)<\/mark>/g;
  let at = 0;
  for (let m = re.exec(excerpt); m; m = re.exec(excerpt)) {
    if (m.index > at) parts.push({ text: decode(excerpt.slice(at, m.index)), mark: false });
    parts.push({ text: decode(m[1]), mark: true });
    at = m.index + m[0].length;
  }
  if (at < excerpt.length) parts.push({ text: decode(excerpt.slice(at)), mark: false });
  return parts;
}

/**
 * Where an arrow key moves focus among the dialog's stops (0 is the search field, 1 to count − 1 the result links):
 * one step, stopping at either end. From anywhere else it starts at the field.
 */
export function nextIndex(current: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (current < 0) return 0;
  const next = key === "ArrowDown" ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), count - 1);
}
