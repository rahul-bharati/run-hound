// Unit tests for components/legal/pages.ts: the legal pages' titles, descriptions and structured data. `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { legalNav, site } = await import("@/lib/site");
const { legalJsonLd, legalPages } = await import("@/components/legal/pages");

const base = "https://run-hound.example";
const pages = Object.values(legalPages);

/** Every object in a JSON value, depth first. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (value && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const item of Object.values(value)) yield* objectsIn(item);
  }
}

describe("legalPages", () => {
  test("has one page for each legal link in the footer, at its canonical path", () => {
    assert.deepEqual(
      pages.map((page) => page.path).sort(),
      legalNav.map((item) => `${item.href}/`).sort(),
    );
  });

  test("titles are the pages' h1s, as the weak-titles finding asks", () => {
    assert.deepEqual(
      Object.fromEntries(pages.map((page) => [page.path, page.title])),
      {
        "/privacy/": "Privacy policy",
        "/terms/": "Terms of use",
        "/acceptable-use/": "Acceptable use policy",
        "/security/": "Security and vulnerability disclosure",
      },
    );
  });

  test("titles fit a search result with the site's suffix, and descriptions fit a snippet", () => {
    for (const page of pages) {
      assert.ok(`${page.title} · ${site.name}`.length <= 60, `${page.path} title is too long`);
      assert.ok(page.description.length >= 70 && page.description.length <= 155, `${page.path} description length`);
    }
    assert.equal(new Set(pages.map((page) => page.description)).size, pages.length, "descriptions are unique");
  });
});

describe("legalJsonLd", () => {
  for (const page of pages) {
    test(`${page.path}: a WebPage with the "Last updated" date and a breadcrumb`, () => {
      const data = legalJsonLd(page);
      assert.equal(data["@context"], "https://schema.org");
      const nodes = data["@graph"];
      assert.deepEqual(
        nodes.map((node) => node["@type"]),
        ["WebPage", "BreadcrumbList"],
      );

      const url = `${base}${page.path}`;
      const [webPage, breadcrumb] = nodes;
      assert.equal(webPage["@id"], `${url}#webpage`);
      assert.equal(webPage.url, url);
      assert.equal(webPage.name, `${page.title} · ${site.name}`);
      assert.equal(webPage.description, page.description);
      assert.equal(webPage.dateModified, site.legalUpdatedIso);
      assert.deepEqual(webPage.isPartOf, { "@id": `${base}/#website` });
      assert.deepEqual(webPage.about, { "@id": `${base}/#software` });
      assert.deepEqual(webPage.breadcrumb, { "@id": `${url}#breadcrumb` });

      const label = legalNav.find((item) => `${item.href}/` === page.path)?.label;
      assert.equal(breadcrumb["@id"], `${url}#breadcrumb`);
      assert.deepEqual(breadcrumb.itemListElement, [
        { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
        { "@type": "ListItem", position: 2, name: label, item: url },
      ]);
    });
  }

  test("refers to the site and the app instead of repeating them, and carries no ratings or FAQ", () => {
    for (const page of pages) {
      for (const node of objectsIn(legalJsonLd(page))) {
        assert.ok(
          !["WebSite", "Person", "SoftwareApplication", "FAQPage", "AggregateRating", "Review"].includes(
            node["@type"] as string,
          ),
          `${page.path} defines a ${node["@type"]}`,
        );
        assert.equal(node.aggregateRating, undefined);
        assert.equal(node.review, undefined);
      }
    }
  });
});
