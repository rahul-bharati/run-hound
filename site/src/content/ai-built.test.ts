// Unit tests for content/ai-built.ts: the AI-built apps page's metadata and structured data. `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const ai = await import("@/content/ai-built");
const { aiBuiltIntro, aiBuiltJsonLd, aiBuiltPage, aiBuiltSections, coverage, discovery, setUpSteps } = ai;
const { routeGraph } = await import("@/lib/structured-data");
const { plainText } = await import("@/content/how-it-works");
const { route } = await import("@/content/routes");

const base = "https://run-hound.example";

describe("ai-built apps", () => {
  test("the title names the builders, and the description fits a search snippet", () => {
    assert.match(aiBuiltPage.title, /Lovable, Bolt and v0/);
    assert.ok(`${aiBuiltPage.title} · ${site.name}`.length <= 60);
    assert.ok(aiBuiltPage.description.length <= 155, `${aiBuiltPage.description.length} characters`);
  });

  test("says what discovery covers, never every form (docs/brand.md)", () => {
    assert.match(coverage, /up to 5 forms/);
    assert.doesNotMatch(coverage, /every form/i);
  });

  test("the structured data is a WebPage dated by the release, and its breadcrumb", () => {
    const [page, breadcrumb, ...rest] = aiBuiltJsonLd()["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "WebPage");
    assert.equal(page.url, `${base}/ai-built-apps/`);
    assert.equal(page.name, `${aiBuiltPage.title} · ${site.name}`);
    assert.equal(page.dateModified, site.releasedIso);
    assert.equal(breadcrumb["@id"], `${base}/ai-built-apps/#breadcrumb`);
  });

  test("the structured data is the registry's (routeGraph): one source, as on /how-it-works/ and /demo/", () => {
    assert.deepEqual(aiBuiltJsonLd(), routeGraph("ai-built-apps"));
  });
});

// DESIGN.md §3.11 (node F2): the search landing page for Lovable, Bolt and v0 apps.
const siteDir = fileURLToPath(new URL("../../", import.meta.url));
const pageSource = readFileSync(`${siteDir}src/app/ai-built-apps/page.tsx`, "utf8");
const vibe = /vibe-coded/gi;
const count = (text: string) => (text.match(vibe) ?? []).length;
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;

describe("ai-built apps: the landing page (§3.11)", () => {
  test("“vibe-coded” once in the first paragraph and in one h2; never in the title, the h1 or the description", () => {
    assert.equal(count(aiBuiltIntro.lede), 1, "the first paragraph");
    assert.equal(aiBuiltSections.filter((s) => count(s.title) > 0).length, 1, "one h2");
    assert.equal(aiBuiltSections.reduce((n, s) => n + count(s.title), 0), 1, "once in that h2");
    for (const text of [aiBuiltPage.title, aiBuiltIntro.title, aiBuiltPage.description, route("ai-built-apps").title, route("ai-built-apps").description]) {
      assert.equal(count(text), 0, text);
    }
    // No other copy on the page says it: the section intros, the steps and the discovery facts.
    const rest = [
      ...aiBuiltSections.map((s) => s.intro),
      ...setUpSteps.flatMap((step) => [step.title, plainText(step.text)]),
      ...discovery.facts.map((f) => `${f.term} ${f.value}`),
      ...discovery.finds.map(plainText),
      coverage,
    ].join(" ");
    assert.equal(count(rest), 0);
    assert.doesNotMatch(pageSource, /vibe-coded/i, "the page writes no copy of its own");
  });

  test("the h1 is the title; h2s have at most 8 words and intros at most 25", () => {
    assert.equal(aiBuiltIntro.title.replace(/\.$/, ""), aiBuiltPage.title);
    for (const s of aiBuiltSections) {
      assert.ok(words(s.title) <= 8, `${s.id}: h2 of ${words(s.title)} words`);
      assert.ok(words(s.intro) <= 25, `${s.id}: intro of ${words(s.intro)} words`);
    }
  });

  test("the sections keep their ids and gain #discovery, the old /docs/#ai-built", () => {
    const ids = aiBuiltSections.map((s) => s.id);
    for (const id of ["handles", "discovery", "set-up", "signed-in", "limits", "fernway"]) assert.ok(ids.includes(id as (typeof ids)[number]), id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(pageSource, new RegExp(`"${id}"`), `the page renders #${id}`);
  });

  test("#discovery states the app's own limits: 5 forms, 3 dialog buttons, 40 controls outside forms (20 clicked)", () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const discover = readFileSync(`${repo}app/src/engine/discover.ts`, "utf8");
    const pageControls = readFileSync(`${repo}app/src/checks/page-controls.ts`, "utf8");
    const forms = Number(/const MAX_FORMS = (\d+);/.exec(discover)?.[1]);
    const openers = Number(/export const MAX_OPENERS = (\d+);/.exec(discover)?.[1]);
    const controls = Number(/const controls = els\.slice\(0, (\d+)\)/.exec(discover)?.[1]);
    const clicked = Number(/export const MAX_PAGE_CONTROLS = (\d+);/.exec(pageControls)?.[1]);
    assert.deepEqual([forms, openers, controls, clicked], [5, 3, 40, 20], "the app's constants moved; update the page");
    assert.deepEqual(
      discovery.facts.map((f) => f.limit),
      [forms, openers, controls],
    );
    for (const fact of discovery.facts) assert.match(fact.value, new RegExp(`\\b${fact.limit}\\b`), fact.term);
    assert.match(discovery.facts[2].value, new RegExp(`clicks ${clicked}\\b`));
    assert.match(coverage, new RegExp(`up to ${forms} forms.*up to ${openers} buttons.*up to ${controls} controls.*clicks ${clicked}`));
  });

  test("Set up leads with exporting the app and running it locally, then host.docker.internal", () => {
    const [first, second] = setUpSteps.map((step) => `${step.title} ${plainText(step.text)}`);
    assert.match(first, /^1\. Export your app's code and run it locally/);
    assert.doesNotMatch(first, /host\.docker\.internal/);
    assert.match(second, /host\.docker\.internal/);
    assert.match(aiBuiltSections.find((s) => s.id === "set-up")!.intro, /Export the code, start it locally/);
  });
});

// The copy rules (brand.md) on the page's own words, and the set-up's code blocks tied to their steps by name.
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);
/** The page's running text in reading order. The hero's buttons name where they go, so they are left out. */
const pageCopy: string[] = [
  aiBuiltIntro.lede,
  ...aiBuiltSections.flatMap((s) => [s.title, s.intro]).slice(0, 2),
  ...ai.handles.flatMap((h) => [h.title, h.card]),
  ...ai.handlesFigures.map((f) => f.caption),
  ...aiBuiltSections.filter((s) => s.id === "discovery").flatMap((s) => [s.title, s.intro]),
  ...discovery.facts.flatMap((f) => [f.term, f.value]),
  ...discovery.finds.map(plainText),
  ...aiBuiltSections.filter((s) => s.id === "set-up").flatMap((s) => [s.title, s.intro]),
  ...setUpSteps.flatMap((step) => [step.title, plainText(step.text)]),
  plainText(ai.nextConfigNote),
  ai.otherSetUps.hostNetwork.title,
  plainText(ai.otherSetUps.hostNetwork.text),
  ai.otherSetUps.source.title,
  plainText(ai.otherSetUps.source.text),
  plainText(ai.otherSetUps.limits),
  ...ai.problems.flatMap((p) => [p.see, p.means]),
  ...aiBuiltSections.filter((s) => s.id === "signed-in").flatMap((s) => [s.title, s.intro]),
  ...ai.signedIn.paragraphs.map(plainText),
  ...aiBuiltSections.filter((s) => s.id === "limits").flatMap((s) => [s.title, s.intro]),
  ...ai.limits,
  ...aiBuiltSections.filter((s) => s.id === "fernway").flatMap((s) => [s.title, s.intro]),
  plainText(ai.fernwayTry.hint),
];

describe("ai-built apps: the copy rules (brand.md)", () => {
  test("every sentence on the page has at most 25 words", () => {
    for (const text of pageCopy) {
      for (const sentence of sentences(text)) assert.ok(words(sentence) <= 25, `${words(sentence)} words: ${sentence}`);
    }
  });

  test("cards: titles of at most 5 words, bodies of at most 22", () => {
    const cards = [
      ...ai.handles.map((h) => ({ title: h.title, body: h.card })),
      ...discovery.facts.map((f) => ({ title: f.term, body: f.value })),
    ];
    for (const card of cards) {
      assert.ok(words(card.title) <= 5, `${words(card.title)} words: ${card.title}`);
      assert.ok(words(card.body) <= 22, `${card.title}: body of ${words(card.body)} words`);
    }
    for (const title of [ai.otherSetUps.hostNetwork.title, ai.otherSetUps.source.title]) assert.ok(words(title) <= 5, title);
  });

  test("captions have at most 15 words, in sentence case", () => {
    for (const { caption } of ai.handlesFigures) {
      assert.ok(words(caption) <= 15, `${words(caption)} words: ${caption}`);
      assert.match(caption, /^[A-Z0-9“]/, caption);
    }
  });

  test("Fernway is defined at its first use in the page's running text", () => {
    const first = pageCopy.flatMap(sentences).find((sentence) => /Fernway/.test(sentence));
    assert.match(first ?? "", /Fernway(?::|,| is) (?:a small SaaS app|a test app built|built the way AI)/, `first use: ${first}`);
  });

  test("the set-up's code blocks are tied to their steps by name, never by position", () => {
    assert.deepEqual(
      setUpSteps.map((step) => step.extra ?? null),
      [null, "configs", "run", null],
    );
    assert.match(pageSource, /step\.extra === "configs"/);
    assert.match(pageSource, /step\.extra === "run"/);
    assert.doesNotMatch(pageSource, /\bi === \d/, "a code block tied to a step's index");
  });
});
