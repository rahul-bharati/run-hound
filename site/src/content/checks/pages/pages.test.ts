// The check pages' modules (content/checks/pages/<id>.ts, DESIGN.md §3.6, §5.4 C1 and C2): their shape, their budgets,
// and that everything they say about a run is the run's. The page shows the check's featured finding from the run
// extracts (content/runs/*.json) verbatim, so the fix it shows is the report's; a module's own words may not invent a
// number, a step or an evidence item. Reads ../app/src/checks (each check's source), so it runs in `pnpm test` on a
// full checkout, never in the build.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { askPrompt, extractsText, featuredFinding, pageFinding } from "@/components/checks/run-evidence";
import { builtInChecks } from "@/content/checks/data";
import { hasRoute, route, type RouteId } from "@/content/routes";
import { ui } from "@/content/ui";
import * as accessibility from "./accessibility";
import * as features from "./features";
import { checkPage, checkPages as listed, checkPageSummaries } from "./index";
import * as security from "./security";
import type { CheckPage } from "./types";

/** The three group files (./accessibility.ts, ./features.ts, ./security.ts), one per node, so no two share a file. */
const groupFiles: readonly { group: string; expectedIds: readonly string[]; pages: readonly CheckPage[] }[] = [accessibility, features, security];

/**
 * The checks whose page must exist, from each group file's expectedIds. C1 wrote double-submit; C2a, C2b and C2c each
 * add their ids to their group file's expectedIds when they start (the design's "pages.test.ts cases for its ids,
 * failing until written"). E1 checks all 26 are there at release.
 */
const expectedIds: readonly string[] = groupFiles.flatMap((g) => g.expectedIds);

/** The modules as their type says (each module's own type is its literal value). */
const checkPages: readonly CheckPage[] = listed;

const appChecks = new URL("../../../../../app/src/checks/", import.meta.url);

/** The brief's word pattern, as the lab and check-copy count words. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu;
const wordCount = (text: string) => text.match(WORD)?.length ?? 0;

const builtIn = (id: string) => builtInChecks.find((c) => c.id === id);

/** Every string of content/ui.ts: shared template words, which may repeat on every check page (§3.6). */
function uiStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(uiStrings);
  return [];
}
const shared = new Set(uiStrings(ui).map((s) => normalise(s)));

/** A sentence as the repetition rule compares it: lower case, single spaces, no closing punctuation. */
function normalise(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").replace(/[.!?:;,]+$/, "").trim();
}

/** The page's prose, as a reader sees it (the Playwright test and the evidence listings are code, not prose). */
function prose(page: CheckPage): string[] {
  const finding = pageFinding(page);
  const check = builtIn(page.id);
  const related = page.related.map((id) => builtIn(id)?.question ?? "");
  return [
    check?.name ?? "",
    page.lede,
    ...page.steps.flatMap((s) => [s.label, s.line]),
    page.notCounted,
    finding.title,
    finding.meaning,
    finding.impact,
    finding.location ?? "",
    ...page.evidence.map((e) => e.caption),
    page.reproduce,
    finding.fix,
    ...page.background.flatMap((b) => [b.label, b.why]),
    ...page.limits,
    ...related,
  ].filter(Boolean);
}

/** The words a module writes itself, where an invented number would hide. */
function ownWords(page: CheckPage): string[] {
  return [
    page.lede,
    ...page.steps.map((s) => s.line),
    page.notCounted,
    ...page.evidence.map((e) => e.caption),
    ...page.evidence.flatMap((e) => (e.alt ? [e.alt] : [])),
    page.reproduce,
    ...page.background.map((b) => b.why),
    ...page.limits,
  ];
}

/** Sentences of 8 or more words that appear on 3 or more pages (content/ui.ts strings left out). */
function repeatedSentences(pages: readonly { id: string; text: readonly string[] }[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const block of page.text) {
      for (const raw of block.split(/(?<=[.!?])\s+/)) {
        const sentence = normalise(raw);
        if (wordCount(sentence) < 8 || shared.has(sentence)) continue;
        seen.set(sentence, (seen.get(sentence) ?? new Set()).add(page.id));
      }
    }
  }
  return [...seen].filter(([, ids]) => ids.size >= 3).map(([sentence]) => sentence);
}

/** The numbers in a text: "29.8", "3", "320". */
const numbersIn = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) ?? [];

/**
 * How many steps a page shows, given how many the run recorded: 3 to 6, or every one of them when the run recorded
 * fewer than 3 (security-headers and cookie-flags record 1, credential-fields 2). Never none: a run that recorded no
 * step can't back a step trail.
 */
function stepRange(recorded: number): { min: number; max: number } {
  return { min: Math.max(1, Math.min(3, recorded)), max: 6 };
}

describe("the check pages that exist", () => {
  test("every expected check has a page, each listed once, in the hub's order", () => {
    const ids: string[] = checkPages.map((p) => p.id);
    for (const id of expectedIds) assert.ok(ids.includes(id), `no page module for ${id}`);
    assert.equal(new Set(ids).size, ids.length, "a check is listed twice");
    const order = builtInChecks.map((c) => c.id);
    for (const id of ids) assert.ok(order.includes(id), `${id} is not a built-in check`);
    assert.deepEqual(ids, [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)), "not in the hub's order");
  });

  test("every page is registered as check-<id> at /checks/<id>/, named like its check, promising #reproduce", () => {
    assert.equal(checkPageSummaries.length, checkPages.length);
    for (const summary of checkPageSummaries) {
      const id = `check-${summary.id}`;
      assert.ok(hasRoute(id), `${id} is not in the registry`);
      const r = route(id as RouteId);
      assert.equal(r.path, `/checks/${summary.id}/`);
      assert.equal(r.title, builtIn(summary.id)?.name);
      assert.equal(r.description, checkPage(summary.id)?.description);
      assert.ok(r.anchors.includes("reproduce"), `${id} doesn't promise #reproduce`);
      assert.equal(r.schema.article?.headline, builtIn(summary.id)?.name, `${id}: the TechArticle's headline is the h1`);
    }
  });

  test("each group file lists only its group's checks, and index.ts lists them all, group by group", () => {
    const groups = groupFiles.map((g) => g.group);
    assert.deepEqual(groups, [...new Set(builtInChecks.map((c) => c.group))], "one file per group, in the hub's order");
    for (const g of groupFiles) {
      for (const p of g.pages) assert.equal(builtIn(p.id)?.group, g.group, `${p.id} is not a ${g.group} check`);
      for (const id of g.expectedIds) assert.equal(builtIn(id)?.group, g.group, `${id} is expected in ${g.group}`);
    }
    assert.deepEqual(
      checkPages.map((p) => p.id),
      groupFiles.flatMap((g) => g.pages.map((p) => p.id)),
    );
  });

  test("a module per listed page, named after its check", () => {
    for (const page of checkPages) {
      assert.ok(existsSync(new URL(`./${page.id}.ts`, import.meta.url)), `content/checks/pages/${page.id}.ts`);
    }
  });
});

for (const page of checkPages) {
  describe(`/checks/${page.id}/`, () => {
    const check = builtIn(page.id);
    // A check's public module, plus its implementation folder when it has one (checks/<id>/).
    const folder = new URL(`${page.id}/`, appChecks);
    const source = [
      readFileSync(new URL(`${page.id}.ts`, appChecks), "utf8"),
      ...(existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(new URL(f, folder), "utf8")) : []),
    ].join("\n");
    const featured = featuredFinding(page.id);

    test("the meta description is 70 to 160 characters, and no other page's", () => {
      assert.ok(page.description.length >= 70 && page.description.length <= 160, `${page.description.length} characters`);
      assert.equal(checkPages.filter((p) => p.description === page.description).length, 1);
    });

    test("the lede is at most 45 words", () => {
      assert.ok(wordCount(page.lede) <= 45, `${wordCount(page.lede)} words`);
      assert.ok(wordCount(page.lede) >= 12, "a lede says what goes wrong and why");
    });

    test("the typical severity is one the check's source assigns", () => {
      assert.match(source, new RegExp(`"${page.severity}"`), `${page.id}.ts never says "${page.severity}"`);
    });

    test("the page shows the run's featured finding, or says it has none", () => {
      if (featured) {
        assert.equal(page.noEvidence, undefined, "a featured finding exists: its texts come from the run extract, not the module");
      } else {
        assert.ok(page.noEvidence, "no featured finding in either extract: the module needs noEvidence texts from the check's source");
        for (const text of Object.values(page.noEvidence)) assert.ok(source.includes(text.slice(0, 40)), `not from ${page.id}.ts: ${text}`);
      }
    });

    test("the fix is the extract's verbatim, and Copy copies what to ask", () => {
      const finding = pageFinding(page);
      if (featured) {
        assert.equal(finding.fix, featured.finding.fix);
        assert.equal(finding.meaning, featured.finding.meaning);
        assert.equal(finding.impact, featured.finding.impact);
        assert.equal(finding.title, featured.finding.title);
      }
      const { before, prompt, after } = askPrompt(finding.fix);
      assert.equal(`${before}${prompt}${after}`, finding.fix, "the split loses nothing");
      assert.ok(prompt.trim().length > 20, "a prompt worth copying");
    });

    test("the steps are the run's own labels, in the run's order, each with one line", () => {
      assert.ok(featured, "no featured finding, so no recorded steps");
      const recorded = featured.scenario?.steps ?? [];
      const { min, max } = stepRange(recorded.length);
      assert.ok(page.steps.length >= min && page.steps.length <= max, `${page.steps.length} steps (${recorded.length} recorded)`);
      let at = -1;
      for (const step of page.steps) {
        const i = recorded.indexOf(step.label, at + 1);
        assert.ok(i > at, `"${step.label}" is not a step the run recorded after the one before it (${recorded.join(" | ")})`);
        at = i;
        assert.ok(wordCount(step.line) >= 5 && wordCount(step.line) <= 25, `"${step.line}"`);
      }
      assert.equal(page.steps.at(-1)?.label, recorded.at(-1), "the last step is the one that decides");
    });

    test("the evidence is the featured finding's, captioned in at most 15 words, pictures described", () => {
      assert.ok(featured);
      assert.ok(page.evidence.length >= 1 && page.evidence.length <= 4);
      const items = featured.finding.evidence ?? [];
      for (const e of page.evidence) {
        const item = items.find((x) => x.label === e.label);
        assert.ok(item, `no evidence "${e.label}" on ${featured.finding.id}`);
        assert.ok(wordCount(e.caption) <= 15, `caption "${e.caption}"`);
        assert.match(e.caption, /^[A-Z0-9“"]/, `sentence case: "${e.caption}"`);
        if (item.kind === "gif" || item.kind === "frame") {
          assert.ok(item.asset, `${e.label}: no copied picture`);
          assert.ok(e.alt && wordCount(e.alt) >= 5, `${e.label}: a picture needs alt text`);
        }
      }
    });

    test("1 to 3 background links from OWASP, WCAG, CWE, MDN or the IETF, each with a line", () => {
      assert.ok(page.background.length >= 1 && page.background.length <= 3);
      const hosts = /^https:\/\/(?:[\w-]+\.)*(?:owasp\.org|w3\.org|cwe\.mitre\.org|developer\.mozilla\.org|ietf\.org|rfc-editor\.org)\//;
      for (const b of page.background) {
        assert.match(b.href, hosts, b.href);
        assert.ok(wordCount(b.why) >= 5 && wordCount(b.why) <= 25, `"${b.why}"`);
      }
    });

    test("2 to 4 limits, and a line on what isn't counted", () => {
      assert.ok(page.limits.length >= 2 && page.limits.length <= 4);
      assert.ok(wordCount(page.notCounted) >= 5);
    });

    test("2 to 4 related checks: other built-in checks, each once, shown as their questions", () => {
      assert.ok(page.related.length >= 2 && page.related.length <= 4);
      assert.equal(new Set(page.related).size, page.related.length);
      for (const id of page.related) {
        assert.notEqual(id, page.id);
        assert.ok(builtIn(id)?.question, `${id} is not a built-in check with a question`);
      }
    });

    test("300 to 800 words on the page", () => {
      const words = wordCount(prose(page).join(" "));
      assert.ok(words >= 300 && words <= 800, `${words} words`);
    });

    test("every number the module writes is the run's, the check source's or its data line's", () => {
      const known = [extractsText(), source, check?.line ?? "", check?.records ?? ""].join("\n");
      for (const text of ownWords(page)) {
        for (const n of numbersIn(text)) assert.ok(known.includes(n), `"${n}" in "${text}" isn't in the run, ${page.id}.ts or its data`);
      }
    });

    test("no sentence over 25 words", () => {
      for (const text of ownWords(page)) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) assert.ok(wordCount(sentence) <= 25, `"${sentence}"`);
      }
    });
  });
}

describe("no sentence of 8 or more words on 3 or more check pages (§3.6)", () => {
  test("the rule finds a sentence repeated on three pages, and leaves two and content/ui.ts alone", () => {
    const long = "This sentence has well over eight words in it, so it counts.";
    const text = (extra: string) => [long, "Short one.", extra];
    assert.deepEqual(repeatedSentences([{ id: "a", text: text("") }, { id: "b", text: text("") }]), []);
    assert.deepEqual(repeatedSentences([{ id: "a", text: text("") }, { id: "b", text: text("") }, { id: "c", text: text("") }]), [
      normalise(long),
    ]);
    const template = "No finding from the test apps is shown here yet";
    assert.ok(wordCount(template) >= 8);
    assert.deepEqual(repeatedSentences(["a", "b", "c"].map((id) => ({ id, text: [template] }))), []);
  });

  test("the check pages repeat none", () => {
    assert.deepEqual(repeatedSentences(checkPages.map((p) => ({ id: p.id, text: prose(p) }))), []);
  });
});

describe("stepRange: how many steps a page shows", () => {
  test("3 to 6, or every recorded step when the run recorded fewer than 3, and never none", () => {
    assert.deepEqual(stepRange(1), { min: 1, max: 6 });
    assert.deepEqual(stepRange(2), { min: 2, max: 6 });
    assert.deepEqual(stepRange(3), { min: 3, max: 6 });
    assert.deepEqual(stepRange(5), { min: 3, max: 6 });
    assert.deepEqual(stepRange(13), { min: 3, max: 6 });
    assert.deepEqual(stepRange(0), { min: 1, max: 6 });
  });
});

describe("askPrompt: what Copy copies from a fix", () => {
  test("the quoted request after 'Ask your AI or developer:', and the whole text otherwise", () => {
    assert.deepEqual(askPrompt('Ask your AI or developer: "Disable the button while saving."'), {
      before: 'Ask your AI or developer: "',
      prompt: "Disable the button while saving.",
      after: '"',
    });
    assert.deepEqual(askPrompt("Ask your AI: “Add HttpOnly.”"), { before: "Ask your AI: “", prompt: "Add HttpOnly.", after: "”" });
    assert.deepEqual(askPrompt("Add a Content-Security-Policy header."), { before: "", prompt: "Add a Content-Security-Policy header.", after: "" });
  });
});
