/**
 * The header on the built site (DESIGN.md §3.2; node H1): it fits from 1024 to 1440 px with no overflow or overlap;
 * the phone menu works by keyboard at 390×844 and at 400% zoom (320×256), where the header is static; the current hub
 * is marked on every /docs/* and /checks/* page; nothing in the header or footer overflows at 320 px; the bar turns
 * opaque after 8 px of scroll; and axe finds nothing with the menu open. Run: pnpm lab header.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { focusInfo, reflow, tabUntil } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { labRoutes } from "../lib/routes.mjs";

await import("../../test-hooks.mjs");
const { headerLinks } = await import("../../../src/lib/nav.ts");
const { site } = await import("../../../src/lib/site.ts");

const base = origin();
const { indexable, internal, notFound } = await labRoutes();
const hubs = headerLinks();
const menuLabels = [...hubs.map((h) => h.label), "GitHub", `Changelog · v${site.version}`, site.cta];
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("header.json", result);
});

/** The header's visible interactive items, left to right, with their boxes and names. */
const barItems = (page) =>
  page.evaluate(() => {
    const header = document.querySelector("body > header");
    const items = [...header.querySelectorAll("a, button")]
      .filter((el) => !el.closest("#site-menu") && el.checkVisibility())
      .map((el) => {
        const box = el.getBoundingClientRect();
        // What is rendered (innerText: display:none text left out, visually hidden text kept), as the name is.
        const name = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ");
        return { name, left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
      })
      .sort((a, b) => a.left - b.left);
    return {
      items,
      headerHeight: header.getBoundingClientRect().height,
      overflow: header.scrollWidth - header.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: innerWidth,
    };
  });

describe("fit (§3.2): 0 overflow and no overlap", () => {
  for (const width of [1024, 1100, 1279, 1280, 1366, 1440]) {
    test(`at ${width} px`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      const bar = await barItems(page);
      result[`fit${width}`] = bar;
      await context.close();
      assert.equal(bar.overflow, 0, "the header overflows");
      assert.equal(bar.pageOverflow, 0, "the page overflows");
      assert.equal(bar.headerHeight, 64, "the header is 64 px");
      for (const item of bar.items) {
        assert.ok(item.left >= 0 && item.right <= width, `${item.name} is outside the viewport (${item.left}-${item.right})`);
      }
      for (let i = 1; i < bar.items.length; i += 1) {
        const [a, b] = [bar.items[i - 1], bar.items[i]];
        assert.ok(b.left >= a.right, `${a.name} and ${b.name} overlap (${a.right} > ${b.left})`);
      }
      const names = bar.items.map((item) => item.name);
      assert.ok(names.includes(site.name), `the wordmark shows: ${names.join(" | ")}`);
      for (const hub of hubs) assert.ok(names.includes(hub.label), `${hub.label} is in the bar: ${names.join(" | ")}`);
      assert.ok(names.includes(site.cta), "Try it locally is in the bar");
      if (width >= 1280) {
        assert.ok(names.includes("Search Ctrl K"), `Search with its hint: ${names.join(" | ")}`);
        assert.ok(names.includes(`v${site.version} changelog`), "the release chip");
        assert.ok(names.includes("GitHub"), "GitHub");
      } else {
        assert.ok(names.includes("Search"), `Search as an icon button: ${names.join(" | ")}`);
        assert.ok(!names.some((name) => name.startsWith("v0.") || name.includes("changelog")), "no chip below 1280 px");
        assert.ok(names.includes("GitHub"), "GitHub as an icon button");
        const icons = bar.items.filter((item) => item.name === "Search" || item.name === "GitHub");
        for (const icon of icons) assert.ok(icon.right - icon.left >= 44 && icon.height >= 44, `${icon.name} is a 44 px target`);
      }
    });
  }

  test("below 1024 px: the mark and wordmark, Search and Menu only", async () => {
    const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    const bar = await barItems(page);
    result.fit390 = bar;
    await context.close();
    assert.deepEqual(
      bar.items.map((item) => item.name),
      [site.name, "Search", "Menu"],
    );
    assert.equal(bar.overflow, 0);
  });
});

/** Opens the menu by keyboard from the top of the page: Tab until Menu, then Enter. */
async function openMenuByKeyboard(page) {
  const menu = await tabUntil(page, /^Menu$/, { max: 10 });
  assert.ok(menu, "Menu is reachable by Tab");
  await page.keyboard.press("Enter");
  await sleep(250);
  assert.equal(await page.getAttribute("button[aria-controls='site-menu']", "aria-expanded"), "true");
  // A disclosure keeps its name; aria-expanded carries the state (no "Close, expanded").
  assert.equal((await focusInfo(page))?.name, "Menu", "the open Menu button is still named Menu");
}

describe("the phone menu by keyboard (E1)", () => {
  for (const [name, viewport] of [
    ["390×844", { width: 390, height: 844 }],
    ["320×256 (400% zoom)", { width: 320, height: 256 }],
  ]) {
    test(`at ${name}: Tab lands on the first item, all 8 reachable, Escape returns to Menu, leaving closes it`, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      const layout = await reflow(page);
      if (viewport.height <= 480) assert.equal(layout.headerPosition, "static", "the header is static at max-height 30rem (E3)");
      else assert.equal(layout.headerPosition, "sticky");

      await openMenuByKeyboard(page);
      const reached = [];
      for (let i = 0; i < menuLabels.length; i += 1) {
        await page.keyboard.press("Tab");
        await sleep(40);
        const info = await focusInfo(page);
        const inMenu = await page.evaluate(() => Boolean(document.activeElement?.closest("#site-menu")));
        reached.push({ name: info?.name, inMenu, ring: info?.ring, fullyObscured: info?.fullyObscured });
      }
      result[`menu ${name}`] = reached;
      assert.deepEqual(
        reached.map((r) => r.name),
        menuLabels,
        "Tab from Menu goes through the 8 items in order",
      );
      assert.ok(reached.every((r) => r.inMenu), "every stop is in the menu");
      assert.ok(reached.every((r) => r.ring), "every stop shows a focus ring");
      assert.ok(reached.every((r) => !r.fullyObscured), "no stop is hidden under a sticky bar");

      await page.keyboard.press("Escape");
      await sleep(100);
      assert.equal(await page.$("#site-menu"), null, "Escape closes the menu");
      assert.equal((await focusInfo(page))?.name, "Menu", "focus returns to Menu");

      await page.keyboard.press("Enter");
      await sleep(200);
      assert.ok(await page.$("#site-menu"), "Enter on Menu opens it again");
      for (let i = 0; i < menuLabels.length + 1; i += 1) await page.keyboard.press("Tab");
      await sleep(100);
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("header"))), false, "focus left the header");
      assert.equal(await page.$("#site-menu"), null, "focus leaving the header closes the menu");
      assert.equal(await page.getAttribute("button[aria-controls='site-menu']", "aria-expanded"), "false");

      assert.deepEqual(await cspViolations(page), []);
      await context.close();
    });
  }

  test("following a link closes the menu", async () => {
    const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click("button[aria-controls='site-menu']");
    await page.click(`#site-menu a[href='${hubs[1].href}']`);
    await page.waitForURL(`${base}${hubs[1].href}`);
    await sleep(200);
    assert.equal(await page.$("#site-menu"), null);
    await context.close();
  });

  test("with focus on <body> (a click that moves no focus, as in Safari): Escape closes it, a press outside closes it", async () => {
    const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    const menu = "button[aria-controls='site-menu']";
    // element.click() from script fires the click without moving focus, as a mouse click does in Safari.
    await page.evaluate((sel) => {
      document.activeElement?.blur();
      document.querySelector(sel).click();
    }, menu);
    await page.waitForSelector("#site-menu");
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "focus is on <body>");
    await page.keyboard.press("Escape");
    await sleep(100);
    assert.equal(await page.$("#site-menu"), null, "Escape closes the menu with focus on <body>");
    assert.equal((await focusInfo(page))?.name, "Menu", "and focus goes to Menu");

    await page.evaluate((sel) => document.querySelector(sel).click(), menu);
    await page.waitForSelector("#site-menu");
    const panel = await page.evaluate(() => {
      const box = document.querySelector("#site-menu").getBoundingClientRect();
      return { x: box.left + 4, y: box.bottom - 4 };
    });
    await page.mouse.click(panel.x, panel.y);
    await sleep(100);
    assert.ok(await page.$("#site-menu"), "a press on the panel's padding keeps it open");
    // The open panel covers the page below the bar, so a real press can't reach <main>: dispatch one on it.
    await page.evaluate(() => document.querySelector("main").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await sleep(100);
    assert.equal(await page.$("#site-menu"), null, "a press outside the header closes it");
    await context.close();
  });

  test("the open menu fits under the bar and scrolls within the viewport", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 320, height: 256 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click("button[aria-controls='site-menu']");
    const panel = await page.evaluate(() => {
      const el = document.querySelector("#site-menu");
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().height));
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, overflowY: getComputedStyle(el).overflowY, rows };
    });
    result.menuPanel320x256 = panel;
    await context.close();
    assert.equal(panel.top, 64, "the panel sits under the 64 px bar");
    assert.ok(panel.bottom <= 256 + 0.5, `the panel ends inside the viewport (${panel.bottom})`);
    assert.equal(panel.overflowY, "auto");
    assert.ok(panel.rows.every((h) => h >= 48), `48 px rows: ${panel.rows.join(", ")}`);
    // The panel spans the viewport and no more (the page's own content is the homepage's to fit).
    assert.ok(panel.left >= 0 && panel.right <= 320, `the panel fits across 320 px (${panel.left}-${panel.right})`);
  });
});

describe("the current hub (aria-current on every /docs/* and /checks/* page)", () => {
  test("in the prerendered HTML of every page", async () => {
    const seen = {};
    for (const route of [...indexable, ...internal]) {
      const htmlText = await (await fetch(`${base}${route.path}`)).text();
      const bar = /<header[\s\S]*?<\/header>/.exec(htmlText)?.[0] ?? "";
      const current = [...bar.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((m) => /href="([^"]*)"/.exec(m[0])?.[1]);
      const expected = hubs.filter((hub) => route.path.startsWith(hub.href)).map((hub) => hub.href);
      seen[route.path] = current;
      assert.deepEqual(current, expected, `${route.path}: current ${current.join(", ") || "none"}`);
    }
    result.current = seen;
  });

  test("after navigating on the client, the new hub is current", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click(`header nav[aria-label='Main'] a[href='${hubs[1].href}']`);
    await page.waitForURL(`${base}${hubs[1].href}`);
    await sleep(200);
    const current = await page.$$eval("header nav[aria-label='Main'] a[aria-current='page']", (links) => links.map((a) => a.getAttribute("href")));
    const style = await page.$eval("header nav[aria-label='Main'] a[aria-current='page']", (a) => {
      const s = getComputedStyle(a);
      return { color: s.color, line: s.textDecorationLine, decoration: s.textDecorationColor, thickness: s.textDecorationThickness };
    });
    result.currentStyle = style;
    await context.close();
    assert.deepEqual(current, [hubs[1].href]);
    assert.equal(style.color, "rgb(233, 239, 236)", "the current hub is fg");
    assert.equal(style.line, "underline");
    assert.equal(style.decoration, "rgb(94, 230, 163)", "with an accent underline");
    assert.equal(style.thickness, "2px");
  });
});

describe("reflow at 320 px (every page): nothing in the header or footer reaches past the viewport", () => {
  test("320×720", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
    const wide = {};
    for (const path of [...indexable.map((r) => r.path), notFound]) {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      const over = await page.evaluate(() =>
        [...document.querySelectorAll("body > header *, body > footer *")]
          .filter((el) => el.checkVisibility() && el.getBoundingClientRect().right > innerWidth + 0.5)
          .map((el) => `${el.tagName.toLowerCase()} ${(el.textContent ?? "").trim().slice(0, 20)} (${Math.round(el.getBoundingClientRect().right)})`),
      );
      if (over.length) wide[path] = over;
    }
    result.reflow320 = wide;
    await context.close();
    assert.deepEqual(wide, {});
  });
});

describe("the bar turns opaque after 8 px of scroll (CSS scroll-driven, a step)", () => {
  for (const reducedMotion of ["no-preference", "reduce"]) test(`transparent at the top, bg at 86% with a line-soft border from 8 px (${reducedMotion})`, async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion });
    await page.goto(`${base}/`, { waitUntil: "load" });
    // Colours read back as sRGB through a canvas pixel: Chromium serialises color-mix() and relative colours as
    // oklab() or color(), which a regex for rgb() would miss.
    const read = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.querySelector("body > header"));
        const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
        const rgba = (color) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = "rgba(0, 0, 0, 0)";
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          return { r, g, b, a: Math.round((a / 255) * 100) / 100 };
        };
        return { background: rgba(s.backgroundColor), border: rgba(s.borderBottomColor), position: s.position };
      });
    const top = await read();
    await page.evaluate(() => window.scrollTo(0, 4));
    await sleep(100);
    const four = await read();
    await page.evaluate(() => window.scrollTo(0, 200));
    await sleep(100);
    const scrolled = await read();
    result[`scroll-${reducedMotion}`] = { top, four, scrolled };
    await context.close();
    assert.equal(top.position, "sticky");
    assert.equal(top.background.a, 0, `transparent at the top: ${JSON.stringify(top.background)}`);
    assert.equal(four.background.a, 0, `still transparent at 4 px: ${JSON.stringify(four.background)}`);
    assert.ok(Math.abs(scrolled.background.a - 0.86) <= 0.01, `bg at 86% after 8 px: ${JSON.stringify(scrolled.background)}`);
    assert.deepEqual(scrolled.border, { r: 23, g: 33, b: 39, a: 1 }, "a line-soft border");
  });
});

describe("axe-core with the header in each state", () => {
  test("0 violations: the menu open at 390×844, the bar at 1280×720", async () => {
    const found = {};
    {
      const { context, page } = await newPage(browser, { profile: "phone", reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.click("button[aria-controls='site-menu']");
      await sleep(200);
      found.menuOpen = (await runAxe(page)).violations;
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
      await page.goto(`${base}${hubs[0].href}`, { waitUntil: "load" });
      found.bar1280 = (await runAxe(page)).violations;
      await context.close();
    }
    result.axe = found;
    assert.deepEqual(found, { menuOpen: [], bar1280: [] });
  });
});
