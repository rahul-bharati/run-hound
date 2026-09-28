import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckPageView } from "@/components/checks/check-page";
import { JsonLd } from "@/components/json-ld";
import { checkPage, checkPages } from "@/content/checks/pages";
import type { RouteId } from "@/content/routes";
import { routeMetadata } from "@/lib/metadata";
import { routeGraph } from "@/lib/structured-data";

/**
 * A built-in check's page, /checks/<id>/ (DESIGN.md §3.6), one per module in content/checks/pages; any other id is a
 * 404 (dynamicParams = false). Every page is prerendered at build time.
 */
export const dynamicParams = false;

export function generateStaticParams(): { id: string }[] {
  return checkPages.map((page) => ({ id: page.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return routeMetadata(`check-${id}` as RouteId);
}

export default async function CheckRoute({ params }: Props) {
  const { id } = await params;
  const page = checkPage(id);
  if (!page) notFound();
  return (
    <>
      <CheckPageView page={page} />
      {/* WebPage, BreadcrumbList and the TechArticle, from the registry (content/routes/checks.ts). */}
      <JsonLd data={routeGraph(`check-${id}` as RouteId)} />
    </>
  );
}
