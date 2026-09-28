/**
 * The docs (content/routes.ts explains the registry): the hub at /docs/, then one entry per docs page, each with its
 * place in the sidebar (`docs: { group, order }`, groups in content/routes.ts docsGroups), `parent: "docs"` and its MDX
 * source (site/src/content/docs/<slug>.mdx). Registering a page is what switches every link to it on: the footer, the
 * docs sidebar, prev/next, the sitemap, llms.txt, the search index and the homepage's installUrl follow by themselves.
 *
 * A docs page's id is `docs-<slug>`: /docs/quick-start/ is "docs-quick-start". The footer's Docs column, installUrl
 * (lib/structured-data.ts) and lib/nav.test.ts name the pages by these ids, and a link switches to its page only when
 * an entry has that id (content/routes.test.ts fails an entry named otherwise).
 *
 * The hub keeps every section id of the one-page docs it replaced (seo-ia §5.1) as the id of a card that points at the
 * page that now holds that section (content/docs/hub.ts). A docs page's `anchors` are its pinned heading ids that other
 * pages and sites link to (`## Requirements \{#requirements\}` in its MDX; src/content/docs.test.ts checks each is
 * pinned, and scripts/check-registry.mjs that each is on the built page). Its h1 is `schema.article.headline`, which
 * the TechArticle repeats; the page shows its date ("Updated …", `dated`). The DESIGN.md §3.5 pages and groups:
 * Get started (Quick start, Install, The test lab, Test your app), Guides (Signed-in runs, Optional AI), Reference
 * (Reading the report, CLI and CI, Safety and test records, Known limitations, Glossary) and Help (Troubleshooting).
 * The glossary (D2) defines Run Hound's own words, each an h3 with a pinned id under four h2 groups; its anchors are
 * every term, and src/content/docs-polish.test.ts keeps them to the terms on the page.
 */
import type { DocsGroup, RouteEntry } from "@/content/routes";

/** A docs page's entry: under the hub, in the sidebar, rendered from its MDX, searchable as Docs, dated by the release. */
function docsPage<const Slug extends string>(page: {
  slug: Slug;
  group: DocsGroup;
  order: number;
  title: string;
  description: string;
  label: string;
  h1: string;
  anchors: readonly string[];
  dependencies?: string;
}) {
  return {
    id: `docs-${page.slug}` as const,
    path: `/docs/${page.slug}/`,
    title: page.title,
    description: page.description,
    label: page.label,
    parent: "docs",
    docs: { group: page.group, order: page.order },
    schema: {
      type: "WebPage",
      dated: true,
      article: { headline: page.h1, ...(page.dependencies ? { dependencies: page.dependencies } : {}) },
    },
    source: `src/content/docs/${page.slug}.mdx`,
    search: "Docs",
    indexable: true,
    anchors: page.anchors,
    lastmod: "release",
    priority: 0.7,
    // Listed in llms.txt right after the hub, in sidebar order.
    llms: { list: "Site", order: 1 + page.order / 100 },
  } satisfies RouteEntry;
}

export const docsRoutes = [
  {
    id: "docs",
    path: "/docs/",
    title: "Docs: test your app locally with Docker",
    description:
      "How to run Run Hound on your machine: the Docker or Podman quick start, demo apps, your own app, test accounts, optional AI, the report and every check.",
    label: "Docs",
    header: 1,
    // A hub of cards (§3.4): its WebPage and BreadcrumbList, no TechArticle.
    schema: { type: "WebPage" },
    source: "src/app/docs/page.tsx",
    search: "Docs",
    indexable: true,
    anchors: [
      "overview",
      "quick-start",
      "requirements",
      "install",
      "kennel",
      "your-app",
      "accounts",
      "ai-built",
      "problems",
      "ai",
      "report",
      "checks",
      "safety",
      "limitations",
      "feedback",
    ],
    lastmod: "release",
    priority: 0.8,
    llms: {
      list: "Site",
      order: 1,
      note: "The guide's hub: the quick start, installing, the test lab, testing your own app, signed-in runs, optional AI, reading the report, the command line, safety, known limitations and troubleshooting.",
    },
  },
  docsPage({
    slug: "quick-start",
    group: "get-started",
    order: 1,
    title: "Quick start: run Run Hound on your machine",
    description:
      "Start Run Hound with one Docker or Podman command, open the web UI on localhost:4000 and test a page of an app you run on your machine.",
    label: "Quick start",
    h1: "Quick start",
    anchors: ["what-you-need", "start", "enter-your-page", "approve-and-run", "test-lab", "next-steps"],
    dependencies: "Docker 24+, Docker Desktop or Podman",
  }),
  docsPage({
    slug: "install",
    group: "get-started",
    order: 2,
    title: "Install Run Hound with Docker, Podman or Node",
    description:
      "What Run Hound needs and how to install it: the Docker image, Podman, Windows PowerShell, running from source with Node.js, and how to update.",
    label: "Install",
    h1: "Install",
    anchors: ["requirements", "docker", "podman", "windows", "from-source", "update"],
    dependencies: "Docker 24+, Docker Desktop or Podman; or Node.js 22.12 or newer, pnpm and git to run from source",
  }),
  docsPage({
    slug: "test-lab",
    group: "get-started",
    order: 3,
    title: "The test lab: Kennel, Fernway and sample apps",
    description:
      "One compose file starts Run Hound with Kennel, Fernway and five sample apps, so you can see real findings and clean runs before testing your own app.",
    label: "The test lab",
    h1: "The test lab",
    anchors: ["start", "apps", "kennel", "from-source", "fernway"],
    dependencies: "Docker with Compose, or Podman with podman-compose",
  }),
  docsPage({
    slug: "your-app",
    group: "get-started",
    order: 4,
    title: "Test your own app with Run Hound",
    description:
      "Point Run Hound at a page of your own app: host.docker.internal on macOS, Windows and Linux, the dev-server settings that allow it, and runs from source.",
    label: "Test your app",
    h1: "Test your app",
    anchors: ["before-you-start", "macos-windows", "linux", "podman", "dev-server", "from-source"],
  }),
  docsPage({
    slug: "signed-in-runs",
    group: "guides",
    order: 5,
    title: "Signed-in runs with two test accounts",
    description:
      "Give Run Hound two test accounts and it signs in before it tests: pages behind a login get every check, plus the access, write and CSRF checks.",
    label: "Signed-in runs",
    h1: "Signed-in runs",
    anchors: ["set-up", "command-line", "access-checks", "write-checks", "secrets", "fernway"],
  }),
  docsPage({
    slug: "ai",
    group: "guides",
    order: 6,
    title: "Optional AI with your own model",
    description:
      "Turn on AI with your own model, from Ollama to Amazon Bedrock: it reviews the plan, suggests flows and explains findings, and real checks still decide.",
    label: "Optional AI",
    h1: "Optional AI",
    anchors: ["what-it-does", "web-ui", "command-line", "docker", "what-is-sent"],
  }),
  docsPage({
    slug: "report",
    group: "reference",
    order: 7,
    title: "Reading the report: findings and evidence",
    description:
      "What a run leaves on your machine, what each finding holds, severity, confirmed versus advisory, and the Playwright test that reproduces a finding.",
    label: "Reading the report",
    h1: "Reading the report",
    anchors: ["run-folder", "summary", "findings", "severity", "confirmed-advisory", "playwright-test"],
  }),
  docsPage({
    slug: "cli",
    group: "reference",
    order: 8,
    title: "CLI and CI: commands, flags and exit codes",
    description:
      "Run Hound on the command line: run, serve, accounts and ai, the flags of run, exit codes 0, 1 and 2, and one Docker command for a CI job.",
    label: "CLI and CI",
    h1: "CLI and CI",
    anchors: ["commands", "run-flags", "exit-codes", "ci"],
  }),
  docsPage({
    slug: "safety",
    group: "reference",
    order: 9,
    title: "Safety and test records",
    description:
      "What Run Hound will and won't test or change: local targets only, risky scenarios off until you tick them, secrets hidden, and the records a run leaves.",
    label: "Safety and test records",
    h1: "Safety and test records",
    anchors: ["local-only", "what-it-changes", "secrets", "test-records"],
  }),
  docsPage({
    slug: "limitations",
    group: "reference",
    order: 10,
    title: "Known limitations of Run Hound",
    description:
      "What Run Hound can't test yet: one page at a time, password sign-in only, dev-server headers, some AI-builder forms, and the limits of Docker and AI.",
    label: "Known limitations",
    h1: "Known limitations",
    anchors: ["one-page", "sign-in", "write-checks", "account-a", "dev-servers", "ai-builders", "docker-windows", "ai"],
  }),
  docsPage({
    slug: "glossary",
    group: "reference",
    order: 11,
    title: "Glossary: the words Run Hound uses",
    description:
      "Run Hound's own words, defined: plan, scenario, golden and danger paths, confirmed and advisory, evidence frames, test records, Kennel and Fernway.",
    label: "Glossary",
    h1: "Glossary",
    // Every term, so a link from another page to /docs/glossary/#<term> is checked on the built page.
    anchors: [
      "check",
      "plan",
      "scenario",
      "golden-path",
      "danger-path",
      "test-record",
      "allowed-hosts",
      "confirmed",
      "advisory",
      "evidence-frame",
      "request-card",
      "run-folder",
      "account-a-and-b",
      "write-side-check",
      "kennel",
      "fernway",
      "clean-mode",
    ],
  }),
  docsPage({
    slug: "troubleshooting",
    group: "help",
    order: 12,
    title: "Troubleshooting Run Hound",
    description:
      "The messages Run Hound may show and what to do about each: an app that doesn't answer, no form found, refused hosts, ports, images and sign-in.",
    label: "Troubleshooting",
    h1: "Troubleshooting",
    anchors: ["host-docker-internal", "messages", "feedback"],
  }),
] as const satisfies readonly RouteEntry[];
