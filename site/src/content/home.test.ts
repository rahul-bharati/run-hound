// The homepage's words (DESIGN.md §3.1): every block within its word budget and the page within the 750 gate, "and N
// more" counted from the checks data, every example a built-in check with a link to its page, the pill short and
// internal, captions of at most 15 words, the test excerpt readable, and no count or release typed into home.ts.
// check-copy.mjs counts the built page the same way in `pnpm build`; the lab (home.spec.mjs) measures it in a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { checkHref } from "@/components/checks/links";
import { builtInChecks, previewGroups } from "@/content/checks/data";
import { commands } from "@/content/commands";
import { excerptWidth, heroRun, kennelEvidence } from "@/content/hero-run";
import { bandIndex, bandOrder, home, type HomeBlockKey } from "@/content/home";
import { ui } from "@/content/ui";
import { route, routes } from "@/content/routes";
import { href } from "@/lib/nav";
import { site } from "@/lib/site";

/** The brief's word regex (readability.md), as check-copy.mjs and the lab count. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu;
const words = (text: string) => (text.match(WORD) ?? []).length;

/** Fields that never reach the page as visible text: link targets, ids, icons and what only screen readers get. */
const unseen = new Set(["href", "id", "icon", "srOnly", "alt", "anchor", "check", "n"]);

/** Every string a block shows: its values, walked, leaving out the unseen fields. */
function shown(value: unknown, key = ""): string[] {
  if (unseen.has(key)) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => shown(v));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => shown(v, k));
  return [];
}

/** The words the primitives add to a block: Copy per command, Replay in the hero. */
const primitiveWords: Partial<Record<HomeBlockKey, number>> = { hero: words(ui.replay) + 1, start: 1 };

/** §3.1's word budgets per block, and the page's gate and build target. */
const budgets: Record<HomeBlockKey, number> = { hero: 118, why: 50, how: 118, checks: 115, aiBuilt: 120, trust: 100, start: 105, close: 25 };
const gate = 750;
const target = 735;

const blockWords = (key: HomeBlockKey) => words(shown(home[key]).join(" ")) + (primitiveWords[key] ?? 0);

describe("word budgets (§3.1)", () => {
  for (const key of Object.keys(budgets) as HomeBlockKey[]) {
    test(`${key}: at most ${budgets[key]} words`, () => {
      const n = blockWords(key);
      assert.ok(n <= budgets[key], `${key} has ${n} words`);
    });
  }

  test(`the page: at most ${gate} words (build target ${target})`, () => {
    const total = (Object.keys(budgets) as HomeBlockKey[]).reduce((sum, key) => sum + blockWords(key), 0);
    assert.ok(total <= target, `${total} words`);
  });

  test("the blocks are the eight of §3.1, in order", () => {
    assert.deepEqual(Object.keys(home), ["hero", "why", "how", "checks", "aiBuilt", "trust", "start", "close"]);
  });
});

describe("the copy rules (docs/brand.md)", () => {
  const headings = [home.why.title, home.how.title, home.checks.title, home.aiBuilt.title, home.trust.title, home.start.title, `${home.close.title.lead} ${home.close.title.key}`];

  test("seven h2s, each at most 8 words", () => {
    assert.equal(headings.length, 7);
    for (const h2 of headings) assert.ok(words(h2) <= 8, h2);
  });

  test("intros at most 25 words; sentences at most 25", () => {
    assert.ok(words(home.aiBuilt.intro) <= 25, home.aiBuilt.intro);
    for (const text of shown(home)) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) assert.ok(words(sentence) <= 25, sentence);
    }
  });

  test("captions: at most 15 words, in sentence case", () => {
    const captions = [home.hero.caption, home.how.proof.page.caption, home.how.proof.requests.caption, home.how.proof.test.caption];
    for (const caption of captions) {
      assert.ok(words(caption) <= 15, `${words(caption)}: ${caption}`);
      assert.match(caption, /^[A-Z][^A-Z]*(?:Kennel[^A-Z]*)?$/, `sentence case: ${caption}`);
    }
  });

  test("the subhead says free, open-source and your machine; 32 words or fewer", () => {
    assert.match(home.hero.subhead, /\bfree\b/);
    assert.match(home.hero.subhead, /open-source/);
    assert.match(home.hero.subhead, /on your machine/);
    assert.ok(words(home.hero.subhead) <= 32);
  });

  test("the h1 is three phrases, the last in accent", () => {
    assert.deepEqual(home.hero.h1, ["Find the bugs", "your AI forgot", "to test."]);
  });
});

describe("the hero (§3.1 block 0)", () => {
  test(`the pill: one line of at most 46 characters, internal`, () => {
    assert.ok(home.hero.pill.label.length <= 46, `${home.hero.pill.label.length}: ${home.hero.pill.label}`);
    assert.match(home.hero.pill.href, /^\/[^/]/);
    assert.equal(home.hero.pill.href, href("docs-safety", "isolated-browser"));
    assert.ok(home.hero.pill.label.startsWith(`New in ${site.version}:`));
  });

  test("Try it locally goes to the quick start; the secondary button to GitHub, shown as GitHub on phones", () => {
    assert.equal(home.hero.primary.href, href("docs-quick-start"));
    assert.equal(home.hero.primary.href, "/docs/quick-start/");
    assert.equal(home.hero.primary.label, site.cta);
    assert.equal(home.hero.secondary.href, site.github);
    assert.ok(home.hero.secondary.label.includes(home.hero.secondary.short), "the accessible name contains the visible label");
  });

  test("the command is the one pull-and-run line; its hint links the Start band", () => {
    assert.equal(home.hero.command, commands.pullAndRun);
    assert.equal(home.start.command, commands.pullAndRun);
    assert.equal(home.hero.hint.link.href, `#${home.start.id}`);
  });

  test("the proof strip: four facts, each a link to its proof", () => {
    assert.deepEqual(
      home.hero.proof.map((p) => p.label),
      [`${builtInChecks.length} checks, all open source`, "Runs on your machine", "AI off by default", "A Playwright test per finding"],
    );
    assert.deepEqual(
      home.hero.proof.map((p) => p.href),
      [href("checks"), href("docs-safety"), href("docs-ai"), href("check-double-submit", "reproduce")],
    );
  });
});

describe("the checks band (§3.1 block 3)", () => {
  const ids = new Set(builtInChecks.map((c) => c.id));

  test("three groups in the checks data's order, counted from it", () => {
    assert.deepEqual(
      home.checks.groups.map((g) => [g.name, g.count]),
      previewGroups.map((g) => [g.group, g.checks.length]),
    );
    assert.equal(home.checks.title, `${builtInChecks.length} checks: accessibility, features and security`);
  });

  test("each example names exactly one built-in check of its group, with its plain label and a link to its page", () => {
    for (const group of home.checks.groups) {
      const data = previewGroups.find((g) => g.group === group.name)!;
      assert.equal(group.examples.length, 4, group.name);
      for (const example of group.examples) {
        assert.ok(ids.has(example.check), `${example.check} is a built-in check`);
        const check = data.checks.find((c) => c.id === example.check);
        assert.ok(check, `${example.check} is in ${group.name}`);
        assert.equal(example.label, check.plain);
        assert.equal(example.href, checkHref(example.check));
        assert.equal(Boolean(example.tag), Boolean(check.signedIn), `${example.check}: tagged Signed in exactly when it needs sign-in`);
      }
    }
  });

  test('"and N more" is the group count minus its distinct example ids, linked to the group on /checks/', () => {
    for (const group of home.checks.groups) {
      const data = previewGroups.find((g) => g.group === group.name)!;
      const distinct = new Set(group.examples.map((e) => e.check)).size;
      assert.equal(group.more.n, data.checks.length - distinct, group.name);
      assert.equal(group.more.label, `and ${data.checks.length - distinct} more`);
      assert.equal(group.more.href, href("checks", data.anchor));
    }
    assert.deepEqual(home.checks.groups.map((g) => g.more.n), [2, 4, 8]);
  });

  test("the examples are §3.1's", () => {
    assert.deepEqual(
      home.checks.groups.map((g) => g.examples.map((e) => e.check)),
      [
        ["keyboard-completion", "focus-visible", "error-announcement", "reflow-320"],
        ["persistence", "double-submit", "silent-failure", "client-only-validation"],
        ["access-control", "write-access", "paywall-trust", "bundle-secrets"],
      ],
    );
  });
});

describe("the evidence trio's test excerpt", () => {
  test(`every line at most ${excerptWidth} characters`, () => {
    assert.equal(excerptWidth, 58);
    for (const line of kennelEvidence.test.lines) assert.ok(line.length <= excerptWidth, line);
  });
});

describe("links and ids", () => {
  test("the kept and new band ids of §3.1 are there", () => {
    assert.deepEqual(
      [home.why.id, home.how.id, home.checks.id, home.aiBuilt.id, home.trust.id, home.start.id],
      ["why", "see-it-run", "checks", "ai-built-apps", "safety", "start"],
    );
    assert.equal(home.aiBuilt.cards.find((c) => c.id)?.id, "signed-in");
    assert.equal(home.trust.items.find((c) => c.id)?.id, "ai");
  });

  const hrefs: string[] = [];
  const walk = (value: unknown, key = "") => {
    if (key === "href" && typeof value === "string") hrefs.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  walk(home);
  const internal = hrefs.filter((link) => link.startsWith("/"));
  const bandIds = new Set(Object.values(home).flatMap((block) => ("id" in block ? [block.id] : [])));

  test("every internal link is a page in the registry (content/routes.ts), every other one a band here or off the site", () => {
    assert.ok(hrefs.length >= 30, `${hrefs.length} links`);
    for (const link of hrefs) {
      if (link.startsWith("#")) assert.ok(bandIds.has(link.slice(1)), `${link} is a band of the homepage`);
      else if (!link.startsWith("/")) assert.match(link, /^https:\/\//, link);
    }
    for (const link of internal) {
      assert.match(link, /^\/([a-z0-9-]+\/)*(#[a-z0-9-]+)?$/, link);
      const [path] = link.split("#");
      assert.ok(routes.some((r) => r.path === path), `${link}: ${path} is a registered page`);
    }
    assert.ok(route("docs-quick-start"));
  });

  // Fragments the pages have but their registry entries don't promise yet (entries in content/routes/, not this node's
  // files): /checks/ has the three group sections (id="group-…") but promises only the cards, and /open-source/ has
  // #license, #stability and #how-to-help but promises only #roadmap, so resolveTarget() takes the fallbacks
  // (#contributing for How to help, #roadmap for the release). A fragment outside this list that the registry doesn't
  // promise fails now; the two TODO tests still run, and fail for real once the entries promise these anchors.
  const knownGaps = [
    "/checks/#group-accessibility",
    "/checks/#group-features",
    "/checks/#group-security",
    "/open-source/#license",
    "/open-source/#contributing",
    "/open-source/#roadmap",
  ];
  const unpromised = [
    ...new Set(
      internal.filter((link) => {
        const [path, fragment] = link.split("#");
        return fragment !== undefined && !routes.find((r) => r.path === path)!.anchors.includes(fragment);
      }),
    ),
  ];
  const openSource = routes.find((r) => r.id === "open-source")!;
  const checksHub = routes.find((r) => r.id === "checks")!;
  const pending =
    ["license", "stability", "how-to-help"].some((a) => !openSource.anchors.includes(a)) ||
    ["group-accessibility", "group-features", "group-security"].some((a) => !checksHub.anchors.includes(a))
      ? "blocked: content/routes/project.ts must promise #license, #stability and #how-to-help, content/routes/checks.ts the three #group-… anchors"
      : undefined;

  test("no fragment on an internal link is unpromised by its page's registry entry, beyond the known gaps", () => {
    for (const link of unpromised) assert.ok(knownGaps.includes(link), `${link}: its page's registry entry doesn't promise it`);
  });

  test("every fragment on an internal link is an anchor its page's registry entry promises", { todo: pending }, () => {
    assert.deepEqual(unpromised, []);
  });

  test("the Start band: How to help and the release go to §3.1's targets on /open-source/", { todo: pending }, () => {
    assert.equal(home.start.links.find((l) => l.label === "How to help")!.href, "/open-source/#how-to-help");
    assert.equal(home.start.facts.at(-1)!.href, "/open-source/#stability");
    assert.equal(home.start.facts[0].href, "/open-source/#license");
  });

  test("the band labels count from bandOrder: 02 to 07 of 07, in page order", () => {
    assert.deepEqual(bandOrder, ["why", "how", "checks", "aiBuilt", "trust", "start"]);
    assert.deepEqual(
      bandOrder.map((key) => bandIndex(key)),
      [2, 3, 4, 5, 6, 7].map((n) => ({ n, total: 7 })),
    );
    // Every band in the order is a block of the page, in the page's own order.
    const keys = Object.keys(home);
    assert.deepEqual([...bandOrder], keys.filter((k) => (bandOrder as readonly string[]).includes(k)));
  });
});

describe("no count or release typed into home.ts", () => {
  const source = readFileSync(new URL("./home.ts", import.meta.url), "utf8");
  // Code only: comments may explain where a number comes from.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const literals = [...code.matchAll(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0].replace(/\$\{[^}]*\}/g, " "));

  test("no release literal", () => {
    for (const literal of literals) assert.doesNotMatch(literal, /\b\d+\.\d+\.\d+\b/, literal);
    assert.doesNotMatch(code, new RegExp(site.version.replace(/\./g, "\\.")));
    assert.doesNotMatch(code, new RegExp(site.released));
  });

  test("no count from the checks data or the run", () => {
    const counts = new Set([
      builtInChecks.length,
      ...previewGroups.map((g) => g.checks.length),
      ...previewGroups.map((g) => g.checks.length - 4),
      heroRun.fieldCount,
      heroRun.progress.total,
      heroRun.progress.seconds,
      heroRun.plan.more,
    ]);
    for (const literal of literals) {
      // A sourced statistic ("2,000+", "5,600") is one number, not a count of ours.
      for (const [number] of literal.matchAll(/\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\b/g)) {
        if (number.includes(",")) continue;
        assert.ok(!counts.has(Number(number)), `${number} in ${literal}: fill it in from the data`);
      }
      assert.doesNotMatch(literal, new RegExp(`\\b${heroRun.finding.gapMs}\\b`), literal);
    }
  });
});
