// Unit tests for content/compare.ts and the page it drives (app/compare/page.tsx, DESIGN.md §3.10): the comparison
// table, its sources and structured data; the ids kept; and each row that names a Run Hound check links its page.
// `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, type ReactElement } from "react";
// Before the page: the hook that lets node --test render .tsx (components/primitives/test-render.ts).
import { element, elements, html, textOf } from "@/components/primitives/test-render";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { builtInChecks } = await import("@/content/checks/data");
const { hasRoute, routes } = await import("@/content/routes");
const { capabilities, checkLink, compareJsonLd, comparePage, notYet, tools } = await import("@/content/compare");
// The page is compiled to CommonJS (test-render.ts), so Node's default import is its module.exports: the component is
// that object's own default.
const ComparePage = ((await import("@/app/compare/page")) as unknown as { default: { default: () => ReactElement } }).default.default;

const base = "https://run-hound.example";
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;
const sentences = (text: string) => text.replace(/`/g, "").split(/(?<=[.!?])\s+(?=\S)/);
const markup = html(createElement(ComparePage));
const builtIn = new Set(builtInChecks.map((c) => c.id));

describe("compare", () => {
  test("every row has a cell for every tool, and every text a mark that can carry it", () => {
    for (const row of capabilities) {
      assert.deepEqual(Object.keys(row.cells).sort(), tools.map((tool) => tool.id).sort(), row.capability);
      for (const cell of Object.values(row.cells)) {
        // "unknown" is a dash: the research doesn't say, so there is nothing to add.
        if (cell.mark === "unknown") assert.equal(cell.text, undefined, row.capability);
      }
    }
  });

  test("every tool links its sources, and names no price", () => {
    for (const tool of tools) {
      assert.ok(tool.sources.length > 0, tool.id);
      for (const source of tool.sources) assert.match(source.href, /^https:\/\//);
      for (const text of [tool.what, tool.adds, tool.together]) assert.doesNotMatch(text, /\$|€|\/month|pricing/i);
    }
  });

  test("the title stands alone and the description fits a search snippet", () => {
    assert.equal(comparePage.absoluteTitle, true);
    assert.ok(comparePage.title.length <= 60, `${comparePage.title.length} characters`);
    assert.ok(comparePage.description.length <= 155, `${comparePage.description.length} characters`);
  });

  test("what it doesn't do yet leaves out what 0.6.0 built: write-access, paywall-trust, two-step and sessionStorage sign-in", () => {
    const text = notYet.join("\n");
    assert.doesNotMatch(text, /write-access|paywall-trust/);
    assert.doesNotMatch(text, /sessionStorage|split over two pages|two-step/i);
  });

  test("no sentence runs over 25 words (brand.md)", () => {
    const texts = [...tools.flatMap((tool) => [tool.what, tool.adds, tool.together]), ...notYet];
    for (const text of texts) {
      for (const sentence of sentences(text)) assert.ok(words(sentence) <= 25, `${words(sentence)} words: ${sentence}`);
    }
  });

  test("the structured data is a WebPage dated by the release, and its breadcrumb", () => {
    const [page, breadcrumb, ...rest] = compareJsonLd()["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "WebPage");
    assert.equal(page.url, `${base}/compare/`);
    assert.equal(page.name, comparePage.title);
    assert.equal(page.dateModified, site.releasedIso);
    assert.equal(breadcrumb["@id"], `${base}/compare/#breadcrumb`);
  });
});

describe("rows that name a Run Hound check link its page", () => {
  const row = (start: string) => capabilities.find((r) => r.capability.startsWith(start));

  test("each row names the checks it describes, every one a built-in check", () => {
    assert.deepEqual(row("Walks flows")?.checks, ["dead-control", "silent-failure", "double-submit"]);
    assert.deepEqual(row("Accessibility")?.checks, [
      "axe-states",
      "keyboard-completion",
      "focus-visible",
      "error-announcement",
      "reflow-320",
      "credential-fields",
    ]);
    assert.deepEqual(row("Security checks")?.checks, [
      "security-headers",
      "cookie-flags",
      "cors",
      "source-maps",
      "bundle-secrets",
      "pii-leak",
    ]);
    assert.deepEqual(row("Access checks")?.checks, ["access-control", "write-access", "mass-assignment", "csrf", "paywall-trust"]);
    for (const r of capabilities) for (const id of r.checks ?? []) assert.ok(builtIn.has(id), `${r.capability}: ${id}`);
  });

  test("a check's link is its page once registered, its card on the checks hub before", () => {
    for (const id of builtIn) {
      const link = checkLink(id);
      if (hasRoute(`check-${id}`)) assert.equal(link.href, `/checks/${id}/`, id);
      else assert.equal(link.href, `/checks/#${id}`, id);
      assert.equal(link.label, builtInChecks.find((c) => c.id === id)?.name);
      const [path, hash] = link.href.split("#");
      const page = routes.find((r) => r.path === path);
      assert.ok(page, link.href);
      if (hash) assert.ok(page.anchors.includes(hash), `${link.href}: the checks hub promises #${hash}`);
    }
    assert.throws(() => checkLink("no-such-check"));
  });

  test("the rendered table links every named check from its Run Hound cell", () => {
    const table = element(markup, "table");
    assert.ok(table, "no table");
    for (const r of capabilities) {
      const cells = elements(table.inner, "tr").find((tr) => textOf(tr.inner).includes(r.capability));
      assert.ok(cells, r.capability);
      for (const id of r.checks ?? []) assert.ok(cells.inner.includes(`href="${checkLink(id).href}"`), `${r.capability}: ${id}`);
    }
  });
});

describe("the rendered page", () => {
  test("keeps its ids: #at-a-glance, #tool-by-tool, #not-yet, and a card per tool", () => {
    const ids = elements(markup, "section")
      .map((s) => /\sid="([^"]+)"/.exec(s.attrs)?.[1])
      .filter(Boolean);
    assert.deepEqual(ids, ["at-a-glance", "tool-by-tool", "not-yet"]);
    for (const tool of tools) assert.match(markup, new RegExp(`id="${tool.id}"`), tool.id);
  });

  test("one h1 and a visible breadcrumb equal to the BreadcrumbList", () => {
    assert.equal(elements(markup, "h1").length, 1);
    const nav = element(markup, "nav", 'aria-label="Breadcrumb"');
    assert.deepEqual(
      elements(nav?.inner ?? "", "li").map((li) => textOf(li.inner).replace("/", "").trim()),
      ["Home", "Compare"],
    );
  });

  test("the table scrolls in its own labelled region, never the page", () => {
    const region = element(markup, "div", 'role="region"');
    assert.ok(region, "no scroll region");
    assert.match(region.attrs, /tabindex="0"/);
    assert.match(region.attrs, /aria-labelledby="compare-caption"/);
    assert.match(region.inner, /<caption id="compare-caption"/);
  });

  test("no FAQPage here: the structured data is the WebPage and its breadcrumb", () => {
    assert.doesNotMatch(markup, /FAQPage/);
  });
});
