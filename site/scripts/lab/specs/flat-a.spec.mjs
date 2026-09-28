/**
 * The project pages on the built site (DESIGN.md §3.8-§3.10; node F1): /open-source/, /faq/ and /compare/. Each has one
 * h1 as its first heading, a breadcrumb equal to its BreadcrumbList, no horizontal overflow at 320 px, at most one
 * strong accent object per viewport at rest (§2.3), and axe-core finds nothing at 1280×720 and 390×844, motion on and
 * reduced. The open-source page has its sections in order (#how-to-help on #contributing), the FAQ puts "At a glance"
 * first and hides no answer, the compare table scrolls inside its own region and its rows link the checks they name,
 * and FAQPage structured data is on /faq/ and on no other page. Run: pnpm lab flat-a.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { accentAudit, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { measurePage } from "../lib/page-measures.mjs";
import { labRoutes } from "../lib/routes.mjs";

await import("../../test-hooks.mjs");
const { breadcrumbTrail } = await import("../../../src/lib/nav.ts");
const { openSourceSections } = await import("../../../src/content/open-source.ts");
const { faqAtAGlance, faqItems } = await import("../../../src/content/faq.ts");
const { capabilities, checkLink } = await import("../../../src/content/compare.ts");

const base = origin();
const { indexable } = await labRoutes();
const pages = [
  { id: "open-source", path: "/open-source/" },
  { id: "faq", path: "/faq/" },
  { id: "compare", path: "/compare/" },
];
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("flat-a.json", result);
});

/** The page's headings in order, its visible breadcrumb, its JSON-LD types, and its sections' ids. */
const readPage = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    const types = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          if (typeof value["@type"] === "string") types.push(value["@type"]);
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(script.textContent));
    }
    return {
      headings: [...main.querySelectorAll("h1, h2, h3")].map((h) => h.tagName.toLowerCase()),
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
      breadcrumb: [...(main.querySelector('nav[aria-label="Breadcrumb"]')?.querySelectorAll("li") ?? [])].map((li) =>
        li.textContent.replace("/", "").trim(),
      ),
      jsonLdTypes: types,
      sections: [...main.querySelectorAll("section[id]")].map((s) => ({
        id: s.id,
        labelledBy: s.getAttribute("aria-labelledby"),
        heading: s.querySelector("h2")?.id ?? null,
      })),
      details: main.querySelectorAll("details, summary, [hidden]").length,
    };
  });

describe("every project page", () => {
  for (const { id, path } of pages) {
    test(`${path}: one h1, first; the breadcrumb from the registry; no overflow at 320 px; no CSP violation`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      const read = await readPage(page);
      const flow = await reflow(page);
      const measures = await measurePage(page);
      const csp = await cspViolations(page);
      await context.close();
      result[id] = { ...(result[id] ?? {}), overflow320: flow.overflowX, words: measures.mainWords, screens320: measures.screens };
      assert.equal(read.h1.length, 1, `${path}: ${read.h1.length} h1`);
      assert.equal(read.headings[0], "h1", `${path}: the first heading is ${read.headings[0]}`);
      assert.deepEqual(
        read.breadcrumb,
        breadcrumbTrail(id).map((c) => c.name),
        `${path}: the breadcrumb`,
      );
      assert.equal(flow.overflowX, 0, `${path}: ${flow.overflowX} px of horizontal overflow at 320 px`);
      assert.deepEqual(csp, [], `${path}: CSP violations`);
    });

    for (const [name, viewport] of [
      ["1280×720", { width: 1280, height: 720 }],
      ["390×844", { width: 390, height: 844 }],
    ]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        test(`${path} at ${name}, motion ${reducedMotion}: axe finds nothing`, async () => {
          const { context, page } = await newPage(browser, { viewport, reducedMotion });
          await page.goto(`${base}${path}`, { waitUntil: "load" });
          const axe = await runAxe(page);
          await context.close();
          result[id] = { ...(result[id] ?? {}), [`axe ${name} ${reducedMotion}`]: axe.violations };
          assert.deepEqual(axe.violations, [], `${path}: ${JSON.stringify(axe.violations)}`);
        });
      }
    }

    test(`${path}: at most one strong accent object per viewport at rest (§2.3), at 1440 and 390`, async () => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
        await page.goto(`${base}${path}`, { waitUntil: "load" });
        const audit = await accentAudit(page);
        await context.close();
        result[id] = { ...(result[id] ?? {}), [`accent ${viewport.width}`]: audit };
        assert.ok(audit.maxPerWindow <= 1, `${path} at ${viewport.width}: ${JSON.stringify(audit.objects)}`);
      }
    });
  }
});

describe("/open-source/ (§3.8)", () => {
  test("the sections in order, each labelled by its h2; How to help today is #contributing with its h2 #how-to-help", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/open-source/#how-to-help`, { waitUntil: "load" });
    const read = await readPage(page);
    // The footer's "How to help" link lands on the h2, below the sticky header.
    const landed = await page.evaluate(() => {
      const h2 = document.getElementById("how-to-help");
      const header = document.querySelector("body > header");
      return { top: Math.round(h2.getBoundingClientRect().top), header: Math.round(header.getBoundingClientRect().bottom) };
    });
    await context.close();
    assert.deepEqual(
      read.sections.map((s) => s.id),
      openSourceSections.map((s) => s.id),
    );
    for (const [i, s] of openSourceSections.entries()) {
      const heading = s.headingId ?? `${s.id}-heading`;
      assert.equal(read.sections[i].heading, heading, s.id);
      assert.equal(read.sections[i].labelledBy, heading, s.id);
    }
    assert.ok(landed.top >= landed.header, `#how-to-help sits under the header (${landed.top} < ${landed.header})`);
  });
});

describe("/faq/ (§3.9)", () => {
  test("At a glance first, then every answer visible: no <details>, no hidden panels", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/faq/`, { waitUntil: "load" });
    const read = await readPage(page);
    const visible = await page.evaluate(
      (ids) => ids.map((id) => ({ id, visible: document.getElementById(id)?.checkVisibility({ visibilityProperty: true }) ?? false })),
      faqItems.map((item) => item.id),
    );
    const glance = await page.evaluate(() => [...document.querySelectorAll("#at-a-glance dt")].map((dt) => dt.textContent.trim()));
    await context.close();
    assert.equal(read.sections[0]?.id, "at-a-glance");
    assert.deepEqual(glance, faqAtAGlance.map((fact) => fact.term));
    assert.equal(read.details, 0);
    for (const answer of visible) assert.ok(answer.visible, `#${answer.id} is not visible`);
  });

  test("FAQPage structured data is on /faq/ and on no other page", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const withFaq = [];
    for (const r of indexable) {
      await page.goto(`${base}${r.path}`, { waitUntil: "domcontentloaded" });
      const read = await readPage(page);
      if (read.jsonLdTypes.includes("FAQPage")) withFaq.push(r.path);
    }
    await context.close();
    result.faqPageOn = withFaq;
    assert.deepEqual(withFaq, ["/faq/"]);
  });
});

describe("/compare/ (§3.10)", () => {
  test("its ids kept, and each row's named checks linked from the Run Hound cell", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/compare/`, { waitUntil: "load" });
    const read = await readPage(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("#at-a-glance tbody tr")].map((tr) => ({
        capability: tr.querySelector("th")?.textContent.trim(),
        links: [...tr.querySelectorAll("td:first-of-type a")].map((a) => a.getAttribute("href")),
      })),
    );
    await context.close();
    assert.deepEqual(
      read.sections.map((s) => s.id),
      ["at-a-glance", "tool-by-tool", "not-yet"],
    );
    for (const row of capabilities) {
      const shown = rows.find((r) => r.capability === row.capability);
      assert.ok(shown, row.capability);
      assert.deepEqual(shown.links, (row.checks ?? []).map((id) => checkLink(id).href), row.capability);
    }
  });

  test("at 390 px the table scrolls inside its region and the page does not", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await page.goto(`${base}/compare/`, { waitUntil: "load" });
    const box = await page.evaluate(() => {
      const region = document.querySelector('#at-a-glance [role="region"]');
      return {
        scrolls: region.scrollWidth > region.clientWidth,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        focusable: region.tabIndex === 0,
      };
    });
    await context.close();
    assert.ok(box.scrolls, "the table fits at 390 px, so the region needn't scroll");
    assert.ok(box.focusable, "the region can't take focus, so the keyboard can't scroll it");
    assert.equal(box.overflowX, 0);
  });

  // WCAG 2.4.11 (§5.2 Keyboard gate): with the region scrolled to its right end, Shift+Tab back onto a check link
  // scrolls it only as far as the region's left edge, which is under the sticky capability column unless the region's
  // scroll padding keeps it clear (before it, row 2's "Dead controls" was 91 of 91 px under the column at 1024). Chromium
  // doesn't scroll a link that is already partly in view, so ScrollRegion's focus handler scrolls that one clear too
  // (with the padding alone, "Credential fields" stayed 102 of 103 px under at 1024). result.compare records each link.
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
  ]) {
    test(`at ${viewport.width}×${viewport.height}, Shift+Tab onto a check link never leaves it under the sticky column`, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await page.goto(`${base}/compare/`, { waitUntil: "load" });
      const links = await page.evaluate(() =>
        [...document.querySelectorAll("#at-a-glance tbody tr")].flatMap((tr, row) =>
          [...tr.querySelectorAll("td:first-of-type a")].map((a, i) => ({ row, i, label: a.textContent.trim() })),
        ),
      );
      const checked = [];
      for (const { row, i, label } of links) {
        // Focus the link, Tab to whatever follows it, scroll the region to its right end, then Shift+Tab back.
        await page.evaluate(
          ({ row, i }) => document.querySelectorAll("#at-a-glance tbody tr")[row].querySelectorAll("td:first-of-type a")[i].focus(),
          { row, i },
        );
        await page.keyboard.press("Tab");
        await page.evaluate(() => {
          const region = document.querySelector('#at-a-glance [role="region"]');
          region.scrollLeft = region.scrollWidth;
        });
        await page.keyboard.press("Shift+Tab");
        checked.push(
          await page.evaluate(
            ({ row, i, label }) => {
              const tr = document.querySelectorAll("#at-a-glance tbody tr")[row];
              const link = tr.querySelectorAll("td:first-of-type a")[i];
              const a = link.getBoundingClientRect();
              const th = tr.querySelector("th").getBoundingClientRect();
              const overlap = Math.max(0, Math.min(a.right, th.right) - Math.max(a.left, th.left));
              return { row: row + 1, label, focused: document.activeElement === link, overlap: Math.round(overlap), width: Math.round(a.width) };
            },
            { row, i, label },
          ),
        );
      }
      await context.close();
      result.compare = { ...(result.compare ?? {}), [`sticky ${viewport.width}`]: checked };
      assert.ok(checked.length > 0, "no check links in the table");
      assert.ok(checked.some((c) => c.row === 2), "row 2 has no check links");
      for (const c of checked) {
        assert.ok(c.focused, `row ${c.row} "${c.label}": Shift+Tab didn't land back on it`);
        assert.equal(c.overlap, 0, `row ${c.row} "${c.label}": ${c.overlap} of ${c.width} px under the sticky column`);
      }
    });
  }
});
