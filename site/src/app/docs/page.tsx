import { DocsHub } from "@/components/docs-shell/hub";
import { JsonLd } from "@/components/json-ld";
import { routeMetadata } from "@/lib/metadata";
import { routeGraph } from "@/lib/structured-data";

/**
 * The docs hub at /docs/ (DESIGN.md §3.4): about 150 words and four groups of cards (components/docs-shell/hub.tsx,
 * content/docs/hub.ts), replacing the one-page docs. Every old /docs/#id is a card's id. Its title, description and
 * JSON-LD (WebPage and BreadcrumbList) come from the registry (content/routes/docs.ts).
 */
export const metadata = routeMetadata("docs");

export default function DocsHubPage() {
  return (
    <>
      <JsonLd data={routeGraph("docs")} />
      <DocsHub />
    </>
  );
}
