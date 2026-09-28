// content/claims.ts: statements several pages make, each list written once, so pages can't drift apart (inventory:
// two principles lists of 3 and 4 items, two "what a browser can't see" lists of 5 and 4, and the AI data-flow
// sentence in several places). `pnpm test` (node:test, scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { aiDataFlow, cantSee, cantSeeChecklist, cantSeeTopics, principles, principlesInShort } from "@/content/claims";
import { faqItems } from "@/content/faq";
import { routes } from "@/content/routes";
import { resolveTarget } from "@/lib/nav";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const siteDir = new URL("../../", import.meta.url).pathname;
const srcDir = join(siteDir, "src");
const repo = join(siteDir, "..");
const own = join(srcDir, "content", "claims.ts");

/** A comment's line breaks, so a line number still points at its line. */
const keepLines = (comment: string) => comment.replace(/[^\n]/g, "");

/** The code without its comments. */
const withoutComments = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, keepLines)
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, keepLines)
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

/** Text as a reader gets it from JSX or a string: entities decoded, {" "} a space, whitespace collapsed. */
const normal = (text: string) =>
  text
    .replace(/\{"\s*"\}/g, " ")
    .replace(/&apos;|&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** A list of claims declared in code: a variable named for one, or an object key holding an array. */
const declaration = /\b(?:const|let|var)\s+(principles\w*|cantSee\w*|notVisible\w*|aiDataFlow\w*)\b|\b(principles|cantSee|notVisible)\s*:\s*\[/;

/** A word as the copy budgets count it (the brief's regex). */
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;

/** Every sentence of every claim, of 6 words or more: a name ("Database backups") may appear anywhere, a claim once. */
const sentences = [
  ...principles.flatMap((p) => [p.title, p.text]),
  ...principlesInShort.flatMap((p) => [p.title, p.text]),
  ...cantSee.flatMap((c) => [c.topic, c.checklist?.name ?? "", c.checklist?.line ?? ""]),
  aiDataFlow,
]
  .flatMap((text) => text.split(/(?<=[.;?!])\s+/))
  .map((s) => normal(s).trim())
  .filter((s) => words(s) >= 6);

describe("each claim list is written once, in content/claims.ts", () => {
  const files = sourceFiles(srcDir, ["ts", "tsx", "md", "mdx"]).filter((file) => file !== own);
  const texts = files.map((file) => ({ name: relative(srcDir, file), code: withoutComments(readFileSync(file, "utf8")) }));

  test("no other file declares a list of principles, of what a browser can't see, or the AI data-flow sentence", () => {
    assert.ok(texts.length > 50, `found ${texts.length} source files; has the walk stopped matching?`);
    const found = texts.flatMap(({ name, code }) => (declaration.test(code) ? [`${name}: ${code.match(declaration)?.[0]}`] : []));
    assert.deepEqual(found, []);
  });

  test("no other file repeats a sentence of one (a page reads it from content/claims.ts)", () => {
    assert.ok(sentences.length >= 12, `${sentences.length} claim sentences; has the split stopped matching?`);
    const found = texts.flatMap(({ name, code }) => {
      const text = normal(code);
      return sentences.filter((s) => text.includes(s)).map((s) => `${name}: "${s.slice(0, 70)}…"`);
    });
    assert.deepEqual(found, []);
  });

  test("the checks find a list declared elsewhere and a copied sentence", () => {
    assert.ok(declaration.test("const principles = [\n  { title: \"x\" },\n];"));
    assert.ok(declaration.test("const notVisible: string[] = [];"));
    assert.ok(declaration.test("export const data = { cantSee: [] };"));
    assert.ok(!declaration.test('import { cantSeeChecklist as notVisible } from "@/content/claims";'));
    const copied = normal(`<li>\n  With AI on, ${aiDataFlow.replace("page structure", "page\n      structure")}.\n</li>`);
    assert.ok(sentences.some((s) => copied.includes(s.replace(/\.$/, ""))));
  });
});

/**
 * The AI data flow, however it is worded: "redacted page structure" or "the redacted structure of the page". The
 * sentence test above only finds a word-for-word copy; this finds a page that says it its own way.
 */
const dataFlow = /\bredacted\s+(?:page\s+structure|structure\s+of\s+the\s+page)\b/i;

/**
 * The files that may state the data flow in their own words, and who removes each entry. Everything else says it with
 * aiDataFlow. Files under src/, as sourceFiles() walks them.
 */
const statesDataFlow: Record<string, string> = {
  // The privacy policy lists everything that is sent, precisely (brand.md: legal pages stay precise). Stays (F3).
  "app/(legal)/privacy/page.tsx": "the whole data flow, as the privacy policy must state it",
  // The AI section's full list of what is sent (the page title and path, field labels, …). D1 rebuilds llms-full.txt
  // from the MDX text; the entry stays while the file lists what is sent.
  "app/llms-full.txt/route.ts": "the full list of what is sent",
  // The docs' "What is sent" list moves to the AI page (below); D1 replaces this one-page docs with the hub, and the
  // safety section's short form becomes aiDataFlow. D1 removes this entry's reason by deleting the file's text.
  "app/docs/page.tsx": "the one-page docs, until D1 replaces it with the hub",
  // Where the docs' "What is sent" list lands in the docs split (§3.5 Optional AI): the full list, like the privacy
  // policy. D1 writes it.
  "content/docs/ai.mdx": "the AI page's full list of what is sent",
  // The old homepage's AI section; P1 deletes the old home components.
  "components/home/ai.tsx": "the old homepage, until P1 deletes it",
};

/**
 * The entries that hold only while their file still has the old text they were made for: once D1 or P1 removes it, a
 * new file at that path (the docs hub, a new home component) says the data flow with aiDataFlow like every other file.
 */
const whileOldText: Record<string, string> = {
  // The one-page docs' "What is sent" list, which moves to content/docs/ai.mdx.
  "app/docs/page.tsx": "a local model also gets the redacted address with its query",
  // The old homepage's plan-review step.
  "components/home/ai.tsx": "With Review with AI ticked, the model reads the redacted page structure",
};

describe("the AI data flow has one short form, aiDataFlow", () => {
  const files = sourceFiles(srcDir, ["ts", "tsx", "md", "mdx"]).filter((file) => file !== own);
  /** A file's text as a reader gets it: comments and tags out, entities decoded, whitespace collapsed. */
  const readable = (file: string) => normal(withoutComments(readFileSync(file, "utf8")).replace(/<[^>]+>/g, " "));

  /** Whether a file may state the data flow in its own words: listed, and for an old file, still with its old text. */
  const mayState = (name: string, text: string) => name in statesDataFlow && (!(name in whileOldText) || text.includes(whileOldText[name]));

  test("outside content/claims.ts, only the files that list the whole data flow state it in their own words", () => {
    assert.ok(files.length > 50, `found ${files.length} source files; has the walk stopped matching?`);
    const found = files
      .map((file) => ({ name: relative(srcDir, file), text: readable(file) }))
      .filter(({ name, text }) => !mayState(name, text) && dataFlow.test(text))
      .map(({ name }) => name);
    assert.deepEqual(found, [], "say it with aiDataFlow from content/claims.ts");
  });

  test("an entry made for an old file lapses with its old text, so a new file at that path gets no exemption", () => {
    // A wrong old text fails the test above while the old file states the data flow; a lapsed entry is E1's to prune.
    assert.ok(Object.keys(whileOldText).every((name) => name in statesDataFlow), "each is an entry of statesDataFlow");
    assert.ok(!mayState("components/home/ai.tsx", "Your model reads the redacted structure of the page."), "a new home component");
    assert.ok(!mayState("app/docs/page.tsx", "Only redacted page structure goes to your model."), "the docs hub");
    assert.ok(mayState("app/(legal)/privacy/page.tsx", "only redacted page structure"), "the privacy policy stays");
  });

  test("inside content/claims.ts, every claim that states it uses aiDataFlow, but for principles[3] until F2's rewrite", () => {
    // principles[3] ("Only owned targets, safe by default.") is on /how-it-works/, whose text G3 may not change. Its
    // last sentence becomes `With AI on, ${aiDataFlow}, and a remote endpoint needs your consent first.` when How it
    // works is rewritten (a blocker for the orchestrator: claims.ts has no handover to F2).
    const exception = "With AI on, only redacted page structure is sent to your model, and a remote endpoint needs your consent first.";
    const claims = [
      ...principles.flatMap((p) => [p.title, p.text]),
      ...principlesInShort.flatMap((p) => [p.title, p.text]),
      ...cantSee.flatMap((c) => [c.topic, c.checklist?.name ?? "", c.checklist?.line ?? ""]),
    ].flatMap((text) => text.split(/(?<=[.;?!])\s+/));
    const ownWords = claims.filter((s) => dataFlow.test(s) && !s.includes(aiDataFlow));
    assert.deepEqual(ownWords.filter((s) => s !== exception), []);
    assert.ok(ownWords.length === 0 || principles[3].text.endsWith(exception), "the exception is principles[3]'s last sentence");
  });

  test("the pattern finds the data flow however it is worded, and a list of what is sent", () => {
    for (const text of [
      "only redacted page structure goes to the model you configure",
      "the model reads the redacted structure of the page",
      "only <strong>redacted page\n  structure</strong> is sent",
      aiDataFlow,
    ]) {
      assert.ok(dataFlow.test(normal(text.replace(/<[^>]+>/g, " "))), text);
    }
    assert.ok(!dataFlow.test("Reports redact secret-looking text."));
    assert.ok(Object.keys(statesDataFlow).every((name) => !name.startsWith("content/claims")));
  });
});

describe("the principles", () => {
  test("How it works shows four, each a statement with its reasons", () => {
    assert.equal(principles.length, 4);
    for (const p of principles) {
      assert.match(p.title, /^[A-Z].*\.$/, p.title);
      assert.ok(words(p.text) >= 12, p.title);
    }
  });

  test("a principle's link goes to a registered page", () => {
    for (const p of principles) if (p.link) assert.match(resolveTarget(p.link, routes), /^\/[a-z0-9/-]*$/);
    assert.ok(principles.some((p) => p.link), "one principle links How it compares");
  });

  test("the homepage's short form names three, and says what AI sees in the one data-flow sentence", () => {
    assert.equal(principlesInShort.length, 3);
    assert.ok(principlesInShort.some((p) => p.text.includes(aiDataFlow)));
  });
});

describe("what a browser can't see", () => {
  test("one entry for each item of the checklist every report ends with (app/src/engine/report.ts NOT_VISIBLE)", () => {
    const report = readFileSync(join(repo, "app", "src", "engine", "report.ts"), "utf8");
    const list = report.match(/export const NOT_VISIBLE: string\[\] = \[([\s\S]*?)\];/)?.[1];
    assert.ok(list, "the report's NOT_VISIBLE list");
    const items = [...list.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1]);
    assert.equal(items.length, 5, `the report lists ${items.length}`);
    assert.equal(cantSee.length, items.length);
  });

  test("each entry is the report's item in the same place: backups, webhooks, dependencies, monitoring, legal", () => {
    const report = readFileSync(join(repo, "app", "src", "engine", "report.ts"), "utf8");
    const list = report.match(/export const NOT_VISIBLE: string\[\] = \[([\s\S]*?)\];/)?.[1] ?? "";
    const items = [...list.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1]);
    const topics = [/backup/i, /webhook/i, /dependenc|lockfile/i, /monitoring/i, /legal/i];
    assert.equal(items.length, topics.length);
    topics.forEach((topic, i) => {
      assert.match(items[i], topic, `the report's item ${i + 1}`);
      assert.match(cantSee[i].topic, topic, `cantSee[${i}]`);
      if (cantSee[i].checklist) assert.match(`${cantSee[i].checklist?.name} ${cantSee[i].checklist?.line}`, topic, `cantSee[${i}].checklist`);
    });
  });

  test("How it works lists every topic; the checks page and llms-full.txt the ones with a name and a line", () => {
    assert.deepEqual(cantSeeTopics, cantSee.map((c) => c.topic));
    assert.deepEqual(cantSeeChecklist, cantSee.flatMap((c) => (c.checklist ? [c.checklist] : [])));
    assert.ok(cantSeeChecklist.length >= 4);
  });
});

describe("the AI data-flow sentence", () => {
  test("says only redacted page structure and finding text go to the model the reader chooses", () => {
    assert.match(aiDataFlow, /^only redacted page structure and finding text go to the model you choose$/);
  });

  test("is the FAQ's answer too", () => {
    assert.ok(faqItems.some((item) => item.a.some((a) => a.includes(aiDataFlow))));
  });
});
