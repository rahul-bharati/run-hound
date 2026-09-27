import { pageTitle } from "@/lib/metadata";
import { mainNav } from "@/lib/site";
import { breadcrumbNode, graph, ids, sourceCodeNode, webPageId, webPageNode } from "@/lib/structured-data";

/**
 * The open-source page (app/open-source/page.tsx): its canonical path, title and meta description, shared by its
 * metadata and its structured data. The title says what the page is about in search results; the h1 keeps its voice.
 * Tested in open-source.test.ts.
 */
export const openSourcePage = {
  path: "/open-source/",
  title: "Open-source UI testing, MIT licensed",
  description:
    "Run Hound, AI-assisted UI testing for AI-built apps, is open source under the MIT license, every check included: the roadmap, test apps and contributing.",
} as const;

/**
 * The page's structured data: an AboutPage whose main entity is Run Hound's source code (a SoftwareSourceCode with
 * the repository and the license, which builds the app), and its breadcrumb (Home, then "Open source" as the header
 * names it). The site, the maintainer and the app are referred to by id (lib/structured-data.ts).
 */
export function openSourceJsonLd() {
  const { path, description } = openSourcePage;
  return graph(
    webPageNode({ path, name: pageTitle(openSourcePage), description, type: "AboutPage" }),
    // Merged into the AboutPage by graph(): same @id.
    { "@id": webPageId(path), mainEntity: { "@id": ids.source } },
    breadcrumbNode([
      { name: "Home", path: "/" },
      { name: mainNav.find((item) => `${item.href}/` === path)?.label ?? openSourcePage.title, path },
    ]),
    sourceCodeNode(),
  );
}
