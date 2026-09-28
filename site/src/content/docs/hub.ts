import { builtInChecks } from "@/content/checks/data";
import type { DocsGroup, RouteId } from "@/content/routes";

/**
 * The docs hub at /docs/ (DESIGN.md §3.4): what Run Hound needs and the fastest way to a first run in about 60 words,
 * then four groups of cards. Every section id of the one-page docs that came before is a card's id here (the route
 * promises them all, content/routes/docs.ts), so an old link like /docs/#accounts lands on the card that points at the
 * page that now holds it, and the card rings once. #overview is the intro. A docs page registered later with no card
 * here (D2's CLI and glossary) gets one of its own, from its label and its sentence in pageCards
 * (components/docs-shell/hub.tsx).
 *
 * Card titles have at most 5 words and one sentence of at most 22 (docs/brand.md). The release comes from lib/site.ts
 * and the number of checks from the checks data, never typed here.
 */
export type HubCard = {
  /** The old /docs/#id this card keeps. */
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly to: RouteId;
  readonly hash?: string;
  readonly fallback?: { readonly to: RouteId; readonly hash?: string };
};

export type DocsHub = {
  readonly h1: string;
  /** The #overview block: what Run Hound needs, the fastest way to a first run, and where the reference is. */
  readonly intro: string;
  readonly groups: readonly { readonly id: DocsGroup; readonly cards: readonly HubCard[] }[];
  /**
   * The card sentence of each docs page that keeps no old id (D2's CLI and glossary pages), by the cards' rules: its
   * card goes at the end of its group with the page's label as the title. Never the page's meta description, which is
   * written for search results and runs longer than a card may (§3.4: a title and one sentence).
   */
  readonly pageCards: readonly { readonly to: RouteId; readonly text: string }[];
};

export const docsHub: DocsHub = {
  h1: "Docs",
  intro:
    "Run Hound runs in Docker or Podman on your machine and tests one page of a web app you run locally. You need about 1 GB of disk and an app on localhost. The quick start gets you to a first run in one command. The guides and the reference cover the rest.",
  groups: [
    {
      id: "get-started",
      cards: [
        {
          id: "quick-start",
          title: "Quick start",
          text: "Start Run Hound with one command, open the web UI and test your first page.",
          to: "docs-quick-start",
        },
        {
          id: "requirements",
          title: "Install",
          text: "What your machine needs, then the commands for Docker, Podman and Windows, and how to update.",
          to: "docs-install",
          hash: "requirements",
        },
        {
          id: "install",
          title: "From source",
          text: "Run it with Node.js from a clone, to contribute or to watch the browser in a window.",
          to: "docs-install",
          hash: "from-source",
        },
        {
          id: "kennel",
          title: "The test lab",
          text: "One compose file starts Run Hound with Kennel, Fernway and five sample apps to try it on.",
          to: "docs-test-lab",
        },
        {
          id: "your-app",
          title: "Test your app",
          text: "Point it at a page of your own app, with the host names and dev-server settings for each system.",
          to: "docs-your-app",
        },
      ],
    },
    {
      id: "guides",
      cards: [
        {
          id: "accounts",
          title: "Signed-in runs",
          text: "Give it two test accounts, and pages behind a login get every check, plus the access checks.",
          to: "docs-signed-in-runs",
        },
        {
          id: "ai-built",
          title: "Apps from AI builders",
          text: "What discovery handles in apps built with Lovable, Bolt and v0, and what it doesn't yet.",
          to: "ai-built-apps",
          hash: "discovery",
          fallback: { to: "ai-built-apps" },
        },
        {
          id: "ai",
          title: "Optional AI",
          text: "Bring your own model to review the plan, suggest flows and explain findings; it is off by default.",
          to: "docs-ai",
        },
      ],
    },
    {
      id: "reference",
      cards: [
        {
          id: "report",
          title: "Reading the report",
          text: "What a run writes, what a finding holds, and the Playwright test that shows it.",
          to: "docs-report",
        },
        {
          id: "checks",
          title: `The ${builtInChecks.length} checks`,
          text: "Every built-in check, with how it tests your page and how to fix what it finds.",
          to: "checks",
        },
        {
          id: "safety",
          title: "Safety and test records",
          text: "What Run Hound will and won't touch, and the test records a run leaves in your app.",
          to: "docs-safety",
        },
        {
          id: "limitations",
          title: "Known limitations",
          text: "What it can't test yet: one page at a time, sign-in limits, dev servers and more.",
          to: "docs-limitations",
        },
      ],
    },
    {
      id: "help",
      cards: [
        {
          id: "problems",
          title: "Troubleshooting",
          text: "The messages you may see, what each one means and how to fix it.",
          to: "docs-troubleshooting",
        },
        {
          id: "feedback",
          title: "Sending feedback",
          text: "What to include when you report a wrong finding, a missed bug or a crash.",
          to: "docs-troubleshooting",
          hash: "feedback",
        },
      ],
    },
  ],
  pageCards: [
    { to: "docs-cli", text: "The commands and their flags, the exit codes, and one Docker command for CI." },
    { to: "docs-glossary", text: "Run Hound's own words, from plan and scenario to confirmed and advisory." },
  ],
};
