// Tests for scripts/check-registry.mjs (`pnpm test`): it runs on small prerendered-site fixtures and a registry
// manifest (the plain data lib/nav.ts registryManifest() gives it), and must pass the good ones and fail each broken one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";

const script = join(import.meta.dirname, "check-registry.mjs");
const origin = "https://run-hound.example";
const root = mkdtempSync(join(tmpdir(), "check-registry-"));
after(() => rmSync(root, { recursive: true, force: true }));

const home = { name: "Home", path: "/" };

/** A registry route as registryManifest() lists it. */
function routeOf(id, path, { label, anchors = [], indexable = true, parent = true, type = "WebPage", dated = false, source } = {}) {
  const title = id === "home" ? "Run Hound: tests" : `${label ?? id} · Run Hound`;
  return {
    id,
    path,
    title,
    description: `The ${id} page of the fixture site, described in enough words to pass.`,
    indexable,
    search: indexable ? "Page" : false,
    anchors,
    source: source ?? `src/app/${id}/page.tsx`,
    trail: path === "/" ? [home] : parent ? [home, { name: label ?? id, path }] : [{ name: label ?? id, path }],
    webPage: { type, name: title, dated },
  };
}

const jsonLd = (nodes) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }).replace(/</g, "\\u003c")}</script>`;

/** A prerendered page for a route, as Next.js writes it: head, a header and footer with links, main, JSON-LD. */
function pageFor(route, { main = "", links = [], robots = "", graph, extraHead = "", title, description } = {}) {
  const url = `${origin}${route.path}`;
  const nodes = graph ?? [
    {
      "@type": route.webPage.type,
      "@id": `${url}#webpage`,
      url,
      name: route.webPage.name,
      ...(route.webPage.dated ? { dateModified: "2026-09-27" } : {}),
    },
    ...(route.path === "/"
      ? []
      : [
          {
            "@type": "BreadcrumbList",
            "@id": `${url}#breadcrumb`,
            itemListElement: route.trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${origin}${c.path}` })),
          },
        ]),
  ];
  const anchors = route.anchors.map((a) => `<section id="${a}"><h2>${a}</h2></section>`).join("");
  const nav = links.map((href) => `<a href="${href}">link</a>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>${robots}<title>${title ?? route.title}</title><meta name="description" content="${description ?? route.description}"/>${extraHead}</head><body><header>${nav}</header><main id="main"><h1>${route.id}</h1>${anchors}${main}</main>${jsonLd(nodes)}<script>self.__next_f.push([1,"<a href=\\"/nowhere/\\">"])</script></body></html>`;
}

const routes = [
  routeOf("home", "/"),
  routeOf("docs", "/docs/", { label: "Docs", anchors: ["quick-start"] }),
  routeOf("faq", "/faq/", { label: "FAQ", type: "FAQPage", dated: true }),
  routeOf("design", "/_design/", { label: "Design", indexable: false }),
];
const [homeRoute, docsRoute, faqRoute] = routes;
/** Every page links the others (as the footer does), so none is an orphan. */
const everywhere = ["/", "/docs/", "/faq/"];

function goodSite() {
  return {
    "index.html": pageFor(homeRoute, { links: everywhere }),
    "docs.html": pageFor(docsRoute, { links: everywhere, main: '<a href="#quick-start">Quick start</a><a href="/faq/#top">x</a>'.replace("#top", "") }),
    "faq.html": pageFor(faqRoute, { links: [...everywhere, "/docs/#quick-start", "/llms.txt", "/_next/static/media/a.png", "/brand/mark.png", "mailto:a@b.c", "https://github.com/x"] }),
    "_not-found.html": `<html><head><meta name="robots" content="noindex"/></head><body><main><h1>Not found</h1><a href="/">Home</a><a href="/docs/">Docs</a></main></body></html>`,
    "_global-error.html": `<html><head></head><body><a href="/whatever/">x</a></body></html>`,
    "llms.txt.body": "# fixture",
  };
}

let fixture = 0;
/** Writes a site (pages, public files, static media, source files) and runs the check on it. */
function check(pages, { manifest = { routes }, publicFiles = ["brand/mark.png"], media = ["a.png"], sources, redirects = [] } = {}) {
  const dir = join(root, String((fixture += 1)));
  const app = join(dir, "dist", "server", "app");
  const write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const [name, html] of Object.entries(pages)) write(join(app, name), html);
  for (const file of publicFiles) write(join(dir, "public", file), "x");
  for (const file of media) write(join(dir, "dist", "static", "media", file), "x");
  for (const source of sources ?? manifest.routes.map((r) => r.source)) write(join(dir, "site", source), "export {};");
  write(join(dir, "dist", "routes-manifest.json"), JSON.stringify({ redirects }));
  write(join(dir, "manifest.json"), JSON.stringify(manifest));
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--dist",
      join(dir, "dist"),
      "--public",
      join(dir, "public"),
      "--site",
      join(dir, "site"),
      "--manifest",
      join(dir, "manifest.json"),
    ],
    { encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-registry passes", () => {
  test("a site whose pages, links, anchors, titles and breadcrumbs all match the registry", () => {
    const { status, output } = check(goodSite());
    assert.equal(status, 0, output);
    assert.match(output, /check-registry: 3 pages, 4 registry routes \(1 internal, not built\), \d+ internal links, 0 links in llms files, 1 promised anchors, 0 errors/);
  });

  test("an internal route that is built and noindex", () => {
    const design = routes[3];
    const { status, output } = check({
      ...goodSite(),
      "_design.html": pageFor(design, { robots: '<meta name="robots" content="noindex, nofollow"/>', links: everywhere }),
    });
    assert.equal(status, 0, output);
  });

  test("llms.txt and llms-full.txt link pages, promised anchors and files of the site", () => {
    const { status, output } = check({
      ...goodSite(),
      "llms.txt.body": `# Run Hound\n\n- [Docs](${origin}/docs/): the guide.\n- [Full text](${origin}/llms-full.txt): all of it.\n- [GitHub](https://github.com/x/y): code.`,
      "llms-full.txt.body": `See ${origin}/docs/#quick-start. More (${origin}/faq/).`,
    });
    assert.equal(status, 0, output);
    assert.doesNotMatch(output, /note:/);
    assert.match(output, /4 links in llms files/);
  });

  test("an llms file links an id the page has but the registry doesn't promise: a note, not an error", () => {
    const { status, output } = check({
      ...goodSite(),
      "docs.html": pageFor(docsRoute, { links: everywhere, main: '<h2 id="later">Later</h2>' }),
      "llms-full.txt.body": `This answer: ${origin}/docs/#later.`,
    });
    assert.equal(status, 0, output);
    assert.match(output, /note: llms-full\.txt links \/docs\/#later, which the registry doesn't promise \(content\/routes: anchors\)/);
  });

  test("a visible breadcrumb that follows the registry trail", () => {
    const crumbs = '<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><span aria-current="page">Docs</span></li></ol></nav>';
    const { status, output } = check({ ...goodSite(), "docs.html": pageFor(docsRoute, { links: everywhere, main: crumbs }) });
    assert.equal(status, 0, output);
  });

  test("a visible breadcrumb with aria-hidden separators (the approved prototype's Breadcrumbs markup)", () => {
    // site-design/judge-eng/hound/src/components/templates/trail-toc.tsx: a "/" in each <li> after the first, hidden
    // from screen readers, so it is no part of the crumb's name.
    const crumbs =
      '<nav aria-label="Breadcrumb" class="min-w-0"><ol class="flex min-w-0 items-center gap-2">' +
      '<li class="flex min-w-0 items-center gap-2"><a href="/" class="hover:text-accent">Home</a></li>' +
      '<li class="flex min-w-0 items-center gap-2"><span aria-hidden="true" class="text-dim">/</span><span aria-current="page" class="truncate text-fg">Docs</span></li>' +
      "</ol></nav>";
    const { status, output } = check({ ...goodSite(), "docs.html": pageFor(docsRoute, { links: everywhere, main: crumbs }) });
    assert.equal(status, 0, output);
  });
});

describe("check-registry fails the build when", () => {
  const cases = {
    "a link points at no page": [{ "faq.html": pageFor(faqRoute, { links: [...everywhere, "/pricing/"] }) }, /faq\.html: link \/pricing\/ points at no page/],
    "a link's #fragment is no id on its page": [
      { "faq.html": pageFor(faqRoute, { links: [...everywhere, "/docs/#install"] }) },
      /faq\.html: link \/docs\/#install: no id="install" on \/docs\//,
    ],
    "a same-page #fragment is missing": [
      { "faq.html": pageFor(faqRoute, { links: everywhere, main: '<a href="#nope">x</a>' }) },
      /faq\.html: link #nope: no id="nope" on \/faq\//,
    ],
    "a link leaves out the trailing slash (a redirect on every click)": [
      { "faq.html": pageFor(faqRoute, { links: [...everywhere, "/docs"] }) },
      /faq\.html: link \/docs redirects to \/docs\/; link the page's own URL/,
    ],
    "a link to a file that doesn't exist": [
      { "faq.html": pageFor(faqRoute, { links: [...everywhere, "/brand/missing.png"] }) },
      /faq\.html: link \/brand\/missing\.png points at no page or file/,
    ],
    "a promised anchor is missing": [
      { "docs.html": pageFor({ ...docsRoute, anchors: [] }, { links: everywhere }) },
      /docs\.html: anchor #quick-start \(promised in the registry\) is missing/,
    ],
    "an indexable page is not in the registry": [
      { "pricing.html": pageFor(routeOf("pricing", "/pricing/"), { links: everywhere }) },
      /pricing\.html: \/pricing\/ is prerendered but not in the registry/,
    ],
    "the title differs from the registry's": [
      { "docs.html": pageFor(docsRoute, { links: everywhere, title: "Documentation · Run Hound" }) },
      /docs\.html: title "Documentation · Run Hound" is not the registry's "Docs · Run Hound"/,
    ],
    "the description differs from the registry's": [
      { "docs.html": pageFor(docsRoute, { links: everywhere, description: "Something else entirely, long enough to be a description." }) },
      /docs\.html: meta description is not the registry's/,
    ],
    "the BreadcrumbList differs from the registry trail": [
      {
        "docs.html": pageFor(docsRoute, {
          links: everywhere,
          graph: [
            { "@type": "WebPage", "@id": `${origin}/docs/#webpage`, url: `${origin}/docs/`, name: docsRoute.title },
            { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Start", item: `${origin}/` }, { "@type": "ListItem", position: 2, name: "Docs", item: `${origin}/docs/` }] },
          ],
        }),
      },
      /docs\.html: BreadcrumbList \[\["Start","\/"\],\["Docs","\/docs\/"\]\] is not the registry trail \[\["Home","\/"\],\["Docs","\/docs\/"\]\]/,
    ],
    "an inner page has no BreadcrumbList": [
      {
        "docs.html": pageFor(docsRoute, {
          links: everywhere,
          graph: [{ "@type": "WebPage", "@id": `${origin}/docs/#webpage`, url: `${origin}/docs/`, name: docsRoute.title }],
        }),
      },
      /docs\.html: no BreadcrumbList; the registry trail is Home > Docs/,
    ],
    "the WebPage node's type differs from the registry's schema": [
      {
        "faq.html": pageFor({ ...faqRoute, webPage: { ...faqRoute.webPage, type: "WebPage" } }, { links: everywhere }),
      },
      /faq\.html: the page node is a WebPage, the registry says FAQPage/,
    ],
    "a dated page's node has no dateModified": [
      { "faq.html": pageFor({ ...faqRoute, webPage: { ...faqRoute.webPage, dated: false } }, { links: everywhere }) },
      /faq\.html: the page node has no dateModified, the registry dates this page/,
    ],
    "the visible breadcrumb differs from the registry trail": [
      {
        "docs.html": pageFor(docsRoute, {
          links: everywhere,
          main: '<nav aria-label="Breadcrumb"><ol><li><a href="/">Start</a></li><li>Docs</li></ol></nav>',
        }),
      },
      /docs\.html: the visible breadcrumb \["Start","Docs"\] is not the registry trail \["Home","Docs"\]/,
    ],
    "a page no other page links to (an orphan)": [
      { "index.html": pageFor(homeRoute, { links: ["/", "/docs/"] }), "docs.html": pageFor(docsRoute, { links: ["/", "/docs/"] }), "faq.html": pageFor(faqRoute, { links: ["/", "/docs/"] }) },
      /\/faq\/ \(faq\): no other page links to it \(an orphan\)/,
    ],
    "a page only the 404 links to (still an orphan: no page of the site leads to it)": [
      {
        "index.html": pageFor(homeRoute, { links: ["/", "/docs/"] }),
        "docs.html": pageFor(docsRoute, { links: ["/", "/docs/"] }),
        "faq.html": pageFor(faqRoute, { links: ["/", "/docs/"] }),
        "_not-found.html": `<html><head><meta name="robots" content="noindex"/></head><body><main><a href="/faq/">FAQ</a></main></body></html>`,
      },
      /\/faq\/ \(faq\): no other page links to it \(an orphan\)/,
    ],
    "an llms file links an id the page doesn't have": [
      { "llms-full.txt.body": `- [FAQ](${origin}/faq/#is-it-free): Is it free?` },
      /llms-full\.txt: link https:\/\/run-hound\.example\/faq\/#is-it-free: no id="is-it-free" on \/faq\//,
    ],
    "an llms file links a page that doesn't exist": [
      { "llms.txt.body": `- [Pricing](${origin}/pricing/): what it costs.` },
      /llms\.txt: link https:\/\/run-hound\.example\/pricing\/ points at no page/,
    ],
    "the 404 page links a page that doesn't exist": [
      { "_not-found.html": `<html><head><meta name="robots" content="noindex"/></head><body><main><a href="/gone/">x</a></main></body></html>` },
      /_not-found\.html: link \/gone\/ points at no page/,
    ],
    "an internal route is built without noindex": [
      { "_design.html": pageFor(routes[3], { links: everywhere }) },
      /_design\.html: \/_design\/ is an internal route \(design\) and must be noindex/,
    ],
  };
  for (const [name, [pages, message]] of Object.entries(cases)) {
    test(name, () => {
      const { status, output } = check({ ...goodSite(), ...pages });
      assert.equal(status, 1, output);
      assert.match(output, message);
    });
  }

  test("a page only an internal (noindex) route links to is an orphan", () => {
    const design = routes[3];
    const pages = {
      ...goodSite(),
      "index.html": pageFor(homeRoute, { links: ["/", "/docs/"] }),
      "docs.html": pageFor(docsRoute, { links: ["/", "/docs/"] }),
      "faq.html": pageFor(faqRoute, { links: ["/", "/docs/"] }),
      "_design.html": pageFor(design, { robots: '<meta name="robots" content="noindex, nofollow"/>', links: everywhere }),
    };
    const { status, output } = check(pages);
    assert.equal(status, 1, output);
    assert.match(output, /\/faq\/ \(faq\): no other page links to it \(an orphan\)/);
  });

  test("a registry page was not prerendered", () => {
    const pages = goodSite();
    delete pages["faq.html"];
    const { status, output } = check(pages);
    assert.equal(status, 1, output);
    assert.match(output, /\/faq\/ \(faq\): in the registry but not prerendered/);
  });

  test("a route's source file does not exist", () => {
    const { status, output } = check(goodSite(), { sources: [homeRoute.source, docsRoute.source] });
    assert.equal(status, 1, output);
    assert.match(output, /\/faq\/ \(faq\): source src\/app\/faq\/page\.tsx does not exist/);
  });

  test("a link goes to a redirect, or a redirect leads to another (a chain)", () => {
    const redirects = [
      { source: "/contribute/", destination: "/open-source/contributing/", statusCode: 308, regex: "^/contribute(?:/)?$" },
      { source: "/help/", destination: "/contribute/", statusCode: 308, regex: "^/help(?:/)?$" },
    ];
    const { status, output } = check(
      { ...goodSite(), "faq.html": pageFor(faqRoute, { links: [...everywhere, "/contribute/"] }) },
      { redirects },
    );
    assert.equal(status, 1, output);
    assert.match(output, /faq\.html: link \/contribute\/ redirects \(308 to \/open-source\/contributing\/\); link the final URL/);
    assert.match(output, /redirect \/help\/ → \/contribute\/ leads to another redirect \(a chain\)/);
  });

  test("the build is missing", () => {
    const result = spawnSync(process.execPath, [script, "--dist", join(root, "no-such-build")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is missing/);
  });
});
