/**
 * The checks (content/routes.ts explains the registry): the hub at /checks/, then a page per built-in check at
 * /checks/<check id>/, derived from the check page modules (content/checks/pages/<id>.ts), so a check gets its page,
 * its place in the sitemap, the search index and the hub's ItemList by having a module listed in
 * content/checks/pages/index.ts, whose summaries keep each id a literal type: RouteId then holds exactly those
 * `check-<id>` ids, and href("check-<typo>") fails `tsc`. (A plain CheckPageSummary[] would make every
 * `check-${string}` a RouteId.)
 *
 * Check ids are addresses in every report (app/src/core/links.ts), so a check page's path never changes; a renamed
 * check keeps its old page as a 308.
 */
import { aiFlowCheck, builtInChecks, categories } from "@/content/checks/data";
import { checkPageSummaries } from "@/content/checks/pages";
import type { RouteEntry } from "@/content/routes";
import { site } from "@/lib/site";

/** The built-in checks, counted from the checks data (never typed). */
const builtInTotal = builtInChecks.length;

const hub = {
  id: "checks",
  path: "/checks/",
  title: "UI, accessibility and security checks",
  description: `${builtInTotal} built-in accessibility, feature and security checks for AI-built apps, run in a real browser, plus the full catalog of gaps Run Hound hunts for.`,
  label: "Checks",
  header: 2,
  schema: { type: "CollectionPage", dated: true },
  source: "src/app/checks/page.tsx",
  search: "Check",
  indexable: true,
  // Every card keeps its id (seo-ia §5.1): the built-in checks (the JSON-LD ItemList, llms-full.txt and /demo/ link
  // them), the catalog's entries and its two sections, and the optional AI flow, which reports link ai-flow findings to.
  anchors: [
    ...builtInChecks.map((c) => c.id),
    ...categories.flatMap((c) => c.checks.map((x) => x.id)),
    "catalog",
    "not-visible",
    aiFlowCheck.id,
    // The three groups (§3.7), which the homepage's checks band links.
    "group-accessibility",
    "group-features",
    "group-security",
  ],
  lastmod: "release",
  priority: 0.8,
  llms: {
    list: "Site",
    order: 3,
    note: `The ${builtInTotal} built-in checks in release ${site.version}, in three groups, and the full catalog of gaps in AI-built apps, with typical severity and roadmap stage.`,
  },
} as const satisfies RouteEntry;

/** What a check page module gives the registry. */
export type CheckPageSummary = {
  /** The check id, as in reports and the CLI (app/src/core/types.ts CHECK_IDS). */
  readonly id: string;
  /** The page's title and h1: the check's name. */
  readonly name: string;
  /** Meta description, 70 to 160 characters. */
  readonly description: string;
};

/** A check page's route; `Id` is the check id, so the route id is the literal `check-<id>`. */
export type CheckRoute<Id extends string = string> = RouteEntry & { readonly id: `check-${Id}` };

/** A check page's route: under the hub, a TechArticle headed by the check's name, searchable as a check. */
export function checkPageRoute<const Id extends string>(page: CheckPageSummary & { readonly id: Id }): CheckRoute<Id> {
  return {
    id: `check-${page.id}`,
    path: `/checks/${page.id}/`,
    title: page.name,
    description: page.description,
    label: page.name,
    parent: "checks",
    schema: { type: "WebPage", article: { headline: page.name } },
    source: `src/content/checks/pages/${page.id}.ts`,
    search: "Check",
    indexable: true,
    anchors: ["reproduce"],
    lastmod: "release",
    priority: 0.6,
  };
}

/** The check pages' routes, in the modules' order, each typed with its own id. */
export function checkPageRoutes<const Pages extends readonly CheckPageSummary[]>(
  pages: Pages,
): { readonly [K in keyof Pages]: CheckRoute<Pages[K]["id"]> } {
  return pages.map((page) => checkPageRoute(page)) as unknown as { readonly [K in keyof Pages]: CheckRoute<Pages[K]["id"]> };
}

export const checkRoutes = [hub, ...checkPageRoutes(checkPageSummaries)] as const;
