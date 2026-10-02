/**
 * DiscoveredPage.linkTargets (0.4.0, for deep-links): where the page's own links go. Absolute same-origin URLs of
 * a[href] links, without the hash, one per path and query, in page order, at most 50; never an in-page anchor, a
 * download, another origin, or a link whose name or path says it acts (log out, delete, unsubscribe…).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredPage } from "../core/types.js";
import { discoverPage, MAX_LINK_TARGETS } from "./discover.js";

let site: FixtureServer;
let other: FixtureServer;

const MANY = Array.from({ length: 60 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join(" ");

beforeAll(async () => {
  other = await startFixtureServer({ pages: { "/about": "<!doctype html><title>Other</title><h1>Other</h1>" } });
  site = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>App</title></head><body>
<nav><a href="/app">Home</a> <a href="/settings">Settings</a> <a href="/help#faq">Help</a> <a href="/help">Help again</a>
<a href="/reports?tab=2">Reports</a> <a href="reports?tab=2">Reports, relative</a></nav>
<main><h1>App</h1>
<p><a href="#top">Top</a> <a href="javascript:void(0)">Script</a> <a href="mailto:help@example.test">Mail</a>
<a href="https://example.com/elsewhere">Elsewhere</a> <a href="${other.url}/about">Other app</a>
<a href="/export.csv" download>Download</a></p>
<p><a href="/logout">Log out</a> <a href="/account/delete">Close it</a> <a href="/unsubscribe?u=1">Stop emails</a>
<a href="/projects/7">Remove</a></p>
<form><label for="q">Note</label><input id="q" name="q"><a href="/terms">Terms</a><button>Save</button></form>
<div hidden><a href="/hidden-page">Hidden page</a></div>
</main></body></html>`,
      "/many": `<!doctype html><title>Many</title><h1>Many</h1><p>${MANY}</p>`,
      "/bare": `<!doctype html><title>Bare</title><h1>Bare</h1><p>No links.</p>`,
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await Promise.all([site?.close(), other?.close()]);
});

async function discover(path: string): Promise<DiscoveredPage> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(site.url + path, { waitUntil: "load" });
    return await discoverPage(page);
  } finally {
    await page.close();
  }
}

describe("discoverPage: linkTargets", () => {
  it("lists the page's own links once each, absolute and without the hash, in page order", async () => {
    const found = await discover("/app");
    const paths = found.linkTargets?.map((u) => u.slice(site.url.length));
    expect(paths).toEqual(["/app", "/settings", "/help", "/reports?tab=2", "/terms", "/hidden-page"]);
    expect(found.linkTargets!.every((u) => u.startsWith(`${site.url}/`))).toBe(true);
  });

  it("leaves out anchors, scripts, mail links, other origins, downloads and links that act", async () => {
    const found = await discover("/app");
    const all = found.linkTargets!.join(" ");
    for (const left of ["#top", "javascript", "mailto", "example.com", "/about", "/export.csv", "/logout", "/account/delete", "/unsubscribe", "/projects/7"]) {
      expect(all, left).not.toContain(left);
    }
    // The link count is unchanged: it counts every link with a real href outside the forms.
    expect(found.links).toBeGreaterThan(found.linkTargets!.length);
  });

  it(`keeps at most ${MAX_LINK_TARGETS}`, async () => {
    const found = await discover("/many");
    expect(found.linkTargets).toHaveLength(MAX_LINK_TARGETS);
    expect(found.linkTargets![0]).toBe(`${site.url}/p0`);
  });

  it("is empty on a page without links", async () => {
    expect((await discover("/bare")).linkTargets).toEqual([]);
  });
});
