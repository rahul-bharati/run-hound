/**
 * The checks hub and the check-page template on the built site (DESIGN.md §3.6, §3.7; node C1). A check page (the
 * double-submit page, the first one): the breadcrumb Home / Checks / <name>, the facts panel, the step trail whose last
 * ring is fail, the finding as the report prints it, #reproduce with the run's full Playwright test and a Copy that
 * copies all of it, the TechArticle, axe-core 0 at 1280×720 and 390×844, no sideways scroll at 320 px, and the HTML
 * budget (90,000 B raw, 15,000 B gzip -9). The hub: the group anchors and #ai-flow; every built-in check keeps its card
 * and id; a card links its check's page when the page exists and nothing else; at most 8 screens at 1440×900 and 14 at
 * 390×844. Run: pnpm lab checks.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import { distDir, distName, siteDir } from "../../lib/build-output.mjs";
import { runAxe } from "../lib/audits.mjs";
import { launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { measurePage } from "../lib/page-measures.mjs";

await import("../../test-hooks.mjs");
const { builtInChecks, aiFlowCheck, previewGroups } = await import("../../../src/content/checks/data.ts");
const { checkPages } = await import("../../../src/content/checks/pages/index.ts");
const { featuredFinding } = await import("../../../src/components/checks/run-evidence.ts");
const { ui } = await import("../../../src/content/ui.ts");

const base = origin();
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("checks.json", result);
});

const withPages = new Set(checkPages.map((p) => p.id));

/** A page's text as the search index holds it (scripts/pagefind.mjs writes one gzip fragment per page), or undefined. */
function indexedText(path) {
  const dir = join(distName === ".next" ? join(siteDir, "public") : distDir, "pagefind", "fragment");
  if (!existsSync(dir)) return undefined;
  for (const file of readdirSync(dir)) {
    const fragment = JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString("utf8").replace(/^pagefind_dcd/, ""));
    if (fragment.url === path) return fragment.content;
  }
  return undefined;
}
const page = "/checks/double-submit/";
const check = builtInChecks.find((c) => c.id === "double-submit");
const featured = featuredFinding("double-submit");

describe("a check page: /checks/double-submit/", () => {
  test("the breadcrumb is Home / Checks / Double submit, the current page not a link", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const crumbs = await tab.$$eval('nav[aria-label="Breadcrumb"] li', (items) =>
      items.map((li) => ({ text: li.textContent.replace("/", "").trim(), href: li.querySelector("a")?.getAttribute("href") ?? null })),
    );
    await context.close();
    assert.deepEqual(crumbs, [
      { text: "Home", href: "/" },
      { text: "Checks", href: "/checks/" },
      { text: check.name, href: null },
    ]);
  });

  test("the h1 is the check's name, first heading in <main>; the id is on the page for search", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const heads = await tab.$$eval("main h1, main h2, main h3", (hs) => hs.map((h) => ({ tag: h.tagName, text: h.textContent.trim() })));
    const text = await tab.$eval("main", (m) => m.innerText);
    await context.close();
    assert.deepEqual(heads[0], { tag: "H1", text: check.name });
    assert.match(text, /double-submit/);
    for (const heading of [ui.checkPage.howTested, ui.checkPage.finding, ui.checkPage.reproduce, ui.checkPage.fix, ui.checkPage.limits, ui.checkPage.related]) {
      assert.ok(heads.some((h) => h.tag === "H2" && h.text.endsWith(heading)), `no h2 "${heading}"`);
    }
  });

  test("search: the id is a word of the page's indexed text, the group as written, each section number apart", () => {
    const text = indexedText(page);
    assert.ok(text, `no search fragment for ${page} (the build runs scripts/pagefind.mjs)`);
    result.indexed = text.slice(0, 400);
    assert.match(text, /(?:^|[\s.])double-submit[\s.]/, "the id runs into its neighbours");
    assert.ok(text.includes(check.group), `the group "${check.group}" as written`);
    assert.doesNotMatch(text, new RegExp(check.group.toUpperCase()), "the group is upper case in the text, not only on screen");
    for (const heading of [ui.checkPage.howTested, ui.checkPage.finding, ui.checkPage.fix]) {
      assert.doesNotMatch(text, new RegExp(`\\d${heading}`), `a section number runs into "${heading}"`);
    }
  });

  test("the limits carry no tick: a tick beside what isn't tested would read as passed", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const limits = await tab.$$eval('section[aria-labelledby="limits"] li', (items) => items.map((li) => li.querySelector(".tick") !== null));
    await context.close();
    assert.ok(limits.length >= 2, "2 to 4 limits");
    assert.deepEqual(limits, limits.map(() => false));
  });

  test("the facts panel: the seven facts, in order", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const facts = await tab.$$eval("main dl.facts-list .facts-row", (rows) =>
      rows.map((row) => [row.querySelector("dt").textContent.trim(), row.querySelector("dd").textContent.trim()]),
    );
    await context.close();
    const keys = ui.checkPage.facts;
    assert.deepEqual(
      facts.map(([term]) => term),
      [keys.id, keys.group, keys.severity, keys.records, keys.signIn, keys.ticked, keys.added],
    );
    assert.equal(facts[0][1], "double-submit");
    assert.equal(facts[1][1], "Features");
    assert.match(facts[2][1], /^high$/i);
    assert.equal(facts[3][1], check.records);
    assert.equal(facts[6][1], "0.1.0");
  });

  test("How Run Hound tests it: a step trail of the run's steps whose last ring is fail", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const rings = await tab.$$eval("main ol.step-trail > li .step-ring", (els) => els.map((el) => el.getAttribute("data-tone")));
    const labels = await tab.$$eval("main ol.step-trail > li .step-label", (els) => els.map((el) => el.textContent.trim()));
    await context.close();
    assert.ok(rings.length >= 3);
    assert.equal(rings.at(-1), "fail");
    assert.ok(rings.slice(0, -1).every((tone) => tone === null), "only the last ring is marked");
    for (const label of labels) assert.ok(featured.scenario.steps.includes(label), label);
  });

  test("What a finding looks like: the report's title, meaning and impact, verbatim", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const text = await tab.$eval("main", (m) => m.innerText.replace(/\s+/g, " "));
    await context.close();
    for (const value of [featured.finding.title, featured.finding.meaning, featured.finding.impact, featured.finding.fix]) {
      assert.ok(text.includes(value.replace(/\s+/g, " ")), `missing: ${value}`);
    }
  });

  test("#reproduce holds the run's full Playwright test, and Copy copies all of it", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    await tab.goto(`${base}${page}#reproduce`, { waitUntil: "load" });
    const section = tab.locator("#reproduce");
    const shown = await section.locator("pre").first().innerText();
    await section.getByRole("button", { name: /^Copy/ }).first().click();
    await sleep(200);
    const copied = await tab.evaluate(() => navigator.clipboard.readText());
    const status = await section.locator('[role="status"]').first().textContent();
    const runIt = await section.innerText();
    await context.close();
    assert.equal(shown.trim(), featured.finding.spec.source.trim());
    assert.equal(copied, featured.finding.spec.source);
    assert.match(status ?? "", /^Copied/);
    assert.ok(runIt.includes(`npx playwright test ${featured.finding.spec.filename}`));
  });

  test("the structured data: WebPage, BreadcrumbList and a TechArticle headed by the h1", async () => {
    const html = await (await fetch(`${base}${page}`)).text();
    const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const nodes = graphs.flatMap((g) => g["@graph"] ?? [g]);
    const types = nodes.map((n) => n["@type"]);
    assert.ok(types.includes("WebPage"));
    assert.ok(types.includes("BreadcrumbList"));
    const article = nodes.find((n) => n["@type"] === "TechArticle");
    assert.equal(article?.headline, check.name);
  });

  test("the HTML budget: at most 90,000 B raw and 15,000 B gzip -9", async () => {
    const html = Buffer.from(await (await fetch(`${base}${page}`)).arrayBuffer());
    const gzip = gzipSync(html, { level: 9 }).length;
    result.html = { raw: html.length, gzip };
    assert.ok(html.length <= 90_000, `${html.length} B raw`);
    assert.ok(gzip <= 15_000, `${gzip} B gzip`);
  });

  test("no sideways scroll at 320 px, and the facts come after the lede on phones", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const layout = await reflow(tab);
    const order = await tab.evaluate(() => {
      const top = (el) => el?.getBoundingClientRect().top ?? -1;
      return { lede: top(document.querySelector("main [data-check-lede]")), facts: top(document.querySelector("main dl.facts-list")), steps: top(document.querySelector("main ol.step-trail")) };
    });
    await context.close();
    result.reflow320 = { ...layout, order };
    assert.equal(layout.overflowX, 0);
    assert.ok(order.lede < order.facts && order.facts < order.steps, JSON.stringify(order));
  });

  test("the facts panel sits beside the text from 1024 px", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await tab.goto(`${base}${page}`, { waitUntil: "load" });
    const boxes = await tab.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const facts = box(document.querySelector("main dl.facts-list"));
      const steps = box(document.querySelector("main ol.step-trail"));
      return { factsLeft: facts.left, stepsRight: steps.right };
    });
    await context.close();
    assert.ok(boxes.factsLeft >= boxes.stepsRight, JSON.stringify(boxes));
  });

  for (const [name, viewport] of [
    ["1280×720", { width: 1280, height: 720 }],
    ["390×844", { width: 390, height: 844 }],
  ]) {
    test(`axe-core finds nothing at ${name}`, async () => {
      const { context, page: tab } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await tab.goto(`${base}${page}`, { waitUntil: "load" });
      await sleep(300);
      const axe = await runAxe(tab);
      await context.close();
      result[`axe-page-${name}`] = axe;
      assert.deepEqual(axe.violations, []);
    });
  }
});

describe("the hub: /checks/", () => {
  test("the three group anchors, #preview, #ai-flow, #not-visible and #catalog", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await tab.goto(`${base}/checks/`, { waitUntil: "load" });
    const ids = await tab.$$eval("main [id]", (els) => els.map((el) => el.id));
    await context.close();
    for (const id of [...previewGroups.map((g) => g.anchor), "preview", aiFlowCheck.id, "not-visible", "catalog"]) {
      assert.ok(ids.includes(id), `#${id}`);
    }
  });

  test("what a browser can't see carries no tick: a tick beside it would read as checked", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await tab.goto(`${base}/checks/`, { waitUntil: "load" });
    const items = await tab.$$eval("#not-visible li", (lis) => lis.map((li) => li.querySelector(".tick") !== null));
    await context.close();
    assert.ok(items.length > 0);
    assert.deepEqual(items, items.map(() => false));
  });

  test("every built-in check keeps its card and id; a card links its check's page when the page exists, and nothing else", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await tab.goto(`${base}/checks/`, { waitUntil: "load" });
    const cards = await tab.evaluate((ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const card = document.getElementById(id);
          return [id, card ? { heading: card.querySelector("h3")?.textContent.trim() ?? null, links: [...card.querySelectorAll("a")].map((a) => a.getAttribute("href")) } : null];
        }),
      ),
    builtInChecks.map((c) => c.id));
    const h3 = await tab.$$eval("main h3", (hs) => hs.length);
    const transformed = await tab.$$eval("#preview li[id] :is(h3, p)", (els) => els.filter((el) => getComputedStyle(el).textTransform !== "none").length);
    await context.close();
    assert.equal(transformed, 0, "a card's name and lines are shown as written");
    result.cards = cards;
    for (const c of builtInChecks) {
      const card = cards[c.id];
      assert.ok(card, `no card #${c.id}`);
      assert.equal(card.heading, c.name, c.id);
      assert.deepEqual(card.links, withPages.has(c.id) ? [`/checks/${c.id}/`] : [], c.id);
    }
    assert.equal(h3, builtInChecks.length + 1, "h3 only for the 26 check cards and the AI flow's");
  });

  test("at most 8 screens at 1440×900 and 14 at 390×844, with no sideways scroll", async () => {
    for (const [name, viewport, limit] of [
      ["1440", { width: 1440, height: 900 }, 8],
      ["390", { width: 390, height: 844 }, 14],
    ]) {
      const { context, page: tab } = await newPage(browser, { viewport, reducedMotion: "reduce", profile: name === "390" ? "phone" : "desktop" });
      await tab.goto(`${base}/checks/`, { waitUntil: "load" });
      const measures = await measurePage(tab);
      await context.close();
      result[`hub-${name}`] = { screens: measures.screens, words: measures.mainWords, h2: measures.h2, h3: measures.h3, blocks: measures.blocks };
      assert.equal(measures.overflowX, 0, `${name}: sideways scroll`);
      assert.ok(measures.screens <= limit, `${name}: ${measures.screens} screens`);
    }
  });

  // The hub at release: every one of the 26 cards links its page (C2a, C2b and C2c add them). Until then, each card
  // without a link gets a copy of a linked card's "How it's tested →", so the screens hold for the final page now.
  test("still at most 8 and 14 screens once every card links its page", async () => {
    for (const [name, viewport, limit] of [
      ["1440", { width: 1440, height: 900 }, 8],
      ["390", { width: 390, height: 844 }, 14],
    ]) {
      const { context, page: tab } = await newPage(browser, { viewport, reducedMotion: "reduce", profile: name === "390" ? "phone" : "desktop" });
      await tab.goto(`${base}/checks/`, { waitUntil: "load" });
      const added = await tab.evaluate((ids) => {
        const model = ids.map((id) => document.getElementById(id)?.querySelector("a")?.parentElement).find(Boolean);
        if (!model) return -1;
        let count = 0;
        for (const id of ids) {
          const card = document.getElementById(id);
          if (card && !card.querySelector("a")) {
            card.append(model.cloneNode(true));
            count += 1;
          }
        }
        return count;
      }, builtInChecks.map((c) => c.id));
      const measures = await measurePage(tab);
      await context.close();
      result[`hub-all-linked-${name}`] = { added, screens: measures.screens };
      assert.ok(added >= 0, "no card links its page yet, so there is no link to copy");
      assert.equal(measures.overflowX, 0, `${name}: sideways scroll`);
      assert.ok(measures.screens <= limit, `${name}, every card linked: ${measures.screens} screens`);
    }
  });

  for (const [name, viewport] of [
    ["1280×720", { width: 1280, height: 720 }],
    ["390×844", { width: 390, height: 844 }],
  ]) {
    test(`axe-core finds nothing on the hub at ${name}`, async () => {
      const { context, page: tab } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await tab.goto(`${base}/checks/`, { waitUntil: "load" });
      const axe = await runAxe(tab);
      await context.close();
      result[`axe-hub-${name}`] = axe;
      assert.deepEqual(axe.violations, []);
    });
  }

  test("no sideways scroll at 320 px", async () => {
    const { context, page: tab } = await newPage(browser, { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
    await tab.goto(`${base}/checks/`, { waitUntil: "load" });
    const layout = await reflow(tab);
    await context.close();
    assert.equal(layout.overflowX, 0);
  });
});
