// Every finding in report.html, report.md and the web UI links its check's page on this site through the app's
// app/src/core/links.ts (DESIGN.md §5.5): /checks/<id>/ for a built-in check, the hub's #ai-flow card for the optional
// AI flow. The site tests the same mapping against its registry, so a renamed route, a renamed check or a check page
// that goes missing fails CI here as well as in the app. Reads ../app, so it runs in `pnpm test` on a full checkout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { aiFlowCheck, builtInChecks } from "@/content/checks/data";
import { checkPages } from "@/content/checks/pages";
import { hasRoute, route, routes } from "@/content/routes";

const appCore = new URL("../../../app/src/core/", import.meta.url);
const { SITE_URL, checkPageUrl } = (await import(new URL("links.ts", appCore).href)) as {
  SITE_URL: string;
  checkPageUrl: (id: string) => string;
};

/** The ids of app/src/core/types.ts's CHECK_IDS, read as text (the module imports Playwright's types). */
function appCheckIds(): string[] {
  const types = readFileSync(new URL("types.ts", appCore), "utf8");
  const body = /export const CHECK_IDS = \[([\s\S]*?)\] as const;/.exec(types)?.[1];
  assert.ok(body, "no CHECK_IDS list in app/src/core/types.ts");
  return [...body.replace(/\/\/[^\n]*/g, "").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** A link's path on the site, or undefined when it points elsewhere. */
function sitePath(url: string): { path: string; hash: string } | undefined {
  if (!url.startsWith(`${SITE_URL}/`)) return undefined;
  const parsed = new URL(url);
  assert.equal(parsed.search, "", `${url} carries a query`);
  return { path: parsed.pathname, hash: parsed.hash.replace(/^#/, "") };
}

describe("the app's check links land on this site's check pages", () => {
  const ids = appCheckIds();
  const builtIn = ids.filter((id) => id !== aiFlowCheck.id);

  test("the app's checks are the site's: the 26 built-in checks and the optional ai-flow", () => {
    assert.deepEqual([...builtIn].sort(), builtInChecks.map((c) => c.id).sort());
    assert.ok(ids.includes(aiFlowCheck.id));
  });

  test("SITE_URL is https, with no trailing slash", () => {
    assert.match(SITE_URL, /^https:\/\/[a-z0-9.-]+$/);
  });

  test("every built-in check links /checks/<id>/, and the path is its route's in the registry", () => {
    for (const id of builtIn) {
      const link = sitePath(checkPageUrl(id));
      assert.deepEqual(link, { path: `/checks/${id}/`, hash: "" }, id);
      // Registered once its page module exists; routes/checks.ts derives the path from the id, so the two agree.
      if (hasRoute(`check-${id}`)) assert.equal(route(`check-${id}` as never).path, link?.path, id);
    }
  });

  test("every check page the site has is one the app links, at the same path", () => {
    const pages = routes.filter((r) => r.parent === "checks");
    assert.deepEqual(pages.map((r) => r.id).sort(), checkPages.map((p) => `check-${p.id}`).sort());
    for (const r of pages) assert.equal(sitePath(checkPageUrl(r.id.replace(/^check-/, "")))?.path, r.path, r.id);
  });

  test("ai-flow links the hub's #ai-flow card, which the registry promises", () => {
    const link = sitePath(checkPageUrl(aiFlowCheck.id));
    assert.deepEqual(link, { path: route("checks").path, hash: aiFlowCheck.id });
    assert.ok(route("checks").anchors.includes(aiFlowCheck.id));
  });

  test("the built-in checks without a page yet (C2's modules) land on a 404 until their page exists", { todo: builtIn.length !== checkPages.length }, () => {
    const missing = builtIn.filter((id) => !hasRoute(`check-${id}`));
    assert.deepEqual(missing, [], `no page yet: ${missing.join(", ")}`);
  });
});
