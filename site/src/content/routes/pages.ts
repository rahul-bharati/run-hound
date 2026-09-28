/**
 * The homepage and the internal routes (content/routes.ts explains the registry). The flat pages are split by the
 * work that changes them (the design's §5.4): this file (the homepage, P1; /_design/, X1), content/routes/product.ts
 * (How it works, Demo, AI-built apps: F2), content/routes/project.ts (Open source, FAQ, Compare: F1) and
 * content/routes/legal.ts (the four legal pages: F3).
 *
 * Titles and descriptions are the pages' own, word for word (content/routes.test.ts compares them with the page
 * modules, and scripts/check-registry.mjs with every built page), so moving a page onto the registry changed nothing a
 * reader or a crawler sees. A page's title, description and promised anchors change here in the same change as the
 * page: an anchor the page gains is promised here (the footer's "How to help" link switches to /open-source/#how-to-help
 * once that entry promises it), and one the page drops fails check-registry until it is unpromised.
 */
import type { RouteEntry } from "@/content/routes";
import { site } from "@/lib/site";

export const pageRoutes = [
  {
    id: "home",
    path: "/",
    // The title says what Run Hound is in the words people search for (the h1 stays the pitch). No version number:
    // snippets outlive releases.
    title: `${site.name}: AI-assisted UI testing for AI-built apps`,
    absoluteTitle: true,
    description:
      "Test apps built with Lovable, Bolt or v0 on your machine: open-source accessibility, feature and security checks in a real browser, with evidence.",
    label: "Home",
    schema: { type: "WebPage" },
    source: "src/app/page.tsx",
    search: "Page",
    indexable: true,
    anchors: [],
    lastmod: "release",
    priority: 1,
  },
  // Internal: noindex, and in no public list, the sitemap, llms.txt or the search index (§3.14). The folder is
  // %5Fdesign because Next.js treats a folder starting with "_" as private.
  {
    id: "design",
    path: "/_design/",
    title: "Design system",
    description:
      "The site's tokens, type scale and components in every state, kept for reviewing the design. Not a page for visitors and not indexed.",
    label: "Design system",
    schema: { type: "WebPage" },
    source: "src/app/%5Fdesign/page.tsx",
    search: false,
    indexable: false,
    anchors: [],
    lastmod: "release",
  },
] as const satisfies readonly RouteEntry[];
