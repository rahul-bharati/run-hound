import { previewGroups } from "@/content/checks/data";
import type { LlmsList } from "@/content/routes";
import { llmsLinks } from "@/lib/nav";
import { site } from "@/lib/site";
import { absoluteUrl } from "@/lib/structured-data";

/**
 * What /llms.txt and /llms-full.txt share (llmstxt.org format: an H1, a one-paragraph summary as a blockquote, a few
 * paragraphs of facts, then sections of links with a one-line note each). Every fact comes from site.ts, the checks data
 * and the documents in the repository; URLs follow NEXT_PUBLIC_SITE_URL like the canonical links. The site's own pages
 * in each section come from the route registry (content/routes.ts: each route's `llms` list, order and note), so a new
 * page is listed by registering it; this file adds only the links to GitHub.
 *
 * Nothing here reads files at build or run time: the site builds from site/ alone (the Docker build context), so the
 * repository's documents are linked, not read.
 */

/**
 * Plain text, not HTML: what language models and people read in a browser tab alike. `X-Robots-Tag: noindex` keeps the
 * files out of search results, where the HTML pages should answer instead (llms-full.txt repeats their text); it
 * doesn't stop a crawler or an AI assistant from fetching them.
 */
export function textResponse(text: string): Response {
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}

/**
 * A document in the repository as raw Markdown, on main like the site's other GitHub links (site.testingGuide): the
 * guides under docs/ post-date the v0.5.0 tag, so a link pinned to the tag would not find them. Deploy the site only
 * once those guides are on main, or these links answer 404.
 */
export const repoDoc = (path: string) =>
  `${site.github.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${path}`;

/** The built-in checks in this release, counted from the same data the checks page and the docs render. */
export const builtInTotal = previewGroups.reduce((sum, g) => sum + g.checks.length, 0);

export const summary =
  "Run Hound is free, open-source (MIT) AI-assisted UI testing for AI-built apps. It opens a page of an app running " +
  "on your own machine in a real browser (Playwright, headless Chromium), finds the forms and controls on it, plans " +
  "accessibility, feature and security checks you approve, runs them, and reports each finding with evidence and an " +
  "exported Playwright test. AI is optional, bring-your-own-model and off by default; pass or fail always comes from " +
  "a real check, never a model.";

/** The H1, the summary and the key facts: the top of both files. */
export function intro(): string {
  return [
    `# ${site.name}`,
    "",
    `> ${summary}`,
    "",
    `Release ${site.version} came out on ${site.released} (tag ${site.tag}). Run it with Docker or Podman from the ` +
      `public image ${site.imageName} (linux/amd64 and arm64), with no clone, or from source with Node.js 22.12 or ` +
      `newer. It tests only localhost, private addresses and host names you list yourself; public sites are refused. ` +
      `It handles apps built with Lovable, Bolt, v0 and similar tools: Radix/shadcn, Headless UI, cmdk and MUI ` +
      `widgets, and forms in dialogs and sheets.`,
    "",
    `V0 to V4 are stages of what Run Hound can test, not versions: V0 (one form) and V1 (one page) have shipped, and ` +
      `the ${site.preview} adds signed-in runs with two test accounts you own: access checks, and the write-side checks ` +
      `csrf, write-access and paywall-trust, which change account A's data and put it back. Sign-in works with the email ` +
      `first and the password next, and with sessions kept in sessionStorage. ` +
      `${builtInTotal} checks are built in, in three groups: Accessibility, Features and Security. Every check is in ` +
      `the open core; checks are never paywalled.`,
    "",
    `Made by ${site.maintainer.name} (${site.maintainer.url}). The repository is public: ${site.github}`,
  ].join("\n");
}

type Link = { name: string; url: string; note: string };

/** The site's pages in one section, from the route registry, with absolute URLs. */
const pageLinks = (list: LlmsList): Link[] =>
  llmsLinks(list).map(({ name, path, note }) => ({ name, url: absoluteUrl(path), note }));

/** The link sections of /llms.txt, also the last section of /llms-full.txt. "Optional" can be skipped (llmstxt.org). */
export const linkSections: { title: string; links: Link[] }[] = [
  { title: "Site", links: pageLinks("Site") },
  {
    title: "Guides in the repository (Markdown)",
    links: [
      {
        name: "README.md",
        url: repoDoc("README.md"),
        note: "What Run Hound is, the quick start, what it checks, how it works and the documentation index.",
      },
      {
        name: "TESTING.md",
        url: repoDoc("TESTING.md"),
        note: "How to try it, step by step: install, a 10-minute run on the Kennel demo, your own app, signed-in runs, reading the report and sending feedback.",
      },
      {
        name: "docs/install.md",
        url: repoDoc("docs/install.md"),
        note: "Docker or Podman, the test lab, installing from source, ports, and testing an app on your machine from a container.",
      },
      {
        name: "docs/usage.md",
        url: repoDoc("docs/usage.md"),
        note: "The web UI, the command line (commands, options, exit codes), reports and evidence.",
      },
      {
        name: "docs/signed-in-runs.md",
        url: repoDoc("docs/signed-in-runs.md"),
        note: "Test accounts, the access checks, the write-side checks (csrf, write-access and paywall-trust), secrets, and what sign-in can't do yet.",
      },
      {
        name: "docs/ai-built-apps.md",
        url: repoDoc("docs/ai-built-apps.md"),
        note: "What Run Hound handles on apps from Lovable, Bolt, v0 and similar tools, and its limits.",
      },
      {
        name: "docs/ai.md",
        url: repoDoc("docs/ai.md"),
        note: "Optional AI: the web UI, the command line, .env, what is sent to the model and which models work.",
      },
      {
        name: "docs/security.md",
        url: repoDoc("docs/security.md"),
        note: "Safety (the target gate, destructive scenarios, the UI and API) and security rules.",
      },
    ],
  },
  {
    title: "Project",
    links: [
      ...pageLinks("Project"),
      { name: "GitHub repository", url: site.github, note: "The source code, issues and releases." },
      { name: "CHANGELOG.md", url: repoDoc("CHANGELOG.md"), note: "What changed in each release." },
      {
        name: "docs/roadmap.md",
        url: repoDoc("docs/roadmap.md"),
        note: "The stages V0 to V4, later ideas and the road to 1.0.",
      },
      {
        name: "DECISIONS.md",
        url: repoDoc("DECISIONS.md"),
        note: "The append-only decision log: why Run Hound is the way it is.",
      },
    ],
  },
  {
    title: "Optional",
    links: [
      {
        name: "docs/research.md",
        url: repoDoc("docs/research.md"),
        note: "Market need, competition, the catalog of gaps in AI-built apps and scope mapping, with sources.",
      },
      {
        name: "docs/overview.md",
        url: repoDoc("docs/overview.md"),
        note: "Problem statement, who it's for, what it hunts for, how it works, output, tech stack and delivery.",
      },
      ...pageLinks("Optional"),
    ],
  },
];

/** One section of links, as llmstxt.org lays it out: "- [name](url): note". */
export function linkSection({ title, links }: { title: string; links: Link[] }): string {
  return [`## ${title}`, "", ...links.map((link) => `- [${link.name}](${link.url}): ${link.note}`)].join("\n");
}

/** /llms.txt: the index. */
export function llmsTxt(): string {
  return [
    intro(),
    "",
    `The full text of the site's key pages, in one file: ${absoluteUrl("/llms-full.txt")}`,
    "",
    ...linkSections.flatMap((section) => [linkSection(section), ""]),
  ].join("\n");
}
