// The release workflow (.github/workflows/release-images.yml, check-version) reads the site's release with
//   sed -nE 's/^const version = "([^"]+)";.*/\1/p' site/src/lib/site.ts
// and fails the release when it differs from the tag. A refactor that moves or reformats that line fails here first,
// in `pnpm test`, instead of at release time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { site } from "@/lib/site";

const lines = readFileSync(join(new URL("./", import.meta.url).pathname, "site.ts"), "utf8").split("\n");
const sed = /^const version = "([^"]+)";.*/;

test("line 3 of lib/site.ts is the release line, in the shape the workflow's sed reads", () => {
  assert.match(lines[2], /^const version = "\d+\.\d+\.\d+";$/);
});

test("the sed finds exactly one release in lib/site.ts, and it is site.version", () => {
  const hits = lines.map((line) => sed.exec(line)?.[1]).filter((hit) => hit !== undefined);
  assert.deepEqual(hits, [site.version]);
});
