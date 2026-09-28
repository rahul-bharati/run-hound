import { builtInChecks } from "@/content/checks/data";
import { commands, type ShellBlock } from "@/content/commands";
import type { LinkTarget } from "@/content/routes";

/**
 * Every word of /how-it-works/ (DESIGN.md §3.12): the five steps with their screenshots, the outputs, and the Start
 * snippet that replaced the 279-word get-started block the homepage also showed. The principles and "what a browser
 * can't see" are content/claims.ts's, written once for every page that states them. Plain data, server-only like every
 * content module; app/how-it-works/page.tsx renders it, components/demo/rich-text.tsx its inline code and links.
 *
 * The page may never hold more words than it did before the redesign (1,333 in <main>, scripts/lab/baseline.json):
 * how-it-works.test.ts counts these strings and scripts/lab/specs/flat-b.spec.mjs the built page.
 */

/**
 * Shared by all three product pages (demo.ts and ai-built.ts import it); it lives here because F2 owns this file, and a
 * later pass may move it to content/rich.ts.
 *
 * A run of text with inline code and links, as the product pages write a sentence that names a flag or links a page:
 * a plain string, `{ code }` for a command, flag, URL or id, or `{ link, text }` for a link to a registry page (its
 * `fallback` until that page exists; lib/nav.ts resolveTarget) or an address off the site (`href`).
 */
export type Segment =
  | string
  | { readonly code: string }
  | { readonly text: string; readonly link: LinkTarget }
  | { readonly text: string; readonly href: string; readonly opens: string };
export type Rich = readonly Segment[];

/** The plain text of a rich run: what a reader reads, and what the word counts count. */
export const plainText = (rich: Rich): string =>
  rich.map((segment) => (typeof segment === "string" ? segment : "code" in segment ? segment.code : segment.text)).join("");

/** The screenshots the steps show, by their key in components/screens.ts stepScreens (content can't import images). */
export type StepShot = "explore" | "plan" | "approve" | "run" | "report";

export type HowStep = {
  /** "01" to "05", shown in the step's mono label with its name. */
  readonly number: string;
  /** The step's name, a mono label of one word. */
  readonly name: string;
  /** The step's h3: a statement. */
  readonly title: string;
  readonly body: Rich;
  readonly shot: StepShot;
  /** The screenshot's caption: at most 15 words, sentence case (brand.md, copy rules). */
  readonly caption: string;
};

/** The page's top: the h1, the lede, and where the screenshots come from (Kennel defined at its first use). */
export const howItWorksIntro = {
  title: "It asks before it tests.",
  lede: "Run Hound finds the forms and controls on your page, drafts a test plan and waits for your approval. Then it runs the plan in a real browser and reports what broke, with proof.",
  meta: "Screenshots from a real run on Kennel, a pet-sitting booking page with planted bugs, with AI off.",
  /** The steps' h2, read by screen readers only: the numbered steps say it on screen. */
  stepsHeading: "The five steps",
} as const;

export const howSteps: readonly HowStep[] = [
  {
    number: "01",
    name: "Explore",
    title: "It looks around like a user would",
    body: [
      "Run Hound opens your page in a headless Chromium with Playwright. It finds the forms and controls on it: fields and their labels, buttons, and the controls outside any form. That includes the custom selects, switches and sliders of component libraries such as Radix and shadcn/ui, and forms that open in a dialog. It reads the accessibility tree and the DOM, the same structure screen readers rely on, and notes the page's response headers, cookies and scripts. With a test account, it signs in first and explores the page as that user.",
    ],
    shot: "explore",
    caption: "New run: the page address, and what Run Hound found on it.",
  },
  {
    number: "02",
    name: "Plan",
    title: "It drafts golden paths and danger paths",
    body: [
      "From what it found, it plans form checks for each form, plus page-wide checks. Those cover security headers, cookie flags, CORS, public source maps, dead controls anywhere on the page and links that break when opened directly. All fall under three groups, Accessibility, Features and Security, which hold ",
      { text: `the ${builtInChecks.length} built-in checks`, link: { to: "checks" } },
      ". Signed in, it adds the access checks: can another account, or a visitor who isn't signed in, read your data? Golden paths are what a real user does; danger paths are what breaks things, like double clicks, server errors and invalid input. The plan comes from what it found on the page. If you turn on AI, your own model reviews it, recommending and ranking each scenario with a reason. It suggests up to 5 extra flows built only from the fields and buttons it found. They stay unticked until you choose them.",
    ],
    shot: "plan",
    caption: "The plan's Accessibility group: each scenario says what it tests.",
  },
  {
    number: "03",
    name: "Approve",
    title: "Nothing runs until you say so",
    body: [
      "The plan opens in a local web UI, or prints on the command line (",
      { code: "--plan-only" },
      "). Each scenario says what it does and whether it creates test records. Pick the ones you want, a whole group at a time if you like. Scenarios that could change or delete data, such as Delete or Sign out buttons, stay off unless you opt in.",
    ],
    shot: "approve",
    caption: "The end of the plan: both options off, and Start run for 20 scenarios.",
  },
  {
    number: "04",
    name: "Run",
    title: "It runs your plan and keeps receipts",
    body: [
      "The approved scenarios run group by group in a real browser. A live view shows the page under test, the current scenario and its steps as they happen, the elapsed time and a timestamped log. Stop run stops it for real and still writes a report; Back to test plan plans the same page again. Screenshots, console and network traffic are kept, so every result traces back to what actually happened.",
    ],
    shot: "run",
    caption: "The live view mid-run: 8 of 20 scenarios, 30 seconds in.",
  },
  {
    number: "05",
    name: "Report",
    title: "Every defect, explained with proof",
    body: [
      "Each finding comes with its group, severity, a plain-language explanation, evidence (annotated screenshots, GIFs, request and response cards) and an exported Playwright test. It also tells you what to ask your AI to fix, and links the check's own page. Re-run repeats the same scenarios once you have fixed something, and the Runs page lists every run on this machine. On the command line the exit code says it all: 0 with no confirmed findings, 1 with at least one, 2 on an error. With AI on, each finding also gets an AI explanation beside the built-in one, labelled advisory. ",
      { text: "See real findings from a run on Kennel, with their evidence", link: { to: "demo" } },
      ".",
    ],
    shot: "report",
    caption: "The report: 20 scenarios, 20 with issues, in 56 seconds.",
  },
];

/** "Design principles": the band's heading and intro (the principles are content/claims.ts's). */
export const designPrinciplesBand = {
  title: "Design principles",
  intro: "The principles Run Hound is built around. They exist to keep findings trustworthy and runs safe.",
} as const;

/** "What you get": the three outputs of every run. `label` is a mono label of one word. */
export const outputsBand = {
  title: "What you get",
  intro: "Three outputs from every run, all yours to keep.",
  items: [
    {
      label: "REPORT",
      title: "HTML and Markdown report",
      text: "Run time, a table per group and findings by severity, each with its evidence and what to ask your AI to fix.",
    },
    {
      label: ".SPEC.TS",
      title: "Playwright tests you keep",
      text: "A re-runnable spec for each finding, in plain Playwright without Run Hound: reproduce the failure, then add it to CI.",
    },
    {
      label: "JSON",
      title: "report.json",
      text: "Everything machine-readable: the plan, groups, scenario results and timings, findings and the Run Hound version.",
    },
  ],
} as const;

/** "What it can't see": the band's heading and intro (the list is content/claims.ts cantSeeTopics). */
export const unseenBand = {
  title: "What it can't see",
  intro: "Every report ends with this list: a browser sees only what your app shows it. A clean report is never a clean bill of health.",
} as const;

/**
 * The Start snippet (§3.12): the quick start's three pull-and-run commands with Copy (content/commands.ts, their one
 * source), and a link to the quick start, which has the rest (the test lab, Podman, Windows, from source). On screen
 * they take four lines: `docker run` continues on a second line after a backslash, as in the quick start.
 */
export const startSnippet: {
  readonly title: string;
  readonly text: string;
  readonly label: string;
  readonly block: ShellBlock;
  readonly link: { readonly text: string; readonly to: LinkTarget };
} = {
  title: "Try it on your own page",
  text: "Run Hound runs on your machine with Docker or Podman, free and MIT licensed. Start it, open localhost:4000 and enter a page of your own.",
  label: "Run Hound, from any folder",
  block: { commands: commands.blocks.run.commands },
  link: {
    text: "The quick start, step by step",
    to: { to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } },
  },
};
