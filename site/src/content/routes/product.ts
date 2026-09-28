/**
 * The product pages (content/routes.ts explains the registry): How it works, Demo and AI-built apps, the pages F2
 * rewrites (the design's §5.4), so their entries change with them.
 *
 * Titles and descriptions are the pages' own, word for word (content/routes.test.ts compares them with the page
 * modules, and scripts/check-registry.mjs with every built page), so moving a page onto the registry changed nothing a
 * reader or a crawler sees. A page's title, description and promised anchors change here in the same change as the
 * page: an anchor the page gains is promised here (the footer's "How to help" link switches to /open-source/#how-to-help
 * once that entry promises it), and one the page drops fails check-registry until it is unpromised.
 */
import type { RouteEntry } from "@/content/routes";

export const productRoutes = [
  {
    id: "how-it-works",
    path: "/how-it-works/",
    title: "How AI-assisted UI testing works",
    description:
      "How Run Hound tests an AI-built app: it explores your page, plans checks you approve, runs them in a real browser and proves each finding with evidence.",
    label: "How it works",
    schema: { type: "WebPage", article: { headline: "How Run Hound works: it asks before it tests" } },
    source: "src/app/how-it-works/page.tsx",
    search: "Page",
    indexable: true,
    anchors: [],
    lastmod: "release",
    priority: 0.8,
    llms: {
      list: "Site",
      order: 2,
      note: "The five steps (explore, plan, approve, run, report), the design principles, the outputs and what a browser can't see.",
    },
  },
  {
    id: "demo",
    path: "/demo/",
    title: "Demo: real findings, with evidence",
    description:
      "Real evidence from Run Hound runs on Kennel, a deliberately broken booking app, and Fernway, a Lovable-style app: double submits, leaked keys and more.",
    label: "Demo",
    header: 3,
    schema: { type: "WebPage" },
    source: "src/app/demo/page.tsx",
    search: "Page",
    indexable: true,
    anchors: ["fernway"],
    lastmod: "release",
    priority: 0.8,
    llms: {
      list: "Site",
      order: 7,
      note: "Real evidence from runs on Kennel, a deliberately broken booking app, and Fernway, a Lovable-style app: a double submit, a silent failure, missing focus, leaked keys, access bugs and more.",
    },
  },
  {
    id: "ai-built-apps",
    path: "/ai-built-apps/",
    title: "Test apps built with Lovable, Bolt and v0",
    description:
      "How to test a Lovable, Bolt or v0 app in a real browser: the widgets and dialog forms Run Hound handles, the host.docker.internal set-up, and its limits.",
    label: "AI-built apps",
    header: 4,
    schema: { type: "WebPage", dated: true },
    source: "src/app/ai-built-apps/page.tsx",
    search: "Page",
    indexable: true,
    // The discovery limits (§3.11), which the docs hub's AI-built card lands on.
    anchors: ["discovery"],
    lastmod: "release",
    priority: 0.8,
    llms: { list: "Site", order: 4, name: "title" },
  },
] as const satisfies readonly RouteEntry[];
