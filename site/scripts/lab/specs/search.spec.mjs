/**
 * Site search on the built site (DESIGN.md §3.16; node H1): Ctrl+K and ⌘K open the dialog, which loads only then
 * (nothing of it or of Pagefind in the page's initial requests, and the first heading in every page's HTML is its
 * h1); its status announces a count; results come within 1 s of the last keystroke and the first query moves at most
 * 300 KB; arrow keys move through the results and Enter follows one; Escape closes it and focus returns to where it
 * was; no CSP violation; axe finds nothing with it open. Run: pnpm lab search.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { focusInfo } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";

const base = origin();
const { indexable, internal } = await labRoutes();
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("search.json", result);
});

const dialogOpen = (page) => page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
const status = (page) => page.evaluate(() => document.querySelector("dialog [role='status']")?.textContent.trim() ?? null);

/** Types a query into the open dialog and waits until its status names a count or no results; returns ms taken. */
async function query(page, text) {
  await page.fill("dialog input[type='search']", "");
  await page.keyboard.type(text, { delay: 30 });
  const typed = Date.now();
  await page.waitForFunction(
    (q) => {
      const s = document.querySelector("dialog [role='status']")?.textContent ?? "";
      return /\d+ results?$|^No results/.test(s.trim()) && document.querySelector("dialog")?.dataset.query === q;
    },
    text,
    { timeout: 10_000 },
  );
  return Date.now() - typed;
}

describe("the first heading of every page is its h1; no dialog in the HTML (G-T3)", () => {
  test("every registry page", async () => {
    for (const route of [...indexable, ...internal]) {
      const html = await (await fetch(`${base}${route.path}`)).text();
      const first = /<h([1-6])[\s>]/.exec(html)?.[1];
      assert.equal(first, "1", `${route.path}: the first heading is an h${first}`);
      assert.ok(!/<dialog[\s>]/.test(html), `${route.path} has a dialog in its HTML`);
      const trigger = /<button\b[^>]*\bdata-search-trigger\b[^>]*>/.exec(html)?.[0] ?? "";
      assert.ok(trigger.includes('aria-keyshortcuts="Control+K Meta+K"'), `${route.path}: the trigger is server-rendered with its shortcuts`);
    }
  });
});

describe("Ctrl+K, ⌘K and the button open it; it loads on first open", () => {
  test("nothing of the dialog or Pagefind loads with the page; Ctrl+K opens it, Escape returns focus", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const log = recordRequests(page);
    await page.goto(`${base}/`, { waitUntil: "load" });
    await sleep(1500);
    const before = log.requests.filter((r) => r.path.startsWith("/pagefind/") || /pagefind\/pagefind\.js/.test(r.path));
    const initialScripts = log.requests.filter((r) => r.type === "script").map((r) => r.path);
    // Warming (pointer or focus on the trigger) may fetch the dialog's chunk; nothing loads before either.
    assert.deepEqual(before, [], "no Pagefind request before the dialog opens");
    // Focus a link first: Escape must return there.
    await page.focus(`header nav[aria-label='Main'] a`);
    const opener = (await focusInfo(page)).name;
    log.phase("open");
    await page.keyboard.press("Control+k");
    await page.waitForSelector("dialog[open]");
    await sleep(100);
    assert.equal(await page.evaluate(() => document.activeElement?.matches("dialog input[type='search']")), true, "focus is in the field");
    const took = await query(page, "double-submit");
    const opened = log.requests.filter((r) => r.phase === "open");
    const bytes = opened.reduce((sum, r) => sum + r.bytes, 0);
    result.firstQuery = { took, bytes, requests: opened.map((r) => `${r.path} ${r.bytes}`), initialScripts, status: await status(page) };
    assert.match(await status(page), /^\d+ results?$/, "the status announces a count");
    assert.ok(took <= 1000, `results ${took} ms after the last keystroke (≤ 1,000)`);
    assert.ok(bytes <= 300_000, `the first query moved ${bytes} B (≤ 300 KB)`);
    assert.ok(opened.some((r) => r.path.endsWith("/pagefind/pagefind.js")), "pagefind.js loads when it opens");

    await page.keyboard.press("Escape");
    await sleep(150);
    assert.equal(await dialogOpen(page), false, "Escape closes it");
    assert.equal((await focusInfo(page))?.name, opener, "focus returns to where it was");

    await page.keyboard.press("Meta+k");
    await page.waitForSelector("dialog[open]");
    assert.equal(await dialogOpen(page), true, "⌘K opens it");
    await page.keyboard.press("Escape");
    assert.deepEqual(await cspViolations(page), [], "no CSP violation");
    await context.close();
  });

  test("the trigger opens it on a phone; the empty state; axe with it open", async () => {
    const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click("[data-search-trigger]");
    await page.waitForSelector("dialog[open]");
    await query(page, "zzqqxv");
    const empty = await page.evaluate(() => document.querySelector("dialog")?.innerText ?? "");
    assert.match(empty, /No results for “zzqqxv”\. Try a check id like double-submit, or browse the docs\./);
    await query(page, "csrf");
    const violations = (await runAxe(page)).violations;
    result.axeOpen = violations;
    assert.deepEqual(violations, []);
    const box = await page.evaluate(() => {
      const d = document.querySelector("dialog").getBoundingClientRect();
      return { left: d.left, right: d.right, overflowX: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(box.left >= 0 && box.right <= 390, `the dialog fits at 390 px (${box.left}-${box.right})`);
    await page.keyboard.press("Escape");
    await sleep(150);
    assert.equal((await focusInfo(page))?.name, "Search", "focus returns to the trigger");
    assert.deepEqual(await cspViolations(page), []);
    await context.close();
  });

  test("a click that moves no focus (Safari): Escape returns focus to the trigger, not the top of the page", async () => {
    const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    // element.click() from script fires the click without moving focus, as a mouse click does in Safari.
    await page.evaluate(() => {
      document.activeElement?.blur();
      [...document.querySelectorAll("[data-search-trigger]")].find((el) => el.checkVisibility()).click();
    });
    await page.waitForSelector("dialog[open]");
    await page.keyboard.press("Escape");
    await sleep(150);
    assert.equal(await dialogOpen(page), false);
    assert.equal((await focusInfo(page))?.name, "Search", "focus goes to the trigger");
    await context.close();
  });
});

describe("keys inside the dialog", () => {
  test("arrow keys move through the results; Enter follows one; the dialog closes", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.keyboard.press("Control+k");
    await page.waitForSelector("dialog[open]");
    await query(page, "double-submit");
    const results = await page.$$eval("dialog [data-result]", (links) => links.map((a) => ({ href: a.getAttribute("href"), text: a.innerText })));
    result.results = results;
    assert.ok(results.length > 0, "results are links");
    assert.ok(results.some((r) => /Check|Page|Docs|FAQ/.test(r.text)), "each shows its group");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), results[0].href, "ArrowDown focuses the first result");
    if (results.length > 1) {
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), results[1].href);
      await page.keyboard.press("ArrowUp");
    }
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => document.activeElement?.matches("input[type='search']")), true, "ArrowUp returns to the field");
    await page.keyboard.press("ArrowDown");
    const target = results[0].href;
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => `${url.pathname}${url.hash}` === target || url.pathname === target.split("#")[0], { timeout: 10_000 });
    await sleep(200);
    assert.equal(await dialogOpen(page), false, "the dialog closes when a result is followed");
    await context.close();
  });

  test("Ctrl+K in a text field of the page doesn't open search", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "lab-field";
      document.querySelector("main").prepend(input);
    });
    await page.focus("#lab-field");
    await page.keyboard.press("Control+k");
    await sleep(300);
    assert.equal(await dialogOpen(page), false);
    await context.close();
  });
});
