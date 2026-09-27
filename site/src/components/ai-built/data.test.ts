// Unit tests for components/ai-built/data.ts: the AI-built apps page's metadata and structured data. `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { aiBuiltJsonLd, aiBuiltPage, coverage } = await import("@/components/ai-built/data");

const base = "https://run-hound.example";

describe("ai-built apps", () => {
  test("the title names the builders, and the description fits a search snippet", () => {
    assert.match(aiBuiltPage.title, /Lovable, Bolt and v0/);
    assert.ok(`${aiBuiltPage.title} · ${site.name}`.length <= 60);
    assert.ok(aiBuiltPage.description.length <= 155, `${aiBuiltPage.description.length} characters`);
  });

  test("says what discovery covers, never every form (docs/brand.md)", () => {
    assert.match(coverage, /up to 5 forms/);
    assert.doesNotMatch(coverage, /every form/i);
  });

  test("the structured data is a WebPage dated by the release, and its breadcrumb", () => {
    const [page, breadcrumb, ...rest] = aiBuiltJsonLd()["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "WebPage");
    assert.equal(page.url, `${base}/ai-built-apps/`);
    assert.equal(page.name, `${aiBuiltPage.title} · ${site.name}`);
    assert.equal(page.dateModified, site.releasedIso);
    assert.equal(breadcrumb["@id"], `${base}/ai-built-apps/#breadcrumb`);
  });
});
