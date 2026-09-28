/**
 * /_design/ on the built site (DESIGN.md §3.14; node X1).
 *
 * - Internal: noindex and nofollow with no canonical; in no sitemap, llms file or search index, and no page links it.
 * - Every primitive of §2.5 in every state §3.14 names (buttons default, hover, focus, active; Command and the code
 *   block idle, copied, failed; cards; tags; breadcrumbs; callouts; the step trail), each state really styled.
 * - The header transparent, opaque and with the menu open, each specimen matching the live header in that state.
 * - Each motion moment with its own Replay, played by the site's own motion code: the hero run (its own Replay), the
 *   pipeline at any progress from its range (and a Replay that plays it), the evidence trio, the check cards' trace,
 *   the 404's trail. No text moves meanwhile, no CSP violation, and nothing loops once they rest.
 * - Reduced motion and Save-Data: the finished frames, no Replay, no GSAP.
 * - D18: Bricolage's display steps with the opsz axis and without it at 40, 60 and 80 px, rendered in Bricolage; the
 *   widths and the share of differing pixels of each pair are written to design.json, and each pair's pictures to
 *   design/, for the maintainer's decision (§2.2: drop the axis if the difference is invisible).
 * - axe 0 at 1280×720 and 390×844 (motion on, after every moment has played, and reduced); no overflow at 320 px;
 *   the accent budget (§2.3).
 * - The reduced-motion snapshots at 1280 and 390 px, saved as artefacts (D21: not committed).
 *
 * Not applied here: the type cap (≤ 9 font sizes) and the one-line-hound rule. A specimen page shows every type step,
 * the D18 sizes and the line hound's sizes by design; both gates stay on every public page.
 *
 *   NEXT_DIST_DIR=.next-X1 pnpm build && NEXT_DIST_DIR=.next-X1 pnpm lab design --port 4881
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { accentAudit, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { installRafCounter, installTextAudit, rafDuring, readTextAudit } from "../lib/motion.mjs";
import { labOut, writeJson } from "../lib/out.mjs";
import { recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";
import { compareImages, fullPage, settle } from "../lib/screenshots.mjs";

await import("../../test-hooks.mjs");
const { route } = await import("../../../src/content/routes.ts");
const { domContract } = await import("../../../src/motion/dom-contract.ts");

const base = origin();
const design = route("design");
const url = `${base}${design.path}`;
const { indexable, notFound } = await labRoutes();
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("design.json", result);
});

const moments = ["hero-run", "pipeline", "evidence-trio", "card-trace", "trail-404"];

/** Waits until a moment's root has data-motion-state `state`; resolves with the time it took (ms). */
async function waitState(page, name, state, timeout = 10_000) {
  const start = Date.now();
  await page.waitForFunction(
    ([n, s]) => document.querySelector(`[data-motion="${n}"]`)?.getAttribute("data-motion-state") === s,
    [name, state],
    { timeout, polling: 30 },
  );
  return Date.now() - start;
}

/** Scrolls a moment's root to the middle of the viewport. */
const centre = (page, name) =>
  page.evaluate((n) => document.querySelector(`[data-motion="${n}"]`).scrollIntoView({ block: "center", behavior: "instant" }), name);

/** The computed opacity and transform of every part of a moment, keyed "part#index". */
const partsState = (page, name) =>
  page.evaluate((n) => {
    const root = document.querySelector(`[data-motion="${n}"]`);
    const out = {};
    const counts = {};
    for (const el of root.querySelectorAll("[data-part]")) {
      const part = el.getAttribute("data-part");
      const i = (counts[part] = (counts[part] ?? -1) + 1);
      const style = getComputedStyle(el);
      out[`${part}#${i}`] = { opacity: Number(style.opacity), transform: style.transform, inline: el.getAttribute("style") ?? "" };
    }
    return out;
  }, name);

/** The scale on each axis of a computed transform ("none" is 1, 1). */
const scaleOf = (transform) => {
  if (!transform || transform === "none") return [1, 1];
  const m = /matrix\(([^)]+)\)/.exec(transform)?.[1].split(",").map(Number);
  return m ? [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])] : [NaN, NaN];
};

/**
 * Sets the pipeline's range the way a reader's drag does (the value, then an input event), and waits until the
 * pipeline shows it (data-dz-progress: its scrub loads on first use).
 */
async function setRange(page, value) {
  await page.evaluate((v) => {
    const input = document.querySelector('input[data-dz-range="pipeline"]');
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForFunction((v) => document.querySelector('[data-motion="pipeline"]').getAttribute("data-dz-progress") === String(v), value, { timeout: 5000 });
}

describe("internal: noindex, and in no sitemap, llms file, search index or nav (§3.14)", () => {
  test("noindex and nofollow, no canonical, its registry title", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    const response = await page.goto(url, { waitUntil: "load" });
    const read = await page.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      h1: document.querySelector("main h1")?.textContent.trim(),
      firstHeading: document.querySelector("main :is(h1, h2, h3, h4)")?.tagName.toLowerCase(),
    }));
    await context.close();
    result.meta = { status: response.status(), ...read };
    assert.equal(response.status(), 200);
    assert.match(read.robots ?? "", /noindex/);
    assert.match(read.robots ?? "", /nofollow/);
    assert.equal(read.canonical, null);
    assert.equal(read.h1, design.title);
    assert.equal(read.firstHeading, "h1");
  });

  test("not in the sitemap, llms.txt or llms-full.txt", async () => {
    const found = {};
    for (const path of ["/sitemap.xml", "/llms.txt", "/llms-full.txt"]) {
      const response = await fetch(`${base}${path}`);
      const text = await response.text();
      found[path] = { status: response.status, mentions: (text.match(/_design/g) ?? []).length };
    }
    result.lists = found;
    for (const [path, { status, mentions }] of Object.entries(found)) {
      assert.equal(status, 200, path);
      assert.equal(mentions, 0, `${path} mentions /_design/`);
    }
  });

  test("not in the search index", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    const queries = ["Design system", "tokens", "type scale", "Replay", "opsz", "Run Hound"];
    const found = await page.evaluate(async (list) => {
      const pagefind = await import("/pagefind/pagefind.js");
      await pagefind.init();
      const out = {};
      for (const query of list) {
        const search = await pagefind.search(query);
        out[query] = (await Promise.all(search.results.map((r) => r.data()))).map((d) => d.url);
      }
      return out;
    }, queries);
    await context.close();
    result.search = found;
    assert.ok(found["Run Hound"].length > 0, "the index answers");
    for (const [query, urls] of Object.entries(found)) {
      for (const hit of urls) assert.doesNotMatch(hit, /_design/, `"${query}" found ${hit}`);
    }
  });

  test("no page links it: every indexable page and the 404 (header, menu, footer and body)", async () => {
    const linking = [];
    for (const path of [...indexable.map((r) => r.path), notFound]) {
      const text = await (await fetch(`${base}${path}`)).text();
      if (/href="[^"]*\/_design\/?(?:[#?][^"]*)?"/.test(text)) linking.push(path);
    }
    result.linkedFrom = linking;
    assert.deepEqual(linking, []);
  });
});

describe("every primitive in every state (§2.5, §3.14)", () => {
  test("buttons, links, pill, tags, cards, command, code block, figure, callouts, facts, step trail, breadcrumbs, pager, report line, line hound", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector(".command")?.getAttribute("data-state"), null, { timeout: 5000 });
    const read = await page.evaluate(() => {
      const $ = (s, root = document) => root.querySelector(s);
      const $$ = (s, root = document) => [...root.querySelectorAll(s)];
      const specimen = (key) => $(`[data-dz-specimen="${key}"]`);
      const style = (el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, border: s.borderTopColor, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, transform: s.transform };
      };
      const buttons = (variant) =>
        Object.fromEntries(
          $$(`.btn-${variant}`, specimen("buttons"))
            .filter((b) => !b.classList.contains("btn-sm"))
            .map((b) => [b.getAttribute("data-demo-state") ?? "default", style(b)]),
        );
      const copyStates = (key, selector) =>
        $$(selector, specimen(key)).map((el) => ({ state: el.getAttribute("data-state"), label: $(".copy-btn", el).textContent.trim() }));
      const trail = specimen("step-trail");
      const crumbs = $('nav[aria-label="Breadcrumb"]');
      return {
        specimens: $$("[data-dz-specimen]").map((el) => el.getAttribute("data-dz-specimen")),
        primary: buttons("primary"),
        secondary: buttons("secondary"),
        headerSize: $$(".btn-sm", specimen("buttons")).length,
        links: { text: $$(".text-link", specimen("links")).length, arrow: $$(".arrow-link", specimen("links")).length },
        pill: $$(".pill", specimen("links")).map((p) => p.getAttribute("data-demo-state") ?? "default"),
        tags: $$(".tag", specimen("links")).map((t) => t.textContent.trim()),
        cards: {
          plain: style($$(".card", specimen("cards")).find((c) => !c.classList.contains("card-hover"))),
          hover: style($('.card-hover[data-demo-state="hover"]', specimen("cards"))),
          linked: Boolean($("#linked-card")) && Boolean($('a[href="#linked-card"]')),
          tiles: $$(".icon-tile", specimen("cards")).length,
          ticks: $$(".tick", specimen("cards")).length,
        },
        command: copyStates("command", ".command"),
        code: copyStates("code", ".code-block"),
        figure: Boolean($("figure figcaption", specimen("figure"))),
        callouts: $$(".callout", specimen("callouts")).map((c) => c.getAttribute("data-tone")),
        facts: { strip: $$(".fact-strip a, .fact a", specimen("facts")).length, list: $$("dl dt", specimen("facts")).length },
        stepTrail: { fail: $$('.step-ring[data-tone="fail"]', trail).length, accent: $$('.step-ring[data-tone="accent"]', trail).length, marker: $$(".step-marker", trail).length },
        breadcrumbs: crumbs ? { items: $$("li", crumbs).length, currentIsLink: Boolean($('[aria-current="page"]', crumbs)?.closest("a")) } : null,
        pager: $$(".prev-next a", specimen("pager")).length,
        report: Boolean($(".report-line a", specimen("pager"))),
        hounds: $$("svg.line-hound", specimen("hound")).map((svg) => Math.round(svg.getBoundingClientRect().width)),
        // The 404's hound, 120 px, walks in the Motion band; the hound band shows the homepage's 64 px one.
        trailHound: Math.round($('[data-motion="trail-404"] svg.line-hound')?.getBoundingClientRect().width ?? 0),
        // The phone state (§2.5): a three-level trail in a phone-width stage, on one line, a middle item shortened.
        // A picture: inert, so its links and its landmark leave the tab order and the accessibility tree.
        crumbsPhone: (() => {
          const nav = $("nav", specimen("breadcrumbs") ?? document.createElement("div"));
          if (!nav) return null;
          const stage = nav.closest(".dz-stage");
          const items = $$("li", nav);
          const ol = $("ol", nav);
          const line = parseFloat(getComputedStyle(ol).lineHeight);
          return {
            inert: Boolean(nav.closest("[inert]")),
            items: items.length,
            width: Math.round(stage?.getBoundingClientRect().width ?? 0),
            oneLine: Math.round(ol.getBoundingClientRect().height) <= Math.ceil(line),
            shortened: items.slice(1, -1).map((li) => { const c = $(".crumb", li); return c.scrollWidth > c.clientWidth; }),
            currentIsLink: Boolean($('[aria-current="page"]', nav)?.closest("a")),
          };
        })(),
        // The contrast table's label sits outside its sideways scroller, so a phone reads it whole.
        contrast: (() => {
          const table = $("#palette table");
          const label = table && document.getElementById(table.getAttribute("aria-labelledby") ?? "");
          const region = table?.closest('[role="region"]');
          return {
            label: label?.textContent.trim() ?? null,
            regionLabelledBy: region?.getAttribute("aria-labelledby") ?? null,
            labelInScroller: Boolean(label && region?.contains(label)),
            caption: Boolean(table && $("caption", table)),
          };
        })(),
      };
    });
    await context.close();
    result.primitives = read;

    for (const key of ["buttons", "links", "cards", "facts", "command", "code", "figure", "callouts", "step-trail", "breadcrumbs", "pager", "hound"]) {
      assert.ok(read.specimens.includes(key), `specimen ${key}`);
    }
    for (const variant of ["primary", "secondary"]) {
      const states = read[variant];
      assert.deepEqual(Object.keys(states).sort(), ["active", "default", "focus", "hover"], variant);
      assert.notEqual(states.hover.bg, states.default.bg, `${variant}: hover changes the fill`);
      assert.match(states.focus.outline, /^solid 2px /, `${variant}: focus draws a 2 px ring`);
      assert.doesNotMatch(states.default.outline, /^solid/, `${variant}: no ring at rest`);
      assert.deepEqual(scaleOf(states.active.transform).map((n) => Math.round(n * 100) / 100), [0.97, 0.97], `${variant}: active scales to 0.97`);
    }
    assert.equal(read.headerSize, 1);
    assert.ok(read.links.text >= 2 && read.links.arrow >= 2);
    assert.deepEqual(read.pill, ["default", "hover"]);
    assert.equal(read.tags.length, 3);
    assert.notEqual(read.cards.hover.border, read.cards.plain.border, "a hovered card's border changes colour");
    assert.ok(read.cards.linked && read.cards.tiles >= 1 && read.cards.ticks >= 2);
    for (const key of ["command", "code"]) {
      assert.deepEqual(read[key].map((c) => c.state), ["idle", "copied", "failed"], key);
      assert.equal(read[key][0].label, "Copy");
      assert.equal(read[key][1].label, "Copied");
      assert.match(read[key][2].label, /^Press (Ctrl\+C|⌘C)$/);
    }
    assert.ok(read.figure);
    assert.deepEqual(read.callouts, ["note", "warn"]);
    assert.ok(read.facts.strip >= 4 && read.facts.list >= 3);
    assert.deepEqual(read.stepTrail, { fail: 1, accent: 1, marker: 1 });
    assert.ok(read.breadcrumbs && read.breadcrumbs.items >= 2 && !read.breadcrumbs.currentIsLink);
    assert.equal(read.pager, 2);
    assert.ok(read.report);
    assert.deepEqual(read.hounds, [64]);
    assert.equal(read.trailHound, 120, "the 404's hound in the Motion band is the 120 px size");
    const phone = read.crumbsPhone;
    assert.ok(phone, "a breadcrumb specimen in a phone-width stage");
    assert.equal(phone.inert, true, "the specimen is inert: no second Breadcrumb landmark, no extra tab stops");
    assert.equal(phone.items, 3);
    assert.ok(phone.width >= 320 && phone.width <= 390, `the stage is phone-width (${phone.width} px)`);
    assert.ok(phone.oneLine, "one line on phones");
    assert.ok(phone.shortened.some(Boolean), "a middle item shortens with an ellipsis");
    assert.equal(phone.currentIsLink, false);
    assert.equal(read.contrast.caption, false, "no <caption> inside the scroller");
    assert.match(read.contrast.label ?? "", /^Text colours against each ground/);
    assert.equal(read.contrast.labelInScroller, false, "the table's label is outside the sideways scroller");
    assert.equal(read.contrast.regionLabelledBy, "contrast-caption");
  });
});

describe("the header: transparent, opaque and the menu open (§3.14)", () => {
  test("each specimen matches the live header in that state", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(url, { waitUntil: "load" });
    const look = () =>
      page.evaluate(() => {
        const paint = (el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, border: s.borderBottomColor, height: Math.round(el.getBoundingClientRect().height) };
        };
        const specimen = (state) => document.querySelector(`[data-header-specimen="${state}"]`);
        return {
          live: paint(document.querySelector("body > header, header.site-header")),
          transparent: paint(specimen("transparent")),
          opaque: paint(specimen("opaque")),
          menu: {
            rows: [...specimen("menu").querySelectorAll(".site-menu-link")].map((row) => row.textContent.trim()),
            cta: specimen("menu").querySelector(".btn-primary")?.textContent.trim(),
            width: Math.round(specimen("menu").getBoundingClientRect().width),
            open: specimen("menu").querySelector(".site-menu-button")?.getAttribute("data-open"),
          },
        };
      });
    const top = await look();
    await page.evaluate(() => window.scrollTo(0, 400));
    await sleep(100);
    const scrolled = await look();
    await context.close();
    result.header = { top, scrolled };
    assert.deepEqual(top.transparent, top.live, "at the top of the page the live header looks like the transparent specimen");
    assert.deepEqual(scrolled.opaque, scrolled.live, "scrolled, the live header looks like the opaque specimen");
    assert.notDeepEqual(top.transparent.bg, top.opaque.bg);
    assert.equal(top.menu.rows.length, 7, "five hubs, GitHub and the changelog");
    assert.ok(top.menu.cta, "the call to action ends the menu");
    assert.ok(top.menu.width <= 390, `the menu specimen is phone-width (${top.menu.width} px)`);
    assert.equal(top.menu.open, "");
  });
});

describe("the header specimens lay out as the live header does", () => {
  for (const width of [390, 1024, 1280, 1440]) {
    test(`${width} px: every part of the bar has the live header's width (nothing squeezed or cut)`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await page.goto(url, { waitUntil: "load" });
      const read = await page.evaluate(() => {
        const parts = [".site-brand", ".nav-link", ".search-trigger", ".site-chip", ".site-icon-link", ".btn", ".site-menu-button"];
        const widths = (bar) =>
          Object.fromEntries(
            parts.map((sel) => [
              sel,
              [...bar.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).map((el) => Math.round(el.getBoundingClientRect().width)),
            ]),
          );
        const bar = (state) => document.querySelector(`[data-header-specimen="${state}"] .site-header-bar`);
        return {
          live: widths(document.querySelector("header.site-header .site-header-bar")),
          transparent: widths(bar("transparent")),
          opaque: widths(bar("opaque")),
          menu: widths(bar("menu")),
          overflow: [...document.querySelectorAll("[data-header-specimen] .site-header-bar, [data-header-specimen] .site-menu")].map((el) => el.scrollWidth - el.clientWidth),
        };
      });
      await context.close();
      result[`header layout ${width}`] = read;
      assert.deepEqual(read.transparent, read.live, "the transparent specimen");
      assert.deepEqual(read.opaque, read.live, "the opaque specimen");
      // The menu specimen is the phone's bar at any viewport: at 390 px it is the live header's.
      if (width < 1024) assert.deepEqual(read.menu, read.live, "the menu specimen's bar");
      assert.ok(read.overflow.every((o) => o <= 0), `overflow: ${read.overflow}`);
    });
  }
});

describe("each motion moment with its own Replay (§3.14), motion on", () => {
  for (const profile of ["desktop", "phone"]) {
    test(`${profile}: the hero run, the pipeline's range, the trio, the card trace and the 404 trail replay, and then rest`, async () => {
      const { context, page } = await newPage(browser, { profile });
      await installTextAudit(page);
      await installRafCounter(page);
      const requests = recordRequests(page);
      await page.goto(url, { waitUntil: "load" });
      const run = {};

      // The hero run: its island plays it when it is half visible, then shows its own Replay.
      await centre(page, "hero-run");
      run.heroFirst = await waitState(page, "hero-run", "done", 12_000);
      const replaySlot = page.locator('[data-motion="hero-run"] [data-part="replay-slot"]');
      assert.equal(await replaySlot.evaluate((el) => getComputedStyle(el).visibility), "visible", "the hero's Replay shows at rest");
      await replaySlot.click();
      await waitState(page, "hero-run", "playing", 2000);
      run.heroReplay = await waitState(page, "hero-run", "done", 6000);
      assert.ok(run.heroReplay <= 3500, `the hero replayed in ${run.heroReplay} ms`);

      // The pipeline at any progress: 0 (nothing drawn), 50, 100 (the server's frame).
      await centre(page, "pipeline");
      await page.locator('[data-dz-replay="pipeline"]').waitFor({ state: "visible" });
      const scales = async () =>
        // A connector scales on one axis only (x across, y down): the smaller scale is the one that moves.
        Object.entries(await partsState(page, "pipeline")).map(([key, s]) => ({ key, opacity: s.opacity, scale: Math.min(...scaleOf(s.transform)), inline: s.inline }));
      await setRange(page, 0);
      const at0 = await scales();
      await setRange(page, 50);
      const at50 = await scales();
      await setRange(page, 100);
      const at100 = await scales();
      run.pipeline = { at0, at50, at100 };
      for (const c of at0.filter((p) => p.key.startsWith("connector"))) assert.ok(c.scale < 0.01, `${c.key} at 0: ${c.scale}`);
      for (const r of at0.filter((p) => p.key.startsWith("node-ring") && p.key !== "node-ring#0")) assert.equal(r.opacity, 0, `${r.key} at 0`);
      assert.equal(at0.find((p) => p.key === "node-ring#0").opacity, 1, "ring 1 is lit from the start");
      const drawn50 = at50.filter((p) => p.key.startsWith("connector") && p.scale > 0.99).length;
      const blank50 = at50.filter((p) => p.key.startsWith("connector") && p.scale < 0.01).length;
      assert.ok(drawn50 >= 1 && blank50 >= 1, `at 50: ${drawn50} drawn, ${blank50} not begun`);
      for (const p of at100) {
        assert.equal(p.opacity, 1, `${p.key} at 100`);
        assert.ok(Math.abs(p.scale - 1) < 1e-6, `${p.key} at 100: ${p.scale}`);
        assert.equal(p.inline.replace(/transform-origin:[^;]*;?/, "").trim(), "", `${p.key} at 100 is the server's frame (no inline motion)`);
      }
      // Its Replay plays it through once, moving the range with it.
      await page.locator('[data-dz-replay="pipeline"]').click();
      const mid = await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(Number(document.querySelector('input[data-dz-range="pipeline"]').value)), 300)));
      run.pipelineReplay = await waitState(page, "pipeline", "done", 4000);
      const end = Number(await page.locator('input[data-dz-range="pipeline"]').inputValue());
      assert.ok(mid > 0 && mid < 100, `the range moves with the replay (${mid} at 300 ms)`);
      assert.equal(end, 100);

      // The evidence trio and the card trace: one-shot effects, built by the scroll effects' engine.
      for (const name of ["evidence-trio", "card-trace"]) {
        await centre(page, name);
        const button = page.locator(`[data-dz-replay="${name}"]`);
        await button.click();
        await waitState(page, name, "playing", 4000);
        run[name] = await waitState(page, name, "done", 5000);
        assert.ok(run[name] <= 2500, `${name} ran ${run[name]} ms`);
        await sleep(100);
        const rest = await partsState(page, name);
        for (const [key, s] of Object.entries(rest)) {
          const part = key.split("#")[0];
          const hidden = domContract[name].restHidden.includes(part);
          assert.equal(s.opacity, hidden ? 0 : 1, `${name} ${key} at rest`);
        }
      }

      // The 404 trail: played when half visible, then replayed; the hound rests where the server put it.
      await centre(page, "trail-404");
      run.trailFirst = await waitState(page, "trail-404", "done", 8000);
      const houndBox = () => page.evaluate(() => {
        const r = document.querySelector('[data-motion="trail-404"] [data-part="hound"]').getBoundingClientRect();
        return [r.left, r.width].map((n) => Math.round(n));
      });
      const before = await houndBox();
      await page.locator('[data-dz-replay="trail-404"]').click();
      await waitState(page, "trail-404", "playing", 4000);
      run.trailReplay = await waitState(page, "trail-404", "done", 5000);
      assert.ok(run.trailReplay <= 2500, `the trail replayed in ${run.trailReplay} ms`);
      await sleep(100);
      assert.deepEqual(await houndBox(), before, "the hound rests where the server put it");

      // Everything at rest: nothing loops, no text ever moved, no CSP violation.
      await sleep(2000);
      run.rafAtRest = await rafDuring(page, 3000);
      run.textAudit = await readTextAudit(page);
      run.csp = await cspViolations(page);
      run.motionScripts = requests.requests.filter((r) => r.gsap || r.drawSVG || r.scrollTrigger).map(({ path, gzip, gsap, drawSVG, scrollTrigger }) => ({ path, gzip, gsap, drawSVG, scrollTrigger }));
      await context.close();
      result[`motion ${profile}`] = run;
      assert.ok(run.motionScripts.some((s) => s.gsap), "GSAP was loaded to play them");
      assert.ok(!run.motionScripts.some((s) => s.scrollTrigger), "the pipeline's range needs no ScrollTrigger");
      assert.equal(run.rafAtRest, 0, "no requestAnimationFrame callback in 3 s at rest");
      assert.deepEqual(run.textAudit, []);
      assert.deepEqual(run.csp, []);
    });
  }
});

describe("reduced motion and Save-Data: the finished frames, no Replay, no GSAP (§4.5)", () => {
  for (const mode of ["reduce", "save-data"]) {
    test(mode, async () => {
      const { context, page } = await newPage(browser, mode === "reduce" ? { reducedMotion: "reduce" } : { saveData: true });
      const requests = recordRequests(page);
      await page.goto(url, { waitUntil: "load" });
      await sleep(3500);
      const read = await page.evaluate((names) => ({
        replays: [...document.querySelectorAll('[data-dz-replay], [data-part="replay-slot"]')].map((b) => getComputedStyle(b).visibility),
        held: [...document.querySelectorAll('[data-beat="late"]')].map((el) => Number(getComputedStyle(el).opacity)),
        states: names.map((n) => document.querySelector(`[data-motion="${n}"]`)?.getAttribute("data-motion-state") ?? null),
        gsap: typeof window.gsapVersions !== "undefined",
        note: getComputedStyle(document.querySelector(".dz-reduced-note")).display,
      }), moments);
      const motionScripts = requests.requests.filter((r) => r.gsap || r.drawSVG || r.scrollTrigger).map((r) => r.path);
      await context.close();
      result[mode] = { ...read, motionScripts };
      assert.deepEqual(motionScripts, [], "no motion chunk requested");
      assert.equal(read.replays.length, 5);
      assert.ok(read.replays.every((v) => v === "hidden"), `Replays: ${read.replays}`);
      assert.ok(read.held.every((o) => o === 1), "every held part shows");
      assert.deepEqual(read.states, [null, null, null, null, null], "no moment was taken over");
      assert.equal(read.gsap, false);
      if (mode === "reduce") assert.notEqual(read.note, "none", "the page says why no Replay shows");
    });
  }
});

describe("D18: Bricolage with and without the opsz axis at 40, 60 and 80 px (§2.2)", () => {
  test("both render in Bricolage; each pair's widths and differing pixels are recorded", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
    // The display face loads with font-display: optional (app/layout.tsx): a first load that misses its short block
    // period keeps the fallback for the page's life. The second load has it in the cache, as a returning reader does.
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const read = await page.evaluate(() => {
      const canvas = new OffscreenCanvas(1, 1).getContext("2d");
      /** The width a canvas measures for the text in one family (a loaded face, or the metric-matched fallback). */
      const measure = (el, family) => {
        const s = getComputedStyle(el);
        canvas.font = `${s.fontWeight} ${s.fontSize} ${family}`;
        canvas.letterSpacing = s.letterSpacing;
        return Math.round(canvas.measureText(el.textContent).width * 100) / 100;
      };
      return [...document.querySelectorAll("[data-opsz][data-size]")].map((el) => {
        const s = getComputedStyle(el);
        const families = s.fontFamily.split(",").map((f) => f.trim());
        return {
          size: Number(el.getAttribute("data-size")),
          opsz: el.getAttribute("data-opsz"),
          fontSize: s.fontSize,
          family: families[0],
          loaded: [...document.fonts].some((face) => face.family.replace(/"/g, "") === families[0].replace(/"/g, "") && face.status === "loaded"),
          variation: s.fontVariationSettings,
          optical: s.fontOpticalSizing,
          width: Math.round(el.getBoundingClientRect().width * 100) / 100,
          bricolageWidth: measure(el, families[0]),
          fallbackWidth: measure(el, families[1]),
        };
      });
    });
    const pairs = [];
    for (const size of [40, 60, 80]) {
      const shots = {};
      for (const opsz of ["auto", "default"]) {
        const path = labOut("design", `d18-${size}-${opsz}.png`);
        await page.locator(`[data-opsz="${opsz}"][data-size="${size}"]`).screenshot({ path });
        shots[opsz] = path;
      }
      const diff = await compareImages(page, shots.auto, shots.default);
      pairs.push({ size, ...diff, shots });
    }
    await context.close();
    result.d18 = { specimens: read, pairs };
    assert.equal(read.length, 6);
    for (const r of read) {
      const where = `${r.size} px ${r.opsz}`;
      assert.match(r.family, /Bricolage/, `${where}: ${r.family}`);
      assert.ok(r.loaded, `${where}: the face is loaded`);
      assert.equal(r.fontSize, `${r.size}px`);
      if (r.opsz === "default") assert.match(r.variation, /"opsz" 14/, where);
      else assert.deepEqual([r.variation, r.optical], ["normal", "auto"], where);
      // Drawn in Bricolage, not the fallback: the fallback's width is another (its metrics are matched, not its shapes).
      assert.notEqual(r.bricolageWidth, r.fallbackWidth, `${where}: the two families measure apart`);
      assert.ok(
        Math.abs(r.width - r.bricolageWidth) < Math.abs(r.width - r.fallbackWidth),
        `${where}: ${r.width} px is Bricolage's ${r.bricolageWidth}, not the fallback's ${r.fallbackWidth}`,
      );
    }
    // The axis is applied: each pair renders differently (how much is D18's evidence, in design.json).
    for (const pair of pairs) assert.ok(pair.differentPixels > 0, `${pair.size} px: with and without the axis render the same pixels`);
  });
});

describe("the page's gates: axe, reflow, the accent budget", () => {
  for (const [label, options] of [
    ["1280×720 reduced", { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" }],
    ["390×844 reduced", { profile: "phone", reducedMotion: "reduce" }],
    ["1280×720 motion on, after every moment", { viewport: { width: 1280, height: 720 } }],
    ["390×844 motion on, after every moment", { profile: "phone" }],
  ]) {
    test(`axe: 0 violations at ${label}`, async () => {
      const { context, page } = await newPage(browser, options);
      await page.goto(url, { waitUntil: "load" });
      if (options.reducedMotion !== "reduce") {
        // Every moment played: the islands after a scroll past them, the Replays clicked.
        for (const name of moments) {
          await centre(page, name);
          if (name === "hero-run" || name === "trail-404") await waitState(page, name, "done", 12_000);
          else {
            await page.locator(`[data-dz-replay="${name}"]`).click();
            await waitState(page, name, "done", 5000);
          }
        }
        // Back to the top, as the home spec does: a link that happens to sit under the sticky header where the page
        // stopped isn't a small target.
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(500);
      }
      const axe = await runAxe(page);
      await context.close();
      result[`axe ${label}`] = axe;
      assert.deepEqual(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), []);
    });
  }

  test("0 px of horizontal overflow at 320 px, and at 320×256 (400% zoom)", async () => {
    const out = {};
    for (const viewport of [{ width: 320, height: 800 }, { width: 320, height: 256 }]) {
      const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
      await page.goto(url, { waitUntil: "load" });
      out[`${viewport.width}x${viewport.height}`] = await reflow(page);
      await context.close();
    }
    result.reflow = out;
    for (const [size, r] of Object.entries(out)) assert.equal(r.overflowX, 0, `${size}: ${r.overflowX} px`);
  });

  for (const profile of ["desktop", "phone"]) {
    test(`the accent budget at rest, ${profile}: at most one strong accent object per viewport`, async () => {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      await page.goto(url, { waitUntil: "load" });
      await sleep(300);
      const audit = await accentAudit(page);
      await context.close();
      result[`accent ${profile}`] = audit;
      assert.ok(audit.maxPerWindow <= 1, JSON.stringify(audit.objects));
    });
  }
});

describe("the snapshots (§3.14, D21: artefacts, not committed files)", () => {
  test("reduced motion, full page, at 1280 and 390 px", async () => {
    const saved = [];
    for (const [width, options] of [
      [1280, { viewport: { width: 1280, height: 800 } }],
      [390, { profile: "phone" }],
    ]) {
      const { context, page } = await newPage(browser, { ...options, reducedMotion: "reduce" });
      await page.goto(url, { waitUntil: "load" });
      await settle(page, { gifMs: 0 });
      const path = await fullPage(page, labOut("design", `design-${width}.png`));
      await context.close();
      saved.push({ path, bytes: statSync(path).size });
    }
    result.snapshots = saved;
    for (const { path, bytes } of saved) assert.ok(existsSync(path) && bytes > 10_000, path);
  });
});
