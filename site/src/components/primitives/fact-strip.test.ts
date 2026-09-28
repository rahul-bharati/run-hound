// FactStrip (DESIGN.md §2.5): the proof strip and the facts line. Items with a dim tick, 14 px, each a link to its
// proof; a 2 × 2 grid on phones.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { element, elements, html, textOf } from "./test-render";

const { FactStrip } = await import("./fact-strip");

const items = [
  { label: "26 checks, all open source", href: "/checks/" },
  { label: "Runs on your machine", href: "/docs/#safety" },
  { label: "AI off by default", href: "/docs/#ai" },
  { label: "A Playwright test per finding", href: "/checks/#double-submit" },
];

describe("FactStrip", () => {
  const markup = html(createElement(FactStrip, { items }));

  test("a list with one item per fact", () => {
    const list = element(markup, "ul");
    assert.ok(list);
    assert.equal(elements(list.inner, "li").length, items.length);
  });

  test("every item is a link to its proof", () => {
    const lis = elements(markup, "li");
    items.forEach((item, i) => {
      const link = element(lis[i].inner, "a");
      assert.ok(link, `"${item.label}" is not a link`);
      assert.match(link.attrs, new RegExp(`href="${item.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      assert.equal(textOf(link.inner).trim(), item.label);
    });
  });

  test("each item has a dim tick (a bullet, not a run result), hidden from screen readers", () => {
    for (const li of elements(markup, "li")) {
      const tick = element(li.inner, "svg");
      assert.ok(tick, "no tick");
      assert.match(tick.attrs, /aria-hidden="true"/);
      assert.match(tick.attrs, /tick-bullet/);
      assert.match(tick.inner, /<use href="#tick"/);
    }
  });

  test("items are typed as links: an item without href doesn't compile", () => {
    // @ts-expect-error every fact links to its proof
    const bad = createElement(FactStrip, { items: [{ label: "No proof" }] });
    assert.ok(bad);
  });
});
