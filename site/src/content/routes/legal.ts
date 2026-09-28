/**
 * The legal pages (content/routes.ts explains the registry): Privacy, Terms, Acceptable use and Security, the pages F3
 * rewrites (the design's §5.4). They are dated by their own "Last updated" date (lastmod "legal") and left out of the
 * search index.
 *
 * Titles and descriptions are the pages' own, word for word (content/routes.test.ts compares them with the page
 * modules, and scripts/check-registry.mjs with every built page), so moving a page onto the registry changed nothing a
 * reader or a crawler sees. A page's title, description and promised anchors change here in the same change as the
 * page: an anchor the page gains is promised here (the footer's "How to help" link switches to /open-source/#how-to-help
 * once that entry promises it), and one the page drops fails check-registry until it is unpromised.
 */
import type { RouteEntry } from "@/content/routes";

export const legalRoutes = [
  {
    id: "privacy",
    path: "/privacy/",
    title: "Privacy policy",
    description:
      "How the Run Hound website and software handle personal data: server logs, Cloudflare, Google Analytics only with consent, feedback and local software.",
    label: "Privacy",
    schema: { type: "WebPage", dated: true },
    source: "src/app/(legal)/privacy/page.tsx",
    search: false,
    indexable: true,
    anchors: ["cookies"],
    lastmod: "legal",
    llms: { list: "Optional", order: 3, note: "How the website and the software handle personal data." },
  },
  {
    id: "terms",
    path: "/terms/",
    title: "Terms of use",
    description: "Terms of use for the Run Hound website, and how the MIT license governs the Run Hound software.",
    label: "Terms",
    schema: { type: "WebPage", dated: true },
    source: "src/app/(legal)/terms/page.tsx",
    search: false,
    indexable: true,
    anchors: [],
    lastmod: "legal",
    llms: { list: "Optional", order: 4, name: "title" },
  },
  {
    id: "acceptable-use",
    path: "/acceptable-use/",
    title: "Acceptable use policy",
    description:
      "Run Hound is for testing apps you own or are authorized to test. How it enforces that, and which uses are prohibited.",
    label: "Acceptable use",
    schema: { type: "WebPage", dated: true },
    source: "src/app/(legal)/acceptable-use/page.tsx",
    search: false,
    indexable: true,
    anchors: [],
    lastmod: "legal",
    llms: { list: "Optional", order: 2, note: "Run Hound is for testing apps you own or are authorized to test." },
  },
  {
    id: "security",
    path: "/security/",
    title: "Security and vulnerability disclosure",
    description:
      "How to report a vulnerability in Run Hound or this website, what to include, what is in scope and how we respond.",
    label: "Security",
    schema: { type: "WebPage", dated: true },
    source: "src/app/(legal)/security/page.tsx",
    search: false,
    indexable: true,
    anchors: [],
    lastmod: "legal",
    priority: 0.4,
    llms: {
      list: "Optional",
      order: 1,
      note: "How to report a vulnerability in Run Hound or this website, and what is in scope.",
    },
  },
] as const satisfies readonly RouteEntry[];
