import { builtInChecks } from "@/content/checks/data";
import { resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";
import { routeGraph } from "@/lib/structured-data";

/**
 * The comparison page (/compare/): what Run Hound does next to Playwright's test agents, accessibility rule engines,
 * the AI builders' own scanners and external security scanners. Capabilities only, dated by release. Every statement
 * about another tool comes from docs/research.md §2.2 (Competitors) and §2.3 (Counterarguments and responses), and every
 * link is a source that research.md §7 lists. Prices and tools research.md marks as third-party estimates or
 * "reportedly" (QA Wolf, testRigor, Octomind) are left out. Say what Run Hound adds and where the tools work together;
 * never run the others down. Update with the research, not from memory. Sentences stay at 25 words or fewer (brand.md,
 * compare.test.ts). A row that names Run Hound checks lists their ids, and the page links each to its check page.
 */

/** The page's canonical path, title and meta description: pageMetadata() and the structured data share them. */
export const comparePage = {
  path: "/compare/",
  // The title names Run Hound itself, so it goes without the " · Run Hound" suffix.
  title: "Run Hound vs Playwright, axe-core and security scanners",
  absoluteTitle: true,
  description:
    "Run Hound next to Playwright's test agents, axe-core and Lighthouse, AI-builder scanners and Escape: what each one checks, and how they work together.",
  /** Its name in the breadcrumb and the footer. */
  crumb: "Compare",
} as const;

/** The page's h1 and lede (the h1 names the tools, like the title; sentences of at most 25 words). */
export const compareIntro = {
  title: "Run Hound vs Playwright, axe-core and scanners",
  lede: "Run Hound builds on Playwright and axe-core rather than replacing them. It tests the running app, while the AI builders' own scanners mostly read the code.",
} as const;

/** The sections, in page order, with the ids other pages link to (§3.10). */
export const compareSections = {
  glance: {
    id: "at-a-glance",
    title: "At a glance",
    intro: "Capabilities only. What the table says about other tools comes from our research, which cites no source for Lighthouse, WAVE or Burp.",
    research: "Read the research",
    scrollHint: "Scroll the table sideways to see every tool.",
  },
  tools: { id: "tool-by-tool", title: "Tool by tool", intro: "What each one is for, what Run Hound adds, and how they fit together." },
  notYet: { id: "not-yet", title: "What Run Hound doesn't do yet" },
} as const;

/** The table's caption, for screen readers. */
export const compareCaption = `What Run Hound, Playwright's test agents, accessibility rule engines, AI-builder scanners and external security scanners each do, as of release ${site.version}`;

/** The not-yet section's intro, and where to read more. */
export const notYetIntro = `Release ${site.version} tests one page of an app on your machine. So the comparison isn't read as more than it is, this is what it can't do yet.`;

export const readMore = [
  { label: "Answers to common questions", href: resolveTarget({ to: "faq" }) },
  { label: "Known limitations", href: resolveTarget({ to: "docs-limitations", fallback: { to: "docs", hash: "limitations" } }) },
  { label: "Testing apps built with Lovable, Bolt and v0", href: resolveTarget({ to: "ai-built-apps" }) },
] as const;

/** The research the comparison comes from, on GitHub (§2.2 and §2.3). */
export const researchUrl = `${site.github}/blob/main/docs/research.md#22-competitors`;

export type ToolId = "playwright" | "a11y" | "builders" | "scanners";

/** yes: it does this; some: partly; no: it doesn't; unknown: docs/research.md doesn't say. Cell text may mark `code`. */
export type Mark = "yes" | "some" | "no" | "unknown";

export type Cell = { mark: Mark; text?: string };

export type Source = { label: string; href: string };

export type Tool = {
  id: ToolId;
  /** Column heading in the table. */
  short: string;
  /** Card heading. */
  name: string;
  /** What it is and does (research.md §2.2, "What it does"). */
  what: string;
  /** What Run Hound adds (research.md §2.2 "Gap left for Run Hound", and §2.3). */
  adds: string;
  /** How they fit together, where research.md says so. */
  together: string;
  sources: readonly Source[];
};

export const tools: readonly Tool[] = [
  {
    id: "playwright",
    short: "Playwright test agents",
    name: "Playwright and its test agents",
    what: "Playwright's test agents, since Playwright 1.56, are a free, first-party planner, generator and healer that work with any LLM. They are aimed at developers in an IDE.",
    adds: "Run Hound is built on Playwright. It adds what the agents leave out: a plan you approve in a web UI, built-in accessibility and security checks, and plain-language explanations. A safety gate keeps runs on localhost, private addresses and hosts you list.",
    together:
      "Use them together: every Run Hound finding exports a Playwright spec with role- and label-based locators. It runs in your own Playwright suite, without Run Hound.",
    sources: [{ label: "Playwright test agents", href: "https://playwright.dev/docs/test-agents" }],
  },
  {
    id: "a11y",
    short: "axe-core, Lighthouse, WAVE",
    name: "axe-core, Lighthouse and WAVE",
    what: "Accessibility rule engines. They check one page state at a time; they don't walk flows or complete a task with the keyboard.",
    adds: "Run Hound runs axe-core's WCAG 2.2 AA rules itself, in four states of each form. The states are empty, after an empty submit, after a server error and after a successful send. It completes the form with only the keyboard, and checks visible focus, announced errors, reflow at 320 px and paste in password fields.",
    together:
      "Run Hound embeds axe-core rather than replacing it, so the WCAG rules it runs are axe's. It reports WCAG failures; it doesn't certify compliance.",
    sources: [{ label: "axe-core", href: "https://github.com/dequelabs/axe-core" }],
  },
  {
    id: "builders",
    short: "AI-builder scanners",
    name: "The AI builders' own scanners",
    what: "Lovable's Security Checker scans for secrets and row-level security, with a paid Aikido pentest on top. Bolt runs a free review of the code when you publish, with auto-fix, and calls its audit “a first pass”. Replit's Security Center runs static analysis and dependency scanning before deploy, and v0 checks security when it generates code. Each covers its own platform, and apart from Lovable's paid pentest their checks read the code rather than run the app.",
    adds: "Run Hound is an independent check of the running app, from the browser, after you edit it or connect a backend. Lovable's own docs say its static scans miss runtime issues. It also covers what these scanners don't: features, accessibility and portable Playwright tests. Its signed-in checks reach only your app's own address or a local API; checking a hosted Supabase project's row-level security directly is planned.",
    together:
      "Use them together: the platform's scanner reads the code, and Run Hound tests what the running app does.",
    sources: [
      { label: "Lovable and Aikido", href: "https://docs.lovable.dev/integrations/aikido" },
      { label: "Bolt's security audit", href: "https://bolt.new/blog/security-audit-on-publish" },
      {
        label: "Replit's security scanner",
        href: "https://docs.replit.com/replit-workspace/workspace-features/security-scanner",
      },
      { label: "v0 and security", href: "https://vercel.com/blog/v0-vibe-coding-securely" },
    ],
  },
  {
    id: "scanners",
    short: "Escape and similar scanners",
    name: "Escape and the vibe-app scanners",
    what: "Escape and a long tail of scanners for vibe-coded apps check live apps from outside. They cover dynamic scanning, attack-surface management, secrets in JavaScript bundles, row-level security and headers. They are cloud-hosted and cover security only. ZAP and Burp, proxies for dynamic security testing, are another kind of tool. They are built for specialists, and they don't know which user should see which row. The table's column covers Escape and the vibe-app scanners, not ZAP or Burp.",
    adds: "Security is one of Run Hound's three lenses: the same run checks features and accessibility and exports Playwright tests. Signed in as test accounts you own, it also asks whether another account, or a signed-out visitor, can read or change your data.",
    together: `Use them together: they scan deployed apps, which Run Hound doesn't test yet. Testing live staging sites behind ownership verification is planned for the V4 stage, which the 1.0.0 release completes.`,
    sources: [
      { label: "Escape", href: "https://escape.tech/" },
      { label: "ZAP", href: "https://www.zaproxy.org/blog/2024-09-24-zap-has-joined-forces-with-checkmarx/" },
    ],
  },
];

/**
 * The table: one row per capability. Run Hound's cells come from its own docs (README.md, TESTING.md, docs/*.md);
 * the others from research.md §2.2 and §2.3, "unknown" where it doesn't say.
 */
export type Capability = {
  capability: string;
  runHound: string;
  /** The built-in checks this row names (content/checks/data.ts ids), each linked to its page (checkLink). */
  checks?: readonly string[];
  cells: Record<ToolId, Cell>;
};

export const capabilities: readonly Capability[] = [
  {
    capability: "Runs your app in a real browser",
    runHound: "Headless Chromium, driven by Playwright",
    cells: {
      playwright: { mark: "yes" },
      a11y: { mark: "unknown" },
      builders: { mark: "some", text: "Static checks; Lovable's paid Aikido pentest tests the live app" },
      scanners: { mark: "some", text: "Scans the live app from outside" },
    },
  },
  {
    capability: "Walks flows: dead buttons, silent failures, double submit",
    runHound: "Built-in feature checks",
    checks: ["dead-control", "silent-failure", "double-submit"],
    cells: {
      playwright: { mark: "some", text: "Tests its agents plan and generate" },
      a11y: { mark: "no", text: "Doesn't walk flows" },
      builders: { mark: "no", text: "No functional checks" },
      scanners: { mark: "no", text: "No functional flows" },
    },
  },
  {
    capability: "Accessibility in every form state, and keyboard-only completion",
    runHound: "axe-core's WCAG 2.2 AA rules in four form states, plus keyboard, focus, announcements and 320 px reflow",
    checks: ["axe-states", "keyboard-completion", "focus-visible", "error-announcement", "reflow-320", "credential-fields"],
    cells: {
      playwright: { mark: "no", text: "No accessibility lens" },
      a11y: { mark: "some", text: "One state at a time; no keyboard task completion" },
      builders: { mark: "no", text: "None in the platforms' own checks" },
      scanners: { mark: "no", text: "Security only" },
    },
  },
  {
    capability: "Security checks",
    runHound: "Headers, cookies, CORS, source maps, secrets and data leaks",
    checks: ["security-headers", "cookie-flags", "cors", "source-maps", "bundle-secrets", "pii-leak"],
    cells: {
      playwright: { mark: "no", text: "No security lens" },
      a11y: { mark: "no", text: "Accessibility rules only" },
      builders: { mark: "yes", text: "Static checks, each for its own platform" },
      scanners: { mark: "yes", text: "Dynamic scanning, secrets in bundles, row-level security and headers, from outside" },
    },
  },
  {
    capability: "Access checks, signed in as test accounts you own",
    runHound: `Who can read or change your data, mass assignment, CSRF and paid plans without a payment (${site.preview})`,
    checks: ["access-control", "write-access", "mass-assignment", "csrf", "paywall-trust"],
    cells: {
      playwright: { mark: "no", text: "No security lens" },
      a11y: { mark: "no", text: "Accessibility rules only" },
      builders: { mark: "unknown" },
      scanners: { mark: "unknown" },
    },
  },
  {
    capability: "A plan you approve before anything runs",
    runHound: "In the web UI, or with `--plan-only` on the command line",
    cells: {
      playwright: { mark: "some", text: "A planner agent, but no approval UI" },
      a11y: { mark: "unknown" },
      builders: { mark: "unknown" },
      scanners: { mark: "unknown" },
    },
  },
  {
    capability: "Findings in plain language, with evidence",
    runHound: "What it means, why it matters and what to ask your AI to fix, with screenshots, GIFs and request cards",
    cells: {
      playwright: { mark: "no", text: "No triage or plain-language explanations" },
      a11y: { mark: "unknown" },
      builders: { mark: "unknown" },
      scanners: { mark: "unknown" },
    },
  },
  {
    capability: "Playwright tests that run on their own",
    runHound: "One per finding, with role- and label-based locators",
    cells: {
      playwright: { mark: "yes", text: "They are Playwright tests" },
      a11y: { mark: "unknown" },
      builders: { mark: "no", text: "No test export" },
      scanners: { mark: "no", text: "No test export" },
    },
  },
  {
    capability: "Runs on your machine, and refuses public sites",
    runHound:
      "Localhost, private addresses and hosts you list (no ownership check, so list only your own); live staging sites behind ownership verification are planned (the V4 stage)",
    cells: {
      playwright: { mark: "some", text: "In your IDE; no sandbox" },
      a11y: { mark: "unknown" },
      builders: { mark: "no", text: "Inside each builder's platform" },
      scanners: { mark: "no", text: "Cloud-hosted" },
    },
  },
];

/** What Run Hound doesn't do yet, so the comparison isn't read as more than it is (docs/roadmap.md, TESTING.md). */
export const notYet: readonly string[] = [
  "Test a deployed or public site: testing live staging sites behind ownership verification is planned for the V4 stage, which the 1.0.0 release completes.",
  "Test a feature across several pages: each run tests one page, and multi-page feature runs are planned for the V2 stage.",
  "Replay a checkout with a changed price or plan, or call the APIs only paid accounts use. The paid-plan check opens success pages only; these two probes are planned.",
  "Sign in with verification codes, captchas, Google or GitHub accounts, or a password page on another site.",
  "Certify accessibility compliance: it reports WCAG failures.",
];

/**
 * A built-in check's link, by its name: its page once registered (content/routes/checks.ts, `check-<id>`), its card on
 * the checks hub before, which the hub has always had (/checks/#<id>, promised by the registry).
 */
export function checkLink(id: string): { href: string; label: string } {
  const check = builtInChecks.find((c) => c.id === id);
  if (!check) throw new Error(`compare: "${id}" is not a built-in check`);
  return { label: check.name, href: resolveTarget({ to: `check-${id}`, fallback: { to: "checks", hash: id } }) };
}

/**
 * The page's structured data: its registry nodes, a WebPage dated like the release its comparison describes (the
 * page shows that date) and its breadcrumb (lib/structured-data.ts routeNodes).
 */
export function compareJsonLd() {
  return routeGraph("compare");
}
