import { socialImage } from "@/lib/metadata";
import { site } from "@/lib/site";

/**
 * Structured data (schema.org JSON-LD) for every page, built from `site` so it never drifts from the copy, the
 * canonical links and sitemap.xml. A page renders one graph with <JsonLd data={graph(...)} /> (components/json-ld.tsx):
 *
 * - home: graph(websiteNode(), maintainerNode(), softwareNode({ screenshots }), webPageNode({ path: "/", … }))
 * - an inner page: graph(webPageNode({ path, name, description }), breadcrumbNode([{ name: "Home", path: "/" },
 *   { name: "Docs", path }]), …), plus the page's own nodes (techArticleNode, itemListNode, faqNode, sourceCodeNode).
 *
 * The site, its maintainer and the app are defined on the home page under fixed ids (`ids`); other pages refer to them
 * by id instead of repeating them. The one exception is the maintainer, a small node that /docs/ and /how-it-works/
 * repeat in full as their article's author, since search engines don't follow an @id to another page. Each page's own nodes have ids under its URL (`…/docs/#webpage`,
 * `…/docs/#breadcrumb`). Every URL is absolute, built from site.url like the canonical links, with the trailing slash.
 * scripts/check-seo.mjs checks the rendered result after every build.
 */

/** One schema.org node: a plain object, serialised as it is. */
export type JsonLdNode = { [key: string]: unknown };

/** The site's origin, without a trailing slash (site.url may have one). */
const base = site.url.replace(/\/+$/, "");

/** An absolute URL on this site for a path that starts with "/" (URLs from elsewhere pass through unchanged). */
export function absoluteUrl(path: string): string {
  return path.startsWith("/") ? `${base}${path}` : path;
}

/** The URL of a page. `path` is the same path as the page's canonical link: it starts and ends with "/". */
function pageUrl(path: string): string {
  if (!path.startsWith("/") || !path.endsWith("/") || /[?#]/.test(path)) {
    throw new Error(`structured-data: page path "${path}" must start and end with "/", like the canonical links`);
  }
  return absoluteUrl(path);
}

/** Ids of the nodes that every page refers to. */
export const ids = {
  website: `${base}/#website`,
  maintainer: `${base}/#maintainer`,
  software: `${base}/#software`,
  source: `${base}/open-source/#source`,
} as const;

/** The id of a page's WebPage node (webPageNode). */
export const webPageId = (path: string) => `${pageUrl(path)}#webpage`;

const ref = (id: string) => ({ "@id": id });

const previewImage = () => ({
  "@type": "ImageObject",
  url: absoluteUrl(socialImage.url),
  width: socialImage.width,
  height: socialImage.height,
});

/** The site itself. Google reads the site's name from this node on the home page. */
export function websiteNode(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": ids.website,
    url: `${base}/`,
    name: site.name,
    description: site.description,
    inLanguage: "en",
    publisher: ref(ids.maintainer),
  };
}

/** The person who makes Run Hound and runs the site (site.maintainer): an individual, not an organisation. */
export function maintainerNode(): JsonLdNode {
  return {
    "@type": "Person",
    "@id": ids.maintainer,
    name: site.maintainer.name,
    url: site.maintainer.url,
    sameAs: [site.maintainer.url],
  };
}

/** A screenshot as `components/screens.ts` holds it: a static image import and its alt text. */
type Screenshot = { src: { src: string; width: number; height: number }; alt: string };

/**
 * Run Hound, the app. Defined in full on the home page only; every other page refers to it by `ids.software`.
 *
 * Google shows its software-app rich result only with ratings or reviews. Run Hound has none, so Search Console may
 * report this item as missing aggregateRating or review. That is expected and not a penalty: this node is for entity
 * understanding (Bing, AI answer engines). Never add aggregateRating or review unless real ones are shown on the page
 * (docs/brand.md: no invented users or numbers).
 *
 * The facts come from the docs page's requirements table, LICENSE and site.ts. There is no downloadUrl (the app ships
 * as a container image, installUrl covers it) and no email (site.contactEmail is a placeholder).
 */
export function softwareNode({ screenshots = [] }: { screenshots?: readonly Screenshot[] } = {}): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": ids.software,
    name: site.name,
    description: site.description,
    url: `${base}/`,
    image: absoluteUrl(socialImage.url),
    ...(screenshots.length > 0
      ? {
          screenshot: screenshots.map((s) => ({
            "@type": "ImageObject",
            url: absoluteUrl(s.src.src),
            width: s.src.width,
            height: s.src.height,
            caption: s.alt,
          })),
        }
      : {}),
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "UI testing",
    // The image runs on Linux, macOS and Windows (amd64 and arm64); from source, on Linux and macOS.
    operatingSystem: "Linux, macOS, Windows",
    softwareRequirements: "Docker 24+, Docker Desktop or Podman; from source, Node.js 22.12 or newer",
    storageRequirements: "About 715 MB for the Docker image (260 MB to download)",
    softwareVersion: site.version,
    // The day this version was released (its tag).
    dateModified: site.releasedIso,
    releaseNotes: site.changelog,
    installUrl: absoluteUrl("/docs/#quick-start"),
    license: site.licenseUrl,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: ref(ids.maintainer),
    publisher: ref(ids.maintainer),
    copyrightHolder: ref(ids.maintainer),
    copyrightYear: 2026,
    sameAs: [site.github],
    // docs/brand.md: say what discovery covers, AI is off by default and real checks decide.
    featureList: [
      "Finds up to 5 forms on one page of an app on your machine, forms behind up to 3 dialog or sheet buttons and up to 40 controls outside the forms, including Radix and shadcn/ui, Headless UI, cmdk and MUI widgets",
      "Plans golden-path and danger-path scenarios that you approve before anything runs",
      "Accessibility, feature and security checks in a real browser, with Playwright, axe-core and captured traffic",
      `Signed-in runs with two test accounts: access-control, mass-assignment and CSRF checks, plus deep-link checks signed in or not (${site.preview})`,
      "Evidence for every finding: annotated screenshots, GIFs or request and response cards",
      "A generated Playwright test for every finding, and reports in HTML, Markdown and JSON",
      "A local web UI and a CLI for CI (exit code 0, 1 or 2)",
      "Optional AI with your own model, off by default: plan review, suggested flows and explanations; real checks decide pass or fail",
    ],
  };
}

type PageType = "WebPage" | "AboutPage" | "FAQPage" | "CollectionPage";
const pageTypes: readonly string[] = ["WebPage", "AboutPage", "FAQPage", "CollectionPage"] satisfies PageType[];

/**
 * A page: what it is, which site it belongs to and what it is about (the app). Use the same path and description as
 * the page's pageMetadata() and its title as the browser shows it (`name: pageTitle(page)` from lib/metadata.ts).
 * Every page but the home page links its breadcrumb (breadcrumbNode, which the page's graph must include). The home
 * page's primary image is the social preview. `dateModified`: only where the page shows that date (the legal pages,
 * /checks/, /faq/, /compare/ and /ai-built-apps/).
 */
export function webPageNode({
  path,
  name,
  description,
  type = "WebPage",
  dateModified,
}: {
  path: string;
  name: string;
  description: string;
  type?: PageType;
  dateModified?: string;
}): JsonLdNode {
  const url = pageUrl(path);
  return {
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "en",
    isPartOf: ref(ids.website),
    about: ref(ids.software),
    ...(path === "/" ? { primaryImageOfPage: previewImage() } : { breadcrumb: ref(`${url}#breadcrumb`) }),
    ...(dateModified ? { dateModified } : {}),
  };
}

/** Where a page sits: [{ name: "Home", path: "/" }, { name: "Docs", path: "/docs/" }]. Its id is the last page's. */
export function breadcrumbNode(trail: readonly { name: string; path: string }[]): JsonLdNode {
  const last = trail.at(-1);
  if (!last) throw new Error("structured-data: a breadcrumb needs at least one page");
  return {
    "@type": "BreadcrumbList",
    "@id": `${pageUrl(last.path)}#breadcrumb`,
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: pageUrl(crumb.path),
    })),
  };
}

/**
 * A page that documents the app (/docs/, /how-it-works/), as its own node: breadcrumb is a WebPage property, so the
 * article is the page's main entity rather than the page itself. `headline`: the page's visible h1, not its title.
 * `dependencies`: what the reader needs first (the docs).
 */
export function techArticleNode({
  path,
  headline,
  description,
  dateModified,
  dependencies,
}: {
  path: string;
  headline: string;
  description: string;
  dateModified: string;
  dependencies?: string;
}): JsonLdNode {
  const url = pageUrl(path);
  return {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline,
    description,
    inLanguage: "en",
    image: absoluteUrl(socialImage.url),
    dateModified,
    author: ref(ids.maintainer),
    publisher: ref(ids.maintainer),
    about: ref(ids.software),
    isPartOf: ref(`${url}#webpage`),
    mainEntityOfPage: ref(`${url}#webpage`),
    ...(dependencies ? { dependencies } : {}),
  };
}

/**
 * The questions and answers of the FAQ page (/faq/), from the same array the page renders, so the text matches what
 * visitors see. Only for a page that shows these questions and answers. It shares the FAQ page's WebPage id, and
 * graph() merges the two into one FAQPage node: use it with webPageNode({ path: "/faq/", type: "FAQPage", … }).
 */
export function faqNode(items: readonly { q: string; a: string }[], path = "/faq/"): JsonLdNode {
  return {
    "@type": "FAQPage",
    "@id": webPageId(path),
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/**
 * A list shown on a page (the built-in checks on /checks/), in page order, from the same data the page renders.
 * Item URLs may be paths ("/checks/#axe-states"), made absolute here.
 */
export function itemListNode({
  path,
  name,
  items,
}: {
  path: string;
  name: string;
  items: readonly { name: string; url: string; description?: string }[];
}): JsonLdNode {
  return {
    "@type": "ItemList",
    "@id": `${pageUrl(path)}#itemlist`,
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absoluteUrl(item.url),
      ...(item.description ? { description: item.description } : {}),
    })),
  };
}

/** The source code behind the app (/open-source/). codeRepository is a SoftwareSourceCode property, not an app's. */
export function sourceCodeNode(): JsonLdNode {
  return {
    "@type": "SoftwareSourceCode",
    "@id": ids.source,
    name: site.name,
    codeRepository: site.github,
    license: site.licenseUrl,
    runtimePlatform: "Node.js 22.12 or newer",
    author: ref(ids.maintainer),
    targetProduct: ref(ids.software),
  };
}

/**
 * A page's structured data: its nodes in one @graph. Nodes with the same @id are merged into one (faqNode into the FAQ
 * page's WebPage node); a page type (FAQPage, AboutPage, CollectionPage) wins over a plain WebPage, and any other
 * disagreement between them throws, so the build stops instead of shipping two versions of a fact.
 */
export function graph(...nodes: JsonLdNode[]): { "@context": "https://schema.org"; "@graph": JsonLdNode[] } {
  const merged: JsonLdNode[] = [];
  const byId = new Map<string, JsonLdNode>();
  for (const node of nodes) {
    const id = node["@id"];
    const earlier = typeof id === "string" ? byId.get(id) : undefined;
    if (!earlier) {
      const copy = { ...node };
      merged.push(copy);
      if (typeof id === "string") byId.set(id, copy);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      const current = earlier[key];
      if (current === undefined || JSON.stringify(current) === JSON.stringify(value)) {
        earlier[key] = value;
      } else if (key === "@type" && current === "WebPage" && pageTypes.includes(value as string)) {
        earlier[key] = value;
      } else if (key === "@type" && value === "WebPage" && pageTypes.includes(current as string)) {
        // Keep the more specific page type.
      } else {
        throw new Error(`structured-data: two nodes with @id ${id} disagree on ${key}`);
      }
    }
  }
  return { "@context": "https://schema.org", "@graph": merged };
}
