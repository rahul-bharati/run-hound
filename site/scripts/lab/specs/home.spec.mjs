/**
 * The homepage on the built site (DESIGN.md §3.1, §5.2; node P1): its words, screens and first viewport, the proof
 * strip above the run window on phones, the CTA, the bug on screen in time, LCP and CLS, the HTML weight, the accent
 * and type audits, the h1 in three phrases, "Other ways to start" under a real mouse click, the pill on one line, and
 * axe-core. The motion contract (motion-contract.spec.mjs) covers what moves. Run:
 *
 *   NEXT_DIST_DIR=.next-P1 pnpm build && NEXT_DIST_DIR=.next-P1 pnpm lab home --port 4917
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import { siteDir } from "../../lib/build-output.mjs";
import { accentAudit, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, median, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { firstViewport, measurePage, textLines, typeAudit } from "../lib/page-measures.mjs";
import { writeJson } from "../lib/out.mjs";
import { installFrameSampler, readFrameSampler } from "../lib/timeline.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";

await import("../../test-hooks.mjs");
const { home } = await import("../../../src/content/home.ts");

const base = origin();
const result = {};
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("home.json", result);
});

/** A page at rest on "/": reduced motion unless asked, the fonts loaded. */
async function open(options = {}) {
  const { context, page } = await newPage(browser, { reducedMotion: "reduce", ...options });
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

describe("words, screens and the first viewport (§5.2)", () => {
  test("at most 750 words in <main>: in the built HTML (check-copy, enforced) and as the browser shows them", async () => {
    const copy = spawnSync(process.execPath, ["scripts/check-copy.mjs", "--enforce", "--sections"], { cwd: siteDir, encoding: "utf8" });
    const total = Number(/(\d+) words in <main>/.exec(copy.stdout)?.[1]);
    result.copy = { total, out: copy.stdout.trim().split("\n"), warnings: copy.stderr.trim().split("\n").filter(Boolean) };
    assert.equal(copy.status, 0, copy.stdout + copy.stderr);
    assert.ok(total > 0 && total <= 750, `${total} words`);
    const { context, page } = await open();
    const measured = await measurePage(page);
    result.visibleWords = measured.mainWords;
    assert.ok(measured.mainWords <= 750, `${measured.mainWords} visible words`);
    assert.equal(measured.h1, 1);
    assert.equal(measured.h2, 7);
    assert.equal(measured.tablists, 0);
    await context.close();
  });

  for (const [profile, limit] of [["desktop", 7.0], ["phone", 10.0]]) {
    test(`${profile}: at most ${limit} screens with reduced motion, header and footer included; no sideways scroll`, async () => {
      const { context, page } = await open({ profile });
      const measured = await measurePage(page);
      result[`screens-${profile}`] = { screens: measured.screens, pageHeight: measured.pageHeight, footer: measured.footerHeight, blocks: measured.blocks };
      assert.ok(measured.screens <= limit, `${measured.screens} screens (${measured.pageHeight} px)`);
      assert.equal(measured.overflowX, 0);
      await context.close();
    });
  }

  test("1440×900: the h1, the subhead with free, both buttons and the command are in the first viewport", async () => {
    const { context, page } = await open();
    const seen = await firstViewport(page, {
      h1: "main h1",
      subhead: { text: "Run Hound is free" },
      primary: `main a[href="${home.hero.primary.href}"]`,
      secondary: `main a[href="${home.hero.secondary.href}"]`,
      command: "main .command-line",
    });
    result.firstViewportDesktop = seen;
    for (const [name, box] of Object.entries(seen)) assert.ok(box.found && box.whollyInside, `${name}: ${JSON.stringify(box)}`);
    await context.close();
  });

  test("390×844: free and the primary button within the first 844 px; the proof strip above the run window", async () => {
    const { context, page } = await open({ profile: "phone" });
    const seen = await firstViewport(page, {
      free: { text: "Run Hound is free" },
      primary: `main a[href="${home.hero.primary.href}"]`,
      strip: "main .fact-strip",
      window: "main [data-hero-window]",
    });
    result.firstViewportPhone = seen;
    assert.ok(seen.free.whollyInside, JSON.stringify(seen.free));
    assert.ok(seen.primary.whollyInside, JSON.stringify(seen.primary));
    assert.ok(seen.strip.bottom <= seen.window.top, `strip ${seen.strip.top}-${seen.strip.bottom}, window from ${seen.window.top}`);
    await context.close();
  });
});

describe("links", () => {
  test("Try it locally goes to /docs/quick-start/, in the hero and at the close", async () => {
    const { context, page } = await open();
    const hrefs = await page.$$eval("main a", (links) => links.filter((a) => a.textContent.trim() === "Try it locally").map((a) => a.getAttribute("href")));
    assert.deepEqual(hrefs, ["/docs/quick-start/", "/docs/quick-start/"]);
    await context.close();
  });

  test('a real mouse click on "Other ways to start" lands on #start', async () => {
    for (const profile of ["desktop", "phone"]) {
      const { context, page } = await open({ profile, reducedMotion: "no-preference" });
      const link = page.locator('main a[href="#start"]').first();
      await link.scrollIntoViewIfNeeded();
      // The middle of the link's first line: a link that wraps has a box whose centre can fall between its lines.
      const box = await link.evaluate((a) => {
        const r = a.getClientRects()[0];
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      // Nothing is stacked over the link there (E2: an empty live region covered it).
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a[href="#start"]') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      assert.ok(hit, `${profile}: the link is what a click there hits`);
      if (profile === "phone") await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => location.hash === "#start", null, { timeout: 3000 });
      assert.equal(await page.evaluate(() => location.hash), "#start", profile);
      await context.close();
    }
  });
});

describe("the bug on screen in time, LCP and CLS (§5.2)", () => {
  // 5 runs, not 3: at the 1,000 ms LCP limit a throttled runner's own variance can put the median a few ms over on an
  // unlucky 3 (e.g. 1004, 996, 1004 passed on the previous PR's run and failed on this one, with no change to the
  // homepage's render path). A wider sample is steadier at the same limit: the extra two runs pull an outlier toward
  // the middle instead of letting it decide the median.
  test("throttled desktop, median of 5: the finding card by 5.0 s and the stamp by 5.5 s; LCP ≤ 1,000 ms on the h1", async () => {
    const finding = '[data-motion="hero-run"] [data-part="finding"]';
    const stamp = '[data-motion="hero-run"] [data-part="stamp"]';
    const runs = [];
    for (let run = 0; run < 5; run += 1) {
      const { context, page } = await newPage(browser, { throttle: true });
      await installVitals(page);
      await installFrameSampler(page, [finding, stamp], { ms: 9000 });
      await page.goto(`${base}/`, { waitUntil: "load", timeout: 60_000 });
      await sleep(Math.max(0, 9500 - (await page.evaluate(() => performance.now()))));
      const frames = await readFrameSampler(page, { raw: true });
      const firstAt = (selector) => frames[selector]?.samples?.find(([, opacity]) => opacity !== null && opacity >= 0.9)?.[0] ?? null;
      const vitals = await readVitals(page);
      runs.push({ finding: firstAt(finding), stamp: firstAt(stamp), lcp: vitals.lcp });
      await context.close();
    }
    result.timeToBug = runs;
    assert.ok(runs.every((r) => r.finding !== null && r.stamp !== null), JSON.stringify(runs));
    assert.ok(median(runs.map((r) => r.finding)) <= 5000, `finding at ${median(runs.map((r) => r.finding))} ms`);
    assert.ok(median(runs.map((r) => r.stamp)) <= 5500, `stamp at ${median(runs.map((r) => r.stamp))} ms`);
    assert.ok(median(runs.map((r) => r.lcp.t)) <= 1000, `LCP ${JSON.stringify(runs.map((r) => r.lcp))}`);
    for (const r of runs) assert.equal(r.lcp.tag, "h1", `LCP element ${r.lcp.el}`);
  });

  test("throttled phone, median of 3: LCP ≤ 1,000 ms, on the h1 or the subhead", async () => {
    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      const { context, page } = await newPage(browser, { profile: "phone", throttle: true });
      await installVitals(page);
      await page.goto(`${base}/`, { waitUntil: "load", timeout: 60_000 });
      await sleep(1500);
      const { lcp } = await readVitals(page);
      runs.push(lcp);
      await context.close();
    }
    result.lcpPhone = runs;
    assert.ok(median(runs.map((lcp) => lcp.t)) <= 1000, `LCP ${JSON.stringify(runs)}`);
    for (const lcp of runs) assert.ok(lcp.tag === "h1" || /Run Hound is free/.test(lcp.el ?? ""), `LCP element ${lcp.el}`);
  });

  test("CLS 0 through load, the hero run, Replay and a full scroll down and back", async () => {
    for (const profile of ["desktop", "phone"]) {
      const { context, page } = await newPage(browser, { profile });
      await installVitals(page);
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page
        .waitForFunction(() => ["done", "armed"].includes(document.querySelector('[data-motion="hero-run"]')?.getAttribute("data-motion-state") ?? ""), null, { timeout: 12_000 })
        .catch(() => {});
      if (profile === "desktop") {
        await page.click('[data-part="replay-slot"]');
        await sleep(3500);
      }
      await slowScroll(page, { back: true });
      await sleep(500);
      const { cls, shifts } = await readVitals(page);
      result[`cls-${profile}`] = { cls, shifts };
      assert.ok(cls <= 0.0001, `${profile}: CLS ${cls} ${JSON.stringify(shifts)}`);
      assert.deepEqual(await cspViolations(page), [], `${profile}: no CSP violation`);
      await context.close();
    }
  });
});

describe("weight, accent and type (§5.2)", () => {
  test("HTML at most 135,000 B raw and 25,000 B gzip", async () => {
    const response = await fetch(`${base}/`);
    const body = Buffer.from(await response.arrayBuffer());
    const gzip = gzipSync(body, { level: 9 }).length;
    result.html = { raw: body.length, gzip };
    assert.ok(body.length <= 135_000, `${body.length} B raw`);
    assert.ok(gzip <= 25_000, `${gzip} B gzip`);
  });

  for (const profile of ["desktop", "phone"]) {
    test(`${profile}: at most one strong accent object per viewport at rest; at most 9 font sizes; mono at most 12% of the words`, async () => {
      const { context, page } = await open({ profile });
      const accent = await accentAudit(page);
      const type = await typeAudit(page);
      result[`accent-${profile}`] = accent;
      result[`type-${profile}`] = type;
      assert.ok(accent.maxPerWindow <= 1, JSON.stringify(accent.objects));
      assert.ok(type.distinctFontSizes <= 9, JSON.stringify(type.fontSizes));
      assert.ok(type.monoShare <= 0.12, `mono ${type.monoShare}`);
      await context.close();
    });
  }
});

describe("the h1 and the pill (§2.2, B7)", () => {
  test("the h1 keeps its three phrases whole from 1024 to 1440 px", async () => {
    for (const width of [1024, 1100, 1280, 1366, 1440]) {
      const { context, page } = await open({ viewport: { width, height: 900 } });
      const lines = await textLines(page, "main h1");
      assert.deepEqual(lines, home.hero.h1, `${width} px: ${JSON.stringify(lines)}`);
      await context.close();
    }
  });

  test("the pill is one line at 360 and 390 px", async () => {
    for (const width of [360, 390]) {
      const { context, page } = await open({ viewport: { width, height: 844 } });
      const lines = await textLines(page, "main .pill");
      assert.equal(lines.length, 1, `${width} px: ${JSON.stringify(lines)}`);
      await context.close();
    }
  });
});

describe("axe-core (§5.2)", () => {
  for (const [viewport, reducedMotion] of [
    [{ width: 1280, height: 720 }, "reduce"],
    [{ width: 1280, height: 720 }, "no-preference"],
    [{ width: 390, height: 844 }, "reduce"],
    [{ width: 390, height: 844 }, "no-preference"],
  ]) {
    test(`${viewport.width}×${viewport.height}, ${reducedMotion}: 0 violations, after all motion`, async () => {
      const { context, page } = await newPage(browser, { viewport, reducedMotion });
      await page.goto(`${base}/`, { waitUntil: "load" });
      if (reducedMotion === "no-preference") {
        await sleep(5000);
        await slowScroll(page, { back: true });
        await sleep(2500);
      }
      const axe = await runAxe(page);
      result[`axe-${viewport.width}-${reducedMotion}`] = axe;
      assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations, null, 1));
      await context.close();
    });
  }
});
