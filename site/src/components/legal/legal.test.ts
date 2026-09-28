// The legal pages in the new shell (DESIGN.md §3.15; node F3): Privacy, Terms, Acceptable use and Security, rendered
// to HTML as the prerendered pages have them. Each shows its "Last updated" date, a breadcrumb equal to its
// BreadcrumbList, one h1, a contents list whose links land on its headings, prose on the type scale, and links that
// resolve; each stays out of the search index. The lab checks the built pages (scripts/lab/specs/404-legal.spec.mjs).
// `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, type ComponentType } from "react";
import { element, elements, html, textOf } from "@/components/primitives/test-render";
import "@/components/not-found/test-css";
import { route, routes, type RouteId } from "@/content/routes";
import { legalRoutes } from "@/content/routes/legal";
import { breadcrumbTrail } from "@/lib/nav";
import { site } from "@/lib/site";

const pages = {
  privacy: await import("../../app/(legal)/privacy/page"),
  terms: await import("../../app/(legal)/terms/page"),
  "acceptable-use": await import("../../app/(legal)/acceptable-use/page"),
  security: await import("../../app/(legal)/security/page"),
} as unknown as Record<RouteId, { default: ComponentType; metadata: { title?: unknown; alternates?: { canonical?: string } } }>;

const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1]?.replaceAll("&amp;", "&");
const idsIn = (markup: string) => new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

describe("the legal routes", () => {
  test("the four legal pages, indexable, dated by their own date, and out of the search index (§3.15)", () => {
    assert.deepEqual(
      legalRoutes.map((r) => r.id),
      ["privacy", "terms", "acceptable-use", "security"],
    );
    for (const r of legalRoutes) {
      assert.equal(r.search, false, `${r.id} is left out of search`);
      assert.equal(r.indexable, true, `${r.id} is indexable`);
      assert.equal(r.lastmod, "legal", `${r.id} is dated by "Last updated"`);
      assert.equal(r.schema.dated, true, `${r.id} carries dateModified`);
    }
  });
});

for (const { id } of legalRoutes) {
  const r = route(id);
  const page = pages[id];
  // A .tsx loads as CommonJS (test-render.ts): importing it, `default` is module.exports, whose own `default` is the page.
  const markup = html(createElement((page.default as unknown as { default: ComponentType }).default));
  const ids = idsIn(markup);

  describe(`${r.path} (the new shell)`, () => {
    test("metadata from the registry: its title and canonical path", () => {
      assert.equal(page.metadata.title, r.title);
      assert.equal(page.metadata.alternates?.canonical, r.path);
    });

    test("the breadcrumb is the registry's trail (Home, then the page), the current page not a link", () => {
      const nav = element(markup, "nav", 'aria-label="Breadcrumb"');
      assert.ok(nav, "a visible breadcrumb");
      const crumbs = elements(nav.inner, "li").map((li) => textOf(li.inner).replace("/", "").trim());
      assert.deepEqual(crumbs, breadcrumbTrail(id).map((c) => c.name));
      const current = element(nav.inner, "span", 'aria-current="page"');
      assert.equal(textOf(current?.inner ?? ""), r.label);
    });

    test("one h1, the page's title, and it is the first heading", () => {
      const headings = [...markup.matchAll(/<h([1-6])[\s>]/g)].map((m) => m[1]);
      assert.equal(headings.filter((level) => level === "1").length, 1);
      assert.equal(headings[0], "1");
      assert.equal(textOf(element(markup, "h1")!.inner), r.title);
    });

    test('a visible "Last updated" date, machine-readable', () => {
      const line = element(markup, "p", "data-last-updated");
      assert.ok(line, 'the "Last updated" line');
      assert.equal(textOf(line.inner), `Last updated ${site.legalUpdated}`);
      const time = element(line.inner, "time")!;
      assert.equal(attr(time.attrs, "dateTime") ?? attr(time.attrs, "datetime"), site.legalUpdatedIso);
    });

    test("the contents list links every section, and each link lands on a heading", () => {
      const nav = element(markup, "nav", 'aria-labelledby="legal-contents"');
      assert.ok(nav, "a contents navigation, labelled");
      assert.ok(ids.has("legal-contents"), "its label");
      const links = [...nav.inner.matchAll(/<a\s[^>]*>/g)].map(([tag]) => attr(tag, "href")!);
      assert.ok(links.length >= 3, `${links.length} contents links`);
      const article = element(markup, "article")!;
      for (const link of links) {
        assert.match(link, /^#/);
        const target = link.slice(1);
        assert.match(article.inner, new RegExp(`<h[23][^>]*\\sid="${target}"`), `#${target} is a heading of the article`);
      }
    });

    test("prose on the type scale (prose-doc), not the legacy prose", () => {
      const article = element(markup, "article")!;
      assert.match(article.attrs, /prose-doc/);
      assert.doesNotMatch(markup, /prose-night|prose-legal/);
    });

    test("every link resolves: pages to registered routes (with promised or present anchors), #fragments to ids here", () => {
      // Every <a> tag (elements(markup, "a") would match <article> and <aside> too).
      for (const [tag] of markup.matchAll(/<a\s[^>]*>/g)) {
        const target = attr(tag, "href");
        assert.ok(target, "a link has an href");
        if (target.startsWith("#")) {
          assert.ok(ids.has(target.slice(1)), `${r.path}: #${target.slice(1)} is on the page`);
        } else if (target.startsWith("/")) {
          const [path, hash] = target.split("#");
          const to = routes.find((x) => x.path === path);
          assert.ok(to, `${r.path}: ${target} is a registered page`);
          if (hash) assert.ok(to.anchors.includes(hash) || (to.path === r.path && ids.has(hash)), `${r.path}: ${target}'s anchor is promised`);
        } else {
          assert.match(target, /^(https:\/\/|mailto:)/, `${r.path}: ${target}`);
        }
      }
    });

    test("structured data: the dated WebPage and a BreadcrumbList equal to the visible breadcrumb", () => {
      const script = element(markup, "script", 'type="application/ld\\+json"')!;
      const data = JSON.parse(script.inner) as { "@graph": { "@type": string; dateModified?: string; itemListElement?: { name: string }[] }[] };
      const types = data["@graph"].map((node) => node["@type"]);
      assert.deepEqual(types, ["WebPage", "BreadcrumbList"]);
      assert.equal(data["@graph"][0].dateModified, site.legalUpdatedIso);
      assert.deepEqual(
        data["@graph"][1].itemListElement!.map((item) => item.name),
        breadcrumbTrail(id).map((c) => c.name),
      );
    });

    test("promised anchors are on the page", () => {
      for (const anchor of r.anchors) assert.ok(ids.has(anchor), `#${anchor}`);
    });
  });
}
