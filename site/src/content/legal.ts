import type { RouteId } from "@/content/routes";
import { pageTitle } from "@/lib/metadata";
import { breadcrumbTrail } from "@/lib/nav";
import { site } from "@/lib/site";
import { breadcrumbNode, graph, webPageNode } from "@/lib/structured-data";

/**
 * One legal page: its registry id (the visible breadcrumb reads the registry's trail), its canonical path (with the
 * trailing slash), its title and its meta description. The title is also the page's h1 (<LegalDoc page={…}>), so the
 * two never drift apart; the page passes the same object to pageMetadata().
 */
export type LegalPage = { readonly id: RouteId; readonly path: string; readonly title: string; readonly description: string };

/** The legal pages, one for each link in the footer's legal column (legalNav). Tested in content/legal.test.ts. */
export const legalPages = {
  privacy: {
    id: "privacy",
    path: "/privacy/",
    title: "Privacy policy",
    description:
      "How the Run Hound website and software handle personal data: server logs, Cloudflare, Google Analytics only with consent, feedback and local software.",
  },
  terms: {
    id: "terms",
    path: "/terms/",
    title: "Terms of use",
    description: "Terms of use for the Run Hound website, and how the MIT license governs the Run Hound software.",
  },
  acceptableUse: {
    id: "acceptable-use",
    path: "/acceptable-use/",
    title: "Acceptable use policy",
    description:
      "Run Hound is for testing apps you own or are authorized to test. How it enforces that, and which uses are prohibited.",
  },
  security: {
    id: "security",
    path: "/security/",
    title: "Security and vulnerability disclosure",
    description:
      "How to report a vulnerability in Run Hound or this website, what to include, what is in scope and how we respond.",
  },
} as const satisfies Record<string, LegalPage>;

/**
 * A legal page's structured data: a WebPage whose dateModified is the "Last updated" date the page shows, and its
 * breadcrumb, the registry's trail that the visible breadcrumb shows (<Breadcrumbs id={page.id}>), so the two are the
 * same by construction. The site and the app are referred to by id (lib/structured-data.ts).
 */
export function legalJsonLd(page: LegalPage) {
  return graph(
    webPageNode({
      path: page.path,
      name: pageTitle(page),
      description: page.description,
      dateModified: site.legalUpdatedIso,
    }),
    breadcrumbNode(breadcrumbTrail(page.id)),
  );
}
