/**
 * The words the primitives themselves say: control labels, status messages and landmark names, as DESIGN.md §2.5
 * writes them. Page copy never lives here (it is in src/content/); a caller passes its own words as props, and may
 * override any of these where a page needs another (a second Command on a page names its region differently, so the
 * landmark names stay unique).
 *
 * Plain values, safe to import from client components (src/boundaries.test.ts forbids content/* there, not this).
 */
export const primitiveLabels = {
  copy: "Copy",
  copied: "Copied",
  /** The label a copy button shows when the Clipboard API refused: the reader copies the selection themselves. */
  pressCopy: (shortcut: string) => `Press ${shortcut}`,
  /** The Command's scrolling region (tabindex=0 so the keyboard can scroll it). */
  commandRegion: "Run command",
  /** Spoken after a copy: "Copied." then the next step the caller gives. */
  copiedStatus: (next?: string) => (next ? `Copied. ${next}` : "Copied."),
  commandFailedStatus: (shortcut: string) => `Couldn't copy: the command is selected, press ${shortcut}.`,
  commandsFailedStatus: (shortcut: string) => `Couldn't copy: the commands are selected, press ${shortcut}.`,
  breadcrumb: "Breadcrumb",
  pager: "Previous and next pages",
  previous: "Previous",
  next: "Next",
  reportQuestion: "Something wrong or unclear on this page?",
  reportLink: "Report it on GitHub",
  /** sr-only after an external link's text: " (opens GitHub)". */
  opens: (where: string) => ` (opens ${where})`,
} as const;
