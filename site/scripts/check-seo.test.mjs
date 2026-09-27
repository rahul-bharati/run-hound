// Tests for scripts/check-seo.mjs (`pnpm test`): it runs on small prerendered-page fixtures and must pass the good
// ones and fail each broken one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";

const script = join(import.meta.dirname, "check-seo.mjs");
const origin = "https://run-hound.example";
const root = mkdtempSync(join(tmpdir(), "check-seo-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** A JSON-LD block as components/json-ld.tsx renders it. */
const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

/** A page's graph as lib/structured-data.ts builds it. */
function pageGraph(path, extra = {}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${origin}${path}#webpage`,
        url: `${origin}${path}`,
        name: "Docs · Run Hound",
        isPartOf: { "@id": `${origin}/#website` },
        ...extra,
      },
    ],
  };
}

const homeGraph = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${origin}/#website`, url: `${origin}/`, name: "Run Hound" },
    { "@type": "WebPage", "@id": `${origin}/#webpage`, url: `${origin}/`, isPartOf: { "@id": `${origin}/#website` } },
  ],
};

/** A page's breadcrumb as lib/structured-data.ts builds it, from the home page to `last`. */
const breadcrumb = (path, last = `${origin}${path}`) => ({
  "@type": "BreadcrumbList",
  "@id": `${origin}${path}#breadcrumb`,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
    { "@type": "ListItem", position: 2, name: "Docs", item: last },
  ],
});

const noindex = '<meta name="robots" content="noindex"/>';

/** A prerendered page as Next.js writes it. */
function page({
  path = "/docs/",
  title = "<title>Docs · Run Hound</title>",
  description = '<meta name="description" content="The Docker or Podman quick start, testing your own app, test accounts and every check."/>',
  canonical = `<link rel="canonical" href="${origin}${path}"/>`,
  robots = "",
  h1 = "<h1>Docs</h1>",
  body = jsonLd(pageGraph(path)),
} = {}) {
  // The RSC payload's "<h1" is script text, not an element: it must not count.
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>${robots}${title}${description}${canonical}</head><body><main>${h1}${body}</main><script>self.__next_f.push([1,"<h1>x</h1>"])</script></body></html>`;
}

let fixture = 0;
/** Writes the files ({ "docs.html": html }) into a new folder and runs the check on it. */
function check(files, { strict = false, siteUrl = "" } = {}) {
  const dir = join(root, String((fixture += 1)));
  for (const [name, html] of Object.entries({ "index.html": page({ path: "/", body: jsonLd(homeGraph) }), ...files })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), html);
  }
  const result = spawnSync(process.execPath, [script, ...(strict ? ["--strict"] : []), dir], {
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: siteUrl },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-seo passes", () => {
  test("pages with a title, a description, their canonical and matching JSON-LD", () => {
    const { status, output } = check({ "docs.html": page(), "security.html": page({ path: "/security/" }) });
    assert.equal(status, 0, output);
    assert.match(output, /3 pages .* 3 JSON-LD blocks, 0 errors, 0 warnings/);
  });

  test("the deployed address, when NEXT_PUBLIC_SITE_URL names it", () => {
    assert.equal(check({ "docs.html": page() }, { siteUrl: `${origin}/` }).status, 0);
  });

  test("Next.js's own pages and noindex pages, which need no canonical", () => {
    const bare = "<!DOCTYPE html><html><head><title>500</title></head><body></body></html>";
    const { status, output } = check({
      "_not-found.html": page({ canonical: "", robots: '<meta name="robots" content="noindex"/>', body: "" }),
      "_global-error.html": bare,
      "draft.html": page({ path: "/draft/", canonical: "", robots: '<meta name="robots" content="noindex, nofollow"/>' }),
    });
    assert.equal(status, 0, output);
    assert.match(output, /1 pages/);
  });

  test("an FAQPage on /faq/ and a breadcrumb that ends at the canonical", () => {
    const faq = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "FAQPage", "@id": `${origin}/faq/#webpage`, url: `${origin}/faq/`, mainEntity: [] },
        breadcrumb("/faq/"),
      ],
    };
    const { status, output } = check({ "faq.html": page({ path: "/faq/", body: jsonLd(faq) }) });
    assert.equal(status, 0, output);
    assert.match(output, /0 errors, 0 warnings/);
  });

  test("a noindex page that sitemap.xml doesn't list", () => {
    const { status, output } = check({
      "draft.html": page({ path: "/draft/", canonical: "", robots: noindex }),
      "sitemap.xml.body": `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/docs/</loc></url></urlset>`,
      "docs.html": page(),
    });
    assert.equal(status, 0, output);
  });

  test("a meta description shorter than 70 characters only warns", () => {
    const { status, output } = check({ "docs.html": page({ description: '<meta name="description" content="Docs."/>' }) });
    assert.equal(status, 0, output);
    assert.match(output, /warning: docs\.html: meta description is 5 characters \(at least about 70\)/);
  });

  test("a title longer than 60 characters only warns, and fails with --strict", () => {
    const files = { "docs.html": page({ title: `<title>${"Docs ".repeat(14)}· Run Hound</title>` }) };
    const loose = check(files);
    assert.equal(loose.status, 0, loose.output);
    assert.match(loose.output, /warning: docs\.html: title is 81 characters \(at most 60\)/);
    assert.equal(check(files, { strict: true }).status, 1);
  });

  test("a sitemap.xml that lists every indexable page, and only those", () => {
    const { status, output } = check({
      "docs.html": page(),
      "sitemap.xml.body": `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/docs/</loc></url></urlset>`,
    });
    assert.equal(status, 0, output);
    assert.match(output, /0 errors, 0 warnings/);
  });
});

describe("check-seo fails the build when", () => {
  const cases = {
    "the title is missing": [page({ title: "" }), /docs\.html: no <title>/],
    "the title is empty": [page({ title: "<title> </title>" }), /no <title>/],
    "the meta description is missing": [page({ description: "" }), /no meta description/],
    "the canonical is missing": [page({ canonical: "" }), /0 canonical links, not 1/],
    "the canonical is relative": [page({ canonical: '<link rel="canonical" href="/docs/"/>' }), /not an absolute http\(s\) URL/],
    "the canonical has no trailing slash": [
      page({ canonical: `<link rel="canonical" href="${origin}/docs"/>` }),
      /does not end with "\/"/,
    ],
    "the canonical is another page's": [
      page({ canonical: `<link rel="canonical" href="${origin}/checks/"/>` }),
      /is not this page's route, \/docs\//,
    ],
    "the JSON-LD does not parse": [page({ body: '<script type="application/ld+json">{"@context":</script>' }), /is not valid JSON/],
    "the JSON-LD has no @context": [page({ body: jsonLd({ "@type": "WebPage", url: `${origin}/docs/` }) }), /has no "@context"/],
    "the JSON-LD names another @context": [
      page({ body: jsonLd({ ...pageGraph("/docs/"), "@context": "http://example.com" }) }),
      /"@context" is not https:\/\/schema\.org/,
    ],
    "the page has no JSON-LD": [page({ body: "<p>Docs</p>" }), /docs\.html: no JSON-LD/],
    "the page has two JSON-LD blocks": [
      page({ body: `${jsonLd(pageGraph("/docs/"))}${jsonLd({ "@context": "https://schema.org", "@graph": [breadcrumb("/docs/")] })}` }),
      /docs\.html: 2 JSON-LD blocks; render one graph per page/,
    ],
    "the page has no h1": [page({ h1: "" }), /docs\.html: 0 h1 elements, not 1/],
    "the page has two h1s": [page({ h1: "<h1>Docs</h1><h1 class=\"x\">Again</h1>" }), /docs\.html: 2 h1 elements, not 1/],
    "the page's JSON-LD has no WebPage node": [
      page({ body: jsonLd({ "@context": "https://schema.org", "@graph": [breadcrumb("/docs/")] }) }),
      /docs\.html: 0 WebPage nodes \(WebPage, AboutPage, FAQPage or CollectionPage\), not 1/,
    ],
    "the page's JSON-LD has two WebPage nodes": [
      page({
        body: jsonLd({
          "@context": "https://schema.org",
          "@graph": [...pageGraph("/docs/")["@graph"], { ...pageGraph("/docs/")["@graph"][0], "@type": "AboutPage" }],
        }),
      }),
      /docs\.html: 2 WebPage nodes/,
    ],
    "the page refers to an id no page defines": [
      page({ body: jsonLd(pageGraph("/docs/", { about: { "@id": `${origin}/#software` } })) }),
      /docs\.html: refers to https:\/\/run-hound\.example\/#software, which no page defines/,
    ],
    "the JSON-LD has a raw <": [
      page({ body: `<script type="application/ld+json">${JSON.stringify(pageGraph("/docs/", { name: "a <b> c" }))}</script>` }),
      /contains a raw "<"/,
    ],
    "the WebPage url is not the canonical": [
      page({ body: jsonLd(pageGraph("/checks/")) }),
      /the WebPage url "https:\/\/run-hound\.example\/checks\/" is not the canonical/,
    ],
    "a page type's url is missing": [
      page({ body: jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", "@id": `${origin}/docs/#webpage` }) }),
      /the FAQPage url undefined is not the canonical/,
    ],
    "the breadcrumb's last item is not the canonical": [
      page({
        body: jsonLd({
          "@context": "https://schema.org",
          "@graph": [...pageGraph("/docs/")["@graph"], breadcrumb("/docs/", `${origin}/checks/`)],
        }),
      }),
      /the breadcrumb's last item "https:\/\/run-hound\.example\/checks\/" is not the canonical/,
    ],
    "an FAQPage is outside /faq/": [
      page({
        body: jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", "@id": `${origin}/docs/#webpage`, url: `${origin}/docs/` }),
      }),
      /an FAQPage outside \/faq\//,
    ],
    "a page claims a rating": [
      page({ body: jsonLd(pageGraph("/docs/", { aggregateRating: { "@type": "AggregateRating", ratingValue: 5, ratingCount: 1 } })) }),
      /a rating or review/,
    ],
    "a page carries a review": [
      page({ body: jsonLd(pageGraph("/docs/", { review: { "@type": "Review", reviewBody: "Great" } })) }),
      /a rating or review/,
    ],
    "an @id is relative": [page({ body: jsonLd(pageGraph("/docs/", { "@id": "#webpage" })) }), /@id "#webpage" is not an absolute URL/],
    "an @id is on another origin": [
      page({ body: jsonLd(pageGraph("/docs/", { isPartOf: { "@id": "http://localhost:3000/#website" } })) }),
      /@id "http:\/\/localhost:3000\/#website" is not an absolute URL on https:\/\/run-hound\.example/,
    ],
  };
  for (const [name, [html, message]] of Object.entries(cases)) {
    test(name, () => {
      const { status, output } = check({ "docs.html": html });
      assert.equal(status, 1, output);
      assert.match(output, message);
    });
  }

  test("the WebSite url is not the home page", () => {
    const graph = { ...homeGraph, "@graph": [{ ...homeGraph["@graph"][0], url: `${origin}/docs/` }, homeGraph["@graph"][1]] };
    const { status, output } = check({ "index.html": page({ path: "/", body: jsonLd(graph) }) });
    assert.equal(status, 1, output);
    assert.match(output, /the WebSite url .* is not the home page/);
  });

  test("a noindex page is listed in sitemap.xml", () => {
    const { status, output } = check({
      "docs.html": page({ canonical: "", robots: noindex }),
      "sitemap.xml.body": `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/docs/</loc></url></urlset>`,
    });
    assert.equal(status, 1, output);
    assert.match(output, /docs\.html: is noindex but sitemap\.xml lists \/docs\//);
  });

  test("sitemap.xml leaves out an indexable page", () => {
    const { status, output } = check({
      "docs.html": page(),
      "sitemap.xml.body": `<urlset><url><loc>${origin}/</loc></url></urlset>`,
    });
    assert.equal(status, 1, output);
    assert.match(output, /sitemap\.xml doesn't list \/docs\//);
  });

  test("sitemap.xml lists a page that wasn't prerendered", () => {
    const { status, output } = check({
      "docs.html": page(),
      "sitemap.xml.body": `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/docs/</loc></url><url><loc>${origin}/gone/</loc></url></urlset>`,
    });
    assert.equal(status, 1, output);
    assert.match(output, /sitemap\.xml lists \/gone\/, which is no indexable prerendered page/);
  });

  test("the canonical is not on NEXT_PUBLIC_SITE_URL", () => {
    const { status, output } = check({ "docs.html": page() }, { siteUrl: "https://runhound.dev" });
    assert.equal(status, 1, output);
    assert.match(output, /is not on NEXT_PUBLIC_SITE_URL/);
  });

  test("the folder has no pages to check", () => {
    const dir = join(root, "empty");
    mkdirSync(dir);
    const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no indexable prerendered pages/);
  });
});
