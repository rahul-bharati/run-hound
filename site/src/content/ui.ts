/**
 * The interface's own words that pages pass to their components: the header's labels, the search dialog's, the docs
 * and check pages' headings and meta lines, tags, written once as a dictionary (nested strings with {name}
 * placeholders), the shape a translation would take. Page copy lives in the other content modules; commands, check ids
 * and anchors are never translated.
 *
 * The words the primitives say themselves (Copy and Copied, the copy statuses, the command's region, Breadcrumb,
 * Previous and Next, the report line, "(opens …)") are in components/primitives/labels.ts, where client components can
 * import them; this module is server-only like every content module (src/boundaries.test.ts), so a client component
 * (the menu, the search dialog) gets these strings as props. None is written in both places (ui.test.ts).
 *
 * The design's wording is kept word for word where it gives one (ui.test.ts). A check page may repeat these on every
 * page; the rule against repeated sentences on check pages leaves them out (the design's §3.6).
 */
export const ui = {
  /** The layout's skip link. */
  skipToContent: "Skip to content",
  /** The header (§3.2). */
  header: {
    menu: "Menu",
    search: "Search",
    /** The shortcut shown beside "Search", part of its accessible name ("Search Ctrl K"). */
    searchKeys: "Ctrl K",
    /**
     * The Apple form, for the search dialog's own key hint; the server-rendered trigger keeps "Ctrl K" (§3.2), so
     * nothing in the header changes after hydration.
     */
    searchKeysApple: "⌘ K",
    changelog: "Changelog",
    github: "GitHub",
    /** The hero's secondary button: its accessible name contains the "GitHub" it shows on phones. */
    viewOnGitHub: "View on GitHub",
  },
  /** What to do once the run command is copied: a Command's status says it after "Copied." (§2.5 Command). */
  afterCopy: "Paste it in a terminal, then open localhost:4000.",
  /** The site search dialog (§3.16). */
  search: {
    title: "Search the docs, checks and FAQ",
    label: "Search",
    /** The dialog's own status line; plural() picks the form. */
    results: { one: "{count} result", other: "{count} results" },
    noResults: "No results for “{query}”. Try a check id like double-submit, or browse the docs.",
    /** In `next dev`, where there is no index. */
    devOnly: "Search works in production builds.",
    /** The dialog's close button (Escape closes it too). */
    close: "Close",
  },
  /** Docs pages (§3.5). */
  docs: {
    onThisPage: "On this page",
    docsMenu: "Docs menu",
    nextSteps: "Next steps",
    /** The meta line under a docs page's h1; the reading time follows it on task pages, and plural() picks the form. */
    meta: "For release {version} · Updated {date}",
    readingTime: { one: "About {count} minute", other: "About {count} minutes" },
  },
  /** The checks hub's cards (§3.7): each links its check page; ArrowLink draws the arrow. */
  checksHub: {
    howTested: "How it's tested",
  },
  /** The demo's findings (§3.12): each links its check page. */
  demo: {
    aboutCheck: "About this check",
  },
  /** After each FAQ answer, to the page that holds the detail (§3.9). */
  faq: {
    readMore: "Read more",
  },
  /** Check pages (§3.6). */
  checkPage: {
    checked: "Checked against release {version} · {date}",
    howTested: "How Run Hound tests it",
    notCounted: "Not counted:",
    finding: "What a finding looks like",
    reproduce: "Reproduce it with Playwright",
    runIt: "Run it with {command}",
    fix: "How to fix it",
    askYourAi: "What to ask your AI",
    limits: "Limits",
    related: "Related checks",
    allChecks: "All {count} checks",
    noEvidence: "No finding from the test apps is shown here yet",
    /** The facts panel's keys. */
    facts: {
      id: "Check id",
      group: "Group",
      severity: "Typical severity",
      records: "Test records",
      signIn: "Needs sign-in",
      ticked: "Ticked by default",
      added: "Added in release",
    },
  },
  /** Small outlined tags (§2.5 Tag). */
  tags: {
    preview: "Preview",
    signedIn: "Signed in",
    addedIn: "Added in {release}",
  },
  /** The hero run's button once it has played (§4.3). */
  replay: "Replay",
} as const;

/** A dictionary string with its {name} placeholders filled; a placeholder without a value is a bug, so it throws. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`ui: no value for {${name}} in "${template}"`);
    return String(values[name]);
  });
}

/** The form of a counted string for `count` (English plural rules), with {count} filled. */
export function plural(forms: { readonly one: string; readonly other: string }, count: number): string {
  const form = new Intl.PluralRules("en").select(count) === "one" ? forms.one : forms.other;
  return fill(form, { count });
}
