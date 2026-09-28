// The check pages' picture map (components/checks/evidence-assets.ts): every frame or GIF a featured finding records
// has its static import there under the path the extract gives, and each import is that file. Read as text: the module
// imports images, which only Next.js can load.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { extracts, isPicture, listingOf } from "./run-evidence";

const source = readFileSync(new URL("./evidence-assets.ts", import.meta.url), "utf8");
const imports = new Map([...source.matchAll(/^import (\w+) from "@\/(assets\/runs\/[^"]+)";$/gm)].map((m) => [m[1], m[2]]));
const entries = new Map([...source.matchAll(/^ {2}"(assets\/runs\/[^"]+)": (\w+),$/gm)].map((m) => [m[1], m[2]]));

test("every picture of a featured finding is in the map, keyed by its extract path, importing that file", () => {
  const pictures = extracts
    .flatMap((x) => x.runs.flatMap((r) => r.findings))
    .filter((f) => f.featured)
    .flatMap((f) => (f.evidence ?? []).filter((e) => isPicture(e) && e.asset).map((e) => e.asset as string));
  assert.ok(pictures.length >= 16, `${pictures.length} pictures`);
  for (const path of pictures) {
    const name = entries.get(path);
    assert.ok(name, `${path} is not in evidence-assets.ts`);
    assert.equal(imports.get(name), path, `${name} imports another file`);
  }
});

test("every entry imports a file that exists", () => {
  assert.ok(entries.size > 0);
  for (const [path, name] of entries) {
    assert.equal(imports.get(name), path);
    assert.ok(existsSync(new URL(`../../${path}`, import.meta.url)), path);
  }
});

test("a listing: a card's lines, a request, a console message, otherwise facts or values", () => {
  assert.deepEqual(listingOf({ kind: "card", label: "c", title: "T", subtitle: "S", lines: ["a", "b"] }), { title: "T", subtitle: "S", lines: ["a", "b"] });
  assert.deepEqual(listingOf({ kind: "network", label: "n", data: { method: "GET", url: "http://x/a", status: 404, failure: null } }), {
    lines: ["GET http://x/a → 404"],
  });
  assert.deepEqual(listingOf({ kind: "console", label: "c", data: { type: "error", text: "boom", url: "http://x/a" } }), {
    lines: ["console.error: boom", "http://x/a"],
  });
  assert.deepEqual(listingOf({ kind: "dom", label: "d", data: { problem: "unreachable", tabStops: 14, submitStatus: null } }), {
    lines: ["problem: unreachable", "tabStops: 14"],
  });
  assert.deepEqual(listingOf({ kind: "note", label: "n", facts: [{ label: "A", value: "1" }] }), { lines: ["A: 1"] });
});
