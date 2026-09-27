// Unit tests for components/oss/open-source.ts: the open-source page's title, description and structured data.
// `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { mainNav, site } = await import("@/lib/site");
const { openSourceJsonLd, openSourcePage } = await import("@/components/oss/open-source");

const base = "https://run-hound.example";
const url = `${base}/open-source/`;

/** Every object in a JSON value, depth first. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (value && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const item of Object.values(value)) yield* objectsIn(item);
  }
}

describe("openSourcePage", () => {
  test("is the page the header links to, at its canonical path", () => {
    assert.equal(openSourcePage.path, "/open-source/");
    assert.ok(mainNav.some((item) => `${item.href}/` === openSourcePage.path));
  });

  test("has a descriptive title (weak-titles) that fits a search result, and a description that fits a snippet", () => {
    assert.equal(openSourcePage.title, "Open-source UI testing, MIT licensed");
    assert.ok(`${openSourcePage.title} · ${site.name}`.length <= 60);
    assert.ok(openSourcePage.description.length >= 70 && openSourcePage.description.length <= 155);
    assert.match(openSourcePage.description, /MIT license/);
    assert.match(openSourcePage.description, /AI-assisted UI testing for AI-built apps/);
  });
});

describe("openSourceJsonLd", () => {
  const data = openSourceJsonLd();
  const nodes = data["@graph"];
  const byType = (type: string) => nodes.filter((node) => node["@type"] === type);

  test("an AboutPage, its breadcrumb and the source code, in one graph", () => {
    assert.equal(data["@context"], "https://schema.org");
    assert.deepEqual(
      nodes.map((node) => node["@type"]),
      ["AboutPage", "BreadcrumbList", "SoftwareSourceCode"],
    );
  });

  test("the AboutPage is the canonical URL, names the page as the browser does and is about the source code", () => {
    const [page] = byType("AboutPage");
    assert.equal(page["@id"], `${url}#webpage`);
    assert.equal(page.url, url);
    assert.equal(page.name, `${openSourcePage.title} · ${site.name}`);
    assert.equal(page.description, openSourcePage.description);
    assert.deepEqual(page.isPartOf, { "@id": `${base}/#website` });
    assert.deepEqual(page.about, { "@id": `${base}/#software` });
    assert.deepEqual(page.mainEntity, { "@id": `${url}#source` });
    assert.deepEqual(page.breadcrumb, { "@id": `${url}#breadcrumb` });
    // The page shows no "Last updated" date.
    assert.equal(page.dateModified, undefined);
  });

  test("the breadcrumb is Home, then the page under its label in the header", () => {
    const [breadcrumb] = byType("BreadcrumbList");
    assert.deepEqual(breadcrumb.itemListElement, [
      { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: "Open source", item: url },
    ]);
  });

  test("SoftwareSourceCode: the repository, the license and the app it builds (open-source-sourcecode)", () => {
    const [source] = byType("SoftwareSourceCode");
    assert.equal(source["@id"], `${url}#source`);
    assert.equal(source.codeRepository, site.github);
    assert.equal(source.license, site.licenseUrl);
    assert.deepEqual(source.author, { "@id": `${base}/#maintainer` });
    assert.deepEqual(source.targetProduct, { "@id": `${base}/#software` });
    // No page says which language it is written in, so the structured data doesn't either.
    assert.equal(source.programmingLanguage, undefined);
  });

  test("refers to the site, the maintainer and the app instead of repeating them, and carries no ratings", () => {
    for (const node of objectsIn(data)) {
      assert.ok(
        !["WebSite", "Person", "SoftwareApplication", "FAQPage", "AggregateRating", "Review"].includes(
          node["@type"] as string,
        ),
        `defines a ${node["@type"]}`,
      );
      assert.equal(node.aggregateRating, undefined);
      assert.equal(node.review, undefined);
    }
  });
});
