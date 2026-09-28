// The design tokens (site-design/DESIGN.md §2.1 layout, §2.2 type, §4.2 motion) live in src/styles/tokens.css, the
// only copy of the numbers: every token the design names exists there with its value, the three colour layers
// (brand palette → roles → Tailwind) keep today's Tailwind names, reduced motion collapses the motion distances and
// times, the names src/motion/ reads exist, and nothing turns on smooth scrolling (it animates focus scrolling too,
// brief §5.4). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { motionTokenNames } from "@/styles/motion-token-names";
import { type CssBlock, declarationsAt, parseCss, remTotal, resolveVar } from "@/styles/read-tokens";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const styles = new URL("./", import.meta.url).pathname;
const src = new URL("../", import.meta.url).pathname;
const tokensCss = readFileSync(`${styles}tokens.css`, "utf8");
const globalsCss = readFileSync(`${src}app/globals.css`, "utf8");

const tree = parseCss(tokensCss);
const theme = declarationsAt(tree, ["@theme"]);
const themeInline = declarationsAt(tree, ["@theme inline"]);
const themeStatic = declarationsAt(tree, ["@theme static"]);
const root = declarationsAt(tree, [":root"]);
const sm = declarationsAt(tree, ["@media (width >= 40rem)", ":root"]);
const lg = declarationsAt(tree, ["@media (width >= 64rem)", ":root"]);
const xl = declarationsAt(tree, ["@media (width >= 80rem)", ":root"]);
const reduce = declarationsAt(tree, ["@media (prefers-reduced-motion: reduce)", ":root"]);

/** Every custom property tokens.css defines anywhere, with the value it has at :root level (or the first one found). */
const everywhere = new Map<string, string>();
(function walk(block: CssBlock) {
  for (const [name, value] of block.declarations) if (name.startsWith("--") && !everywhere.has(name)) everywhere.set(name, value);
  block.children.forEach(walk);
})(tree);

/** Follows var() references through `at`, then the :root and @theme layers, to a literal value. */
const resolve = (value: string, at: Map<string, string>[] = [root]) => resolveVar(value, [...at, root, theme, themeInline, themeStatic]);

describe("tokens.css: layout (§2.1)", () => {
  test("breakpoints: 360 (the wordmark), 640 (sm), 1024 (lg), 1280 (xl)", () => {
    assert.equal(theme.get("--breakpoint-xs"), "22.5rem");
    assert.equal(theme.get("--breakpoint-sm"), "40rem");
    assert.equal(theme.get("--breakpoint-lg"), "64rem");
    assert.equal(theme.get("--breakpoint-xl"), "80rem");
  });

  test("container: max 1280 px; gutters 16 px, 24 px from 640, 72 px from 1024", () => {
    assert.equal(theme.get("--container-page"), "80rem");
    assert.equal(resolve(root.get("--gutter") ?? ""), "1rem");
    assert.equal(resolve(sm.get("--gutter") ?? "", [sm]), "1.5rem");
    assert.equal(resolve(lg.get("--gutter") ?? "", [lg]), "4.5rem");
  });

  test("grid: 12 columns from 1024 px, 24 px gap, 32 px from 1280", () => {
    assert.equal(root.get("--grid-columns"), "12");
    assert.equal(resolve(root.get("--grid-gap") ?? ""), "1.5rem");
    assert.equal(resolve(xl.get("--grid-gap") ?? "", [xl]), "2rem");
  });

  test("spacing scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 px (8 px base) and nothing else", () => {
    assert.equal(theme.get("--spacing"), "0.25rem");
    const scale = [...root.entries()].filter(([name]) => /^--space-\d+$/.test(name));
    assert.deepEqual(
      scale.map(([name, value]) => [name, value]),
      [
        ["--space-1", "0.25rem"],
        ["--space-2", "0.5rem"],
        ["--space-3", "0.75rem"],
        ["--space-4", "1rem"],
        ["--space-6", "1.5rem"],
        ["--space-8", "2rem"],
        ["--space-10", "2.5rem"],
        ["--space-12", "3rem"],
        ["--space-16", "4rem"],
        ["--space-20", "5rem"],
      ],
    );
  });

  test("band shell: padding-block 40 / 48 / 80 px, heading block ≤ 48 rem, body 24 / 32 / 48 px below the heading", () => {
    assert.equal(resolve(root.get("--band-pad") ?? ""), "2.5rem");
    assert.equal(resolve(sm.get("--band-pad") ?? "", [sm]), "3rem");
    assert.equal(resolve(lg.get("--band-pad") ?? "", [lg]), "5rem");
    assert.equal(theme.get("--container-heading"), "48rem");
    assert.equal(resolve(root.get("--band-gap") ?? ""), "1.5rem");
    assert.equal(resolve(sm.get("--band-gap") ?? "", [sm]), "2rem");
    assert.equal(resolve(lg.get("--band-gap") ?? "", [lg]), "3rem");
  });

  test("band index: a 40 px rule", () => {
    assert.equal(root.get("--band-index-rule"), "2.5rem");
  });

  test("measure: body text ≤ 66 ch, docs prose 70 ch", () => {
    assert.equal(theme.get("--container-measure"), "66ch");
    assert.equal(theme.get("--container-prose"), "70ch");
  });

  test("radii: 8 (chips, inputs, tags), 12 (buttons, code), 16 (cards, windows), 999 (pills)", () => {
    assert.equal(theme.get("--radius-chip"), "0.5rem");
    assert.equal(theme.get("--radius-control"), "0.75rem");
    assert.equal(theme.get("--radius-card"), "1rem");
    assert.equal(theme.get("--radius-pill"), "999px");
  });

  test("targets: 44 px for buttons and icon buttons, 36 px rows in lists and the footer", () => {
    assert.equal(theme.get("--spacing-target"), "2.75rem");
    assert.equal(theme.get("--spacing-target-row"), "2.25rem");
  });

  test("one anchor offset: header + 16 px (5 rem); header + the 48 px docs bar + 16 px (8 rem) on docs pages below 1024 px; 16 px where the bars are static", () => {
    // §3.5: the docs bar is 48 px and shows only below 1024 px (from 1024 the sidebar and an inline "On this page"
    // replace it), so the offset that counts the bar applies only there. (§2.1's "8.5 rem below 1280 px" can't hold
    // with a 48 px bar: 64 + 48 + 16 px is 8 rem.)
    assert.equal(root.get("--header-height"), "4rem");
    assert.equal(root.get("--docs-bar-height"), "3rem");
    assert.equal(root.get("--anchor-offset"), "calc(var(--header-height) + 1rem)");
    assert.equal(remTotal(root.get("--anchor-offset") ?? "", [root]), 5);
    const docs = declarationsAt(tree, ["@media (width < 64rem)", ":root:has([data-docs-bar])"]);
    assert.equal(docs.get("--anchor-offset"), "calc(var(--header-height) + var(--docs-bar-height) + 1rem)");
    assert.equal(remTotal(docs.get("--anchor-offset") ?? "", [docs, root]), 8);
    // §3.2, §3.5, §5.2: at max-height 30rem (320×256, 400% zoom) the header and the docs bar are static, so nothing
    // covers the top and the offset is the 16 px of breathing room alone, on docs pages too. The block comes after the
    // docs-bar one and its second selector is as specific, (0,2,0), so it wins there.
    const short = declarationsAt(tree, ["@media (max-height: 30rem)", ":root, :root:has([data-docs-bar])"]);
    assert.equal(remTotal(short.get("--anchor-offset") ?? "", [short, root]), 1);
    const order = tree.children.map((b) => b.prelude);
    assert.ok(order.lastIndexOf("@media (max-height: 30rem)") > order.lastIndexOf("@media (width < 64rem)"), "the static-bars offset must come after the docs-bar one");
    // Nowhere else: no other block sets the offset (from 1024 px the docs pages use the header's 5 rem).
    const setters: string[] = [];
    (function walk(block: CssBlock, path: string[]) {
      if (block.declarations.has("--anchor-offset")) setters.push(path.join(" "));
      for (const child of block.children) walk(child, [...path, child.prelude]);
    })(tree, []);
    assert.deepEqual(setters, [
      ":root",
      "@media (width < 64rem) :root:has([data-docs-bar])",
      "@media (max-height: 30rem) :root, :root:has([data-docs-bar])",
    ]);
  });
});

describe("tokens.css: type (§2.2)", () => {
  // [token, phone size, from sm, from xl, weight, leading, tracking]
  const steps: [string, string, string | null, string | null, string | null, string, string | null][] = [
    ["display-xl", "2.625rem", "3.75rem", "4.125rem", "800", "0.98", "-0.035em"],
    ["display-l", "2.125rem", "3rem", null, "800", "1.02", "-0.03em"],
    ["display-m", "1.875rem", "2.5rem", null, "700", "1.08", "-0.02em"],
    ["title", "1.125rem", "1.25rem", null, "600", "1.3", null],
    ["lead", "1.0625rem", "1.125rem", null, "400", "1.6", null],
    ["body", "0.9375rem", "1rem", null, "400", "1.6", null],
    ["small", "0.875rem", null, null, null, "1.5", null],
    ["mono", "0.75rem", null, null, "500", "1.5", "0.14em"],
    ["code", "0.8125rem", null, null, "500", "1.6", null],
  ];
  for (const [name, phone, fromSm, fromXl, weight, leading, tracking] of steps) {
    test(`--text-${name}: ${[phone, fromSm, fromXl].filter(Boolean).join(" → ")}`, () => {
      const token = themeInline.get(`--text-${name}`) ?? theme.get(`--text-${name}`);
      assert.ok(token, `--text-${name} is missing`);
      assert.equal(resolve(token), phone);
      if (fromSm) assert.equal(resolve(token, [sm]), fromSm);
      if (fromXl) assert.equal(resolve(token, [xl, sm]), fromXl);
      const sub = (key: string) => themeInline.get(`--text-${name}--${key}`) ?? theme.get(`--text-${name}--${key}`);
      if (weight) assert.equal(sub("font-weight"), weight);
      assert.equal(sub("line-height"), leading);
      if (tracking) assert.equal(sub("letter-spacing"), tracking);
    });
  }

  test("the eight steps (mono as --text-mono for labels and --text-code for code) and the tag size: no other --text-* token", () => {
    const names = [...new Set([...theme.keys(), ...themeInline.keys()])].filter((n) => /^--text-[\w-]+$/.test(n) && !n.includes("--", 2));
    assert.deepEqual(names.sort(), [...steps.map(([n]) => `--text-${n}`), "--text-tag"].sort());
    assert.equal(theme.get("--text-tag") ?? themeInline.get("--text-tag"), "0.6875rem");
  });

  test("the three faces stay Bricolage Grotesque, Geist and Geist Mono (next/font variables)", () => {
    assert.match(theme.get("--font-display") ?? "", /^var\(--font-bricolage\)/);
    assert.match(theme.get("--font-sans") ?? "", /^var\(--font-geist\)/);
    assert.match(theme.get("--font-mono") ?? "", /^var\(--font-geist-mono\)/);
  });
});

describe("tokens.css: motion (§4.2)", () => {
  test("durations and eases, in @theme static (always emitted, so src/motion/tokens.ts can read them)", () => {
    assert.deepEqual(Object.fromEntries(themeStatic), {
      "--transition-duration-micro": "120ms",
      "--transition-duration-short": "180ms",
      "--transition-duration-medium": "280ms",
      "--transition-duration-long": "450ms",
      "--ease-enter": "cubic-bezier(0.22, 1, 0.36, 1)",
      "--ease-exit": "cubic-bezier(0.3, 0, 0.8, 0.15)",
      "--ease-move": "cubic-bezier(0.2, 0, 0, 1)",
      "--ease-stamp": "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
  });

  test("distances and times on :root", () => {
    const expected = {
      "--motion-rise-sm": "8px",
      "--motion-rise-md": "16px",
      "--motion-nudge": "2px",
      "--motion-stagger": "40ms",
      "--motion-scan": "600ms",
      "--motion-draw": "900ms",
      "--motion-trace": "800ms",
      "--motion-hold": "3s",
      // §3.4, §4.3: the 2 px accent ring on a :target card fades out once in 600 ms (CSS only; src/motion/ doesn't read it).
      "--motion-ring": "600ms",
    };
    for (const [name, value] of Object.entries(expected)) assert.equal(root.get(name), value, name);
  });

  test("reduced motion collapses the rise, nudge, stagger, scan, draw, trace and ring tokens (the hold stays)", () => {
    assert.deepEqual(Object.fromEntries(reduce), {
      "--motion-rise-sm": "0px",
      "--motion-rise-md": "0px",
      "--motion-nudge": "0px",
      "--motion-stagger": "0ms",
      "--motion-scan": "0ms",
      "--motion-draw": "0ms",
      "--motion-trace": "0ms",
      "--motion-ring": "0ms",
    });
  });

  test("every name src/motion/ reads (styles/motion-token-names.ts) is defined in tokens.css", () => {
    const names = [...motionTokenNames.durations, ...motionTokenNames.eases, ...motionTokenNames.distances];
    assert.ok(names.length >= 16, "motion-token-names.ts lists too few names");
    for (const name of names) assert.ok(everywhere.has(name), `${name} is read by src/motion/ but not defined in tokens.css`);
    assert.deepEqual([...motionTokenNames.durations, ...motionTokenNames.eases].sort(), [...themeStatic.keys()].sort());
  });
});

describe("tokens.css: colour layers (§2, §2.3)", () => {
  // The Tailwind colour names the site used before the redesign: they keep their names and their values.
  const legacy: Record<string, string> = {
    bg: "#0a1014",
    "bg-deep": "#070b0e",
    surface: "#10171c",
    "surface-2": "#141d23",
    "surface-3": "#19242b",
    band: "#0c1318",
    stage: "#0e151a",
    line: "#1e2a31",
    "line-soft": "#172127",
    "line-strong": "#2a3841",
    fg: "#e9efec",
    muted: "#a7b4b0",
    dim: "#82918d",
    accent: "#5ee6a3",
    "accent-strong": "#7dedb6",
    "accent-ink": "#04150d",
    pass: "#5ee6a3",
    fail: "#ff6b6b",
    warn: "#f5b642",
    paper: "#f4f4f0",
    "paper-ink": "#1b1d21",
    "paper-muted": "#4a4e55",
    "paper-line": "#c9cac4",
    "paper-fail": "#b8392b",
  };

  test("every Tailwind colour keeps its name and value, through the roles (@theme inline → --rh-* → the palette)", () => {
    for (const [name, hex] of Object.entries(legacy)) {
      const utility = themeInline.get(`--color-${name}`);
      assert.ok(utility, `--color-${name} is missing from @theme inline`);
      assert.match(utility, /^var\(--rh-[\w-]+\)$/, `--color-${name} must point at a role`);
      const role = root.get(/^var\((--[\w-]+)\)$/.exec(utility)![1]);
      assert.ok(role, `${utility} is not defined on :root`);
      assert.match(role, /^var\(--(hound|paper)[\w-]*\)$/, `${utility} must point at the brand palette`);
      assert.equal(resolve(utility).toLowerCase(), hex, `--color-${name}`);
    }
  });

  test("the roles a light theme would redefine exist: accent as text, focus, and the app under test's action colour", () => {
    assert.equal(resolve("var(--rh-accent-text)").toLowerCase(), "#5ee6a3");
    assert.equal(resolve("var(--rh-focus)").toLowerCase(), "#5ee6a3");
    assert.equal(resolve(themeInline.get("--color-paper-action") ?? "").toLowerCase(), "#c2410c");
  });

  test("the palette layer holds literals only; the other layers only point at it", () => {
    for (const [name, value] of root) {
      if (/^--(hound|paper)(-|$)/.test(name)) assert.match(value, /^#[0-9a-f]{6}$/i, `${name} is not a literal colour`);
      if (/^--rh-/.test(name) && !/^--rh-text-/.test(name)) assert.match(value, /^var\(--/, `${name} is a literal; roles point at the palette`);
    }
    assert.ok([...themeInline].filter(([n]) => n.startsWith("--color-")).every(([, v]) => v.startsWith("var(--rh-")));
  });

  test("dark only: color-scheme dark, and no light theme block (decision 5)", () => {
    assert.match(globalsCss + tokensCss, /color-scheme:\s*dark/);
    assert.doesNotMatch(tokensCss, /prefers-color-scheme|data-theme/);
  });
});

describe("globals.css", () => {
  test("imports tailwindcss and the tokens", () => {
    assert.match(globalsCss, /@import\s+"tailwindcss";/);
    assert.match(globalsCss, /@import\s+"\.\.\/styles\/tokens\.css";/);
  });

  test("no smooth scrolling anywhere in src (it animates focus scrolling, brief §5.4)", () => {
    const css = [globalsCss, tokensCss].join("\n");
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /scroll-behavior:\s*smooth/);
    for (const file of sourceFiles(src)) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /scroll-smooth\b|scroll-behavior:\s*["']?smooth/, `${file} turns on smooth scrolling`);
    }
  });

  test("the anchor offset is applied once, as scroll-padding-top, never also as scroll-margin-top", () => {
    const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(css, /scroll-padding-top:\s*var\(--anchor-offset\)/);
    assert.doesNotMatch(css, /scroll-margin-top/);
    assert.equal((css.match(/scroll-padding-top/g) ?? []).length, 1);
  });

  test("the hold (§4.4): only [data-beat=late] inside an unready [data-motion], only with scripting and motion allowed, released at --motion-hold", () => {
    const css = globalsCss.replace(/\s+/g, " ");
    assert.match(
      css,
      /@media \(scripting: enabled\) and \(prefers-reduced-motion: no-preference\) \{ \[data-motion\]:not\(\[data-ready\]\) \[data-beat="late"\] \{ opacity: 0; animation: motion-fallback 0s var\(--motion-hold\) forwards; \} \}/,
    );
    assert.match(css, /@keyframes motion-fallback \{ to \{ opacity: 1; \} \}/);
  });

  test("the reduced-motion safety net stays (§4.5)", () => {
    const css = globalsCss.replace(/\s+/g, " ");
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation-duration: 0\.01ms !important;/);
  });

  test("print (§2.8): every motion part at its finished state; header, footer and the search trigger hidden; link URLs", () => {
    const print = declarationsAt(parseCss(globalsCss), ["@media print"]);
    const blocks = parseCss(globalsCss).children.filter((b) => b.prelude === "@media print").flatMap((b) => b.children);
    const rule = (selector: string) => blocks.find((b) => b.prelude === selector)?.declarations;
    assert.equal(print.size, 0);
    assert.deepEqual(Object.fromEntries(rule("[data-motion] *, [data-beat]") ?? []), {
      opacity: "1 !important",
      transform: "none !important",
      "stroke-dasharray": "none !important",
    });
    assert.equal(rule("body > header, body > footer, [data-search-trigger]")?.get("display"), "none !important");
    assert.match(rule('main a[href]:not([href^="#"])::after')?.get("content") ?? "", /attr\(href\)/);
  });

  test("no transition-all (it animates layout properties)", () => {
    assert.doesNotMatch(globalsCss + tokensCss, /transition:\s*all|transition-property:\s*all/);
  });

  describe("the primitives' text sizes are type tokens (§2.2: a page computing more than 9 sizes in <main> fails the lab)", () => {
    // The component classes of the primitives: the @layer components block that holds .btn.
    const layer = parseCss(globalsCss).children.find((b) => b.prelude === "@layer components" && b.children.some((c) => c.prelude === ".btn"));
    const rules: CssBlock[] = [];
    (function walk(block: CssBlock | undefined) {
      for (const child of block?.children ?? []) {
        rules.push(child);
        walk(child);
      }
    })(layer);
    const size = (selector: string) => rules.find((r) => r.prelude === selector)?.declarations.get("font-size");

    test("every font-size is a type token, never a literal (the header's 15 px nav items are §3.2's, outside <main>)", () => {
      assert.ok(layer, "no primitives layer in globals.css");
      const sized = rules.filter((r) => r.declarations.has("font-size"));
      assert.ok(sized.length >= 20, `only ${sized.length} rules set a size`);
      for (const rule of sized) {
        const value = rule.declarations.get("font-size")!;
        if (rule.prelude === ".nav-link") assert.equal(value, "0.9375rem");
        else assert.match(value, /^var\(--(rh-)?text-[\w-]+\)$/, `${rule.prelude} sets font-size: ${value}`);
      }
    });

    test("text that would otherwise take the browser's 16 px (off the scale on phones, where Body is 15) sets its step", () => {
      assert.equal(size(".btn"), "var(--rh-text-body)");
      assert.equal(size(".arrow-link"), "var(--text-small)");
      assert.equal(size(".callout"), "var(--rh-text-body)");
      assert.equal(size(".step-trail"), "var(--rh-text-body)");
      assert.equal(size(".prev-next-label"), "var(--rh-text-title)");
      assert.equal(size(".pill"), "var(--text-code)");
      // The run window's address pill is a mono label (12 px): the 11 px tag size stays the Tag's alone.
      assert.equal(size(".win-address"), "var(--text-mono)");
      assert.deepEqual(
        rules.filter((r) => r.declarations.get("font-size") === "var(--text-tag)").map((r) => r.prelude),
        [".tag"],
      );
      // Labels inside a trail inherit the trail's size, so a caller's text-small on the list reaches them.
      assert.equal(size(".step-label"), undefined);
    });
  });
});

/** The rules of the primitives' @layer components block in globals.css (the one holding .btn), nested blocks included. */
const primitiveRules: CssBlock[] = [];
(function walk(block: CssBlock | undefined) {
  for (const child of block?.children ?? []) {
    primitiveRules.push(child);
    walk(child);
  }
})(parseCss(globalsCss).children.find((b) => b.prelude === "@layer components" && b.children.some((c) => c.prelude === ".btn")));
const ruleAt = (selector: string) => primitiveRules.find((r) => r.prelude === selector)?.declarations ?? new Map<string, string>();

/**
 * A length in rem from rem lengths, var() references to them, 0 and numeric factors, added or subtracted:
 * "calc(-1 * var(--step-gap) - 0.375rem)" is -1.375 when --step-gap is 1rem. Throws on anything else (px, %, em), so a
 * test can't pass on a value it didn't understand.
 */
function remOf(value: string | undefined, layers: Map<string, string>[] = []): number {
  if (value === undefined) throw new Error("remOf: no value");
  const body = /^calc\((.*)\)$/.exec(value.trim())?.[1] ?? value.trim();
  let total = 0;
  for (const term of body.replace(/\s+-\s+/g, " + -").split(/\s+\+\s+/)) {
    if (term.trim() === "0") continue;
    let factor = 1;
    let length: number | undefined;
    for (const part of term.split("*").map((p) => p.trim())) {
      if (/^-?\d*\.?\d+$/.test(part)) {
        factor *= Number(part);
        continue;
      }
      const literal = resolve(part, layers);
      const rem = /^(-?\d*\.?\d+)rem$/.exec(literal);
      if (!rem && literal !== "0") throw new Error(`remOf: "${part}" in "${value}" is not a rem length (resolved to "${literal}")`);
      length = rem ? Number(rem[1]) : 0;
    }
    if (length === undefined) throw new Error(`remOf: "${term}" in "${value}" has no length`);
    total += factor * length;
  }
  return total;
}

describe("StepTrail (§2.5): rings joined by a dotted line", () => {
  const trail = ruleAt(".step-trail");
  const ring = ruleAt(".step-ring");
  const layers = [trail];
  const ringTop = remOf(ring.get("margin-top"), layers);
  const ringSize = remOf(ring.get("height"), layers);

  test("down the page, each step's line starts at its ring's bottom edge and reaches the next ring's top edge", () => {
    assert.equal(remOf(ring.get("width"), layers), ringSize);
    const gap = remOf(trail.get("gap"), layers);
    const line = ruleAt(".step:not(:last-child)::before");
    // Both measured from the step's own box: the line's top below the step's top, its bottom past the step's bottom.
    const top = remOf(line.get("top"), layers);
    const reach = -remOf(line.get("bottom"), layers);
    assert.ok(top <= ringTop + ringSize, `the line starts ${top} rem down, below the ring's bottom edge (${ringTop + ringSize} rem)`);
    const nextRingTop = gap + ringTop;
    assert.ok(reach >= nextRingTop, `the line ends ${reach} rem below the step, short of the next ring's top edge (${nextRingTop} rem)`);
    assert.ok(reach <= nextRingTop + ringSize, `the line ends ${reach} rem below the step, past the next ring`);
    // Where the line runs under a ring, the ring hides it: it sits above the line, filled with the page background.
    assert.ok(Number(ring.get("z-index")) >= 1);
    assert.equal(ring.get("background"), "var(--rh-bg)");
  });

  test("as a row (from 640 px), each line runs from its ring's right edge to the end of its step, where the next ring starts", () => {
    assert.equal(ruleAt('.step-trail[data-orientation="row"]').get("gap"), "0");
    const line = ruleAt('.step-trail[data-orientation="row"] > .step:not(:last-child)::before');
    assert.ok(remOf(line.get("left"), layers) <= ringSize);
    assert.equal(remOf(line.get("right"), layers), 0);
  });

  test('the docs "On this page" marker (§3.5, §4.3): a filled ring that moves by transform in 180 ms, instantly while focus is inside the list', () => {
    assert.equal(ruleAt(".step-trail-wrap").get("position"), "relative");
    const marker = ruleAt(".step-marker");
    assert.equal(marker.get("position"), "absolute");
    assert.equal(remOf(marker.get("top"), layers), ringTop);
    assert.equal(remOf(marker.get("left"), layers), 0);
    assert.equal(remOf(marker.get("width"), layers), ringSize);
    assert.equal(remOf(marker.get("height"), layers), ringSize);
    assert.ok(Number(marker.get("z-index")) > Number(ring.get("z-index")), "the marker sits above the rings");
    assert.equal(marker.get("background"), "var(--rh-accent)");
    assert.equal(marker.get("transform"), "translateY(var(--marker-y, 0px))");
    assert.equal(marker.get("transition"), "transform var(--transition-duration-short) var(--ease-move)");
    assert.equal(ruleAt(".step-trail-wrap:focus-within .step-marker").get("transition"), "none");
    // Until the docs shell has measured where the marker goes, the server's filled ring shows and the marker doesn't;
    // after that the marker is the one filled ring (one strong accent object, §2.3).
    assert.equal(ruleAt(".step-trail-wrap:not([data-ready]) .step-marker").get("visibility"), "hidden");
    const settled = ruleAt('.step-trail-wrap[data-ready] .step-ring[data-tone="accent"]');
    assert.equal(settled.get("background"), "var(--rh-bg)");
    assert.equal(settled.get("border-color"), "var(--rh-dim)");
  });
});

describe("CSS micro-interactions (§4.3)", () => {
  test("a :target card rings once (§3.4): a 2 px accent ring that fades out in --motion-ring (600 ms; at once under reduce)", () => {
    const card = ruleAt(".card:target");
    assert.equal(card.get("outline"), "2px solid transparent");
    assert.equal(card.get("outline-offset"), "2px");
    assert.equal(card.get("animation"), "target-ring var(--motion-ring) var(--ease-exit) both");
    const keyframes = primitiveRules.find((r) => r.prelude === "@keyframes target-ring");
    assert.ok(keyframes, "no @keyframes target-ring");
    assert.equal(keyframes.children.find((c) => c.prelude === "from")?.declarations.get("outline-color"), "var(--rh-accent)");
    assert.equal(keyframes.children.find((c) => c.prelude === "to")?.declarations.get("outline-color"), "transparent");
    // Forced colours paint outlines in a system colour, transparent included (measured in Chromium: rgb(0, 0, 0) after
    // 800 ms), so there the card shows the finished state: no ring.
    const forced = parseCss(globalsCss).children.filter((b) => b.prelude === "@media (forced-colors: active)").flatMap((b) => b.children);
    assert.deepEqual(Object.fromEntries(forced.find((b) => b.prelude === ".card:target")?.declarations ?? []), { animation: "none", "outline-style": "none" });
  });

  test("the pill: on hover and focus its text turns fg, underlined in accent; its arrow nudges", () => {
    const states = '.pill:is(:hover, :focus-visible, [data-demo-state="hover"])';
    assert.equal(ruleAt(states).get("color"), "var(--rh-fg)");
    assert.deepEqual(Object.fromEntries(ruleAt(`${states} .pill-text`)), {
      "text-decoration-line": "underline",
      "text-decoration-color": "var(--rh-accent)",
      "text-decoration-thickness": "1px",
      "text-underline-offset": "3px",
    });
    const nudge = ruleAt('.has-arrow:is(:hover, :focus-visible, [data-demo-state="hover"], [data-demo-state="focus"])::after');
    assert.equal(nudge.get("transform"), "translateX(var(--motion-nudge))");
  });
});

describe("prose for the docs and legal pages (.prose-doc): on the §2.2 scale", () => {
  test("Lead text in a 70 ch measure; h2 Display M, h3 Title, inline code the code step, tables Body", () => {
    const prose = ruleAt(".prose-doc");
    assert.equal(prose.get("font-size"), "var(--rh-text-lead)");
    assert.equal(prose.get("max-width"), "var(--container-prose)");
    assert.equal(prose.get("color"), "var(--rh-muted)");
    const h2 = ruleAt(".prose-doc h2");
    assert.equal(h2.get("font-family"), "var(--font-display)");
    assert.equal(h2.get("font-size"), "var(--rh-text-display-m)");
    assert.equal(h2.get("line-height"), themeInline.get("--text-display-m--line-height"));
    assert.equal(h2.get("letter-spacing"), themeInline.get("--text-display-m--letter-spacing"));
    assert.equal(h2.get("font-weight"), themeInline.get("--text-display-m--font-weight"));
    assert.equal(ruleAt(".prose-doc h3").get("font-size"), "var(--rh-text-title)");
    assert.equal(ruleAt(".prose-doc :not(pre) > code").get("font-size"), "var(--text-code)");
    assert.equal(ruleAt(".prose-doc table").get("font-size"), "var(--rh-text-body)");
  });
});

/**
 * What a node's own CSS module (a *.module.css beside its components) may not hold: the numbers live in tokens.css, so
 * a module uses the --rh-* colours, the type tokens and the motion tokens, never literals; and the anchor offset is
 * tokens.css's alone.
 */
function moduleCssProblems(css: string): string[] {
  const problems: string[] = [];
  const tree = parseCss(css);
  (function walk(block: CssBlock) {
    for (const [name, value] of block.declarations) {
      const at = `${block.prelude} { ${name}: ${value} }`;
      if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value)) problems.push(`a colour literal: ${at}`);
      if (name === "font-size" && !/^(?:var\(--(?:rh-)?text-[\w-]+\)|inherit)$/.test(value)) problems.push(`a font size off the tokens: ${at}`);
      if (/^(?:transition|animation)(?:-duration|-delay)?$/.test(name) && /(?:^|[\s,(])(?!0m?s\b)\d*\.?\d+m?s\b/.test(value)) problems.push(`a duration literal: ${at}`);
      if (/cubic-bezier\(|steps\(/.test(value)) problems.push(`an easing literal: ${at}`);
      if (/^scroll-margin/.test(name)) problems.push(`a scroll margin (the anchor offset is tokens.css's): ${at}`);
      if (name === "scroll-behavior" && value === "smooth") problems.push(`smooth scrolling: ${at}`);
    }
    block.children.forEach(walk);
  })(tree);
  return problems;
}

describe("CSS modules use the tokens (a node's own component CSS goes in a *.module.css beside it; shared classes in globals.css)", () => {
  test("the check finds literals and passes tokens", () => {
    const bad = `.a { color: #5ee6a3; background: rgb(0 0 0 / 0.5); font-size: 15px; transition: opacity 200ms ease; scroll-margin-top: 5rem; }
      @media (width >= 40rem) { .b { animation: rise 0.3s cubic-bezier(0.2, 0, 0, 1) both; scroll-behavior: smooth; } }`;
    assert.equal(moduleCssProblems(bad).length, 8);
    const good = `.a { color: var(--rh-fg); border-color: color-mix(in oklab, var(--rh-accent) 45%, transparent); font-size: var(--text-small);
      transition: opacity var(--transition-duration-short) var(--ease-enter), display var(--transition-duration-short) allow-discrete; }
      @supports (animation-timeline: scroll()) { .h { animation: opaque linear both; animation-timeline: scroll(root); animation-range: 0 8px; } }
      @media (forced-colors: active) { .a { color: CanvasText; } } .z { transition-delay: 0s; }`;
    assert.deepEqual(moduleCssProblems(good), []);
  });

  test("every *.module.css in src passes", () => {
    for (const file of sourceFiles(src, ["css"]).filter((f) => f.endsWith(".module.css"))) {
      assert.deepEqual(moduleCssProblems(readFileSync(file, "utf8")), [], file);
    }
  });
});

describe("the anchor offset is set once, for the whole site (§2.1)", () => {
  // Files that still set a scroll margin, which now adds to the one offset (scroll-mt-20 lands an anchor 160 px down).
  // Each goes when its file is rewritten (C1: app/checks/page.tsx; F1: app/compare, app/faq; D1 and E1: the legacy
  // layout.tsx and docs/doc-section.tsx), and this list only shrinks.
  const legacy = new Set(["app/checks/page.tsx", "app/compare/page.tsx", "app/faq/page.tsx", "components/layout.tsx", "components/docs/doc-section.tsx"]);

  test("no scroll-mt-* class or scroll-margin declaration anywhere else in src", () => {
    for (const file of sourceFiles(src, ["ts", "tsx", "mdx", "css"])) {
      const name = file.slice(src.length);
      if (legacy.has(name)) continue;
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(text, /\bscroll-m[tbylrxse]?-[\w[]|scroll-margin[\w-]*\s*:/, `${name} sets a scroll margin`);
    }
  });
});
