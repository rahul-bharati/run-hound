// Breadcrumbs (DESIGN.md §2.5, brief §3.6): nav aria-label="Breadcrumb", rendered from the registry like the
// BreadcrumbList, one line on phones, and the current page is not a link.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { breadcrumbTrail } from "@/lib/nav";
import { element, elements, html, textOf } from "./test-render";

const { Breadcrumbs } = await import("./breadcrumbs");

describe("Breadcrumbs", () => {
  const markup = html(createElement(Breadcrumbs, { id: "faq" }));

  test("a nav named Breadcrumb holding an ordered list", () => {
    const nav = element(markup, "nav");
    assert.match(nav?.attrs ?? "", /aria-label="Breadcrumb"/);
    assert.ok(element(nav!.inner, "ol"));
  });

  test("the trail is the registry's (the same one the BreadcrumbList uses)", () => {
    const items = elements(markup, "li").map((li) => textOf(li.inner).replace(/\//g, "").trim());
    assert.deepEqual(items, breadcrumbTrail("faq").map((c) => c.name));
  });

  test("every item but the current page is a link to its path", () => {
    const trail = breadcrumbTrail("faq");
    const items = elements(markup, "li");
    trail.slice(0, -1).forEach((crumb, i) => {
      const link = element(items[i].inner, "a");
      assert.ok(link, `${crumb.name} is not a link`);
      assert.match(link.attrs, new RegExp(`href="${crumb.path}"`));
    });
  });

  test("the current page is not a link, and says it is the current page", () => {
    const last = elements(markup, "li").at(-1)!;
    assert.equal(element(last.inner, "a"), undefined);
    const current = element(last.inner, "span", 'aria-current="page"');
    assert.ok(current, "the current page doesn't say it is the current page");
    assert.equal(textOf(current.inner), "FAQ");
    assert.equal(elements(markup, "span", "aria-current").length, 1);
  });

  test("separators are hidden from screen readers", () => {
    for (const li of elements(markup, "li").slice(1)) {
      const separator = element(li.inner, "span", 'aria-hidden="true"');
      assert.equal(textOf(separator?.inner ?? ""), "/");
    }
  });
});
