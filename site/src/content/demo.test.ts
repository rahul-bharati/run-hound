// Unit tests for /demo/ (DESIGN.md §3.12, node F2): every finding links its check's page, the recordings play once and
// have a still, the ids the page had are kept, the captions keep the copy rules, and every planted-bug count is the
// fixtures' own. `pnpm test` (it reads ../fixtures, which the build never does); the built page is
// scripts/lab/specs/flat-b.spec.mjs's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const { builtInChecks } = await import("@/content/checks/data");
const { plainText } = await import("@/content/how-it-works");
const { resolveTarget } = await import("@/lib/nav");
const { routes } = await import("@/content/routes");
const demo = await import("@/content/demo");
const { checkPageLink, demoIntro, demoSections, fernwayBand, fernwayBugCount, kennelBugCount, kennelPlannedIds, planted, plantedBand, tryBand } = demo;

const siteDir = fileURLToPath(new URL("../../", import.meta.url));
const repoDir = fileURLToPath(new URL("../../../", import.meta.url));
const pageSource = readFileSync(`${siteDir}src/app/demo/page.tsx`, "utf8");

const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;
const findings = [...demoSections.flatMap((section) => section.findings), fernwayBand.finding];
/** Sentences as scripts/check-copy.mjs splits them. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);
/** A sentence that says what Fernway is (brand.md: a small SaaS app built the way AI app builders build apps). */
const definesFernway = /Fernway(?::|,| is) (?:a small SaaS app|a test app built|built the way AI)/;
/** The page's running text in reading order (buttons and link labels name where they go, so they are left out). */
const pageCopy: string[] = [
  demoIntro.lede,
  ...demoSections.flatMap((s) => [
    s.title,
    plainText(s.intro),
    ...s.findings.flatMap((f) => f.figures.map((fig) => fig.caption)),
    s.aside?.text ?? "",
  ]),
  tryBand.title,
  tryBand.intro,
  plainText(tryBand.labNext),
  plainText(tryBand.sourceText),
  fernwayBand.title,
  plainText(fernwayBand.intro),
  ...fernwayBand.points.map((point) => `${point.lead} ${plainText(point.text)}`),
  plainText(fernwayBand.enter),
  fernwayBand.app.caption,
  ...fernwayBand.finding.figures.map((fig) => fig.caption),
  plantedBand.title,
  plantedBand.intro,
  ...planted.flatMap((set) => [set.title, set.text]),
  plantedBand.note,
];

describe("/demo/ findings", () => {
  test("every finding is a built-in check, and links its page (or its card on /checks/ until the page exists)", () => {
    const builtIn = new Set(builtInChecks.map((c) => c.id));
    for (const finding of findings) {
      assert.ok(builtIn.has(finding.check), `${finding.check} is a built-in check`);
      const link = checkPageLink(finding.check);
      assert.equal(link.to, `check-${finding.check}`);
      const href = resolveTarget(link, routes);
      const page = routes.some((r) => r.id === `check-${finding.check}`);
      assert.equal(href, page ? `/checks/${finding.check}/` : `/checks/#${finding.check}`, finding.check);
    }
    // The page renders every finding through DemoFindingBlock, which ends each with “About this check” to that link.
    const block = readFileSync(`${siteDir}src/components/demo/finding.tsx`, "utf8");
    assert.match(block, /resolveTarget\(checkPageLink\(finding\.check\)\)/, "the finding block links its check's page");
    assert.match(block, /\{aboutCheck\}/, "each finding ends with “About this check”");
    const rendered = [...pageSource.matchAll(/<DemoFindingBlock\b[^>]*finding=\{([^}]+)\}/g)].map((m) => m[1]);
    assert.ok(rendered.includes("finding") && rendered.includes("first") && rendered.includes("fernwayBand.finding"), `findings rendered: ${rendered}`);
  });

  test("the ids the page had are kept, and each finding's check id is an id on the page", () => {
    const sectionIds = demoSections.map((s) => s.id);
    for (const id of ["features", "silent-failure", "accessibility", "security", "whole-page"]) assert.ok(sectionIds.includes(id), id);
    assert.equal(tryBand.id, "try");
    assert.equal(fernwayBand.id, "fernway");
    const ids = [...sectionIds, tryBand.id, fernwayBand.id, plantedBand.id, ...findings.map((f) => f.check).filter((c) => !sectionIds.includes(c))];
    assert.equal(new Set(ids).size, ids.length, `ids are unique: ${ids.join(", ")}`);
    for (const id of ["double-submit", "bundle-secrets", "pii-leak", "cors", "security-headers", "focus-visible", "access-control"]) {
      assert.ok(ids.includes(id), `#${id}`);
    }
  });

  test("captions have at most 15 words, in sentence case", () => {
    const captions = [...findings.flatMap((f) => f.figures.map((fig) => fig.caption)), fernwayBand.app.caption];
    for (const caption of captions) {
      assert.ok(words(caption) <= 15, `${words(caption)} words: ${caption}`);
      assert.match(caption, /^[A-Z0-9“]/, caption);
    }
  });

  test("h2s have at most 8 words, intros at most 25 (brand.md, §2.5); mono labels at most 3 words", () => {
    for (const title of [...demoSections.map((s) => s.title), tryBand.title, fernwayBand.title, plantedBand.title]) {
      assert.ok(words(title) <= 8, `${words(title)} words: ${title}`);
    }
    const intros: [string, string][] = [
      ...demoSections.map((s) => [s.id, plainText(s.intro)] as [string, string]),
      [tryBand.id, tryBand.intro],
      [fernwayBand.id, plainText(fernwayBand.intro)],
      [plantedBand.id, plantedBand.intro],
    ];
    for (const [id, intro] of intros) assert.ok(words(intro) <= 25, `#${id}: intro of ${words(intro)} words`);
    for (const set of planted) assert.ok(words(set.label) <= 3, set.label);
  });

  test("the planted-bug cards: titles of at most 5 words, bodies of at most 22 (brand.md)", () => {
    for (const set of planted) {
      assert.ok(words(set.title) <= 5, `${words(set.title)} words: ${set.title}`);
      assert.ok(words(set.text) <= 22, `${set.title}: body of ${words(set.text)} words`);
    }
  });

  test("every sentence on the page has at most 25 words (brand.md)", () => {
    for (const text of pageCopy) {
      for (const sentence of sentences(text)) assert.ok(words(sentence) <= 25, `${words(sentence)} words: ${sentence}`);
    }
  });

  test("Fernway is defined at its first use on the page (brand.md)", () => {
    const first = pageCopy.flatMap(sentences).find((sentence) => /Fernway/.test(sentence));
    assert.match(first ?? "", definesFernway, `first use: ${first}`);
  });

  test("the Fernway points read as one sentence with their lead, and #fernway links the AI-built apps page", () => {
    for (const point of fernwayBand.points) assert.doesNotMatch(`${point.lead} ${plainText(point.text)}`, /\s{2}|^\s|\s$/, point.lead);
    assert.ok(
      fernwayBand.links.some((link) => link.to.to === "ai-built-apps"),
      "#fernway links /ai-built-apps/",
    );
  });
});

describe("/demo/ recordings play once", () => {
  /** components/evidence.ts: each key's image file, from its imports. */
  const evidenceSource = readFileSync(`${siteDir}src/components/evidence.ts`, "utf8");
  const importOf = new Map([...evidenceSource.matchAll(/import (\w+) from "@\/assets\/evidence\/([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const entry = (key: string) => {
    const block = new RegExp(`\\b${key}: \\{\\s*src: (\\w+),(?:\\s*still: (\\w+),)?`).exec(evidenceSource);
    assert.ok(block, `components/evidence.ts has ${key}`);
    return { file: importOf.get(block[1]), still: block[2] ? importOf.get(block[2]) : undefined };
  };
  const pictures = findings.flatMap((f) => f.figures.map((fig) => fig.picture)).filter((p) => "evidence" in p);

  test("every GIF the page shows has no looping extension, and a still for reduced motion", () => {
    const gifs = pictures.map((p) => entry(p.evidence)).filter((e) => e.file?.endsWith(".gif"));
    assert.equal(gifs.length, 2, "the double-submit and silent-failure recordings");
    for (const gif of gifs) {
      const bytes = readFileSync(`${siteDir}src/assets/evidence/${gif.file}`).toString("latin1");
      assert.ok(bytes.startsWith("GIF8"), gif.file);
      for (const loop of ["NETSCAPE2.0", "ANIMEXTS1.0"]) assert.ok(!bytes.includes(loop), `${gif.file} carries ${loop}: it loops`);
      assert.ok(gif.still?.endsWith(".png"), `${gif.file} has a still`);
    }
  });
});

describe("/demo/ planted bugs are the fixtures' own", () => {
  type Bug = { id: string; version: string };
  const bugs = (app: string): Bug[] => JSON.parse(readFileSync(`${repoDir}fixtures/${app}/bugs.json`, "utf8")).bugs;

  test("each app's sets list exactly the bugs it builds today, each once", () => {
    for (const app of ["kennel", "fernway"] as const) {
      const listed = planted.filter((set) => set.app === app).flatMap((set) => set.groups.flatMap((g) => g.ids));
      const built = bugs(app).filter((b) => !(app === "kennel" && b.version === "V2")).map((b) => b.id);
      assert.equal(new Set(listed).size, listed.length, `${app}: an id listed twice`);
      assert.deepEqual([...listed].sort(), [...built].sort(), app);
    }
  });

  test("the counts the words give come from those lists", () => {
    assert.equal(kennelBugCount, 24);
    assert.equal(fernwayBugCount, bugs("fernway").length);
    assert.match(demoIntro.lede, new RegExp(`all ${kennelBugCount} of its planted bugs`));
    assert.ok(
      fernwayBand.points.some((point) => plainText(point.text).includes(`${fernwayBugCount} planted bugs`)),
      "the fernway-bugs count",
    );
    const planned = bugs("kennel").filter((b) => b.version === "V2").map((b) => b.id);
    assert.deepEqual([...kennelPlannedIds], planned);
    assert.match(plantedBand.note, new RegExp(`^.*${planned.length} more bugs`));
  });
});
