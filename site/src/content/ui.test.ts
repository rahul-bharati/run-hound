// content/ui.ts: the interface's words that pages pass to their components, written once as a dictionary, the shape a
// translation would take. `pnpm test` (node:test, scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fill, plural, ui } from "@/content/ui";

/** Every string in the dictionary, with its path ("docs.onThisPage"). */
function leaves(value: unknown, path = ""): [string, unknown][] {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [[path, value]];
}

const all = leaves(ui);

describe("the dictionary", () => {
  test("holds strings only, each trimmed, with single spaces", () => {
    assert.ok(all.length >= 30, `${all.length} strings`);
    for (const [path, value] of all) {
      assert.equal(typeof value, "string", path);
      const text = value as string;
      assert.ok(text.length > 0 && text.trim() === text && !/\s{2}/.test(text), `${path}: "${text}"`);
    }
  });

  test("has no 'Edit this page': pages end with the report line instead (decision 4)", () => {
    for (const [path, value] of all) assert.doesNotMatch(value as string, /edit this page/i, path);
  });

  test("writes none of the primitives' own words, which components/primitives/labels.ts holds for client components", () => {
    const file = new URL("../components/primitives/labels.ts", import.meta.url);
    const theirs = existsSync(file)
      ? [...readFileSync(file, "utf8").matchAll(/"([^"\n]+)"|`([^`\n$]+)`/g)].map((m) => m[1] ?? m[2])
      : [];
    const both = all.filter(([, value]) => theirs.includes(value as string)).map(([path]) => path);
    assert.deepEqual(both, []);
  });

  test("the next step after copying the run command is the design's (§2.5 Command)", () => {
    assert.equal(`Copied. ${ui.afterCopy}`, "Copied. Paste it in a terminal, then open localhost:4000.");
  });

  test("the search dialog's words are the design's (§3.16)", () => {
    assert.equal(ui.search.title, "Search the docs, checks and FAQ");
    assert.equal(fill(ui.search.noResults, { query: "x" }), "No results for “x”. Try a check id like double-submit, or browse the docs.");
    assert.equal(ui.search.devOnly, "Search works in production builds.");
  });

  test("a check page's and a docs page's meta lines read as the design shows them (§3.5, §3.6)", () => {
    assert.equal(fill(ui.checkPage.checked, { version: "0.6.0", date: "27 September 2026" }), "Checked against release 0.6.0 · 27 September 2026");
    assert.equal(fill(ui.docs.meta, { version: "0.6.0", date: "27 September 2026" }), "For release 0.6.0 · Updated 27 September 2026");
    assert.equal(plural(ui.docs.readingTime, 5), "About 5 minutes");
  });

  test("a docs page's reading time has a form for one minute (§3.5: \"About N minutes\" on task pages)", () => {
    assert.equal(plural(ui.docs.readingTime, 1), "About 1 minute");
    assert.equal(plural(ui.docs.readingTime, 5), "About 5 minutes");
  });

  test("the links a template repeats are the design's, without the arrow ArrowLink draws (§3.7, §3.9, §3.12)", () => {
    assert.equal(ui.checksHub.howTested, "How it's tested");
    assert.equal(ui.demo.aboutCheck, "About this check");
    assert.equal(ui.faq.readMore, "Read more");
    for (const text of [ui.checksHub.howTested, ui.demo.aboutCheck, ui.faq.readMore]) assert.doesNotMatch(text, /[→↗]/);
  });

  test("the trigger says Ctrl K, the dialog's own hint has an Apple form, and the dialog a close label (§3.2, §3.16: Ctrl/⌘K)", () => {
    assert.equal(ui.header.searchKeys, "Ctrl K");
    assert.equal(ui.header.searchKeysApple, "⌘ K");
    assert.equal(ui.search.close, "Close");
  });

  test("the tags are the design's: Preview, Signed in and Added in <release> (§2.5 Tag)", () => {
    assert.deepEqual([ui.tags.preview, ui.tags.signedIn, fill(ui.tags.addedIn, { release: "0.6.0" })], ["Preview", "Signed in", "Added in 0.6.0"]);
  });
});

describe("fill() and plural()", () => {
  test("fill() puts every value in its place, and fails on a placeholder without a value", () => {
    assert.equal(fill("All {count} checks", { count: 26 }), "All 26 checks");
    assert.equal(fill("{a} and {a}", { a: "x" }), "x and x");
    assert.throws(() => fill("All {count} checks", {}), /count/);
  });

  test("every placeholder in the dictionary is a plain name", () => {
    for (const [path, value] of all) {
      for (const [, name] of (value as string).matchAll(/\{([^}]*)\}/g)) assert.match(name, /^[a-z][a-zA-Z]*$/, path);
    }
  });

  test("plural() picks the English form for a count", () => {
    assert.equal(plural(ui.search.results, 0), "0 results");
    assert.equal(plural(ui.search.results, 1), "1 result");
    assert.equal(plural(ui.search.results, 12), "12 results");
  });
});
