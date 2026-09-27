// Unit tests for lib/structured-data.ts: `pnpm test` (node:test, no dependencies; scripts/test-hooks.mjs resolves
// the "@/" imports).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL below must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const {
  absoluteUrl,
  breadcrumbNode,
  faqNode,
  graph,
  ids,
  itemListNode,
  maintainerNode,
  softwareNode,
  sourceCodeNode,
  techArticleNode,
  webPageId,
  webPageNode,
  websiteNode,
} = await import("@/lib/structured-data");

const base = "https://run-hound.example";
const docs = { path: "/docs/", name: "Docs · Run Hound", description: "The Docker quick start and every check." };
const screenshot = {
  src: { src: "/_next/static/media/plan.0a1b2c.png", width: 3840, height: 2160 },
  alt: "Run Hound's plan for Kennel's Book a sitter page.",
};

/** Every object in a JSON value, depth first. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (value && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const item of Object.values(value)) yield* objectsIn(item);
  }
}

describe("URLs and ids", () => {
  test("are absolute on site.url, without a doubled slash", () => {
    assert.equal(site.url, "https://run-hound.example/");
    assert.equal(absoluteUrl("/docs/"), `${base}/docs/`);
    assert.equal(absoluteUrl("/checks/#axe-states"), `${base}/checks/#axe-states`);
    assert.equal(absoluteUrl("https://github.com/rahul-bharati/run-hound"), "https://github.com/rahul-bharati/run-hound");
    assert.deepEqual(ids, {
      website: `${base}/#website`,
      maintainer: `${base}/#maintainer`,
      software: `${base}/#software`,
      source: `${base}/open-source/#source`,
    });
    assert.equal(webPageId("/"), `${base}/#webpage`);
    assert.equal(webPageId("/faq/"), `${base}/faq/#webpage`);
  });

  test("page paths must look like the canonical links", () => {
    for (const path of ["/docs", "docs/", "/docs/#quick-start", "/docs/?a=1", ""]) {
      assert.throws(() => webPageNode({ ...docs, path }), /must start and end with "\/"/, path);
      assert.throws(() => breadcrumbNode([{ name: "Docs", path }]), /must start and end with "\/"/, path);
    }
  });
});

describe("home page nodes", () => {
  test("the site, published by its maintainer", () => {
    assert.deepEqual(websiteNode(), {
      "@type": "WebSite",
      "@id": `${base}/#website`,
      url: `${base}/`,
      name: "Run Hound",
      description: site.description,
      inLanguage: "en",
      publisher: { "@id": `${base}/#maintainer` },
    });
  });

  test("the maintainer is a person, from site.maintainer", () => {
    assert.deepEqual(maintainerNode(), {
      "@type": "Person",
      "@id": `${base}/#maintainer`,
      name: "Rahul Bharati",
      url: "https://github.com/rahul-bharati",
      sameAs: ["https://github.com/rahul-bharati"],
    });
  });

  test("the app carries this release's facts and no ratings or reviews", () => {
    const app = softwareNode();
    assert.equal(app["@type"], "SoftwareApplication");
    assert.equal(app["@id"], `${base}/#software`);
    assert.equal(app.softwareVersion, site.version);
    assert.equal(app.dateModified, site.releasedIso);
    assert.equal(app.license, site.licenseUrl);
    assert.equal(app.releaseNotes, site.changelog);
    assert.equal(app.installUrl, `${base}/docs/#quick-start`);
    assert.equal(app.image, `${base}/social-preview.png`);
    assert.deepEqual(app.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
    assert.deepEqual(app.sameAs, [site.github]);
    assert.deepEqual(app.author, { "@id": `${base}/#maintainer` });
    assert.equal("screenshot" in app, false);
    const json = JSON.stringify(app);
    for (const key of ["aggregateRating", "review", "downloadUrl", "email"]) assert.equal(json.includes(`"${key}"`), false, key);
    assert.ok((app.featureList as string[]).some((feature) => feature.includes("off by default")));
  });

  test("the app's screenshots are absolute image objects", () => {
    assert.deepEqual(softwareNode({ screenshots: [screenshot] }).screenshot, [
      {
        "@type": "ImageObject",
        url: `${base}/_next/static/media/plan.0a1b2c.png`,
        width: 3840,
        height: 2160,
        caption: screenshot.alt,
      },
    ]);
  });

  test("the home page has the preview image and no breadcrumb", () => {
    const home = webPageNode({ path: "/", name: "Run Hound", description: "Home." });
    assert.equal(home["@id"], `${base}/#webpage`);
    assert.equal(home.url, `${base}/`);
    assert.deepEqual(home.primaryImageOfPage, {
      "@type": "ImageObject",
      url: `${base}/social-preview.png`,
      width: 1200,
      height: 630,
    });
    assert.equal("breadcrumb" in home, false);
  });
});

describe("inner page nodes", () => {
  test("a page refers to the site and the app, and links its breadcrumb", () => {
    assert.deepEqual(webPageNode(docs), {
      "@type": "WebPage",
      "@id": `${base}/docs/#webpage`,
      url: `${base}/docs/`,
      name: docs.name,
      description: docs.description,
      inLanguage: "en",
      isPartOf: { "@id": `${base}/#website` },
      about: { "@id": `${base}/#software` },
      breadcrumb: { "@id": `${base}/docs/#breadcrumb` },
    });
  });

  test("page types and dateModified", () => {
    for (const type of ["AboutPage", "FAQPage", "CollectionPage"] as const) {
      assert.equal(webPageNode({ ...docs, type })["@type"], type);
    }
    assert.equal(webPageNode({ ...docs, path: "/privacy/", dateModified: site.legalUpdatedIso }).dateModified, "2026-09-26");
    assert.equal("dateModified" in webPageNode(docs), false);
  });

  test("the breadcrumb: Home, then the page, with absolute items", () => {
    const crumbs = breadcrumbNode([
      { name: "Home", path: "/" },
      { name: "Docs", path: "/docs/" },
    ]);
    assert.deepEqual(crumbs, {
      "@type": "BreadcrumbList",
      "@id": `${base}/docs/#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
        { "@type": "ListItem", position: 2, name: "Docs", item: `${base}/docs/` },
      ],
    });
    assert.deepEqual(webPageNode(docs).breadcrumb, { "@id": crumbs["@id"] });
    assert.throws(() => breadcrumbNode([]), /at least one page/);
  });

  test("a tech article is the page's main entity", () => {
    const article = techArticleNode({
      path: "/docs/",
      headline: "Run it on your machine.",
      description: docs.description,
      dateModified: site.releasedIso,
      dependencies: "Docker 24+, Docker Desktop or Podman",
    });
    assert.equal(article["@type"], "TechArticle");
    assert.equal(article["@id"], `${base}/docs/#article`);
    assert.equal(article.dateModified, "2026-09-27");
    assert.deepEqual(article.mainEntityOfPage, { "@id": `${base}/docs/#webpage` });
    assert.deepEqual(article.isPartOf, { "@id": `${base}/docs/#webpage` });
    assert.deepEqual(article.author, { "@id": `${base}/#maintainer` });
    assert.equal(article.dependencies, "Docker 24+, Docker Desktop or Podman");
    const howItWorks = techArticleNode({ path: "/how-it-works/", headline: "It asks.", description: "d", dateModified: "2026-09-26" });
    assert.equal("dependencies" in howItWorks, false);
  });

  test("an item list, in order, with absolute URLs", () => {
    const list = itemListNode({
      path: "/checks/",
      name: "Built-in checks",
      items: [
        { name: "axe-core in every form state (axe-states)", url: "/checks/#axe-states" },
        { name: "Double submit (double-submit)", url: "/checks/#double-submit", description: "Features: …" },
      ],
    });
    assert.equal(list["@type"], "ItemList");
    assert.equal(list["@id"], `${base}/checks/#itemlist`);
    assert.equal(list.numberOfItems, 2);
    assert.deepEqual(list.itemListElement, [
      { "@type": "ListItem", position: 1, name: "axe-core in every form state (axe-states)", url: `${base}/checks/#axe-states` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Double submit (double-submit)",
        url: `${base}/checks/#double-submit`,
        description: "Features: …",
      },
    ]);
  });

  test("the source code points at the repository and the app", () => {
    assert.deepEqual(sourceCodeNode(), {
      "@type": "SoftwareSourceCode",
      "@id": `${base}/open-source/#source`,
      name: "Run Hound",
      codeRepository: site.github,
      license: site.licenseUrl,
      runtimePlatform: "Node.js 22.12 or newer",
      author: { "@id": `${base}/#maintainer` },
      targetProduct: { "@id": `${base}/#software` },
    });
  });
});

describe("graph", () => {
  test("wraps the nodes with the schema.org context", () => {
    assert.deepEqual(graph(websiteNode(), maintainerNode()), {
      "@context": "https://schema.org",
      "@graph": [websiteNode(), maintainerNode()],
    });
  });

  test("merges the FAQ into the FAQ page's node, whichever page type it was given", () => {
    const faqs = [
      { q: "Is it free?", a: "Yes. Run Hound is open source under the MIT license." },
      { q: "Can it test my live site?", a: "No. It tests apps on your machine." },
    ];
    for (const type of ["FAQPage", undefined] as const) {
      const page = graph(
        webPageNode({ path: "/faq/", name: "FAQ · Run Hound", description: "Questions.", type }),
        breadcrumbNode([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq/" },
        ]),
        faqNode(faqs),
      );
      assert.equal(page["@graph"].length, 2);
      const [faqPage] = page["@graph"];
      assert.equal(faqPage["@type"], "FAQPage");
      assert.equal(faqPage["@id"], `${base}/faq/#webpage`);
      assert.equal(faqPage.url, `${base}/faq/`);
      assert.deepEqual(faqPage.mainEntity, [
        { "@type": "Question", name: "Is it free?", acceptedAnswer: { "@type": "Answer", text: faqs[0].a } },
        { "@type": "Question", name: "Can it test my live site?", acceptedAnswer: { "@type": "Answer", text: faqs[1].a } },
      ]);
    }
  });

  test("does not change the nodes it is given", () => {
    const page = webPageNode({ path: "/faq/", name: "FAQ", description: "Questions." });
    graph(page, faqNode([{ q: "Q?", a: "A." }]));
    assert.equal(page["@type"], "WebPage");
    assert.equal("mainEntity" in page, false);
  });

  test("refuses two versions of one node", () => {
    assert.throws(
      () => graph(webPageNode(docs), webPageNode({ ...docs, description: "Something else." })),
      /disagree on description/,
    );
    assert.throws(() => graph(webPageNode({ ...docs, type: "AboutPage" }), webPageNode({ ...docs, type: "CollectionPage" })), /disagree on @type/);
    assert.equal(graph(maintainerNode(), maintainerNode())["@graph"].length, 1);
  });

  test("every reference across the site's pages resolves to a node some page defines", () => {
    const home = graph(
      websiteNode(),
      maintainerNode(),
      softwareNode({ screenshots: [screenshot] }),
      webPageNode({ path: "/", name: "Run Hound", description: "Home." }),
    );
    const docsPage = graph(
      webPageNode(docs),
      breadcrumbNode([
        { name: "Home", path: "/" },
        { name: "Docs", path: "/docs/" },
      ]),
      techArticleNode({ path: "/docs/", headline: "Run it on your machine.", description: "d", dateModified: "2026-09-26" }),
    );
    const openSource = graph(
      webPageNode({ path: "/open-source/", name: "Open source", description: "d", type: "AboutPage" }),
      breadcrumbNode([
        { name: "Home", path: "/" },
        { name: "Open source", path: "/open-source/" },
      ]),
      sourceCodeNode(),
    );
    const defined = new Set<unknown>();
    const referenced = new Set<unknown>();
    for (const node of objectsIn([home, docsPage, openSource])) {
      if (!("@id" in node)) continue;
      if (Object.keys(node).length === 1) referenced.add(node["@id"]);
      else defined.add(node["@id"]);
      assert.ok(String(node["@id"]).startsWith(`${base}/`), String(node["@id"]));
    }
    for (const id of referenced) assert.ok(defined.has(id), `nothing defines ${id}`);
  });
});
