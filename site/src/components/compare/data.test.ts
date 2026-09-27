// Unit tests for components/compare/data.ts: the comparison table, its sources and structured data. `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { capabilities, compareJsonLd, comparePage, notYet, tools } = await import("@/components/compare/data");

const base = "https://run-hound.example";

describe("compare", () => {
  test("every row has a cell for every tool, and every text a mark that can carry it", () => {
    for (const row of capabilities) {
      assert.deepEqual(Object.keys(row.cells).sort(), tools.map((tool) => tool.id).sort(), row.capability);
      for (const cell of Object.values(row.cells)) {
        // "unknown" is a dash: the research doesn't say, so there is nothing to add.
        if (cell.mark === "unknown") assert.equal(cell.text, undefined, row.capability);
      }
    }
  });

  test("every tool links its sources, and names no price", () => {
    for (const tool of tools) {
      assert.ok(tool.sources.length > 0, tool.id);
      for (const source of tool.sources) assert.match(source.href, /^https:\/\//);
      for (const text of [tool.what, tool.adds, tool.together]) assert.doesNotMatch(text, /\$|€|\/month|pricing/i);
    }
  });

  test("the title stands alone and the description fits a search snippet", () => {
    assert.equal(comparePage.absoluteTitle, true);
    assert.ok(comparePage.title.length <= 60, `${comparePage.title.length} characters`);
    assert.ok(comparePage.description.length <= 155, `${comparePage.description.length} characters`);
  });

  test("what it doesn't do yet leaves out what 0.6.0 built: write-access, paywall-trust, two-step and sessionStorage sign-in", () => {
    const text = notYet.join("\n");
    assert.doesNotMatch(text, /write-access|paywall-trust/);
    assert.doesNotMatch(text, /sessionStorage|split over two pages|two-step/i);
  });

  test("the structured data is a WebPage dated by the release, and its breadcrumb", () => {
    const [page, breadcrumb, ...rest] = compareJsonLd()["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "WebPage");
    assert.equal(page.url, `${base}/compare/`);
    assert.equal(page.name, comparePage.title);
    assert.equal(page.dateModified, site.releasedIso);
    assert.equal(breadcrumb["@id"], `${base}/compare/#breadcrumb`);
  });
});
