// src/content/ holds every word a contributor edits, as plain data (brief §8.1, §8.3; the design's §5.4 G3): the data
// modules that lived beside the components moved here, and a content module has no JSX and no class names, so plain
// Node loads it (node --test, the build scripts) and a page decides how it looks. `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const srcDir = new URL("../", import.meta.url).pathname;
const contentDir = join(srcDir, "content");

describe("content modules", () => {
  test("the data modules moved out of components/ and live in content/", () => {
    const moved: Record<string, string> = {
      "components/checks/data.ts": "content/checks/data.ts",
      "components/faq/data.ts": "content/faq.ts",
      "components/compare/data.ts": "content/compare.ts",
      "components/ai-built/data.ts": "content/ai-built.ts",
      "components/oss/open-source.ts": "content/open-source.ts",
      "components/legal/pages.ts": "content/legal.ts",
    };
    for (const [from, to] of Object.entries(moved)) {
      assert.ok(!existsSync(join(srcDir, from)), `${from} is back; its module is ${to}`);
      assert.ok(existsSync(join(srcDir, to)), to);
    }
  });

  test("are plain .ts: no .tsx in content/ (a .ts file can't hold JSX), and no class names", () => {
    assert.deepEqual(sourceFiles(contentDir, ["tsx", "jsx"]).map((f) => relative(srcDir, f)), []);
    const found = sourceFiles(contentDir, ["ts"]).filter((file) => /\bclassName\b/.test(readFileSync(file, "utf8")));
    assert.deepEqual(found.map((f) => relative(srcDir, f)), []);
  });
});
