/**
 * Copying for Command and CodeBlock, as pure functions the components call (and the tests check without a browser).
 * The Clipboard API writes the text; when it is missing or refuses (an insecure page, a denied permission), the
 * component selects the text for the reader and says which keys copy it.
 */

export type CopyState = "idle" | "copied" | "failed";

/** How long "Copied" stays before the button reads "Copy" again (§4.3: resets after 2 s). */
export const COPIED_RESET_MS = 2000;

/** Anything with the Clipboard API's writeText (navigator.clipboard, or a stand-in in a test). */
export type ClipboardLike = { writeText(text: string): Promise<void> } | null | undefined;

/** Writes `text` to the clipboard: "copied", or "failed" when there is no Clipboard API or it refused. */
export async function copyText(text: string, clipboard: ClipboardLike): Promise<"copied" | "failed"> {
  if (!clipboard || typeof clipboard.writeText !== "function") return "failed";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * What a click on Copy does: write `text` with the Clipboard API; when that fails, call `select` (the component selects
 * its text for the reader) exactly once, after the attempt and never on success. useCopy sets its state from the
 * result, so this is the whole of the flow the tests check.
 */
export async function runCopy(text: string, clipboard: ClipboardLike, select: () => void): Promise<"copied" | "failed"> {
  const result = await copyText(text, clipboard);
  if (result === "failed") select();
  return result;
}

/** Sets the state back to "idle" after COPIED_RESET_MS; returns the function that cancels the reset. */
export function scheduleReset(setState: (state: CopyState) => void, delay = COPIED_RESET_MS): () => void {
  const timer = setTimeout(() => setState("idle"), delay);
  return () => clearTimeout(timer);
}

/**
 * Whether the reader's selection is this component's text (whitespace aside: a selection across lines of a <pre> can
 * differ in spaces), so that after a failure only their copy of that text, not of anything else on the page, counts
 * as copied.
 */
export function selectionMatches(selected: string | null | undefined, text: string): boolean {
  const normal = (value: string) => value.replace(/\s+/g, " ").trim();
  return Boolean(selected) && normal(text) !== "" && normal(selected ?? "") === normal(text);
}

/** The keys that copy a selection on the reader's platform (navigator.platform or userAgent): ⌘C on Apple, Ctrl+C elsewhere. */
export function copyShortcut(platform: string): "⌘C" | "Ctrl+C" {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘C" : "Ctrl+C";
}

/** A terminal block: the commands (what Copy copies), the real output lines it prints, and a leading comment. */
export type CodeBlockData = {
  readonly commands: readonly string[];
  readonly output?: readonly string[];
  readonly comment?: string;
};

/** What a CodeBlock's Copy copies: its commands, one per line. Never a prompt, the comment or the output. */
export function commandsText(block: Pick<CodeBlockData, "commands">): string {
  return block.commands.join("\n");
}

/** Selects an element's text for the reader (the failure path: they copy it with the keyboard). */
export function selectContents(node: Node | null): void {
  if (!node || typeof window === "undefined") return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}
