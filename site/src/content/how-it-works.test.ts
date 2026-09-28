// Unit tests for /how-it-works/ (DESIGN.md §3.12, node F2): no duplicated get-started block, a three-line Start snippet
// that links the quick start, no more words than the page had, captions within the copy rules, and figures that
// reveal only their media. `pnpm test`; the built page is scripts/lab/specs/flat-b.spec.mjs's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const { cantSeeTopics, principles } = await import("@/content/claims");
const { commands } = await import("@/content/commands");
const { unseenBand, howItWorksIntro, howSteps, outputsBand, plainText, designPrinciplesBand, startSnippet } = await import("@/content/how-it-works");

const siteDir = fileURLToPath(new URL("../../", import.meta.url));
const pageSource = readFileSync(`${siteDir}src/app/how-it-works/page.tsx`, "utf8");
const baseline = JSON.parse(readFileSync(`${siteDir}scripts/lab/baseline.json`, "utf8"));

/** The brief's word regex (scripts/lab/lib/page-measures.mjs WORD_SOURCE), so the count matches the lab's. */
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;

describe("/how-it-works/", () => {
  test("the page renders no get-started block: the Start snippet replaced it", () => {
    assert.doesNotMatch(pageSource, /components\/get-started/, "the page still imports GetStarted");
    assert.doesNotMatch(pageSource, /GetStarted/);
  });

  test("the Start snippet is three commands with Copy, the quick start's own, and links the quick start", () => {
    assert.deepEqual(startSnippet.block.commands, commands.blocks.run.commands);
    assert.equal(startSnippet.block.commands.length, 3);
    assert.equal(startSnippet.block.output, undefined, "the snippet shows commands, not output");
    assert.equal(startSnippet.link.to.to, "docs-quick-start");
    assert.match(pageSource, /startSnippet/, "the page renders the Start snippet");
    assert.match(pageSource, /CodeBlock/, "the Start snippet is a CodeBlock (Copy copies the commands only)");
  });

  test("no more words than the page had before the redesign (1,333 in <main>)", () => {
    const today = baseline.pages["how-it-works"]["1440"].words;
    assert.equal(today, 1333);
    const text = [
      howItWorksIntro.title,
      howItWorksIntro.lede,
      howItWorksIntro.meta,
      ...howSteps.flatMap((step) => [`${step.number} · ${step.name}`, step.title, plainText(step.body), step.caption]),
      designPrinciplesBand.title,
      designPrinciplesBand.intro,
      ...principles.flatMap((p) => [p.title, p.text, p.link?.label ?? ""]),
      outputsBand.title,
      outputsBand.intro,
      ...outputsBand.items.flatMap((item) => [item.label, item.title, item.text]),
      unseenBand.title,
      unseenBand.intro,
      ...cantSeeTopics,
      startSnippet.title,
      startSnippet.text,
      startSnippet.label,
      ...startSnippet.block.commands,
      startSnippet.link.text,
    ].join(" ");
    // Breadcrumb ("Home", "How it works") and the Copy button's label on top of the content's own words.
    const total = words(text) + 3 + 1;
    assert.ok(total <= today, `${total} words, ${today} before`);
  });

  test("five steps, each with a screenshot and a caption of at most 15 words in sentence case", () => {
    assert.deepEqual(
      howSteps.map((step) => step.name),
      ["Explore", "Plan", "Approve", "Run", "Report"],
    );
    for (const step of howSteps) {
      assert.ok(words(step.caption) <= 15, `${step.name}: caption of ${words(step.caption)} words`);
      assert.match(step.caption, /^[A-Z0-9]/, `${step.name}: caption starts with a capital`);
      assert.notEqual(step.caption, step.caption.toUpperCase(), `${step.name}: caption in capitals`);
    }
  });

  test("mono labels in capitals have at most 3 words; the meta line is sentence case", () => {
    for (const item of outputsBand.items) assert.ok(words(item.label) <= 3, item.label);
    assert.notEqual(howItWorksIntro.meta, howItWorksIntro.meta.toUpperCase());
    assert.match(howItWorksIntro.meta, /Kennel, a pet-sitting booking page/, "Kennel is defined at its first use");
  });

  test("section intros have at most 25 words (DESIGN.md §2.5, brand.md)", () => {
    for (const intro of [designPrinciplesBand.intro, outputsBand.intro, unseenBand.intro, startSnippet.text]) {
      assert.ok(words(intro) <= 25, `intro of ${words(intro)} words: ${intro}`);
    }
  });

  // The principles' cards and sentences are content/claims.ts's (node G3), not this page's own copy: left out here.
  test("the outputs' cards: titles of at most 5 words, bodies of at most 22 (brand.md)", () => {
    const cards = outputsBand.items.map((item) => ({ title: item.title, body: item.text }));
    for (const card of cards) {
      assert.ok(words(card.title) <= 5, `${words(card.title)} words: ${card.title}`);
      assert.ok(words(card.body) <= 22, `${card.title}: body of ${words(card.body)} words`);
    }
  });

  test("every sentence of the page's own copy has at most 25 words (brand.md)", () => {
    const copy = [
      howItWorksIntro.lede,
      howItWorksIntro.meta,
      ...howSteps.flatMap((step) => [step.title, plainText(step.body), step.caption]),
      designPrinciplesBand.intro,
      outputsBand.intro,
      ...outputsBand.items.map((item) => item.text),
      unseenBand.intro,
      ...cantSeeTopics,
      startSnippet.text,
    ];
    for (const text of copy) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) assert.ok(words(sentence) <= 25, `${words(sentence)} words: ${sentence}`);
    }
  });

  test("the screenshots reveal as figures (media only) under the scroll runtime", () => {
    assert.match(pageSource, /<Figure[^>]*\breveal\b/, "the step screenshots are revealed Figures");
    assert.match(pageSource, /<MotionGate islands=\{\["scroll"\]\}/, "the page mounts the scroll runtime");
  });
});
