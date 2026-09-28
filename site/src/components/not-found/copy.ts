/**
 * The 404's words (DESIGN.md §3.13). The h1 says where the reader is in the hound's terms; its key words are the
 * accent (one of the accent budget's exempt uses, §2.3). The page names no count and no release.
 */
export const notFoundCopy = {
  /** A dim mono label above the h1: the only label, never in accent. */
  label: "404",
  title: { lead: "The trail ", accent: "goes cold here." },
  text: "This page doesn't exist or has moved.",
  /** The buttons, as §3.13 names them. */
  home: "Home",
  docs: "Docs",
  report: { question: "Followed a broken link here?", link: "Tell us on GitHub" },
} as const;

/** The 404's <title> and description: a separate export, so the page's client chunk doesn't carry them. */
export const notFoundMetadata = {
  title: "Page not found",
  description: "This page does not exist. Head back to the Run Hound home page or the docs.",
} as const;
