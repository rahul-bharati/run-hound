// Tests for scripts/pagefind.mjs (`pnpm test`): it indexes exactly the registry's searchable pages with Pagefind's
// Node API, on fixture builds, and fails when the index would differ from the registry.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";

const script = join(import.meta.dirname, "pagefind.mjs");
const root = mkdtempSync(join(tmpdir(), "pagefind-"));
after(() => rmSync(root, { recursive: true, force: true }));

const page = (title, text) =>
  `<!DOCTYPE html><html lang="en"><head><title>${title}</title></head><body><header><a href="/">Run Hound</a></header><main><h1>${title}</h1><p>${text}</p></main><footer>Footer</footer></body></html>`;

const route = (id, path, search) => ({ id, path, indexable: true, search });

const manifest = {
  routes: [
    route("home", "/", "Page"),
    route("docs", "/docs/", "Docs"),
    route("double-submit", "/checks/double-submit/", "Check"),
    route("privacy", "/privacy/", false),
    { ...route("design", "/_design/", false), indexable: false },
  ],
};

const pages = {
  "index.html": page("Run Hound", "Find the bugs your AI forgot to test."),
  "docs.html": page("Docs", "Run it on your machine with Docker or Podman."),
  "checks/double-submit.html": page("Double submit", "Clicking twice saves the booking twice: double-submit."),
  "privacy.html": page("Privacy", "How the website handles personal data."),
};

let fixture = 0;
function run({ files = pages, routes = manifest } = {}) {
  const dir = join(root, String((fixture += 1)));
  for (const [name, html] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, "app", name)), { recursive: true });
    writeFileSync(join(dir, "app", name), html);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(routes));
  const out = join(dir, "pagefind");
  const result = spawnSync(process.execPath, [script, "--dir", join(dir, "app"), "--manifest", join(dir, "manifest.json"), "--out", out], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, out };
}

describe("pagefind indexes the registry's searchable pages", () => {
  test("exactly those, at their routes (docs.html is /docs/), with their result group", () => {
    const { status, output, out } = run();
    assert.equal(status, 0, output);
    assert.match(output, /pagefind: indexed 3 pages \(the registry's 3 searchable routes\)/);
    assert.match(output, /\/docs\/ \(Docs\)/);
    assert.match(output, /\/checks\/double-submit\/ \(Check\)/);
    assert.doesNotMatch(output, /\/privacy\//);
    const entry = JSON.parse(readFileSync(join(out, "pagefind-entry.json"), "utf8"));
    assert.equal(Object.values(entry.languages).reduce((n, l) => n + l.page_count, 0), 3);
    assert.ok(existsSync(join(out, "pagefind.js")));
  });

  test("a second run replaces the index instead of adding to it", () => {
    const first = run();
    assert.equal(first.status, 0, first.output);
    const again = spawnSync(
      process.execPath,
      [script, "--dir", join(dirname(first.out), "app"), "--manifest", join(dirname(first.out), "manifest.json"), "--out", first.out],
      { encoding: "utf8" },
    );
    assert.equal(again.status, 0, again.stdout + again.stderr);
    const entry = JSON.parse(readFileSync(join(first.out, "pagefind-entry.json"), "utf8"));
    assert.equal(Object.values(entry.languages).reduce((n, l) => n + l.page_count, 0), 3);
  });
});

describe("pagefind fails the build when", () => {
  test("a searchable registry page was not prerendered", () => {
    const files = { ...pages };
    delete files["docs.html"];
    const { status, output } = run({ files });
    assert.equal(status, 1, output);
    assert.match(output, /\/docs\/ \(docs\) is searchable in the registry, but docs\.html was not prerendered/);
  });

  test("a searchable page has no text to index", () => {
    const files = { ...pages, "docs.html": "<!DOCTYPE html><html lang=\"en\"><head><title>Docs</title></head><body></body></html>" };
    const { status, output } = run({ files });
    assert.equal(status, 1, output);
    assert.match(output, /\/docs\/: indexed with no words/);
  });

  test("the registry lists no searchable page", () => {
    const { status, output } = run({ routes: { routes: manifest.routes.map((r) => ({ ...r, search: false })) } });
    assert.equal(status, 1, output);
    assert.match(output, /no searchable routes in the registry/);
  });
});
