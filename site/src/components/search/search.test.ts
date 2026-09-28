// The site search (DESIGN.md §3.16): the shortcut, the result count and empty state, Pagefind's excerpts rendered
// without innerHTML, and how the dialog loads (on first open, never with the page). The built site is tested in the lab
// (scripts/lab/specs/search.spec.mjs). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { createElement } from "react";
import { sourceFiles } from "../../../scripts/lib/build-output.mjs";
import { element, html, textOf } from "../primitives/test-render";

const { countText, emptyParts, emptyText, excerptParts, isSearchShortcut, nextIndex } = await import("./search-logic");
const { SearchTrigger } = await import("./search-trigger");
const { SearchDialog } = await import("./search-dialog");

const here = new URL("./", import.meta.url).pathname;
const src = new URL("../../", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(here, name), "utf8");

/** A keydown as the shortcut handler reads it. */
const key = (init: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: unknown }>) => ({
  key: "k",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: { tagName: "BODY", isContentEditable: false },
  ...init,
});

describe("Ctrl K and ⌘K open search, never while typing (no '/' shortcut, WCAG 2.1.4)", () => {
  test("Ctrl+K and Meta+K, either case", () => {
    assert.equal(isSearchShortcut(key({ ctrlKey: true })), true);
    assert.equal(isSearchShortcut(key({ metaKey: true })), true);
    assert.equal(isSearchShortcut(key({ key: "K", ctrlKey: true })), true);
  });

  test("not K alone, not with Alt or Shift, not another key, not '/'", () => {
    assert.equal(isSearchShortcut(key({})), false);
    assert.equal(isSearchShortcut(key({ ctrlKey: true, altKey: true })), false);
    assert.equal(isSearchShortcut(key({ ctrlKey: true, shiftKey: true })), false);
    assert.equal(isSearchShortcut(key({ key: "j", ctrlKey: true })), false);
    assert.equal(isSearchShortcut(key({ key: "/" })), false);
  });

  test("not while typing in a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      assert.equal(isSearchShortcut(key({ ctrlKey: true, target: { tagName, isContentEditable: false } })), false, tagName);
    }
    assert.equal(isSearchShortcut(key({ ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } })), false);
    assert.equal(isSearchShortcut(key({ ctrlKey: true, target: null })), true);
  });
});

describe("results", () => {
  test("its own polite count: '1 result', '12 results'", () => {
    assert.equal(countText(1), "1 result");
    assert.equal(countText(12), "12 results");
    assert.equal(countText(0), "No results");
  });

  test("the empty state points to a check id and the docs", () => {
    assert.equal(emptyText("x"), "No results for “x”. Try a check id like double-submit, or browse the docs.");
  });

  test("the empty state's parts make that sentence, with the docs link as its own part", () => {
    const parts = emptyParts("x");
    assert.deepEqual(parts, {
      before: "No results for “x”. Try a check id like double-submit, or ",
      link: "browse the docs",
      after: ".",
    });
    assert.equal(parts.before + parts.link + parts.after, emptyText("x"));
  });

  test("the dialog renders the parts, not string surgery on the sentence", () => {
    const source = readFileSync(new URL("./search-dialog.tsx", import.meta.url), "utf8");
    assert.match(source, /emptyParts\(/);
    assert.doesNotMatch(source, /emptyText\([^)]*\)\.replace/);
  });

  test("an excerpt's <mark>s become parts, text stays text (no innerHTML)", () => {
    assert.deepEqual(excerptParts("Run <mark>double-submit</mark> on &lt;form&gt; &amp; more"), [
      { text: "Run ", mark: false },
      { text: "double-submit", mark: true },
      { text: " on <form> & more", mark: false },
    ]);
    assert.deepEqual(excerptParts("<mark>a</mark><mark>b</mark>"), [
      { text: "a", mark: true },
      { text: "b", mark: true },
    ]);
    assert.deepEqual(excerptParts("<script>alert(1)</script>"), [{ text: "<script>alert(1)</script>", mark: false }]);
    assert.deepEqual(excerptParts(""), []);
  });

  test("arrow keys move from the field through the results and stop at the ends", () => {
    // Stops: 0 is the field, 1..n the result links.
    assert.equal(nextIndex(0, 4, "ArrowDown"), 1);
    assert.equal(nextIndex(3, 4, "ArrowDown"), 3);
    assert.equal(nextIndex(1, 4, "ArrowUp"), 0);
    assert.equal(nextIndex(0, 4, "ArrowUp"), 0);
    assert.equal(nextIndex(-1, 4, "ArrowDown"), 0);
  });
});

describe("the dialog loads on first open, never with the page (§3.16, G-T3)", () => {
  test("the trigger imports the dialog only through next/dynamic, and nothing else imports it", () => {
    const trigger = read("search-trigger.tsx");
    assert.match(trigger, /dynamic\(\s*loadDialog/);
    assert.match(trigger, /import\(\s*["']\.\/search-dialog["']\s*\)/);
    assert.doesNotMatch(trigger, /^\s*import\s+(?!type\b)[^;]*from\s+["']\.\/search-dialog["']/m);
    for (const file of sourceFiles(src, ["ts", "tsx"])) {
      const name = relative(src, file);
      if (name.startsWith("components/search/")) continue;
      assert.doesNotMatch(readFileSync(file, "utf8"), /search-dialog/, `${name} imports the dialog`);
    }
  });

  test("the dialog imports Pagefind's search API from where the index is served, unbundled", () => {
    assert.match(read("search-dialog.tsx"), /import\(\s*\/\* webpackIgnore: true \*\/\s*["']\/pagefind\/pagefind\.js["']\s*\)/);
  });

  test("the trigger renders a button and no dialog or heading", () => {
    const markup = html(createElement(SearchTrigger, { docs: "/docs/" }));
    const button = element(markup, "button")!;
    assert.match(button.attrs, /type="button"/);
    assert.match(button.attrs, /data-search-trigger/);
    assert.match(button.attrs, /aria-keyshortcuts="Control\+K Meta\+K"/);
    assert.doesNotMatch(markup, /<dialog|<h[1-6]/);
  });

  test("the dialog: an h2 names it, a labelled search field, its own status", () => {
    const markup = html(createElement(SearchDialog, { open: false, docs: "/docs/", onClose: () => {}, returnFocus: null }));
    const dialog = element(markup, "dialog")!;
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog.attrs)?.[1];
    assert.ok(labelledBy);
    const heading = element(dialog.inner, "h2")!;
    assert.match(heading.attrs, new RegExp(`id="${labelledBy}"`));
    assert.equal(textOf(heading.inner), "Search the docs, checks and FAQ");
    const input = /<input[^>]*>/.exec(dialog.inner)![0];
    assert.match(input, /type="search"/);
    const inputId = /id="([^"]+)"/.exec(input)![1];
    assert.match(dialog.inner, new RegExp(`<label[^>]*for="${inputId}"`));
    assert.match(dialog.inner, /role="status"/);
  });
});
