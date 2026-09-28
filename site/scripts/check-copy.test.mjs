// Tests for scripts/check-copy.mjs (`pnpm test`): the homepage word budget, counted without a browser from the
// prerendered HTML, on fixtures that must pass or fail.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const script = join(import.meta.dirname, "check-copy.mjs");
const root = mkdtempSync(join(tmpdir(), "check-copy-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** `n` words of plain prose. */
const words = (n, word = "word") => Array.from({ length: n }, () => word).join(" ");
/** Prose in sentences of `per` words. */
const sentences = (n, per = 10) =>
  Array.from({ length: Math.ceil(n / per) }, (_, i) => `${words(Math.min(per, n - i * per))}.`).join(" ");

const page = (main) =>
  `<!DOCTYPE html><html><head><title>Home</title></head><body><header><nav>${words(40, "nav")}</nav></header><main id="main">${main}</main><footer>${words(60, "footer")}</footer><script>self.__next_f.push([1,"${words(500, "payload")}"])</script></body></html>`;

let fixture = 0;
function check(main, flags = ["--enforce"]) {
  const file = join(root, `${(fixture += 1)}.html`);
  writeFileSync(file, page(main));
  const result = spawnSync(process.execPath, [script, "--file", file, ...flags], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("check-copy counts the words in <main>", () => {
  test("only <main>: not the header, the footer or the RSC payload", () => {
    const { status, output } = check(`<h1>${words(3)}</h1><p>${sentences(20)}</p>`);
    assert.equal(status, 0, output);
    assert.match(output, /check-copy: 23 words in <main> \(0 in hidden panels\), budget 750: ok/);
  });

  test("aria-hidden, sr-only, <svg>, <script> and <style> are left out (the brief's list, §4.3)", () => {
    const hidden = [
      `<div aria-hidden="true"><p>${words(900)}</p></div>`,
      `<span class="sr-only">${words(30)}</span>`,
      `<svg><text>${words(50)}</text></svg>`,
      `<style>.a{}</style>`,
      `<script>const a = "${words(40)}";</script>`,
    ].join("");
    const { status, output } = check(`<h1>${words(2)}</h1>${hidden}<p>${sentences(10)}</p>`);
    assert.equal(status, 0, output);
    assert.match(output, /12 words in <main>/);
  });

  test("only the bare sr-only class leaves words out: words shown at some widths count", () => {
    const shown = [
      // Hidden on phones, shown from md up; shown on phones, hidden from sm up; hidden, then shown again from md up.
      `<span class="md:not-sr-only">${words(3)}</span>`,
      `<span class="sm:sr-only">${words(4)}</span>`,
      `<span class="sr-only md:not-sr-only">${words(5)}</span>`,
    ].join("");
    const hidden = [`<span class="sr-only">${words(30)}</span>`, `<span class="block sr-only mt-2">${words(30)}</span>`].join("");
    const { status, output } = check(`<h1>${words(2)}</h1>${shown}${hidden}`);
    assert.equal(status, 0, output);
    assert.match(output, /14 words in <main>/);
  });

  test("<noscript> and <template> text counts: they are not on the brief's list of what is left out", () => {
    const { output } = check(`<h1>${words(2)}</h1><noscript><p>${words(5)}</p></noscript><template><p>${words(4)}</p></template>`);
    assert.match(output, /11 words in <main>/);
  });

  test("a tag boundary separates words: a label and the text after it are not run together", () => {
    const { output } = check(`<h1>Home</h1><figure><figcaption><span>${words(8, "label")}</span>${words(8, "caption")}</figcaption></figure>`);
    assert.match(output, /17 words in <main>/);
    assert.match(output, /warning: caption has 16 words \(at most 15\)/);
  });

  test("words in hidden panels count (a tab can't hide words from the budget), and are reported", () => {
    const main = `<h1>Home</h1><p>${sentences(700)}</p><div role="tabpanel" hidden><p>${sentences(60)}</p></div>`;
    const { status, output } = check(main);
    assert.equal(status, 1, output);
    assert.match(output, /761 words in <main> \(60 in hidden panels\), budget 750: OVER/);
    assert.match(output, /warning: 60 words are in hidden panels/);
  });

  test("words are the brief's regex: ids, versions and paths are one word each", () => {
    const { output } = check(`<h1>Run Hound 0.6.0</h1><p>Open localhost:4000 and host.docker.internal:3000/book now.</p>`);
    assert.match(output, /check-copy: 8 words in <main>/);
  });
});

describe("check-copy enforces the 750-word gate only once content/home.ts exists", () => {
  test("over 750 fails when enforced", () => {
    const { status, output } = check(`<h1>Home</h1><p>${sentences(760)}</p>`);
    assert.equal(status, 1, output);
    assert.match(output, /OVER/);
  });

  test("over 750 only reports before the homepage moves to content/home.ts", () => {
    const { status, output } = check(`<h1>Home</h1><p>${sentences(3000)}</p>`, ["--report"]);
    assert.equal(status, 0, output);
    assert.match(output, /3001 words in <main>.*OVER \(report only: src\/content\/home\.ts does not exist yet\)/);
  });

  test("a custom budget", () => {
    const { status } = check(`<h1>Home</h1><p>${sentences(30)}</p>`, ["--enforce", "--budget", "20"]);
    assert.equal(status, 1);
  });
});

describe("check-copy warns about the copy rules (brief §4.5), without failing", () => {
  test("an h2 over 8 words, an intro over 25, a sentence over 25, a caption over 15, more than one tablist", () => {
    const main = [
      "<h1>Home</h1>",
      `<section><h2>${words(9, "heading")}</h2><p>${words(26, "intro")}.</p></section>`,
      `<section><h2>Short heading</h2><p>Short intro.</p><p>${words(26, "long")}.</p></section>`,
      `<figure><img alt=""/><figcaption>${words(16, "caption")}</figcaption></figure>`,
      `<div role="tablist"></div><div role="tablist"></div>`,
    ].join("");
    const { status, output } = check(main);
    assert.equal(status, 0, output);
    assert.match(output, /warning: h2 has 9 words \(at most 8\): "heading heading/);
    assert.match(output, /warning: intro has 26 words \(at most 25\): "intro intro/);
    assert.match(output, /warning: sentence has 26 words \(at most 25\): "long long/);
    assert.match(output, /warning: caption has 16 words \(at most 15\): "caption caption/);
    assert.match(output, /warning: 2 tablists \(at most 1\)/);
  });

  test("--sections lists the words under each h2", () => {
    const { output } = check(`<h1>Home</h1><p>${words(4)}</p><h2>Why</h2><p>${words(6)}</p><h2>Start</h2><p>${words(2)}</p>`, [
      "--enforce",
      "--sections",
    ]);
    assert.match(output, /\s5\s+\(before the first h2\)/);
    assert.match(output, /\s7\s+Why/);
    assert.match(output, /\s3\s+Start/);
  });
});

test("a list item made of a heading and a paragraph is checked through them, not as one run-on sentence", () => {
  const main = `<h1>Home</h1><ul><li><h3>Can someone read your data?</h3><p>${words(24, "short")}. ${words(24, "again")}.</p></li></ul>`;
  const { status, output } = check(main);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /sentence has/);
});
