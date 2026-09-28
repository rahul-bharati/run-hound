/**
 * The footer doormat on the built site (DESIGN.md §3.3; node H1): 22 links in four columns, in the registry's order
 * on every page, never prefetched; the brand block with the release line; at most 360 px tall at 1440 and 760 px at
 * 390; five columns from 1024 px, four from 768, two on phones; and axe-core finds nothing on any page with the new
 * header and footer (1280×720 and 390×844). Run: pnpm lab footer.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { runAxe } from "../lib/audits.mjs";
import { launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { measurePage } from "../lib/page-measures.mjs";
import { writeJson } from "../lib/out.mjs";
import { recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";

await import("../../test-hooks.mjs");
const { footerColumns } = await import("../../../src/lib/nav.ts");
const { site } = await import("../../../src/lib/site.ts");

const base = origin();
const { indexable, internal, notFound } = await labRoutes();
const columns = footerColumns();
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("footer.json", result);
});

/** The footer's columns as the page shows them: each nav's heading and its links. */
const readFooter = (page) =>
  page.evaluate(() => {
    const footer = document.querySelector("body > footer");
    return {
      height: Math.round(footer.getBoundingClientRect().height),
      columns: [...footer.querySelectorAll("nav")].map((nav) => ({
        heading: nav.querySelector("h2")?.textContent.trim(),
        left: Math.round(nav.getBoundingClientRect().left),
        top: Math.round(nav.getBoundingClientRect().top),
        links: [...nav.querySelectorAll("a")].map((a) => ({
          label: (a.textContent ?? "").trim(),
          href: a.getAttribute("href"),
          height: Math.round(a.getBoundingClientRect().height),
        })),
      })),
      text: footer.innerText,
      author: footer.querySelector("a[rel~='author']")?.textContent.trim(),
      pagefindIgnore: footer.hasAttribute("data-pagefind-ignore"),
    };
  });

describe("22 links in four columns, the same on every page (§3.3)", () => {
  test("every page: the registry's columns, labels and hrefs, in order", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const expected = columns.map((c) => ({ heading: c.label, links: c.links.map((l) => ({ label: l.label, href: l.href })) }));
    assert.equal(expected.flatMap((c) => c.links).length, 22);
    for (const path of [...indexable.map((r) => r.path), ...internal.map((r) => r.path), notFound]) {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      const footer = await readFooter(page);
      assert.deepEqual(
        footer.columns.map((c) => ({ heading: c.heading, links: c.links.map(({ label, href }) => ({ label, href })) })),
        expected,
        `${path}: the footer's columns`,
      );
      assert.ok(footer.pagefindIgnore, `${path}: the footer is left out of the search index`);
    }
    await context.close();
  });

  test("the brand block: the mark, the name, the line, the maintainer (rel=author) and the release line", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    const footer = await readFooter(page);
    await context.close();
    assert.match(footer.text, /Open-source, AI-assisted UI testing for AI-built apps\. Made by Rahul Bharati\./);
    assert.equal(footer.author, site.maintainer.name);
    assert.match(footer.text, new RegExp(`Release ${site.version.replace(/\./g, "\\.")} · ${site.released}`));
    assert.doesNotMatch(footer.text, /Cookie settings/, "no Cookie settings without Google Analytics");
  });

  test("no footer link is prefetched (prefetch none)", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const log = recordRequests(page);
    await page.goto(`${base}/`, { waitUntil: "load" });
    const footerOnly = await page.evaluate(() => {
      const inFooter = [...document.querySelectorAll("body > footer a[href^='/']")].map((a) => a.getAttribute("href"));
      const elsewhere = new Set(
        [...document.querySelectorAll("a[href^='/']")].filter((a) => !a.closest("body > footer")).map((a) => a.getAttribute("href")),
      );
      return inFooter.filter((href) => !elsewhere.has(href.split("#")[0]) && !elsewhere.has(href));
    });
    await page.evaluate(() => document.querySelector("body > footer").scrollIntoView());
    await sleep(1500);
    const fetched = log.requests.filter((r) => r.rsc || r.prefetch).map((r) => r.path.split("?")[0]);
    result.prefetch = { footerOnly, fetched };
    await context.close();
    for (const href of footerOnly) {
      const path = href.split("#")[0];
      assert.ok(!fetched.includes(path), `${href} was prefetched`);
    }
  });
});

describe("size and columns", () => {
  for (const [name, viewport, limit, count] of [
    ["1440", { width: 1440, height: 900 }, 360, 5],
    ["1024", { width: 1024, height: 768 }, undefined, 5],
    ["768", { width: 768, height: 1024 }, undefined, 4],
    ["390", { width: 390, height: 844 }, 760, 2],
  ]) {
    test(`at ${name} px: ${count === 5 ? "the brand block and four columns in a row" : `${count} link columns per row`}${limit ? `, at most ${limit} px tall` : ""}`, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      const footer = await readFooter(page);
      const measures = await measurePage(page);
      result[`size${name}`] = { height: footer.height, measured: measures.footerHeight, columns: footer.columns.map((c) => [c.left, c.top]) };
      await context.close();
      if (limit) assert.ok(footer.height <= limit, `the footer is ${footer.height} px tall (≤ ${limit})`);
      const firstRowTop = footer.columns[0].top;
      const inFirstRow = footer.columns.filter((c) => c.top === firstRowTop).length;
      assert.equal(inFirstRow, count === 5 ? 4 : count, `${inFirstRow} columns in the first row`);
      assert.ok(footer.columns.every((c) => c.links.every((l) => l.height >= 36)), "36 px rows");
      assert.equal(measures.overflowX, 0);
    });
  }
});

describe("axe-core on every page with the new header and footer", () => {
  for (const [name, viewport] of [
    ["1280×720", { width: 1280, height: 720 }],
    ["390×844", { width: 390, height: 844 }],
  ]) {
    test(`at ${name}`, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      const found = {};
      for (const path of [...indexable.map((r) => r.path), ...internal.map((r) => r.path), notFound]) {
        await page.goto(`${base}${path}`, { waitUntil: "load" });
        const { violations } = await runAxe(page);
        if (violations.length) found[path] = violations;
      }
      result[`axe${name}`] = found;
      await context.close();
      assert.deepEqual(found, {});
    });
  }
});
