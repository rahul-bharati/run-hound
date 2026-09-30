// Tests for docs/brand.md (`pnpm test`): the brand guide must not drift from what Run Hound ships or from the rules the
// site is built to (docs/decisions/09-2026.md#2026-09-27-brand-copy-and-motion-rules: Voice's copy rules, Palette's
// accent budget, Logo's line hound and the Motion section). It reads ../docs/brand.md and the check ids in
// ../app/src/core/types.ts, so it runs on a full checkout (CI), never in the Docker build, whose context is site/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";

const repo = join(import.meta.dirname, "..", "..");
const brand = readFileSync(join(repo, "docs", "brand.md"), "utf8");
// The app's own list of checks; type-only imports, so Node loads it by stripping the types.
const { CHECK_IDS, V2_CHECK_IDS } = await import(pathToFileURL(join(repo, "app", "src", "core", "types.ts")).href);

/** The text of the `## <heading>` section up to the next h2, or undefined when there is none. */
function section(heading) {
  const lines = brand.split("\n");
  const start = lines.findIndex((line) => line === `## ${heading}` || line.startsWith(`## ${heading} `));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** A top-level bullet that starts with `- **<label>**`, its wrapped lines included, as one line of text. */
function bullet(text, label) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`- **${label}**`));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !/^\s+\S/.test(line));
  return [lines[start], ...rest.slice(0, end < 0 ? undefined : end)].map((line) => line.trim()).join(" ");
}

/** Whether `text` names check `id`: in backticks, or as a whole hyphenated word (`write-access`, not `persistence`). */
const names = (text, id) =>
  text.includes(`\`${id}\``) || (id.includes("-") && new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text));

/** The Voice section's "Shipped vs planned" bullet, split where it introduces what isn't built. */
const PLANNED_MARKER = "only for what isn't built:";
function shippedAndPlanned() {
  const voice = section("Voice");
  assert.ok(voice !== undefined, "brand.md has a ## Voice section");
  const text = bullet(voice, "Shipped vs planned.");
  assert.ok(text, 'Voice keeps its "- **Shipped vs planned.**" bullet');
  const at = text.indexOf(PLANNED_MARKER);
  assert.ok(at >= 0, `the Shipped vs planned bullet introduces the planned list with "${PLANNED_MARKER}"`);
  // The list runs to the end of its sentence: a parenthesized stage abbreviation such as "(V3)" or "(V4)" holds no
  // full stop followed by a space, so the split must not stop there.
  const planned = text.slice(at + PLANNED_MARKER.length).split(/\.(?:\s|$)/)[0];
  assert.ok(planned.trim().length > 0, "the planned list is not empty");
  return { shipped: text.slice(0, at), planned };
}

describe("docs/brand.md", () => {
  test("the planned list names no check that Run Hound ships", () => {
    const { planned } = shippedAndPlanned();
    assert.ok(CHECK_IDS.length >= 27, "app/src/core/types.ts lists the checks");
    assert.deepEqual(
      CHECK_IDS.filter((id) => names(planned, id)),
      [],
      `these ids are in CHECK_IDS (shipped) but brand.md still lists them as planned: "${planned.trim()}"`,
    );
  });

  test("every V2 check is named as shipped, and write-access and paywall-trust as shipped in 0.6.0", () => {
    const { shipped } = shippedAndPlanned();
    assert.deepEqual(
      V2_CHECK_IDS.filter((id) => !names(shipped, id)),
      [],
      "every id in V2_CHECK_IDS is named in the shipped part of the Shipped vs planned bullet",
    );
    const at = shipped.indexOf("0.6.0");
    assert.ok(at >= 0, "the shipped part names the 0.6.0 release");
    for (const id of ["write-access", "paywall-trust"]) {
      assert.ok(names(shipped.slice(at), id), `\`${id}\` is named as shipped in 0.6.0`);
    }
  });

  test("a Motion section covers the site, the local UI and reports, and points to the tokens", () => {
    const motion = section("Motion");
    assert.ok(motion !== undefined, "brand.md has a ## Motion section");
    // The coverage lives in "Where it moves": one bullet each, not words that the intro or a path already holds.
    const where = motion.split("### Where it moves")[1]?.split("\n### ")[0];
    assert.ok(where, "Motion has a Where it moves subsection");
    for (const label of ["The site:", "The local web UI", "Reports"]) {
      assert.ok(where.includes(`- **${label}`), `Where it moves covers ${label}`);
    }
    assert.ok(motion.includes("`site/src/styles/tokens.css`"), "it points to the tokens file, the only copy of the numbers");
    assert.match(motion, /180 ms or less may be removed/, 'short colour and opacity changes "may be removed" under reduced motion');
    assert.doesNotMatch(motion, /may stay/, 'the old "may stay" wording is gone');
    assert.match(motion, /[Tt]ext never moves/, "text never moves (rule 2)");
  });

  test("Motion names the local UI's live updates and the arrow nudge", () => {
    const motion = section("Motion");
    assert.ok(motion !== undefined, "brand.md has a ## Motion section");
    const rule = (n) => motion.split("\n").find((line) => line.startsWith(`${n}. `)) ?? "";
    // app/src/server/ui/client.ts runLive: each new live.jpg frame is swapped into the Browser preview, and the elapsed
    // clock ticks once a second (setInterval), with or without reduced motion.
    const localUi = bullet(motion.split("### Where it moves")[1] ?? "", "The local web UI");
    assert.ok(localUi, 'Where it moves has a "- **The local web UI**" bullet');
    assert.match(localUi, /Browser preview/, "the local UI bullet lists the Browser preview's live frames");
    assert.match(localUi, /elapsed time/, "the local UI bullet lists the elapsed clock");
    assert.match(rule(9), /live view of the page[^\n]*elapsed clock/, "rule 9 lists the live view and the elapsed clock");
    assert.doesNotMatch(rule(10), /Nothing counts up\./, "rule 10 leaves room for a live clock");
    // Rule 2's feedback exception: the arrow in a button, an arrow link or the release pill nudges on hover and focus.
    assert.match(rule(2), /--motion-nudge/, "rule 2 allows the arrow nudge");
    // The scrubbed pipeline is on the homepage, not on /how-it-works/, which only gets figure reveals.
    for (const n of [1, 4]) assert.match(rule(n), /pipeline in the homepage's How it works band/, `rule ${n} puts the pipeline on the homepage`);
    assert.doesNotMatch(motion, /the How it works pipeline/, "no rule places the pipeline on a page named How it works");
  });

  test("Palette sets the accent budget", () => {
    const palette = section("Palette");
    assert.ok(palette !== undefined, "brand.md has a ## Palette section");
    assert.match(
      palette,
      /at most \**one strong accent object\**[^\n]*at rest|at rest[^\n]*at most \**one strong accent object/i,
      "the accent budget: at most one strong accent object per view at rest",
    );
    assert.match(palette, /[Ee]xempt/, "the budget names its exempt uses");
    // As the lab's accent audit counts them (site/scripts/lab/lib/audits.mjs): status marks are exempt only inside a
    // product figure, never on their own on the page.
    assert.match(palette, /status marks inside a product figure/, "status marks are exempt only inside a product figure");
    // The site header's active link underline, the docs sidebar's current-page rule and the filled current ring of the
    // docs "On this page" trail mark where the reader is, so they are exempt.
    assert.match(palette, /header's active underline/, "the budget exempts the current-page markers of navigation");
    assert.match(palette, /current ring of a docs page's "On this page" trail/, 'the budget exempts the "On this page" ring');
    // A tick is dim only as a bullet (the proof strip, a facts line); the checks band's ticks stay accent.
    assert.match(
      palette,
      /tick used as a bullet[^\n]*is `dim`[^\n]*accent ticks mark a pass or a check[^\n]*checks band/,
      "bullet ticks are dim, and ticks that mark a pass or a check stay accent",
    );
    // audits.mjs scans `main *` only, skipping links and buttons.
    assert.match(palette, /counts the rest inside `<main>`/, "the budget says the lab counts inside <main> only");
  });

  test("Logo sets the line-hound rule and keeps the mark still", () => {
    const logo = section("Logo");
    assert.ok(logo !== undefined, "brand.md has a ## Logo section");
    assert.match(logo, /line hound[^\n]*at most once per page/i, "the line hound appears at most once per page");
    assert.match(logo, /\bnever recolou?r\b/i, "the mark is never recoloured");
    assert.match(logo, /\bnever animate\b/i, "the mark is never animated");
  });

  test("Voice carries the copy rules", () => {
    const voice = section("Voice");
    assert.ok(voice !== undefined, "brand.md has a ## Voice section");
    const rules = [
      ["headings are statements", /[Hh]eadings are statements/],
      // The rule itself, not the Copy rules intro's "warns on an h2 over 8 words".
      ["an h2 has at most 8 words", /\bh2 has at most 8 words\b/],
      // Each limit is matched in its own rule's words, so a changed number fails even when another line of Voice holds
      // the old one (the Uppercase bullet also says "a mono label of at most 3 words may be a heading").
      ["a section intro has at most 25 words", /\bsection intro has at most 25 words\b/],
      ["a card title has at most 5 words and its body at most 22", /\bcard title has at most 5 words, and its body at most 22\b/],
      ["sentences of at most 20 words, never over 25", /[Ss]entences\W+have at most 20 words and never more than 25\b/],
      ["captions in sentence case with at most 15 words", /[Cc]aptions\W+are in sentence case and have at most 15 words\b/],
      ["uppercase only for mono labels of at most 3 words", /[Uu]ppercase\W+only for mono labels of at most 3 words\b/],
      ["Kennel and Fernway defined once", /Kennel[^\n]*Fernway[^\n]*\bonce\b/],
      ['a "Preview" tag instead of release labels', /"Preview"[^\n]*release/],
      ['"vibe-coded" is a secondary term', /"[Vv]ibe-coded"[^\n]*secondary term/],
    ];
    assert.deepEqual(
      rules.filter(([, pattern]) => !pattern.test(voice)).map(([rule]) => rule),
      [],
      "every copy rule is in Voice",
    );
  });

  test("the copy rules allow the release lines and uppercase labels the site shows", () => {
    const voice = section("Voice");
    assert.ok(voice !== undefined, "brand.md has a ## Voice section");
    const releases = bullet(voice, "Where stages and releases appear.");
    assert.ok(releases, 'Voice keeps its "- **Where stages and releases appear.**" bullet');
    // The phone menu's release chip, and the meta lines of docs pages and check pages.
    for (const place of ["Changelog · v0.6.0", "For release 0.6.0", "Checked against release 0.6.0"]) {
      assert.ok(releases.includes(place), `the release may appear as "${place}"`);
    }
    // site/src/components/site-footer.tsx sets its column h2s in mono uppercase (`headingClass`).
    const uppercase = bullet(voice, "Uppercase");
    assert.ok(uppercase, 'Voice keeps its "- **Uppercase**" bullet');
    assert.match(uppercase, /mono label of at most 3 words may be a heading/, "a short mono label may be a heading");
    // Mono labels are uppercase only when they have at most 3 words; longer ones keep their case.
    assert.match(section("Type") ?? "", /uppercase only when they have at most 3 words/, "Type limits uppercase mono labels");
  });
});

// docs/launch-spec.md §7 ("Roadmap wording"): "0.9.9 is the npx release" and "1.0.0 completes V4" are retired wording
// (2026-09-30-launch-at-0-6-5 supersedes 2026-09-26-npx-release-is-0-9-9 and, in part, 2026-09-21-stages-are-feature-
// sets: npx is 0.6.3, the public launch is 0.6.5, and 1.0.0 is the release that refactors the app code so it is
// maintainable — the V0-V4 stages no longer decide when 1.0.0 comes). A test fails if that wording comes back in any
// page or document a reader could see it on. The decision log itself (DECISIONS.md, docs/decisions/09-2026.md) is
// exempt: it is append-only history and describes, by name, the wording it retires.
describe("no stale roadmap wording (docs/launch-spec.md §7)", () => {
  const FORBIDDEN = /0\.9\.9|completes V4|release that completes V4|planned:\s*1\.0\.0/;

  /** Every string in a JSON-like value (a module namespace included: its own enumerable properties are its exports). */
  function strings(value, path = "$") {
    if (typeof value === "string") return [[path, value]];
    if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
    return [];
  }

  /** Asserts none of `text`'s strings (or `text` itself, for a document) match FORBIDDEN. */
  function checkNoDrift(name, text) {
    const hits = (typeof text === "string" ? [["$", text]] : strings(text)).filter(([, s]) => FORBIDDEN.test(s));
    assert.deepEqual(hits, [], `${name} still has the old roadmap wording (0.9.9 next / 1.0.0 completes V4): ${JSON.stringify(hits)}`);
  }

  test("README.md and docs/roadmap.md", () => {
    checkNoDrift("README.md", readFileSync(join(repo, "README.md"), "utf8"));
    checkNoDrift("docs/roadmap.md", readFileSync(join(repo, "docs", "roadmap.md"), "utf8"));
  });

  test("docs/brand.md", () => {
    checkNoDrift("docs/brand.md", brand);
  });

  test("the site's roadmap note, FAQ, compare and checks data", async () => {
    const openSource = await import("@/content/open-source");
    const faq = await import("@/content/faq");
    const compare = await import("@/content/compare");
    const checksData = await import("@/content/checks/data");
    checkNoDrift("open-source.ts roadmapNote", openSource.roadmapNote);
    checkNoDrift("faq.ts", { ...faq });
    checkNoDrift("compare.ts", { ...compare });
    checkNoDrift("checks/data.ts", { ...checksData });
  });

  // Imported instead of read as source (like README.md above): route.ts imports a .tsx component (check-card, for
  // isShipped), which node --test's lightweight loader can't compile (test-hooks.mjs doesn't handle JSX), only .ts.
  // Its own text, including the hard-coded Roadmap section, is scanned as source instead; the data it renders from
  // (faqGroups, categories, roadmapNote) is already covered above.
  test("/llms-full.txt's route", () => {
    checkNoDrift("app/llms-full.txt/route.ts", readFileSync(new URL("../src/app/llms-full.txt/route.ts", import.meta.url), "utf8"));
  });
});
