// The lint rule that counts arbitrary Tailwind values (DESIGN.md §5.2 "Arbitrary Tailwind values: ≤ 139 in site/src,
// no growth, 0 in new components"; ES1): eslint-plugin-tailwindcss 4.4.0's no-arbitrary-value finds them, and the
// site's rule (eslint.config.mjs, site/arbitrary-values) allows a file only the values it had when the redesign began,
// each at most as often: none for any new file, and nothing new in a file that had some, even at its old count. `pnpm
// lint` runs it; this checks the rule itself and today's source. ESLint can't parse MDX, so the MDX files are checked
// here. scripts/check-budgets.mjs keeps the build's own count (139) as the ratchet.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ESLint } from "eslint";
import { sourceFiles } from "../../../scripts/lib/build-output.mjs";

const site = new URL("../../../", import.meta.url).pathname;
const eslint = new ESLint({ cwd: site });
const config = (await import(join(site, "eslint.config.mjs"))) as { arbitraryAllowance: Record<string, readonly string[]> };

/** The site/arbitrary-values messages ESLint gives for `code` as if it were the file at `path` (relative to site/). */
async function arbitrary(path: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(site, path) });
  return result.messages.filter((m) => m.ruleId === "site/arbitrary-values");
}

const component = (classes: string) => `export function X() {\n  return <div className="${classes}">x</div>;\n}\n`;
/** One element per class string, so each value is found where it is. */
const elementsWith = (values: readonly string[]) => `export function X() {\n  return <>${values.map((v) => `<i className="${v}" />`).join("")}</>;\n}\n`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("site/arbitrary-values", () => {
  test("a new component with one arbitrary value is an error", async () => {
    const found = await arbitrary("src/components/primitives/probe-new.tsx", component("px-[72px] text-fg"));
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 2);
    assert.match(found[0].message, /px-\[72px\]/);
  });

  test("a new component with none passes", async () => {
    assert.deepEqual(await arbitrary("src/components/primitives/probe-new.tsx", component("px-18 text-fg")), []);
  });

  test("variants, template strings and several values are all found", async () => {
    const code = "export const X = () => <p className={`sm:text-[15px] ${'a'} tracking-[0.18em]`}>x</p>;\n";
    assert.equal((await arbitrary("src/app/new-page/probe.tsx", code)).length, 2);
  });

  test("so are the site's own cx() calls (primitives/class-names.ts), in className and outside it", async () => {
    const inClassName = 'import { cx } from "./class-names";\nexport const X = ({ c }: { c?: string }) => <p className={cx("px-[72px]", c)}>x</p>;\n';
    assert.equal((await arbitrary("src/components/primitives/probe-new.tsx", inClassName)).length, 1);
    const outside = 'import { cx } from "./class-names";\nexport const classes = cx("sm:text-[15px]", "text-fg");\n';
    assert.equal((await arbitrary("src/components/primitives/probe-new.tsx", outside)).length, 1);
  });

  test("a file that had some keeps exactly those: a new value fails even at the old count, and so does one more copy of an old one", async () => {
    const [file, allowed] = Object.entries(config.arbitraryAllowance).find(([, values]) => new Set(values).size >= 2)!;
    assert.deepEqual(await arbitrary(file, elementsWith(allowed)), [], `${file} with the values it had`);
    // A rewrite at the same path that swaps one old value for a new one: the same count, and the new value is an error.
    const swapped = await arbitrary(file, elementsWith([...allowed.slice(1), "w-[123px]"]));
    assert.equal(swapped.length, 1);
    assert.equal(swapped[0].severity, 2);
    assert.match(swapped[0].message, /w-\[123px\]/);
    // One more copy of a value it had.
    const more = await arbitrary(file, elementsWith([...allowed, allowed[0]]));
    assert.equal(more.length, 1);
    assert.match(more[0].message, new RegExp(escape(allowed[0])));
  });

  test("the allowances name files under src/, list arbitrary values only, and add up to no more than the 139 of today", () => {
    const total = Object.values(config.arbitraryAllowance).reduce((sum, values) => sum + values.length, 0);
    assert.ok(total <= 139, `allowances add up to ${total}`);
    for (const [file, values] of Object.entries(config.arbitraryAllowance)) {
      assert.match(file, /^src\/.+\.tsx?$/);
      assert.ok(values.length > 0, `${file}: an empty allowance; delete the entry`);
      for (const value of values) assert.match(value, /-\[/, `${file}: "${value}" is not an arbitrary value`);
    }
  });

  test("no allowance for the redesign's new files: they start at 0 and stay there", () => {
    // The new directories and templates of DESIGN.md §5.4. A legacy file that a node rewrites reaches 0 too, and its
    // entry is deleted when that node merges.
    const fresh =
      /^src\/(?:components\/(?:primitives|header|search|docs-shell|design|not-found|hound)\/|motion\/|content\/|styles\/|app\/%5Fdesign\/|app\/docs\/\[slug\]\/|app\/checks\/\[id\]\/|mdx-components\.tsx$)/;
    assert.deepEqual(
      Object.keys(config.arbitraryAllowance).filter((file) => fresh.test(file)),
      [],
    );
  });

  test("today's source lints clean: every file within its allowance", async () => {
    const files = Object.keys(config.arbitraryAllowance).filter((file) => existsSync(join(site, file)));
    const results = await eslint.lintFiles(files);
    const over = results.flatMap((r) => r.messages.filter((m) => m.ruleId === "site/arbitrary-values").map((m) => `${r.filePath}: ${m.message}`));
    assert.deepEqual(over, []);
  });
});

/**
 * The arbitrary Tailwind values in an MDX file's className attributes (className="…" and className={`…`}): ESLint
 * can't parse MDX without a parser the site doesn't have, and check-budgets counts .ts and .tsx only.
 */
function arbitraryInMdx(text: string): string[] {
  const found: string[] = [];
  for (const [, quoted, template] of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const name of (quoted ?? template).split(/\s+/)) if (/-\[[^\]]+\]/.test(name)) found.push(name);
  }
  return found;
}

describe("MDX (src/content/docs/*.mdx): no arbitrary values", () => {
  test("the check finds them in both forms of className", () => {
    const mdx = '<div className="text-[15px] text-muted">x</div>\n\n<Callout className={`lg:grid-cols-[1fr_2fr]`}>y</Callout>\n';
    assert.deepEqual(arbitraryInMdx(mdx), ["text-[15px]", "lg:grid-cols-[1fr_2fr]"]);
    assert.deepEqual(arbitraryInMdx('<div className="text-small text-muted">x</div>'), []);
  });

  test("no MDX file in src has one", () => {
    for (const file of sourceFiles(join(site, "src"), ["mdx"])) assert.deepEqual(arbitraryInMdx(readFileSync(file, "utf8")), [], file);
  });
});

describe("GSAP stays in src/motion/ (§4.4)", () => {
  test("importing gsap or @gsap/react outside src/motion/ is an error; inside it is fine", async () => {
    const code = 'import { gsap } from "gsap";\nimport { useGSAP } from "@gsap/react";\nimport { DrawSVGPlugin } from "gsap/DrawSVGPlugin";\nexport const x = [gsap, useGSAP, DrawSVGPlugin];\n';
    const [outside] = await eslint.lintText(code, { filePath: join(site, "src/components/home/probe.tsx") });
    assert.equal(outside.messages.filter((m) => m.ruleId === "no-restricted-imports" && m.severity === 2).length, 3);
    const [inside] = await eslint.lintText(code, { filePath: join(site, "src/motion/probe.ts") });
    assert.equal(inside.messages.filter((m) => m.ruleId === "no-restricted-imports").length, 0);
  });
});
