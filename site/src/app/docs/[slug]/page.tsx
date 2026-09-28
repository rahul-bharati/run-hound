import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MDXContent } from "mdx/types";
import { DocsShell, InlineToc } from "@/components/docs-shell/docs-shell";
import { JsonLd } from "@/components/json-ld";
import { hasRoute, route, routes, type RouteEntry, type RouteId } from "@/content/routes";
import { docHeadings, docMinutes, docSource } from "@/lib/docs-text";
import { routeMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";
import { routeGraph } from "@/lib/structured-data";

/**
 * A docs page (DESIGN.md §3.5): /docs/<slug>/ for each docs page in the registry (content/routes/docs.ts), rendered from
 * src/content/docs/<slug>.mdx inside the docs shell. Its title, description, h1, place in the sidebar and date come
 * from the registry; its "On this page" from the MDX's h2s and their pinned ids (lib/docs-text.ts). Every page is
 * prerendered; any other slug is a 404.
 */
export const dynamicParams = false;

type DocsRoute = RouteEntry & { docs: NonNullable<RouteEntry["docs"]> };
const docsPages = () => routes.filter((r): r is DocsRoute => r.docs !== undefined);
const slugOf = (r: RouteEntry) => r.path.split("/")[2];

export function generateStaticParams() {
  return docsPages().map((r) => ({ slug: slugOf(r) }));
}

/** The registered docs page for a slug, or a 404. */
function pageFor(slug: string): DocsRoute & { id: RouteId } {
  const id = `docs-${slug}`;
  if (!hasRoute(id)) notFound();
  return route(id as RouteId) as DocsRoute & { id: RouteId };
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return routeMetadata(pageFor(slug).id);
}

/** "Updated 27 September 2026": the page's date as the footer and the legal pages write theirs. */
function updated(r: RouteEntry): string {
  if (r.lastmod === "release") return site.released;
  if (r.lastmod === "legal") return site.legalUpdated;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(r.lastmod));
}

export default async function DocsPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const r = pageFor(slug);
  const mdx = docSource(slug);
  const toc = docHeadings(mdx).flatMap((h) => (h.depth === 2 && h.id ? [{ id: h.id, text: h.text }] : []));
  // "About N minutes" only on the task pages (§3.5): the Get started group.
  const minutes = r.docs.group === "get-started" ? docMinutes(slug, mdx) : undefined;
  const meta = [`For release ${site.version}`, `Updated ${updated(r)}`, ...(minutes ? [`About ${minutes} minute${minutes === 1 ? "" : "s"}`] : [])].join(" · ");
  const { default: Content } = (await import(`@/content/docs/${slug}.mdx`)) as { default: MDXContent };
  // "On this page" as an inline box right after the opening paragraph (the slot remark-docs.mjs places there).
  const components = { InlineTocSlot: () => <InlineToc toc={toc} /> };
  return (
    <>
      <JsonLd data={routeGraph(r.id)} />
      <DocsShell id={r.id} path={r.path} h1={r.schema.article?.headline ?? r.label} meta={meta} toc={toc}>
        <Content components={components} />
      </DocsShell>
    </>
  );
}
