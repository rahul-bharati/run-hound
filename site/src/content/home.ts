/**
 * The homepage's words (DESIGN.md §3.1): a pitch and a router in eight blocks, at most 750 words in <main> (check-copy
 * fails the build above that once this file exists; home.test.ts holds each block to its budget). Every word the
 * homepage shows lives here; the components in components/home/ only lay them out. Counts come from the checks data,
 * the release and its date from lib/site.ts, the run's facts from content/hero-run.ts (the Kennel 0.6.0 extract), and
 * every command from content/commands.ts: nothing here types a count or a release (home.test.ts checks).
 *
 * Fields a reader never sees as text are named so the word budgets can leave them out: href, id, icon, srOnly (what
 * only screen readers get), alt, check (a check id) and n (a number the label already says).
 *
 * Server-only, like every content module: a client component (the Copy button) gets its words as props.
 */
import { checkHref } from "@/components/checks/links";
import { builtInChecks, previewGroups, type PreviewGroup } from "@/content/checks/data";
import { commands } from "@/content/commands";
import { heroRun, kennelEvidence } from "@/content/hero-run";
import { factsLine, proofStrip } from "@/content/trust";
import { ui } from "@/content/ui";
import { bugFormUrl, href, resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";

export type HomeLink = { readonly label: string; readonly href: string };

const total = builtInChecks.length;
const quickStart: HomeLink = { label: site.cta, href: href("docs-quick-start") };
const github = { label: ui.header.viewOnGitHub, href: site.github };

// ---- 0. Hero ------------------------------------------------------------------------------------------------------------

const hero = {
  pill: { label: `New in ${site.version}: paywall and data-change checks`, href: href("checks", "group-security") },
  /** The h1's three phrases, whole from 1024 px; the last is in accent. */
  h1: ["Find the bugs", "your AI forgot", "to test."],
  subhead: `${site.name} is free, open-source, AI-assisted UI testing for apps built with Lovable, Bolt or v0. It tests a page in a real browser on your machine, with evidence for every finding.`,
  primary: quickStart,
  /** Phones show "GitHub" (the buttons share a row below 640 px); the accessible name stays the full label. */
  secondary: { ...github, short: ui.header.github },
  command: commands.pullAndRun,
  hint: { text: "Then open localhost:4000. Docker or Podman.", link: { label: "Other ways to start", href: "#start" } },
  proof: proofStrip.map((fact) => ({ label: fact.label, href: resolveTarget(fact.link) })),
  caption: `A ${heroRun.progress.seconds}-second run on Kennel, our demo app with planted bugs, replayed in 3 seconds.`,
  /** What the run window shows, as the sr-only list beside it (the window itself is aria-hidden, like a screenshot). */
  srOnly: [
    `${site.name} finds the “${heroRun.form}” form at ${heroRun.address}: ${heroRun.fieldCount} fields.`,
    `It runs all ${heroRun.progress.total} planned scenarios in ${heroRun.progress.seconds} seconds.`,
    `Finding, ${heroRun.finding.severity.toLowerCase()}: ${heroRun.finding.title}, two save requests ${heroRun.finding.gapMs} ms apart.`,
    "It comes with evidence and a Playwright test.",
  ],
};

// ---- 1. Why ---------------------------------------------------------------------------------------------------------------

/** Numbers from docs/research.md §2.1 ("Strong" evidence), each linked to the source it lists (§7). */
const why = {
  id: "why",
  title: "AI builds fast. It ships holes too.",
  stats: [
    {
      value: "45%",
      text: "of AI-generated code samples failed security tests.",
      source: { label: "Veracode, 2025", href: "https://www.veracode.com/blog/genai-code-security-report/" },
    },
    {
      value: "95.9%",
      text: "of the top million home pages fail automated WCAG checks.",
      source: { label: "WebAIM Million, 2026", href: "https://webaim.org/projects/million/" },
    },
    {
      value: "2,000+",
      text: "vulnerabilities across about 5,600 live vibe-coded apps.",
      // research.md: the methodology post (about 5,600 apps), not the landing page (about 1,400).
      source: {
        label: "Escape.tech, 2025",
        href: "https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/",
      },
    },
  ],
  link: { label: "The research behind these numbers", href: `${site.github}/blob/main/docs/research.md` },
};

// ---- 2. How it works --------------------------------------------------------------------------------------------------

const [firstRequest, secondRequest] = kennelEvidence.requests.rows;

const how = {
  id: "see-it-run",
  title: "How it works: nothing runs until you approve",
  steps: [
    { name: "Explore", text: "It opens your page in Chromium and finds its forms, widgets and buttons." },
    { name: "Plan", text: "Each scenario says what it tests and which test records it creates." },
    { name: "Approve", text: "You tick what runs. Checks that change data start unticked." },
    { name: "Run", text: "Real checks in a real browser, while you watch the live page." },
    { name: "Report", text: "Every finding comes with proof you can check yourself." },
  ],
  proof: {
    title: "One finding, three kinds of proof",
    page: {
      caption: "The page: one double click, two saved bookings, both marked.",
      alt: `Kennel's “${heroRun.bookings}” list after one double click on “Book”: ${kennelEvidence.crop.alt}, both marked.`,
    },
    requests: {
      caption: `The requests: two identical saves, ${heroRun.finding.gapMs} ms apart, both accepted.`,
      srOnly: `${kennelEvidence.requests.title}: request ${firstRequest.n} at ${firstRequest.at} and ${secondRequest.n} at ${secondRequest.at}, both answered ${secondRequest.status}.`,
    },
    test: {
      caption: "The test: runs on its own, and fails until the bug is fixed.",
      srOnly: "The exported Playwright test double-clicks “Book” and expects one save request.",
    },
  },
  links: [
    { label: "How it works in detail", href: href("how-it-works") },
    { label: "See real findings", href: href("demo") },
  ],
};

// ---- 3. Checks ------------------------------------------------------------------------------------------------------------

/** Each group's question, and the four checks it names: each example is exactly one built-in check (V4). */
const groupCopy: Record<PreviewGroup, { question: string; examples: string[] }> = {
  Accessibility: {
    question: "Can everyone use the page?",
    examples: ["keyboard-completion", "focus-visible", "error-announcement", "reflow-320"],
  },
  Features: {
    question: "Does it actually work?",
    examples: ["persistence", "double-submit", "silent-failure", "client-only-validation"],
  },
  Security: {
    question: "Can someone read or change what they shouldn't?",
    examples: ["access-control", "write-access", "paywall-trust", "bundle-secrets"],
  },
};

const checks = {
  id: "checks",
  title: `${total} checks: accessibility, features and security`,
  groups: previewGroups.map((g) => {
    const copy = groupCopy[g.group];
    const examples = copy.examples.map((id) => {
      const check = g.checks.find((c) => c.id === id);
      if (!check) throw new Error(`home: ${id} is not a ${g.group} check (content/checks/data.ts)`);
      // The labels are the checks data's plain words, which the hub, the check pages and search use too.
      return { check: id, label: check.plain, href: checkHref(id), ...(check.signedIn ? { tag: ui.tags.signedIn } : {}) };
    });
    const more = g.checks.length - new Set(copy.examples).size;
    return {
      name: g.group,
      anchor: g.anchor,
      count: g.checks.length,
      question: copy.question,
      examples,
      more: { n: more, label: `and ${more} more`, href: href("checks", g.anchor) },
    };
  }),
  all: { label: `See all ${total} checks`, href: href("checks") },
};

// ---- 4. AI-built apps -----------------------------------------------------------------------------------------------------

const aiBuilt = {
  id: "ai-built-apps",
  title: "Works on Lovable, Bolt and v0 apps.",
  intro:
    "Export your app's code and start it on your machine. Run Hound fills custom selects, dialogs and toasts the way a person would.",
  cards: [
    {
      icon: "widgets",
      title: "Custom widgets",
      text: "Selects, comboboxes, switches and sliders from Radix, shadcn/ui, Headless UI, cmdk and MUI.",
    },
    {
      icon: "dialogs",
      title: "Forms in dialogs",
      text: "It opens up to 3 dialog buttons, such as “Add member”, and tests the form inside.",
    },
    {
      icon: "accounts",
      id: "signed-in",
      title: "Signed-in runs",
      tag: ui.tags.preview,
      text: "Signs in as test accounts you own, then checks whether another account can read or change your data.",
    },
    {
      icon: "fernway",
      title: "Kept honest by Fernway",
      text: "A test app built the way AI builders build. On its clean version, any confirmed finding is a false positive.",
    },
  ],
  link: { label: "Test a Lovable, Bolt or v0 app", href: href("ai-built-apps") },
};

// ---- 5. Trust -------------------------------------------------------------------------------------------------------------

const trust = {
  id: "safety",
  title: "Runs on your machine. Real checks decide.",
  items: [
    {
      icon: "local",
      title: "Local by default",
      text: "It tests localhost, private addresses and hosts you list, and refuses public sites. Reports stay on your machine.",
    },
    {
      icon: "guard",
      title: "Guard rails",
      text: "Checks that change data start unticked and put back what they change. Reports hide passwords and session tokens.",
    },
    {
      icon: "ai",
      id: "ai",
      title: "AI is optional",
      text: "Off by default. Turn it on and your own model reviews the plan, suggests flows and explains findings.",
    },
    {
      icon: "evidence",
      title: "No evidence, no finding",
      text: "Pass or fail comes from Playwright assertions, axe-core and captured traffic, never from a model.",
    },
  ],
  link: { label: "Safety and data flow in the docs", href: href("docs-safety") },
};

// ---- 6. Start -------------------------------------------------------------------------------------------------------------

const start = {
  id: "start",
  title: "Free and open source. Start with one command.",
  command: commands.pullAndRun,
  hint: ui.afterCopy,
  /** The command line's region name: the hero's is "Run command", and a page's landmark names differ. */
  srOnly: "Start command",
  /** Three ways on, each led by a link: text before, a command or address in code, text after. */
  lines: [
    {
      lead: { label: "Your app:", href: href("docs-your-app") },
      before: "run it on your machine, then enter",
      code: "http://host.docker.internal:<port>/<page>",
      after: ".",
    },
    {
      lead: { label: "No app handy:", href: href("docs-test-lab") },
      before: "the test lab starts Kennel, Fernway and five sample apps with planted bugs.",
    },
    {
      lead: { label: "In CI:", href: href("docs-cli") },
      code: "run-hound run <url> --approve all",
      after: "exits 1 on a confirmed finding.",
    },
  ],
  links: [
    { label: "Quick start", href: href("docs-quick-start") },
    { label: "Source on GitHub", href: site.github },
    { label: "Report a bug", href: bugFormUrl },
    { label: "Changelog", href: site.changelog },
    {
      label: "How to help",
      href: resolveTarget({ to: "open-source", hash: "how-to-help", fallback: { to: "open-source", hash: "contributing" } }),
    },
  ],
  facts: factsLine.map((fact) => ({ label: fact.label, href: resolveTarget(fact.link) })),
};

// ---- 7. Close -------------------------------------------------------------------------------------------------------------

const close = {
  /** The closing h2: the tagline, its last words in accent. */
  title: { lead: "Your AI said it's done.", key: "Let's check." },
  line: "One command, one page, evidence for every finding.",
  buttons: [quickStart, github],
};

/** The eight blocks, in page order (§3.1). */
export const home = { hero, why, how, checks, aiBuilt, trust, start, close };
export type HomeBlockKey = keyof typeof home;

/**
 * The numbered bands between the hero and the close, in page order: each band's "0N / 07" label is its place here
 * (the hero is 01), so cutting or moving a band (§3.1: block 1 is the first to cut) renumbers the rest.
 */
export const bandOrder = ["why", "how", "checks", "aiBuilt", "trust", "start"] as const satisfies readonly HomeBlockKey[];

/** A band's index label: its place after the hero, out of the hero and the numbered bands. */
export function bandIndex(key: (typeof bandOrder)[number]): { n: number; total: number } {
  return { n: bandOrder.indexOf(key) + 2, total: bandOrder.length + 1 };
}
