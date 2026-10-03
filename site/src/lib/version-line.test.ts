// app/tests/features/cli/cli-version.test.ts reads this file's release with /^const version = "([^"]+)";/m
// (docs/decisions/09-2026.md#2026-09-29-images-latest-no-version-pins). A refactor that adds a second
// `const version = "…";` line, or makes site.version disagree with it, fails here first, in `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { site } from "@/lib/site";

const lines = readFileSync(join(new URL("./", import.meta.url).pathname, "site.ts"), "utf8").split("\n");
const sed = /^const version = "([^"]+)";.*/;

test("the sed finds exactly one release in lib/site.ts, and it is site.version", () => {
  const hits = lines.map((line) => sed.exec(line)?.[1]).filter((hit) => hit !== undefined);
  assert.deepEqual(hits, [site.version]);
});
