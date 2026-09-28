// lib/metadata.ts routeMetadata(): a registered page's metadata comes from the route registry. `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example";
const { pageMetadata, routeMetadata } = await import("@/lib/metadata");
const { route } = await import("@/content/routes");

test("a page's metadata is pageMetadata() of its registry entry, word for word", () => {
  for (const id of ["home", "docs", "checks", "faq", "compare", "privacy"] as const) {
    const r = route(id);
    assert.deepEqual(
      routeMetadata(id),
      pageMetadata({ path: r.path, title: r.title, description: r.description, absoluteTitle: r.absoluteTitle }),
      id,
    );
  }
  assert.deepEqual(routeMetadata("compare").title, { absolute: "Run Hound vs Playwright, axe-core and security scanners" });
  // The layout's title template adds " · Run Hound"; the page's metadata carries the bare title.
  assert.equal(routeMetadata("faq").title, "FAQ: UI testing for AI-built apps");
});

test("an internal route (/_design/) is noindex and nofollow, with no canonical or social card", () => {
  const design = routeMetadata("design");
  assert.deepEqual(design.robots, { index: false, follow: false });
  assert.equal(design.alternates, undefined);
  // Next.js merges metadata one field at a time: a page that leaves openGraph and twitter out inherits the layout's
  // (og:title, og:image, twitter:card). null clears them.
  assert.equal(design.openGraph, null);
  assert.equal(design.twitter, null);
  assert.equal(design.title, "Design system");
});
