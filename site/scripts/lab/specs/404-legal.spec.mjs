/**
 * The 404 and the legal pages on the built site (DESIGN.md §3.13, §3.15, §4.3; node F3).
 *
 * The 404: served with status 404 and noindex; its copy and links (Home, Docs, and the bug form with only the path in
 * the issue title, never the query or the hash); every other page carrying it as one small client reference; at most
 * one strong accent object per viewport at rest (§2.3); the trail drawn once in at most 2 s, the hound walking it from
 * its start and resting where the server put it, no held part ever shown and then hidden (no flicker), and nothing
 * moving under reduced motion; axe finds nothing; no overflow at 320 px; no CSP violation. The motion contract
 * (motion-contract.spec.mjs) checks the 404 with every other moving page.
 *
 * The legal pages: a visible "Last updated" date, one h1 first, the breadcrumb from the registry, out of the search
 * index (Pagefind, queried the way the search dialog does), every link resolving (pages, #fragments, promised
 * anchors), the accent budget, axe, 320 px and CSP.
 *
 *   NEXT_DIST_DIR=.next-F3 pnpm build && NEXT_DIST_DIR=.next-F3 pnpm lab 404-legal --port 4873
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { accentAudit, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { writeJson } from "../lib/out.mjs";
import { labRoutes } from "../lib/routes.mjs";
import { installFrameSampler, readFrameSampler } from "../lib/timeline.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";

await import("../../test-hooks.mjs");
const { breadcrumbTrail, bugFormUrl, href } = await import("../../../src/lib/nav.ts");
const { legalRoutes } = await import("../../../src/content/routes/legal.ts");
const { site } = await import("../../../src/lib/site.ts");
const { domContract } = await import("../../../src/motion/dom-contract.ts");

const base = origin();
const { indexable, notFound } = await labRoutes();
const result = { notFound: {}, legal: {} };
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("404-legal.json", result);
});

const parts = Object.keys(domContract["trail-404"].parts).map((part) => `[data-motion="trail-404"] [data-part="${part}"]`);

/**
 * Records, from navigation, each change of the 404 root's data-motion-state and data-ready (page clock), and on every
 * frame while it plays, the left edges of the hound and the trail (the hound walks the trail from its start, §4.3).
 */
async function installStateLog(page) {
  await page.addInitScript(() => {
    window.__trailLog = [];
    window.__walk = [];
    const sample = () => {
      const root = document.querySelector('[data-motion="trail-404"]');
      if (root?.getAttribute("data-motion-state") === "playing") {
        const left = (part) => Math.round(root.querySelector(`[data-part="${part}"]`).getBoundingClientRect().left);
        window.__walk.push({ t: Math.round(performance.now()), hound: left("hound"), trail: left("trail") });
      }
      if (performance.now() < 8000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target.getAttribute?.("data-motion") !== "trail-404") continue;
        window.__trailLog.push({ t: Math.round(performance.now()), attr: m.attributeName, value: m.target.getAttribute(m.attributeName) });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-motion-state", "data-ready"] });
  });
}

/** The drawing's boxes (px, rounded to 0.5), its state and the parts' computed opacity and transform. */
const drawing = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-motion="trail-404"]');
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 2) / 2);
    };
    const part = (name) => root.querySelector(`[data-part="${name}"]`);
    return {
      state: root.getAttribute("data-motion-state"),
      ready: root.hasAttribute("data-ready"),
      rootBox: box(root),
      trail: { box: box(part("trail")), opacity: getComputedStyle(part("trail")).opacity, dash: part("trail").getAttribute("style") },
      hound: { box: box(part("hound")), opacity: getComputedStyle(part("hound")).opacity, transform: getComputedStyle(part("hound")).transform },
      head: { box: box(part("head")), opacity: getComputedStyle(part("head")).opacity, attr: part("head").getAttribute("transform") },
      gsap: typeof window.gsapVersions !== "undefined",
    };
  });

describe(`the 404 (${notFound})`, () => {
  test("status 404, noindex, its title; the copy and the links (§3.13)", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    const response = await page.goto(`${base}${notFound}`, { waitUntil: "load" });
    const read = await page.evaluate(() => ({
      title: document.title,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      headings: [...document.querySelectorAll("main h1, main h2, main h3")].map((h) => h.tagName.toLowerCase()),
      h1: document.querySelector("main h1")?.textContent.trim(),
      accent: document.querySelector("main h1 [data-accent-exempt]")?.textContent.trim(),
      text: document.querySelector("main").innerText,
      buttons: [...document.querySelectorAll("main a.btn")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), primary: a.classList.contains("btn-primary") })),
      report: document.querySelector("main .report-line a")?.getAttribute("href"),
      reportLine: document.querySelector("main .report-line")?.textContent.replace(/\s+/g, " ").trim(),
    }));
    await context.close();
    result.notFound.page = { status: response.status(), ...read };
    assert.equal(response.status(), 404);
    assert.match(read.robots ?? "", /noindex/);
    assert.equal(read.canonical, null, "a 404 has no canonical");
    assert.equal(read.title, `Page not found · ${site.name}`);
    assert.deepEqual(read.headings, ["h1"]);
    assert.equal(read.h1, "The trail goes cold here.");
    assert.equal(read.accent, "goes cold here.");
    assert.match(read.text, /This page doesn[’']t exist or has moved\./);
    assert.doesNotMatch(read.text, /NOT FOUND/);
    assert.deepEqual(
      read.buttons.map(({ href: to, primary }) => ({ href: to, primary })),
      [
        { href: href("home"), primary: true },
        { href: href("docs"), primary: false },
      ],
    );
    assert.equal(read.reportLine, "Followed a broken link here? Tell us on GitHub (opens GitHub)");
  });

  test("the bug-report link carries only the path: never the query or the hash", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    const cases = [
      { visit: notFound, title: notFound },
      { visit: "/docs/old-page/?token=abc123&email=a%40b.example#private", title: "/docs/old-page/" },
    ];
    const seen = [];
    for (const { visit, title } of cases) {
      await page.goto(`${base}${visit}`, { waitUntil: "load" });
      // Hydrated: the link has the path (the server's HTML has the bare form, which needs no JavaScript).
      await page.waitForFunction(() => document.querySelector("main .report-line a")?.getAttribute("href").includes("title="), null, { timeout: 5000 });
      const link = await page.evaluate(() => document.querySelector("main .report-line a").getAttribute("href"));
      seen.push(link);
      const url = new URL(link);
      assert.equal(`${url.origin}${url.pathname}`, new URL(bugFormUrl).origin + new URL(bugFormUrl).pathname);
      assert.deepEqual([...url.searchParams.keys()], ["template", "title"]);
      assert.equal(url.searchParams.get("template"), "bug.yml");
      assert.equal(url.searchParams.get("title"), title);
      assert.equal(url.hash, "");
      assert.doesNotMatch(link, /token|abc123|email|private/);
    }
    await context.close();
    result.notFound.reportLinks = seen;
  });

  /**
   * One visit with motion on at a viewport, captured once and shared by the two tests below, so a failing walk never
   * hides the rest, the flicker, CLS, accent and CSP gates (each test reports on its own).
   */
  const motionRuns = new Map();
  const motionRun = (name, viewport) => {
    if (!motionRuns.has(name)) {
      motionRuns.set(
        name,
        (async () => {
          // The server's frame first (reduced motion: nothing moves, nothing is requested).
          const still = await newPage(browser, { viewport, reducedMotion: "reduce" });
          await still.page.goto(`${base}${notFound}`, { waitUntil: "load" });
          await sleep(300);
          const server = await drawing(still.page);
          await still.context.close();

          const { context, page } = await newPage(browser, { viewport });
          await installStateLog(page);
          await installVitals(page);
          await installFrameSampler(page, parts, { ms: 8000 });
          await page.goto(`${base}${notFound}`, { waitUntil: "load" });
          await page.waitForFunction(() => document.querySelector('[data-motion="trail-404"]')?.getAttribute("data-motion-state") === "done", null, { timeout: 12_000, polling: 50 });
          await sleep(2500);
          const log = await page.evaluate(() => window.__trailLog);
          const walk = await page.evaluate(() => window.__walk);
          const end = await drawing(page);
          const frames = await readFrameSampler(page);
          const vitals = await readVitals(page);
          const accent = await accentAudit(page);
          const csp = await cspViolations(page);
          await context.close();

          const playing = log.filter((e) => e.attr === "data-motion-state" && e.value === "playing");
          const done = log.filter((e) => e.attr === "data-motion-state" && e.value === "done");
          const duration = done[0]?.t - playing[0]?.t;
          const run = { log, playing, done, duration, walk, server, end, frames, cls: vitals.cls, accent, csp };
          result.notFound[`motion ${name}`] = { log, duration, walk: [walk.slice(0, 3), walk.slice(-2)], server, end, frames, cls: vitals.cls, accent, csp };
          return run;
        })(),
      );
    }
    return motionRuns.get(name);
  };

  for (const [name, viewport] of [
    ["1440×900", { width: 1440, height: 900 }],
    ["390×844", { width: 390, height: 844 }],
  ]) {
    test(`at ${name}: the trail plays once in at most 2 s and rests where the server put it; no flicker; CLS; accent ≤ 1 at rest; no CSP violation`, async () => {
      const { log, playing, done, duration, server, end, frames, cls, accent, csp } = await motionRun(name, viewport);
      assert.equal(playing.length, 1, `played ${playing.length} times: ${JSON.stringify(log)}`);
      assert.equal(done.length, 1, `rested ${done.length} times`);
      assert.ok(duration > 0 && duration <= 2000, `the trail took ${duration} ms (≤ 2000)`);
      // Rest: the hound and its head where the server drew them, every part fully shown.
      assert.deepEqual(end.hound.box, server.hound.box, "the hound rests where the server put it");
      assert.deepEqual(end.head.box, server.head.box, "the head rests turned as the server drew it");
      assert.deepEqual(end.trail.box, server.trail.box);
      for (const p of ["trail", "hound", "head"]) assert.equal(end[p].opacity, "1", `${p} at rest`);
      // No flicker: no held part is seen, then hidden again.
      for (const [selector, sample] of Object.entries(frames)) assert.equal(sample.flash, false, `${selector} flashed`);
      assert.ok(cls <= 0.01, `CLS ${cls}`);
      assert.ok(accent.maxPerWindow <= 1, JSON.stringify(accent.objects));
      assert.deepEqual(csp, []);
    });

    test(`at ${name}: the hound walks the trail from its start`, async () => {
      const { walk } = await motionRun(name, viewport);
      // The hound sets off from the trail's start (its first frames at the trail's left end) and walks right.
      assert.ok(walk.length > 10, `${walk.length} frames sampled while playing`);
      const start = walk.slice(0, 3);
      assert.ok(start.every((f) => Math.abs(f.hound - f.trail) <= 16), `the hound starts at the trail's start: ${JSON.stringify(start)}`);
      assert.ok(walk.every((f, i) => i === 0 || f.hound >= walk[i - 1].hound), "the hound only walks forward");
    });
  }

  test("reduced motion and Save-Data: nothing moves, GSAP is never requested, frames at 0, 1, 2 and 3 s identical", async () => {
    for (const mode of [{ reducedMotion: "reduce" }, { saveData: true }]) {
      const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 }, ...mode });
      await installStateLog(page);
      await page.goto(`${base}${notFound}`, { waitUntil: "load" });
      const load = await page.evaluate(() => Math.round(performance.getEntriesByType("navigation")[0].loadEventEnd));
      // Save-Data keeps the hold until the gate releases it at hydration (§4.5; the motion contract allows load +
      // 200 ms, since the lab can't see hydration itself). Reduced motion never holds (the hold's media query).
      if (mode.saveData) await page.waitForFunction(() => document.querySelector('[data-motion="trail-404"]').hasAttribute("data-ready"), null, { timeout: 3000, polling: 10 });
      const shots = [];
      const reads = [];
      for (let i = 0; i < 4; i += 1) {
        if (i > 0) await sleep(1000);
        reads.push(await drawing(page));
        shots.push((await page.locator('[data-motion="trail-404"]').screenshot()).toString("base64"));
      }
      const log = await page.evaluate(() => window.__trailLog);
      await context.close();
      const label = mode.saveData ? "save-data" : "reduce";
      result.notFound[label] = { load, log, reads };
      if (mode.saveData) {
        const released = log.filter((e) => e.attr === "data-ready").map((e) => e.t);
        assert.equal(released.length, 1, `save-data: the hold is released once: ${JSON.stringify(log)}`);
        assert.ok(released[0] <= load + 200, `save-data: hold released at ${released[0]} ms, load at ${load} ms`);
      }
      for (const read of reads) {
        assert.equal(read.state, null, `${label}: the island never took over`);
        assert.equal(read.gsap, false, `${label}: GSAP never loaded`);
        for (const p of ["trail", "hound", "head"]) assert.equal(read[p].opacity, "1", `${label}: ${p} is shown`);
        assert.equal(read.hound.transform, "none", `${label}: the hound is where the server put it`);
        assert.equal(read.trail.dash, null, `${label}: the trail is drawn by the server alone`);
        assert.match(read.head.attr ?? "", /^rotate\(-6 /, `${label}: the head rests turned -6°`);
      }
      for (let i = 1; i < shots.length; i += 1) assert.equal(shots[i], shots[0], `${label}: frame ${i} s differs from 0 s`);
    }
  });

  test("every page carries the 404 as one client reference: its not-found slot is at most 512 B of each page's HTML", async () => {
    // Next.js puts the root not-found tree in every page's RSC payload (the root layout's not-found boundary); the 404's
    // body is one client component with three strings, so no page pays for its drawing and words
    // (components/not-found/not-found-body.tsx).
    const sizes = {};
    for (const path of ["/", ...indexable.filter((r) => ["privacy", "docs", "faq"].includes(r.id)).map((r) => r.path)]) {
      const html = await (await fetch(`${base}${path}`)).text();
      const key = '\\"notFound\\":';
      const at = html.indexOf(key);
      assert.ok(at > 0, `${path}: no not-found slot found`);
      let depth = 0;
      let end = at + key.length;
      for (; end < html.length; end += 1) {
        if (html[end] === "[") depth += 1;
        else if (html[end] === "]" && --depth === 0) break;
      }
      sizes[path] = end + 1 - (at + key.length);
    }
    result.notFound.slotBytes = sizes;
    for (const [path, bytes] of Object.entries(sizes)) assert.ok(bytes <= 512, `${path}: the not-found slot is ${bytes} B`);
  });

  test("no overflow at 320 px; axe finds nothing at 1280×720 and 390×844, motion on (after the trail) and reduced", async () => {
    const flowCheck = await newPage(browser, { viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
    await flowCheck.page.goto(`${base}${notFound}`, { waitUntil: "load" });
    const flow = await reflow(flowCheck.page);
    await flowCheck.context.close();
    result.notFound.overflow320 = flow.overflowX;
    assert.equal(flow.overflowX, 0, `${flow.overflowX} px of horizontal overflow at 320 px`);
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const { context, page } = await newPage(browser, { viewport, reducedMotion });
        await page.goto(`${base}${notFound}`, { waitUntil: "load" });
        if (reducedMotion === "no-preference") {
          await page.waitForFunction(() => document.querySelector('[data-motion="trail-404"]')?.getAttribute("data-motion-state") === "done", null, { timeout: 12_000 });
        }
        const axe = await runAxe(page);
        await context.close();
        result.notFound[`axe ${viewport.width} ${reducedMotion}`] = axe.violations;
        assert.deepEqual(axe.violations, [], `${viewport.width} ${reducedMotion}: ${JSON.stringify(axe.violations)}`);
      }
    }
  });
});

describe("the legal pages (§3.15)", () => {
  test("the registry's four legal pages are the ones checked here", () => {
    assert.deepEqual(
      legalRoutes.map((r) => r.path).sort(),
      indexable.filter((r) => r.search === false && ["privacy", "terms", "acceptable-use", "security"].includes(r.id)).map((r) => r.path).sort(),
    );
  });

  for (const r of legalRoutes) {
    test(`${r.path}: "Last updated", one h1 first, the registry's breadcrumb; no overflow at 320 px; no CSP violation`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
      const response = await page.goto(`${base}${r.path}`, { waitUntil: "load" });
      const read = await page.evaluate(() => {
        const main = document.querySelector("main");
        const line = main.querySelector("[data-last-updated]");
        const time = line?.querySelector("time");
        return {
          headings: [...main.querySelectorAll("h1, h2, h3")].map((h) => h.tagName.toLowerCase()),
          h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
          lastUpdated: line?.textContent.replace(/\s+/g, " ").trim() ?? null,
          lastUpdatedVisible: line ? line.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && line.getBoundingClientRect().height > 0 : false,
          datetime: time?.getAttribute("datetime") ?? null,
          breadcrumb: [...(main.querySelector('nav[aria-label="Breadcrumb"]')?.querySelectorAll("li") ?? [])].map((li) => li.textContent.replace("/", "").trim()),
        };
      });
      const flow = await reflow(page);
      const csp = await cspViolations(page);
      await context.close();
      result.legal[r.id] = { ...(result.legal[r.id] ?? {}), status: response.status(), ...read, overflow320: flow.overflowX };
      assert.equal(response.status(), 200);
      assert.equal(read.h1.length, 1);
      assert.equal(read.headings[0], "h1");
      assert.equal(read.h1[0], r.title);
      assert.equal(read.lastUpdated, `Last updated ${site.legalUpdated}`);
      assert.ok(read.lastUpdatedVisible, '"Last updated" is visible');
      assert.equal(read.datetime, site.legalUpdatedIso);
      assert.deepEqual(read.breadcrumb, breadcrumbTrail(r.id).map((c) => c.name));
      assert.equal(flow.overflowX, 0, `${flow.overflowX} px of horizontal overflow at 320 px`);
      assert.deepEqual(csp, []);
    });

    test(`${r.path}: every link resolves (pages load, #fragments exist on their page)`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
      await page.goto(`${base}${r.path}`, { waitUntil: "load" });
      const links = await page.evaluate(() => [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")));
      const checked = [];
      const idsOf = new Map();
      const ids = async (path) => {
        if (!idsOf.has(path)) {
          const response = await page.request.get(`${base}${path}`);
          const text = await response.text();
          idsOf.set(path, { status: response.status(), ids: new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) });
        }
        return idsOf.get(path);
      };
      for (const link of links) {
        if (/^(https?:|mailto:)/.test(link) && !link.startsWith(base)) {
          checked.push({ link, kind: "external" });
          continue;
        }
        const url = new URL(link, `${base}${r.path}`);
        const target = await ids(url.pathname);
        const fragment = decodeURIComponent(url.hash.slice(1));
        checked.push({ link, status: target.status, fragment: fragment ? target.ids.has(fragment) : null });
        assert.equal(target.status, 200, `${r.path}: ${link} is ${target.status}`);
        if (fragment) assert.ok(target.ids.has(fragment), `${r.path}: ${link}: no #${fragment} on ${url.pathname}`);
      }
      await context.close();
      result.legal[r.id] = { ...(result.legal[r.id] ?? {}), links: checked };
      assert.ok(checked.length > 0);
    });

    test(`${r.path}: at most one strong accent object per viewport at rest, at 1440 and 390; axe finds nothing at 1280×720 and 390×844`, async () => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        const { context, page } = await newPage(browser, { viewport, reducedMotion: "reduce" });
        await page.goto(`${base}${r.path}`, { waitUntil: "load" });
        const audit = await accentAudit(page);
        await context.close();
        result.legal[r.id] = { ...(result.legal[r.id] ?? {}), [`accent ${viewport.width}`]: audit };
        assert.ok(audit.maxPerWindow <= 1, `${r.path} at ${viewport.width}: ${JSON.stringify(audit.objects)}`);
      }
      for (const viewport of [
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ]) {
        for (const reducedMotion of ["no-preference", "reduce"]) {
          const { context, page } = await newPage(browser, { viewport, reducedMotion });
          await page.goto(`${base}${r.path}`, { waitUntil: "load" });
          const axe = await runAxe(page);
          await context.close();
          result.legal[r.id] = { ...(result.legal[r.id] ?? {}), [`axe ${viewport.width} ${reducedMotion}`]: axe.violations };
          assert.deepEqual(axe.violations, [], `${r.path} ${viewport.width} ${reducedMotion}: ${JSON.stringify(axe.violations)}`);
        }
      }
    });
  }

  test("none is in the search index: Pagefind, queried as the search dialog does, returns no legal page", async () => {
    const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    await page.goto(`${base}/`, { waitUntil: "load" });
    // "Run Hound" is on every indexed page: it shows the index answers at all.
    const queries = ["Run Hound", ...legalRoutes.map((r) => r.title), "vulnerability disclosure", "acceptable use", "privacy policy", "terms of use"];
    const found = await page.evaluate(async (list) => {
      const pagefind = await import("/pagefind/pagefind.js");
      await pagefind.init();
      const out = {};
      for (const query of list) {
        const search = await pagefind.search(query);
        const data = await Promise.all(search.results.map((result) => result.data()));
        out[query] = data.map((d) => d.url);
      }
      return out;
    }, queries);
    await context.close();
    result.legal.search = found;
    const legalPaths = new Set(legalRoutes.map((r) => r.path));
    assert.ok(found["Run Hound"].length > 0, "the index answers");
    for (const [query, urls] of Object.entries(found)) {
      for (const url of urls) assert.ok(!legalPaths.has(url.replace(/#.*$/, "")), `"${query}" found ${url}`);
    }
  });
});
