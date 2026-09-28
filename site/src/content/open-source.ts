import { aiDataFlow } from "@/content/claims";
import { route, type LinkTarget } from "@/content/routes";
import { bugFormUrl, href, resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";
import { ids, routeGraph, sourceCodeNode, webPageId } from "@/lib/structured-data";

/**
 * The open-source page (app/open-source/page.tsx, DESIGN.md §3.8): every word it says, in the order it says them. The
 * license, the open core, the roadmap, the test apps it is scored against, what a 0.x release may change, who makes
 * it, how to help today and the privacy promise. Facts come from LICENSE, CHANGELOG.md, docs/roadmap.md,
 * docs/fixtures.md ("Scoring"), docs/business-model.md and DECISIONS.md; keep them in step with those. Tested in
 * open-source.test.ts.
 *
 * Code contributions are not open yet (USER-DECISIONS.md 4), so "How to help today" asks for runs, bug reports and
 * feedback, and names no process for code.
 */

const openSource = route("open-source");

/** The page's canonical path, title and meta description, as the registry has them (content/routes/project.ts). */
export const openSourcePage = {
  path: "/open-source/",
  title: "Open-source UI testing, MIT licensed",
  description:
    "Run Hound, AI-assisted UI testing for AI-built apps, is open source under the MIT license, every check included: the roadmap, test apps and how to help.",
} as const;

export type OssLink = { readonly label: string; readonly href: string };

/** A link on this site, from the registry: its page once registered, its fallback until then (lib/nav.ts). */
const onSite = (label: string, target: LinkTarget): OssLink => ({ label, href: resolveTarget(target) });

/** The feedback form on GitHub (.github/ISSUE_TEMPLATE/feedback.yml). */
export const feedbackFormUrl = `${site.github}/issues/new?template=feedback.yml`;

/** The public decision log. */
const decisionLog = `${site.github}/blob/main/DECISIONS.md`;

export type OssSection = {
  /** The section's id, an anchor other pages link to. */
  readonly id: string;
  /** The h2's id when the h2 is linked on its own (#how-to-help on #contributing); `<id>-heading` otherwise. */
  readonly headingId?: string;
  /** The h2: a statement of at most 8 words (brand.md). */
  readonly title: string;
  /** At most 25 words. */
  readonly intro?: string;
};

/** The sections, in page order: every id the page has had, and #stability and #maintainer (§3.8). */
export const openSourceSections: readonly OssSection[] = [
  {
    id: "license",
    title: "MIT licensed, with no strings",
    intro:
      "Use it, copy it, change it and sell it, as long as you keep the copyright and license notice. It comes with no warranty.",
  },
  {
    id: "open-core",
    title: "Every check is in the core",
    intro:
      "Everything one developer needs to test their own app is free. Paid services may come later, only for things that run on our servers.",
  },
  {
    id: "roadmap",
    title: "Roadmap: five stages, not releases",
    intro: "V0 to V4 are stages of what Run Hound can test, not version numbers. V0 and V1 have shipped, and V2 is in preview.",
  },
  {
    id: "kennel",
    title: "Test apps: Kennel and Fernway",
    intro: "Run Hound is scored against test apps in its repository. Each planted bug has its own switch, and a clean mode fixes them all.",
  },
  {
    id: "stability",
    title: "What may change before 1.0.0",
    intro: "Run Hound is 0.x: any release may change behaviour. The changelog says what each release changed.",
  },
  {
    id: "maintainer",
    title: "Who makes Run Hound",
  },
  {
    id: "contributing",
    headingId: "how-to-help",
    title: "How to help today",
    intro: "Code contributions aren't open yet. Running it, reporting bugs and sending feedback help the most.",
  },
  {
    id: "privacy",
    title: "Privacy promise",
  },
];

/** The page's h1 and lede. */
export const openSourceIntro = {
  title: "Open source, every check included",
  lede: "Finding the holes is the whole point, so no check will ever sit behind a paywall. The code is public: clone it, try it, file issues.",
} as const;

/** The license section's line under the intro. */
export const licenseLine = {
  label: `${site.license} license`,
  text: "The full text is in the",
  link: { label: "LICENSE file", href: site.licenseUrl },
} as const;

/** The open core (docs/business-model.md): what is free for good, and what might one day be a hosted service. */
export const openCore = {
  core: {
    title: "In the open-source core",
    items: [
      "The test engine and all checks: features, accessibility and security",
      "Plan approval, reports and Playwright spec export",
      "Bring your own model (optional, off by default): local or any OpenAI-compatible endpoint or Amazon Bedrock",
      "The command line, the local web UI and the Docker or Podman set-up",
      "The test apps with planted bugs, the sample apps and their scoring",
      "The JSON report format (report.json)",
    ],
  },
  later: {
    title: "Possible later, as hosted services",
    items: [
      "Hosted inference: run without a GPU, Ollama or your own model API key",
      "A hosted runner, testing a deployed app behind domain-ownership verification",
      "A team dashboard: run history, trends and regressions",
      "A CI and GitHub app: pull request comments and scheduled runs",
      "Compliance exports: WCAG and European Accessibility Act reports",
      "Organisation features: SSO, roles, an audit log and priority support",
    ],
  },
  note: "None of the hosted services exist. If one is ever built, an API key passed to the container would unlock it, and without a key the core runs fully.",
  link: { label: "The business model", href: `${site.github}/blob/main/docs/business-model.md` },
} as const;

export type RoadmapStatus = "shipped" | "preview" | "planned";

export type RoadmapStage = {
  /** The stage label ("V0"): a stage of what Run Hound can test, never a release number. */
  readonly stage: string;
  readonly name: string;
  readonly status: RoadmapStatus;
  /** The releases that built the stage, or will, as a label that says so ("Release 0.1.0", "Since 0.4.0"). */
  readonly release?: string;
  readonly summary: string;
  readonly adds?: string;
};

/** Releases stay 0.x while the stages are built (brand.md, "Shipped vs planned"). */
export const roadmapNote =
  "Releases stay 0.x while the stages are built. 1.0.0 is the release that completes V4, and 0.9.9, right before it, is the `npx run-hound` release.";

/** V0 to V4 (docs/roadmap.md): shipped, in preview, planned. */
export const roadmap: readonly RoadmapStage[] = [
  {
    stage: "V0",
    name: "Single form",
    status: "shipped",
    release: "Release 0.1.0",
    summary:
      "Point it at a form on localhost. It plans golden- and danger-path scenarios, you approve them, and it runs them and reports with evidence and Playwright tests.",
    adds: "15 checks. Shipped as 0.1.0.",
  },
  {
    stage: "V1",
    name: "Single page",
    status: "shipped",
    release: "Releases 0.2.0 to 0.4.0",
    summary:
      "Point it at a page. It finds the forms and controls on it, plans checks for each form and for the whole page, and runs them in a real browser.",
    adds: "0.2.0 adds security headers, cookie flags, CORS, public source maps and dead controls, and one Docker or Podman command. 0.3.0 adds optional AI with your own model, off by default and never the judge of pass or fail. 0.4.0 finds and fills the custom widgets and dialog forms of AI-built apps.",
  },
  {
    stage: "V2",
    name: "Single feature",
    status: "preview",
    release: "Since 0.4.0",
    summary: "Give it a feature such as signup or checkout, and it tests that feature end to end across pages.",
    adds: "0.4.0 adds test accounts, signed-in runs, access checks, mass assignment and deep links. 0.5.0 adds the CSRF check. 0.6.0 adds write access and paywall trust, and signs in to apps that ask for the email first or keep their session in sessionStorage. Still planned: a feature across pages, the other two paid-plan probes, rate limits, file uploads and prompt injection.",
  },
  {
    stage: "V3",
    name: "Whole app",
    status: "planned",
    summary: "Point it at the app. It discovers and prioritises features, then tests the paths that matter most first.",
    adds: "Adds a dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.",
  },
  {
    stage: "V4",
    name: "Live staging",
    status: "planned",
    release: "Release 1.0.0",
    summary: "Testing live staging and dev sites behind ownership verification. Completing it is the 1.0.0 release.",
    adds: "Adds checks for live hosts, such as mixed content and email DNS records.",
  },
];

/** The test apps (docs/fixtures.md), defined at first use (brand.md). */
export const testApps = {
  apps: [
    {
      name: "Kennel",
      text: "A small pet-sitting booking app with bugs planted on purpose.",
      link: { label: "Kennel's bug list", href: site.kennelBugs },
    },
    {
      name: "Fernway",
      text: "A project-planning app built the way AI builders such as Lovable build them, with a dashboard behind a sign-in.",
      link: { label: "Fernway's bug list", href: site.fernwayBugs },
    },
  ],
  why: "Because we know which bugs are planted, we can measure what Run Hound finds, misses and makes up. Made-up findings are the biggest product risk, so clean mode matters as much as the planted bugs.",
  samples: "Five sample apps, built well on purpose, complete the set: any confirmed finding on them is a false positive.",
  demo: onSite("See the findings from real runs on Kennel and Fernway", { to: "demo" }),
} as const;

/** What CI scores on every pull request (docs/fixtures.md "Scoring"); stability across repeated runs is planned. */
export const scoring: readonly { readonly name: string; readonly text: string }[] = [
  { name: "Recall", text: "With each planted bug switched on alone, the check that must catch it reports it." },
  { name: "False positives", text: "Findings in clean mode, where every bug is fixed properly. Target: zero." },
  { name: "Evidence", text: "Every finding has a screenshot, a GIF or a request card on disk, and no run leaks a secret." },
  { name: "Stability (planned)", text: "Repeating the same run to check that the findings stay the same, tracked per bug." },
];

/** What a 0.x release may change, what it won't, and what 1.0.0 brings (CHANGELOG.md; DECISIONS.md, check ids). */
export const stability: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: "May change in any release",
    text: "The fields of report.json, command-line flags and defaults, such as which scenarios start ticked. The changelog lists each change.",
  },
  {
    title: "Won't change: check ids",
    text: "Check ids are addresses in every report. A renamed check keeps its old page as a permanent redirect.",
  },
  {
    title: "From 1.0.0",
    text: "Releases follow Semantic Versioning: from 1.0.0, a change that breaks report.json or the command line waits for a major release.",
  },
];

/** The changelog, linked from the stability section. */
export const changelogLink: OssLink = { label: "The changelog", href: site.changelog };

/** Who makes Run Hound, and how it is built (§3.8). GitHub only: a personal site waits for the maintainer (§5.10 Q1). */
export const maintainer = {
  name: site.maintainer.name,
  github: site.maintainer.url,
  why: "Run Hound exists so that people who build apps with AI can check what their AI built before their users do.",
  how: [
    "Contracts and failing tests first, then the code that makes them pass.",
    "CI scores every check against test apps with planted bugs, and against their clean versions, on every pull request.",
    "Every decision goes in a public log, with its reasons.",
  ],
  decisions: decisionLog,
  decisionsLabel: "The decision log",
} as const;

/** How to help today (USER-DECISIONS.md 4): three cards, each one sentence and its links. */
export const howToHelp: readonly { readonly title: string; readonly text: string; readonly links: readonly OssLink[] }[] = [
  {
    title: "Try it",
    text: "Run it on a page of your own app, or on the test lab if you have no app handy.",
    links: [
      onSite("Quick start", { to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } }),
      onSite("The test lab", { to: "docs-test-lab", fallback: { to: "docs", hash: "kennel" } }),
    ],
  },
  {
    title: "Report a bug",
    text: "Tell us what broke, with the version and steps; a finding you think is wrong is a bug too.",
    links: [{ label: "Open the bug form", href: bugFormUrl }],
  },
  {
    title: "Send feedback",
    text: "Tell us about bugs it missed, messages that were confusing, and clean runs on apps you think are well built.",
    links: [{ label: "Open the feedback form", href: feedbackFormUrl }],
  },
];

/** The one line under the cards: security problems go through the disclosure policy (/security/). */
export const securityLine = {
  text: "Found a security problem?",
  link: { label: "Follow the disclosure policy", href: href("security") },
} as const;

/** The privacy promise: what never leaves your machine. */
export const privacyPromise = {
  items: [
    {
      lead: "It runs locally.",
      text: "Run Hound runs on your machine, with Node or in Docker or Podman. Test accounts stay there too, and their passwords never appear in a report.",
    },
    {
      lead: "AI is optional and off by default.",
      text: `Turn it on and ${aiDataFlow}, local or cloud. Run Hound operates no AI service of its own.`,
    },
    {
      lead: "No telemetry about the app you test.",
      text: "Nothing about your app, its pages or its findings is sent to us.",
    },
    {
      lead: "Paid features would not change this.",
      text: "If a license key ever exists, its check would send only the key and the version.",
    },
  ],
  link: onSite("The privacy policy", { to: "privacy" }),
} as const;

/**
 * The page's structured data: its registry nodes (an AboutPage and its breadcrumb, lib/structured-data.ts routeNodes)
 * with the source code as the page's main entity: a SoftwareSourceCode with the repository and the license, which
 * builds the app. The site, the maintainer and the app are referred to by id.
 */
export function openSourceJsonLd() {
  return routeGraph(
    "open-source",
    // Merged into the AboutPage by graph(): same @id.
    { "@id": webPageId(openSource.path), mainEntity: { "@id": ids.source } },
    sourceCodeNode(),
  );
}
