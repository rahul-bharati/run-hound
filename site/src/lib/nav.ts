/**
 * Every navigation and page list, derived from the route registry (content/routes.ts): the header, the footer, the
 * docs sidebar, prev/next, breadcrumbs, sitemap.xml, llms.txt, the search index and the manifest the build scripts
 * read. No data of its own but the three links that aren't pages of this site.
 *
 * Server-only, like the registry: a client component (the header's menu, the search dialog) gets these lists as props
 * from a Server Component (src/boundaries.test.ts). Plain .ts, so node --test and the build scripts load it too.
 */
import {
  docsGroups,
  footer,
  hasRoute,
  route,
  routes,
  type DocsGroup,
  type FooterColumn,
  type LinkTarget,
  type LlmsList,
  type RouteEntry,
  type RouteId,
  type SearchGroup,
} from "@/content/routes";
import { site } from "@/lib/site";

export type NavLink = { href: string; label: string; external?: true };

/** The bug report form on GitHub (.github/ISSUE_TEMPLATE/bug.yml). */
export const bugFormUrl = `${site.github}/issues/new?template=bug.yml`;

const externalHref = { changelog: site.changelog, github: site.github, "bug-form": bugFormUrl } as const;

/** A registered page's link, with an optional #hash: href("checks", "double-submit") is "/checks/#double-submit". */
export function href(id: RouteId, hash?: string): string {
  return `${route(id).path}${hash ? `#${hash}` : ""}`;
}

/** The part of a route that link resolution reads. */
export type RegisteredRoute = { readonly id: string; readonly path: string; readonly anchors: readonly string[] };

/**
 * Where a link goes: its route (and anchor) once registered, and promised when it names an anchor; until then its
 * fallback. A target with neither throws, so a dead link fails the build instead of shipping.
 */
export function resolveTarget(target: LinkTarget, registry: readonly RegisteredRoute[] = routes): string {
  const find = (id: string) => registry.find((r) => r.id === id);
  const to = find(target.to);
  if (to && (!target.hash || to.anchors.includes(target.hash))) return `${to.path}${target.hash ? `#${target.hash}` : ""}`;
  if (target.fallback) {
    const fallback = find(target.fallback.to);
    if (fallback) return `${fallback.path}${target.fallback.hash ? `#${target.fallback.hash}` : ""}`;
  }
  throw new Error(`nav: no route "${target.to}"${target.hash ? ` with #${target.hash}` : ""} and no fallback`);
}

/** The header's five hubs, in order (§3.2). The phone menu shows the same list. */
export function headerLinks(): NavLink[] {
  return routes
    .filter((r): r is RouteEntry & { header: number } => r.header !== undefined)
    .sort((a, b) => a.header - b.header)
    .map((r) => ({ href: r.path, label: r.label }));
}

/**
 * Whether a header hub is the current one for a page: its own page and every page under it ("Docs" on every /docs/*).
 * Takes Next.js's usePathname(), which has no trailing slash.
 */
export function isCurrentHub(pathname: string, hubPath: string): boolean {
  const page = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return hubPath !== "/" && page.startsWith(hubPath);
}

/** The footer doormat: four columns, 22 links, in the same order on every page (§3.3). */
export function footerColumns(): { id: FooterColumn; label: string; links: NavLink[] }[] {
  return footer.map((column) => ({
    id: column.id,
    label: column.label,
    links: column.links.map((link): NavLink =>
      "external" in link
        ? { href: externalHref[link.external], label: link.label, external: true }
        : { href: resolveTarget(link), label: link.label },
    ),
  }));
}

type DocsRoute = RouteEntry & { docs: { group: DocsGroup; order: number } };
const docsPages = () => routes.filter((r): r is DocsRoute => r.docs !== undefined);

/** The docs sidebar: its groups in order, each with its pages in order; empty groups left out. */
export function docsSidebar(): { id: DocsGroup; label: string; links: NavLink[] }[] {
  return docsGroups
    .map((group) => ({
      id: group.id,
      label: group.label,
      links: docsPages()
        .filter((r) => r.docs.group === group.id)
        .sort((a, b) => a.docs.order - b.docs.order)
        .map((r) => ({ href: r.path, label: r.label })),
    }))
    .filter((group) => group.links.length > 0);
}

/** The docs pages before and after this one, in sidebar order. */
export function prevNext(id: RouteId): { prev?: NavLink; next?: NavLink } {
  const order = docsSidebar().flatMap((group) => group.links);
  const at = order.findIndex((link) => link.href === route(id).path);
  if (at < 0) return {};
  return { ...(at > 0 ? { prev: order[at - 1] } : {}), ...(at < order.length - 1 ? { next: order[at + 1] } : {}) };
}

/** The breadcrumb trail from Home to the page, along `parent`: the visible trail and the BreadcrumbList share it. */
export function breadcrumbTrail(id: RouteId): { name: string; path: string }[] {
  const trail: { name: string; path: string }[] = [];
  const seen = new Set<string>();
  let current: RouteEntry | undefined = route(id);
  while (current) {
    if (seen.has(current.id)) throw new Error(`nav: the breadcrumb trail of "${id}" loops at "${current.id}"`);
    seen.add(current.id);
    trail.unshift({ name: current.label, path: current.path });
    current = current.parent ? route(current.parent as RouteId) : current.id === "home" ? undefined : route("home");
  }
  return trail;
}

/** The date a page last changed, as sitemap.xml and dateModified give it. */
export const lastModified = (r: Pick<RouteEntry, "lastmod">): string =>
  r.lastmod === "release" ? site.releasedIso : r.lastmod === "legal" ? site.legalUpdatedIso : r.lastmod;

/** sitemap.xml: every indexable page, with its date and priority (app/sitemap.ts makes the URLs absolute). */
export function sitemapEntries(): { path: string; lastModified: string; priority: number }[] {
  return routes
    .filter((r) => r.indexable)
    .map((r) => ({ path: r.path, lastModified: lastModified(r), priority: r.priority ?? 0.3 }));
}

/** The site's pages in one llms.txt section, in their order (app/llms.txt/llms.ts adds the links to GitHub). */
export function llmsLinks(list: LlmsList): { name: string; path: string; note: string }[] {
  return routes
    .filter((r): r is RouteEntry & { llms: NonNullable<RouteEntry["llms"]> } => r.indexable && r.llms?.list === list)
    .sort((a, b) => a.llms.order - b.llms.order)
    .map((r) => ({
      name: r.llms.name === "title" ? r.title : r.label,
      path: r.path,
      note: [r.llms.note ?? r.description, r.llms.noteAfter].filter(Boolean).join(" "),
    }));
}

/** The pages the search index holds (scripts/pagefind.mjs), with the group each result shows. */
export function searchableRoutes(): { path: string; group: SearchGroup }[] {
  return routes
    .filter((r): r is RouteEntry & { search: SearchGroup } => r.indexable && r.search !== false)
    .map((r) => ({ path: r.path, group: r.search }));
}

/** The title a browser shows for a route: the layout's template adds " · Run Hound" unless it's absolute. */
export const fullTitle = (r: Pick<RouteEntry, "title" | "absoluteTitle">): string =>
  r.absoluteTitle ? r.title : `${r.title} · ${site.name}`;

/**
 * The registry as plain data for the build scripts (check-registry, pagefind): what each page must be and show.
 * scripts/lib/registry.mjs loads it.
 */
export function registryManifest() {
  return {
    routes: routes.map((r) => ({
      id: r.id,
      path: r.path,
      title: fullTitle(r),
      description: r.description,
      indexable: r.indexable,
      search: r.search,
      anchors: [...r.anchors],
      source: r.source,
      trail: breadcrumbTrail(r.id as RouteId),
      webPage: { type: r.schema.type, name: fullTitle(r), dated: r.schema.dated ?? false },
    })),
  };
}

export { hasRoute };
