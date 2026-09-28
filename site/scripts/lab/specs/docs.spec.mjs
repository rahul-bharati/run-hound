/**
 * The docs on the built site (DESIGN.md §3.4, §3.5; node D1): the 11 pages render with their h1, breadcrumb and
 * JSON-LD (the visible trail equals the BreadcrumbList); the sidebar marks the current page; every old /docs/#id lands
 * on its hub card below the sticky header; the header and the docs bar are static at 320×256 and nothing overflows at
 * 320 px; Shift+Tab never leaves focus hidden under the bars; a CodeBlock's Copy copies the commands only; the quick
 * start is at most 4 desktop screens and the hub at most 2; initial JS ≤ 156,000 B gzip, HTML ≤ 90,000 B raw and
 * ≤ 15,000 B gzip (docs.json records each page's margin); no motion chunk is ever requested; no lazy JS (§5.2: 0),
 * where a script the header's route prefetches bring is not the page's own; the "On this page" marker is right at
 * every step of a slow scroll and after each jump; axe finds nothing at 1280, 1100 (the inline "On this page") and
 * 390 px. Run: pnpm lab docs.
 */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";
import { runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { focusInfo, reflow } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { measurePage } from "../lib/page-measures.mjs";
import { prefetches, recordRequests, scriptsIn } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";

await import("../../test-hooks.mjs");
const { commands } = await import("../../../src/content/commands.ts");
const { docsHub } = await import("../../../src/content/docs/hub.ts");
const { resolveTarget } = await import("../../../src/lib/nav.ts");

const base = origin();
const { indexable } = await labRoutes();
const hub = indexable.find((r) => r.path === "/docs/");
const pages = indexable.filter((r) => /^\/docs\/[a-z0-9-]+\/$/.test(r.path));
const docsRoutes = [hub, ...pages];
const result = { pages: {}, hub: {} };
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("docs.json", result);
});

/** The page's BreadcrumbList from its JSON-LD, and its visible breadcrumb, as [name, absolute URL] pairs. */
const trails = (page) =>
  page.evaluate(() => {
    const graph = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => JSON.parse(s.textContent)["@graph"] ?? []);
    const list = graph.find((node) => node["@type"] === "BreadcrumbList");
    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    const visible = [...(nav?.querySelectorAll("li") ?? [])].map((li) => {
      const link = li.querySelector("a");
      return [li.querySelector(".crumb")?.textContent.trim(), link ? new URL(link.getAttribute("href"), location.href).pathname : location.pathname];
    });
    const types = graph.map((node) => node["@type"]);
    return {
      jsonLd: (list?.itemListElement ?? []).map((item) => [item.name, new URL(item.item).pathname]),
      visible,
      types,
      h1: document.querySelector("h1")?.textContent.trim(),
      headline: graph.find((node) => node["@type"] === "TechArticle")?.headline ?? null,
    };
  });

describe("the 11 pages and the hub render (§3.4, §3.5)", () => {
  test("11 docs pages are registered and served", () => {
    assert.ok(hub, "/docs/ is registered");
    assert.equal(pages.length >= 11, true, `${pages.length} docs pages`);
  });

  test("each page: its h1, the breadcrumb equals the BreadcrumbList, a TechArticle whose headline is the h1", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    for (const route of docsRoutes) {
      const response = await page.goto(`${base}${route.path}`, { waitUntil: "load" });
      assert.equal(response.status(), 200, route.path);
      const t = await trails(page);
      result.pages[route.path] = { ...result.pages[route.path], trail: t };
      assert.ok(t.visible.length >= 2, `${route.path}: a visible breadcrumb`);
      assert.deepEqual(t.visible, t.jsonLd, `${route.path}: visible breadcrumbs = BreadcrumbList`);
      assert.deepEqual(t.visible.at(-1)?.[1], route.path);
      if (route === hub) {
        assert.equal(t.h1, "Docs");
        assert.ok(!t.types.includes("TechArticle"), "the hub: WebPage and BreadcrumbList only");
      } else {
        assert.ok(t.types.includes("TechArticle"), `${route.path}: a TechArticle`);
        assert.equal(t.headline, t.h1, `${route.path}: the headline is the h1`);
      }
      assert.deepEqual(await cspViolations(page), [], `${route.path}: no CSP violation`);
    }
    await context.close();
  });

  test("the sidebar marks the current page (desktop), and so does the Docs menu (phone)", async () => {
    for (const profile of ["desktop", "phone"]) {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      for (const route of pages) {
        await page.goto(`${base}${route.path}`, { waitUntil: "load" });
        if (profile === "phone") await page.click("summary:has-text('Docs menu')");
        const current = await page.evaluate(() =>
          [...document.querySelectorAll('nav[aria-label="Docs pages"] a[aria-current="page"]')]
            .filter((a) => a.checkVisibility())
            .map((a) => a.getAttribute("href")),
        );
        assert.deepEqual(current, [route.path], `${profile} ${route.path}`);
      }
      await context.close();
    }
  });
});

describe("old links (§3.4): each /docs/#id lands on its hub card", () => {
  const cards = docsHub.groups.flatMap((g) => g.cards);
  for (const profile of ["desktop", "phone"]) {
    test(`${profile}: every card id and #overview`, async () => {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      for (const id of [...cards.map((c) => c.id), "overview"]) {
        await page.goto(`${base}/docs/#${id}`, { waitUntil: "load" });
        await sleep(150);
        const landed = await page.evaluate((target) => {
          const element = document.getElementById(target);
          if (!element) return null;
          const header = document.querySelector("body > header").getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            isCard: element.classList.contains("card"),
            top: box.top,
            headerBottom: header.bottom,
            href: element.querySelector("a")?.getAttribute("href") ?? null,
          };
        }, id);
        assert.ok(landed, `#${id} exists on /docs/`);
        assert.ok(landed.top >= landed.headerBottom - 1, `#${id} lands below the header (${landed.top} < ${landed.headerBottom})`);
        assert.ok(landed.top < 900, `#${id} is in view`);
        if (id !== "overview") {
          assert.equal(landed.isCard, true, `#${id} is a card`);
          assert.equal(landed.href, resolveTarget(cards.find((c) => c.id === id)), `#${id} links its page`);
        }
      }
      await context.close();
    });
  }
});

describe("keyboard and reflow (E3, 2.4.11)", () => {
  test("at 320×256 the header and the docs bar are static; nothing overflows at 320 px", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 320, height: 256 }, reducedMotion: "reduce" });
    for (const route of docsRoutes) {
      await page.goto(`${base}${route.path}`, { waitUntil: "load" });
      const layout = await reflow(page);
      result.pages[route.path] = { ...result.pages[route.path], reflow320x256: layout };
      assert.equal(layout.headerPosition, "static", route.path);
      assert.deepEqual(layout.sticky, [], `${route.path}: nothing sticky at 400% zoom`);
      assert.equal(layout.overflowX, 0, `${route.path}: no horizontal overflow`);
    }
    await page.setViewportSize({ width: 320, height: 700 });
    for (const route of docsRoutes) {
      await page.goto(`${base}${route.path}`, { waitUntil: "load" });
      const layout = await reflow(page);
      assert.equal(layout.overflowX, 0, `${route.path}: no horizontal overflow at 320×700`);
      if (route !== hub) assert.ok(layout.sticky.some((s) => s.startsWith("div.docs-bar")), `${route.path}: the docs bar is sticky at 320×700`);
    }
    await context.close();
  });

  for (const [name, options] of [
    ["phone 390×844", { profile: "phone" }],
    ["desktop 1440×900", { profile: "desktop" }],
    ["1100×800", { viewport: { width: 1100, height: 800 } }],
  ]) {
    test(`${name}: Shift+Tab from the end never leaves focus hidden under the bars`, async () => {
      const { context, page } = await newPage(browser, { ...options, reducedMotion: "reduce" });
      const hidden = [];
      for (const route of pages.filter((r) => ["/docs/quick-start/", "/docs/signed-in-runs/", "/docs/troubleshooting/"].includes(r.path))) {
        await page.goto(`${base}${route.path}`, { waitUntil: "load" });
        // Focus the last link of the article, then walk back to the breadcrumb.
        await page.evaluate(() => {
          const links = [...document.querySelectorAll("article a, article button, article [tabindex='0']")];
          links.at(-1)?.focus();
        });
        for (let i = 0; i < 120; i += 1) {
          await page.keyboard.press("Shift+Tab");
          await sleep(25);
          const info = await focusInfo(page);
          if (!info || info.inHeader) break;
          if (info.fullyObscured) hidden.push(`${route.path}: ${info.tag} "${info.name}"`);
          const inCrumbs = await page.evaluate(() => Boolean(document.activeElement?.closest('nav[aria-label="Breadcrumb"]')));
          if (inCrumbs) break;
        }
      }
      result[`shiftTab ${name}`] = hidden;
      await context.close();
      assert.deepEqual(hidden, []);
    });
  }
});

describe("CodeBlock copies the commands only (§2.5)", () => {
  test("the quick start's run block: its three commands, no prompt, comment or output", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    await page.goto(`${base}/docs/quick-start/`, { waitUntil: "load" });
    const block = page.locator(".code-block").first();
    await block.locator("button.copy-btn").click();
    await sleep(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    result.copied = copied;
    assert.equal(copied, commands.blocks.run.commands.join("\n"));
    assert.equal(await block.getAttribute("data-state"), "copied");
    assert.deepEqual(await cspViolations(page), []);
    await context.close();
  });
});

describe("size: screens, JS, HTML, motion (§5.2)", () => {
  test("the quick start is at most 4 desktop screens, the hub at most 2", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/docs/quick-start/`, { waitUntil: "load" });
    const quick = await measurePage(page);
    await page.goto(`${base}/docs/`, { waitUntil: "load" });
    const hubMeasure = await measurePage(page);
    result.hub.measure = hubMeasure;
    result.quickStart = { ...quick, margin: { screens: Number((4 - quick.pageHeight / quick.viewport.height).toFixed(3)) } };
    await context.close();
    assert.ok(quick.screens <= 4, `quick start: ${quick.screens} screens`);
    assert.ok(hubMeasure.screens <= 2, `hub: ${hubMeasure.screens} screens`);
  });

  test("each page: HTML ≤ 90,000 B raw and ≤ 15,000 B gzip", async () => {
    for (const route of docsRoutes) {
      const html = Buffer.from(await (await fetch(`${base}${route.path}`)).arrayBuffer());
      const size = { raw: html.length, gzip: gzipSync(html, { level: 9 }).length };
      result.pages[route.path] = { ...result.pages[route.path], html: { ...size, margin: { raw: 90_000 - size.raw, gzip: 15_000 - size.gzip } } };
      assert.ok(size.raw <= 90_000, `${route.path}: ${size.raw} B raw`);
      assert.ok(size.gzip <= 15_000, `${route.path}: ${size.gzip} B gzip`);
    }
  });

  test("each page: initial JS ≤ 156,000 B gzip, and no motion chunk ever (load, idle, a full scroll)", async () => {
    for (const route of docsRoutes) {
      const { context, page } = await newPage(browser);
      const log = recordRequests(page);
      await page.goto(`${base}${route.path}`, { waitUntil: "load" });
      await sleep(1500);
      log.phase("scroll");
      await slowScroll(page, { step: 600, pause: 40 });
      await sleep(500);
      const initial = scriptsIn(log.requests, "load");
      const all = log.requests.filter((r) => r.type === "script");
      const later = all.filter((r) => r.phase !== "load").map((r) => `${r.phase} ${r.path} ${r.gzip} B`);
      result.pages[route.path] = {
        ...result.pages[route.path],
        initialJs: initial.gzip,
        scripts: all.length,
        scriptsAfterLoad: later,
        routePrefetches: prefetches(log.requests).paths,
      };
      await context.close();
      assert.ok(initial.gzip <= 156_000, `${route.path}: ${initial.gzip} B`);
      assert.equal(initial.failed, 0, route.path);
      assert.ok(!all.some((r) => r.gsap || r.scrollTrigger || r.drawSVG), `${route.path}: a motion chunk was requested`);
    }
  });

  test("each page: no lazy JS (§5.2: 0 B): with the route prefetches held back, no script comes after load", async () => {
    // The scripts after load on a docs page come with the header's viewport prefetches of other routes (their RSC
    // payload names the client chunks those routes need), which the reader's next page uses. Held back here, what
    // is left after load is the page's own lazy JS, and §5.2 allows none.
    const found = {};
    for (const route of docsRoutes) {
      const { context, page } = await newPage(browser);
      await context.route("**/*", (request) => {
        const headers = request.request().headers();
        const prefetch = headers["next-router-prefetch"] || headers["next-router-segment-prefetch"];
        return prefetch ? request.abort() : request.continue();
      });
      const log = recordRequests(page);
      await page.goto(`${base}${route.path}`, { waitUntil: "load" });
      await sleep(1500);
      log.phase("scroll");
      await slowScroll(page, { step: 600, pause: 40 });
      await sleep(500);
      const later = log.requests.filter((r) => r.type === "script" && r.phase !== "load").map((r) => `${r.phase} ${r.path} ${r.gzip} B`);
      await context.close();
      if (later.length) found[route.path] = later;
    }
    result.lazyJsWithoutPrefetches = found;
    assert.deepEqual(found, {});
  });
});

describe("the \"On this page\" marker (§3.5)", () => {
  test("desktop: the marker follows the section in view, and aria-current moves with it", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/docs/quick-start/#next-steps`, { waitUntil: "load" });
    await sleep(300);
    const state = await page.evaluate(() => {
      const wrap = document.querySelector(".docs-toc .step-trail-wrap");
      return {
        ready: wrap?.hasAttribute("data-ready"),
        current: [...document.querySelectorAll('.docs-toc a[aria-current="location"]')].map((a) => a.getAttribute("href")),
      };
    });
    result.marker = state;
    await context.close();
    assert.equal(state.ready, true, "the marker is ready");
    assert.deepEqual(state.current, ["#next-steps"]);
  });

  /** The section the marker should show (the last h2 whose top is above the anchor line) and the one it shows. */
  const markerState = (page) =>
    page.evaluate(() => {
      const line = Math.round((parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 16);
      const ids = [...document.querySelectorAll(".docs-toc a.step-label")].map((a) => decodeURIComponent(a.hash.slice(1)));
      let expected = ids[0];
      for (const id of ids) if (document.getElementById(id).getBoundingClientRect().top < line) expected = id;
      const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      const shown = document.querySelector('.docs-toc a[aria-current="location"]')?.hash.slice(1) ?? null;
      return { y: Math.round(scrollY), expected, shown, atEnd };
    });

  test("desktop: at every 40 px step of a slow scroll, and after Page Down, End and Home, the marker shows the section at the anchor line", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const wrong = [];
    let steps = 0;
    for (const path of ["/docs/install/", "/docs/signed-in-runs/"]) {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await sleep(300);
      await page.mouse.move(700, 450);
      for (let i = 0; i < 200; i += 1) {
        await page.mouse.wheel(0, 40);
        await sleep(100);
        const state = await markerState(page);
        steps += 1;
        if (state.atEnd) break;
        if (state.expected !== state.shown) wrong.push(`${path} wheel y=${state.y}: ${state.shown} for ${state.expected}`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      for (const key of ["PageDown", "PageDown", "PageDown", "End", "Home", "PageDown"]) {
        await page.keyboard.press(key);
        await sleep(400);
        const state = await markerState(page);
        steps += 1;
        const expected = state.atEnd ? await page.evaluate(() => [...document.querySelectorAll(".docs-toc a.step-label")].at(-1).hash.slice(1)) : state.expected;
        if (expected !== state.shown) wrong.push(`${path} ${key} y=${state.y}: ${state.shown} for ${expected}`);
      }
    }
    result.markerScroll = { steps, wrong };
    await context.close();
    assert.ok(steps > 60, `${steps} steps`);
    assert.deepEqual(wrong, []);
  });
});

describe("\"On this page\" by width (§3.5)", () => {
  test("1100×800: an inline box right after the opening paragraph; 1440: the column; 390: the bar", async () => {
    const seen = {};
    for (const [name, viewport] of [
      ["1100", { width: 1100, height: 800 }],
      ["1440", { width: 1440, height: 900 }],
      ["390", { width: 390, height: 844 }],
    ]) {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await page.goto(`${base}/docs/install/`, { waitUntil: "load" });
      seen[name] = await page.evaluate(() => {
        const shown = (selector) => Boolean(document.querySelector(selector)?.checkVisibility());
        const inline = document.querySelector(".docs-toc-inline");
        const opening = document.querySelector(".prose-doc > p");
        return {
          inline: shown(".docs-toc-inline"),
          afterOpening: inline?.previousElementSibling === opening,
          column: shown(".docs-toc"),
          bar: shown(".docs-bar"),
        };
      });
      await context.close();
    }
    result.tocByWidth = seen;
    assert.deepEqual(seen["1100"], { inline: true, afterOpening: true, column: false, bar: false });
    assert.deepEqual(seen["1440"], { inline: false, afterOpening: true, column: true, bar: false });
    assert.deepEqual(seen["390"], { inline: false, afterOpening: true, column: false, bar: true });
  });
});

describe("axe (§5.2): 0 violations on every docs page", () => {
  for (const [name, viewport] of [
    ["1280×720", { width: 1280, height: 720 }],
    ["1100×800 (the inline \"On this page\")", { width: 1100, height: 800 }],
    ["390×844", { width: 390, height: 844 }],
  ]) {
    test(name, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      const found = {};
      for (const route of docsRoutes) {
        await page.goto(`${base}${route.path}`, { waitUntil: "load" });
        const { violations } = await runAxe(page);
        if (violations.length) found[route.path] = violations.map((v) => `${v.id} (${v.nodes}): ${v.targets.join(", ")}`);
      }
      result[`axe ${name}`] = found;
      await context.close();
      assert.deepEqual(found, {});
    });
  }
});
