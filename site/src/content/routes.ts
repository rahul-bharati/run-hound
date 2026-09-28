/**
 * The route registry: one entry per page, and the one list every page list derives from. The header, the phone menu,
 * the footer, the docs sidebar, prev/next, the visible breadcrumbs, the BreadcrumbList, the page metadata, sitemap.xml,
 * llms.txt, the search index and the build guards all read it (through lib/nav.ts, lib/metadata.ts and
 * lib/structured-data.ts); none keeps its own copy.
 *
 * One file per owner holds the entries, so the nodes that change the pages can change their entries apart (the
 * design's §5.3 and §5.4): content/routes/pages.ts (the homepage and the internal routes), content/routes/product.ts
 * (How it works, Demo, AI-built apps), content/routes/project.ts (Open source, FAQ, Compare), content/routes/legal.ts
 * (the legal pages), content/routes/docs.ts (the docs hub, then the docs pages, each `docs-<slug>`) and
 * content/routes/checks.ts (the checks hub, then a page per built-in check, each `check-<id>`).
 *
 * Rules that keep it loadable by plain Node (node --test and the build scripts, through scripts/test-hooks.mjs): only
 * .ts imports (no .tsx, images or CSS); value imports only from content modules, the checks data
 * (content/checks/data.ts) and lib/site.ts, none of which may import
 * lib/nav, lib/metadata or lib/structured-data, which import this file (an import cycle: a module read before it has
 * run, a TDZ error at load); anything else as a type only. src/boundaries.test.ts checks both. It is server-only: a
 * client component gets what it needs as props (src/boundaries.test.ts too).
 *
 * `id` never changes; `path` may, with a redirect (docs/decisions: check ids are stable, a renamed page keeps a 308).
 * Link to a page with href(id, hash) from lib/nav.ts, never a typed path: a mistyped id fails `tsc`, and
 * scripts/check-registry.mjs fails the build on a link or #fragment that doesn't resolve.
 */
import { checkRoutes } from "@/content/routes/checks";
import { docsRoutes } from "@/content/routes/docs";
import { legalRoutes } from "@/content/routes/legal";
import { pageRoutes } from "@/content/routes/pages";
import { productRoutes } from "@/content/routes/product";
import { projectRoutes } from "@/content/routes/project";

/** schema.org page types the site uses (lib/structured-data.ts). */
export type PageType = "WebPage" | "AboutPage" | "FAQPage" | "CollectionPage";
export type FooterColumn = "product" | "docs" | "project" | "legal";
export type DocsGroup = "get-started" | "guides" | "reference" | "help";
/** The tag a search result shows (§3.16). */
export type SearchGroup = "Docs" | "Check" | "FAQ" | "Page";
/** The llms.txt section a page is listed in. */
export type LlmsList = "Site" | "Project" | "Optional";
/** A day, as sitemap.xml and dateModified give it: "2026-09-27". */
export type IsoDate = `${number}-${number}-${number}`;

export type RouteEntry = {
  /** Stable key. Never renamed; the URL may be. */
  readonly id: string;
  /** Canonical path: starts and ends with "/" (trailingSlash), lower case, at most two levels. */
  readonly path: string;
  /** <title> before " · Run Hound", or as it is with absoluteTitle. At most 60 characters with the suffix. */
  readonly title: string;
  readonly absoluteTitle?: boolean;
  /** Meta description: 70 to 160 characters (check-seo --strict). */
  readonly description: string;
  /** Short name in navigation and breadcrumbs. */
  readonly label: string;
  /** The page above it in the breadcrumb trail (its id). A page without one sits under Home. */
  readonly parent?: string;
  /** Position in the header (1 to 5). */
  readonly header?: number;
  /** Place in the docs sidebar and in prev/next. */
  readonly docs?: { readonly group: DocsGroup; readonly order: number };
  /** Structured data (lib/structured-data.ts routeNodes): the page node's type, whether it carries dateModified (the
   * page shows that date), and a TechArticle whose headline is the page's h1. */
  readonly schema: {
    readonly type: PageType;
    readonly dated?: boolean;
    readonly article?: { readonly headline: string; readonly dependencies?: string };
  };
  /** The file that renders the page, relative to site/ (check-registry checks it exists). */
  readonly source: string;
  /** The search index: the result's group, or false to leave the page out (legal pages, internal routes). */
  readonly search: SearchGroup | false;
  /** false for internal routes such as /_design/: noindex, and in no public list. */
  readonly indexable: boolean;
  /** Fragment ids on this page that other sites, reports and llms-full.txt link to: check-registry fails when one is
   * missing. */
  readonly anchors: readonly string[];
  /** sitemap.xml lastmod (and dateModified): the release date or the legal pages' "Last updated" date (lib/site.ts),
   * or the page's own date (a docs page's "Updated" date). */
  readonly lastmod: "release" | "legal" | IsoDate;
  /** sitemap.xml priority. */
  readonly priority?: number;
  /**
   * llms.txt: the section and the position in it. The link's name is the route's label, or its title with
   * name: "title"; its one-line note is the route's description unless `note` gives another, then `noteAfter`. So a
   * title or description changed here changes llms.txt with it (lib/nav.ts llmsLinks).
   */
  readonly llms?: {
    readonly list: LlmsList;
    readonly order: number;
    readonly name?: "title";
    readonly note?: string;
    readonly noteAfter?: string;
  };
};

/** Every route: the flat pages, the docs, then the checks. */
export const routes: readonly RouteEntry[] = [
  ...pageRoutes,
  ...productRoutes,
  ...projectRoutes,
  ...legalRoutes,
  ...docsRoutes,
  ...checkRoutes,
];

/** The id of a registered route: a mistyped id fails `tsc`. Docs pages are `docs-<slug>`, check pages `check-<id>`. */
export type RouteId =
  | (typeof pageRoutes)[number]["id"]
  | (typeof productRoutes)[number]["id"]
  | (typeof projectRoutes)[number]["id"]
  | (typeof legalRoutes)[number]["id"]
  | (typeof docsRoutes)[number]["id"]
  | (typeof checkRoutes)[number]["id"];

const byId = new Map<string, RouteEntry>(routes.map((r) => [r.id, r]));

/** The route with this id. */
export function route(id: RouteId): RouteEntry {
  const found = byId.get(id);
  if (!found) throw new Error(`routes: no route "${id}"`);
  return found;
}

/** Whether a route is registered: pages that later work adds (a docs page, a check page) may not be yet. */
export const hasRoute = (id: string): boolean => byId.has(id);

/**
 * A link that may point at a page before it exists: `to` names the route (and `hash` an anchor it promises), and
 * `fallback` is where the link goes until then, such as today's section of /docs/ for a docs page still to come.
 */
export type LinkTarget = {
  readonly to: string;
  readonly hash?: string;
  readonly fallback?: { readonly to: RouteId; readonly hash?: string };
};

export type FooterLink =
  | ({ readonly label: string } & LinkTarget)
  | { readonly label: string; readonly external: "changelog" | "github" | "bug-form" };

/**
 * The footer doormat (§3.3): four columns, 22 links, the same order on every page (WCAG 3.2.6). The Docs column names
 * the docs pages of the redesign and falls back to today's sections of /docs/ until each page is registered; "How to
 * help" falls back to the Contributing section until /open-source/ promises #how-to-help.
 */
export const footer: readonly { readonly id: FooterColumn; readonly label: string; readonly links: readonly FooterLink[] }[] = [
  {
    id: "product",
    label: "Product",
    links: [
      { label: "How it works", to: "how-it-works" },
      { label: "Checks", to: "checks" },
      { label: "Demo", to: "demo" },
      { label: "Testing AI-built apps", to: "ai-built-apps" },
      { label: "How it compares", to: "compare" },
      { label: "FAQ", to: "faq" },
    ],
  },
  {
    id: "docs",
    label: "Docs",
    links: [
      { label: "Quick start", to: "docs-quick-start", fallback: { to: "docs", hash: "quick-start" } },
      { label: "Test your app", to: "docs-your-app", fallback: { to: "docs", hash: "your-app" } },
      { label: "Signed-in runs", to: "docs-signed-in-runs", fallback: { to: "docs", hash: "accounts" } },
      { label: "Optional AI", to: "docs-ai", fallback: { to: "docs", hash: "ai" } },
      // Exit codes and the CLI live in "Reading the report" until /docs/cli/ exists.
      { label: "CLI and CI", to: "docs-cli", fallback: { to: "docs", hash: "report" } },
      { label: "Troubleshooting", to: "docs-troubleshooting", fallback: { to: "docs", hash: "problems" } },
    ],
  },
  {
    id: "project",
    label: "Project",
    links: [
      { label: "Open source", to: "open-source" },
      { label: "Roadmap", to: "open-source", hash: "roadmap" },
      { label: "How to help", to: "open-source", hash: "how-to-help", fallback: { to: "open-source", hash: "contributing" } },
      { label: "Changelog", external: "changelog" },
      { label: "GitHub", external: "github" },
      { label: "Report a bug", external: "bug-form" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    links: [
      { label: "Privacy", to: "privacy" },
      { label: "Terms", to: "terms" },
      { label: "Acceptable use", to: "acceptable-use" },
      { label: "Security", to: "security" },
    ],
  },
];

/** The docs sidebar's groups, in order (§3.5). */
export const docsGroups: readonly { readonly id: DocsGroup; readonly label: string }[] = [
  { id: "get-started", label: "Get started" },
  { id: "guides", label: "Guides" },
  { id: "reference", label: "Reference" },
  { id: "help", label: "Help" },
];
