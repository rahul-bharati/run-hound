/**
 * The project pages (content/routes.ts explains the registry): Open source, FAQ and Compare, the pages F1 rewrites
 * (the design's §5.4), so their entries change with them.
 *
 * Titles and descriptions are the pages' own, word for word (content/routes.test.ts compares them with the page
 * modules, and scripts/check-registry.mjs with every built page), so moving a page onto the registry changed nothing a
 * reader or a crawler sees. A page's title, description and promised anchors change here in the same change as the
 * page: an anchor the page gains is promised here (the footer's "How to help" link switches to /open-source/#how-to-help
 * once that entry promises it), and one the page drops fails check-registry until it is unpromised.
 */
import type { RouteEntry } from "@/content/routes";
import { site } from "@/lib/site";

export const projectRoutes = [
  {
    id: "open-source",
    path: "/open-source/",
    title: "Open-source UI testing, MIT licensed",
    description:
      "Run Hound, AI-assisted UI testing for AI-built apps, is open source under the MIT license, every check included: the roadmap, test apps and how to help.",
    label: "Open source",
    header: 5,
    schema: { type: "AboutPage" },
    source: "src/app/open-source/page.tsx",
    search: "Page",
    indexable: true,
    // #contributing is the section (kept for old links), #how-to-help its h2, which the footer and the homepage link.
    anchors: ["roadmap", "license", "stability", "contributing", "how-to-help"],
    lastmod: "release",
    priority: 0.7,
    llms: {
      list: "Project",
      order: 1,
      note: "MIT licensed, every check included: the roadmap, the test apps it is scored against, and how to help today.",
    },
  },
  {
    id: "faq",
    path: "/faq/",
    title: "FAQ: UI testing for AI-built apps",
    description:
      "Short answers about Run Hound: testing Lovable, Bolt and v0 apps, security and accessibility checks, AI, privacy, CI, the price and what it can't test.",
    label: "FAQ",
    schema: { type: "FAQPage", dated: true },
    source: "src/app/faq/page.tsx",
    search: "FAQ",
    indexable: true,
    // llms-full.txt links every answer by its id. Listed here, not read from the FAQ data, so rewording the FAQ keeps
    // them (a merged answer keeps its old id), and check-registry fails when one is gone.
    anchors: [
      "what-is-run-hound",
      "is-it-free",
      "requirements",
      "lovable-bolt-v0",
      "behind-a-login",
      "live-site",
      "ci",
      "is-my-app-secure",
      "vs-playwright",
      "vs-axe-lighthouse",
      "ai-pass-fail",
      "data",
    ],
    lastmod: "release",
    priority: 0.7,
    llms: { list: "Site", order: 5 },
  },
  {
    id: "compare",
    path: "/compare/",
    // The title names Run Hound itself, so it goes without the " · Run Hound" suffix.
    title: "Run Hound vs Playwright, axe-core and security scanners",
    absoluteTitle: true,
    description:
      "Run Hound next to Playwright's test agents, axe-core and Lighthouse, AI-builder scanners and Escape: what each one checks, and how they work together.",
    label: "Compare",
    schema: { type: "WebPage", dated: true },
    source: "src/app/compare/page.tsx",
    search: "Page",
    indexable: true,
    anchors: [],
    lastmod: "release",
    priority: 0.7,
    llms: { list: "Site", order: 6, name: "title", noteAfter: `Capabilities only, as of release ${site.version}, with sources.` },
  },
] as const satisfies readonly RouteEntry[];
