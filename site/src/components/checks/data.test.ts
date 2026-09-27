// Unit tests for components/checks/data.ts: `pnpm test` (node:test, no dependencies; scripts/test-hooks.mjs resolves
// the "@/" imports). The /checks/ page renders every check with an id, so a check can be linked to
// (/checks/#double-submit); these ids must stay unique and stable.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aiFlowCheck, builtInChecks, categories, previewGroups, releaseAdded } from "@/components/checks/data";

/** A fragment that reads well in a URL: lower case, digits and single hyphens. */
const anchor = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Ids the /checks/ page uses for itself (app/checks/page.tsx; Section adds `${id}-heading`), and the layout's skip-link
 * target. A check's id must not take one of them.
 */
const pageIds = [
  "main",
  "preview",
  "preview-heading",
  "preview-ai-flow",
  "catalog",
  "catalog-heading",
  "advisory",
  "advisory-heading",
  "not-visible",
  "not-visible-heading",
  ...categories.flatMap((c) => [c.id, `${c.id}-title`]),
];

const catalogIds = categories.flatMap((c) => c.checks.map((check) => check.id));
const builtInIds = [...previewGroups.flatMap((g) => g.checks.map((c) => c.id)), aiFlowCheck.id];

describe("check ids on /checks/", () => {
  test("every catalog gap has an id that reads well in a URL", () => {
    assert.equal(catalogIds.length, categories.reduce((sum, c) => sum + c.checks.length, 0));
    for (const id of catalogIds) assert.match(id, anchor);
  });

  test("the built-in checks keep the id that plans, reports and the CLI use", () => {
    for (const id of builtInIds) assert.match(id, anchor);
    assert.ok(builtInIds.includes("double-submit"));
    assert.ok(builtInIds.includes("csrf"));
  });

  test("no id is used twice on the page", () => {
    const all = [...pageIds, ...builtInIds, ...catalogIds];
    const seen = new Set<string>();
    const repeated = all.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(repeated, []);
  });
});

describe("builtInChecks", () => {
  test("lists every built-in check once, in the page's order, with its group", () => {
    assert.deepEqual(
      builtInChecks.map((c) => `${c.group} ${c.id}`),
      previewGroups.flatMap((g) => g.checks.map((c) => `${g.group} ${c.id}`)),
    );
  });

  test("leaves out the AI-suggested flows, which aren't counted with them", () => {
    assert.ok(!builtInChecks.some((c) => c.id === aiFlowCheck.id));
  });
});

describe("the release that added each built-in check", () => {
  const byId = new Map(builtInChecks.map((c) => [c.id, c]));
  const releaseOf = (id: string) => {
    const check = byId.get(id);
    assert.ok(check, id);
    return releaseAdded(check);
  };

  test("names the release, never the stage: V0 in 0.1.0, V1 in 0.2.0, the V2 preview in 0.4.0, 0.5.0 and 0.6.0", () => {
    assert.equal(releaseOf("double-submit"), "0.1.0");
    assert.equal(releaseOf("security-headers"), "0.2.0");
    assert.equal(releaseOf("access-control"), "0.4.0");
    assert.equal(releaseOf("mass-assignment"), "0.4.0");
    assert.equal(releaseOf("deep-links"), "0.4.0");
    assert.equal(releaseOf("csrf"), "0.5.0");
    assert.equal(releaseOf("write-access"), "0.6.0");
    assert.equal(releaseOf("paywall-trust"), "0.6.0");
  });

  test("every built-in check has one, a release number", () => {
    for (const c of builtInChecks) assert.match(releaseAdded(c), /^0\.\d+\.0$/, c.id);
  });
});
