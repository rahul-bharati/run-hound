/**
 * The check pages that exist: one module per built-in check (./types.ts), listed in its group's file
 * (./accessibility.ts, ./features.ts, ./security.ts, one per node so no two share a file) and joined here in the hub's
 * order. A check gets its page (/checks/<id>/), its place in the registry, the sitemap, the search index and the hub's
 * ItemList, and its hub card's link, by being listed: content/routes/checks.ts reads checkPageSummaries,
 * app/checks/[id]/page.tsx's generateStaticParams reads checkPages. A check without a module keeps its card on the
 * hub, without a link, so every state in between builds.
 *
 * To add a page: write content/checks/pages/<id>.ts (`export const page = { … } as const satisfies CheckPage;`), then
 * list it in its group's file. Each group's `pages` is `as const` and spreading readonly tuples keeps them tuples, so
 * each id stays a literal type: RouteId holds exactly `check-<id>` for the pages listed, and href("check-<typo>")
 * fails `tsc`.
 *
 * Plain .ts with value imports only from content modules, like the registry that loads it (content/routes.ts).
 */
import { builtInChecks } from "@/content/checks/data";
import type { CheckPageSummary } from "@/content/routes/checks";
import { pages as accessibility } from "./accessibility";
import { pages as features } from "./features";
import { pages as security } from "./security";
import type { CheckPage } from "./types";

/** Every check page, in the hub's order (content/checks/data.ts previewGroups): Accessibility, Features, Security. */
export const checkPages = [...accessibility, ...features, ...security] as const satisfies readonly CheckPage[];

/** The id of a check that has a page. */
export type CheckPageId = (typeof checkPages)[number]["id"];

const byId = new Map<string, CheckPage>(checkPages.map((p) => [p.id, p]));

/** The page of a check, or undefined while it has none. */
export function checkPage(id: string): CheckPage | undefined {
  return byId.get(id);
}

/** Whether a check has a page yet. */
export const hasCheckPage = (id: string): boolean => byId.has(id);

/** The check's name (content/checks/data.ts): the page's title, h1 and breadcrumb. */
function nameOf(id: string): string {
  const check = builtInChecks.find((c) => c.id === id);
  if (!check) throw new Error(`check pages: "${id}" is not a built-in check (content/checks/data.ts)`);
  return check.name;
}

type Summary<P> = CheckPageSummary & { readonly id: P extends { readonly id: infer Id } ? Id : never };
/** A summary per page, the tuple kept (a mapped type over a type parameter maps a tuple to a tuple). */
type SummariesOf<Pages extends readonly unknown[]> = { readonly [K in keyof Pages]: Summary<Pages[K]> };

/** What the registry needs of each page (content/routes/checks.ts), each with its literal id. */
export const checkPageSummaries = checkPages.map((p) => ({
  id: p.id,
  name: nameOf(p.id),
  description: p.description,
})) as unknown as SummariesOf<typeof checkPages>;
