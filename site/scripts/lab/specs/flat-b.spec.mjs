/**
 * The product pages on the built site (DESIGN.md §3.11-§3.12; node F2): /how-it-works/, /demo/ and /ai-built-apps/.
 * Each has one h1 as its first heading, a breadcrumb equal to its BreadcrumbList, no horizontal overflow at 320 px, no
 * CSP violation, at most one strong accent object per viewport at rest (§2.3), and axe-core finds nothing at 1280×720
 * and 390×844, motion on and reduced. Then what each page promises:
 * - /ai-built-apps/: #discovery with the discovery limits; its kept ids; "vibe-coded" once in the first paragraph and
 *   once in an h2, never in the title, the h1 or the description;
 * - /demo/: its kept ids; every finding links its check's page ("About this check"); every GIF plays once (no looping
 *   extension in the bytes served) and has a still for reduced motion;
 * - /how-it-works/: no get-started block, a Start snippet linking the quick start, and no more words than the page had
 *   before the redesign (scripts/lab/baseline.json);
 * - the figure reveals on /how-it-works/ and /demo/ (a subset of the motion contract, §4.6): each plays once, never
 *   moves or fades a word (a caption included), is on the figure's media only, ends "done", never replays on a second
 *   scroll, and shifts no layout; under reduced motion nothing is requested and every figure is at rest.
 * Run: NEXT_DIST_DIR=.next-lab pnpm build && NEXT_DIST_DIR=.next-lab pnpm lab flat-b.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { siteDir } from "../../lib/build-output.mjs";
import { accentAudit, runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { installTextAudit, readTextAudit } from "../lib/motion.mjs";
import { writeJson } from "../lib/out.mjs";
import { measurePage } from "../lib/page-measures.mjs";
import { recordRequests } from "../lib/requests.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";

await import("../../test-hooks.mjs");
const { breadcrumbTrail, resolveTarget } = await import("../../../src/lib/nav.ts");
const { route } = await import("../../../src/content/routes.ts");
const { aiBuiltIntro, aiBuiltSections, discovery } = await import("../../../src/content/ai-built.ts");
const { aboutCheck, checkPageLink, demoSections, fernwayBand } = await import("../../../src/content/demo.ts");
const { startSnippet } = await import("../../../src/content/how-it-works.ts");

const base = origin();
const baseline = JSON.parse(readFileSync(join(siteDir, "scripts/lab/baseline.json"), "utf8"));
const pages = [
  { id: "how-it-works", path: "/how-it-works/" },
  { id: "demo", path: "/demo/" },
  { id: "ai-built-apps", path: "/ai-built-apps/" },
];
const result = {};
const record = (id, key, value) => ((result[id] ??= {})[key] = value);
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("flat-b.json", result);
});

/** The page's headings, its visible breadcrumb, its title, description and first paragraph in <main>. */
const readPage = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      headings: [...main.querySelectorAll("h1, h2, h3")].map((h) => h.tagName.toLowerCase()),
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
      h2: [...main.querySelectorAll("h2")].map((h) => h.textContent.trim()),
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      firstParagraph: main.querySelector("p:not(nav p)")?.textContent.trim() ?? "",
      mainText: main.textContent,
      breadcrumb: [...(main.querySelector('nav[aria-label="Breadcrumb"]')?.querySelectorAll("li") ?? [])].map((li) => li.textContent.replace("/", "").trim()),
      ids: [...main.querySelectorAll("[id]")].map((el) => el.id),
    };
  });

describe("every product page", () => {
  for (const { id, path } of pages) {
    test(`${path}: one h1, first; the breadcrumb from the registry; no overflow at 320 px; no CSP violation`, async () => {
      const { context, page } = await newPage(browser, { viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      const read = await readPage(page);
      const flow = await reflow(page);
      const csp = await cspViolations(page);
      await context.close();
      record(id, "overflow320", flow.overflowX);
      assert.equal(read.h1.length, 1, `${path}: ${read.h1.length} h1`);
      assert.equal(read.headings[0], "h1", `${path}: the first heading is ${read.headings[0]}`);
      assert.deepEqual(
        read.breadcrumb,
        breadcrumbTrail(id).map((c) => c.name),
      );
      assert.equal(flow.overflowX, 0, `${path}: ${flow.overflowX} px of horizontal overflow at 320 px`);
      assert.deepEqual(csp, [], `${path}: CSP violations`);
    });

    for (const [name, viewport] of [
      ["1280×720", { width: 1280, height: 720 }],
      ["390×844", { width: 390, height: 844 }],
    ]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        test(`${path} at ${name}, motion ${reducedMotion}: axe finds nothing (after the figures have played)`, async () => {
          const { context, page } = await newPage(browser, { viewport, reducedMotion });
          await page.goto(`${base}${path}`, { waitUntil: "load" });
          if (reducedMotion === "no-preference") {
            await sleep(2500);
            await slowScroll(page, { step: 300, pause: 60 });
            await sleep(1000);
          }
          const axe = await runAxe(page);
          await context.close();
          record(id, `axe ${name} ${reducedMotion}`, axe.violations);
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
        record(id, `accent ${viewport.width}`, audit);
        assert.ok(audit.maxPerWindow <= 1, `${path} at ${viewport.width}: ${JSON.stringify(audit.objects)}`);
      }
    });
  }
});

describe("/ai-built-apps/ (§3.11)", () => {
  test("#discovery holds the discovery limits, and the kept ids are there", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/ai-built-apps/#discovery`, { waitUntil: "load" });
    const read = await readPage(page);
    const found = await page.evaluate(() => {
      const section = document.getElementById("discovery");
      const header = document.querySelector("body > header");
      return { text: section?.textContent ?? "", top: Math.round(section?.getBoundingClientRect().top ?? -1), header: Math.round(header.getBoundingClientRect().bottom) };
    });
    await context.close();
    for (const id of aiBuiltSections.map((s) => s.id)) assert.ok(read.ids.includes(id), `#${id}`);
    for (const fact of discovery.facts) assert.ok(found.text.includes(fact.value), `#discovery: ${fact.value}`);
    assert.match(found.text, /Up to 5 per page/);
    assert.match(found.text, /Up to 3 buttons/);
    assert.match(found.text, /Up to 40 found/);
    assert.ok(found.top >= found.header - 1, `#discovery lands under the header (${found.top} < ${found.header})`);
  });

  test("“vibe-coded”: once in the first paragraph and once in an h2; never in the title, the h1 or the description", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/ai-built-apps/`, { waitUntil: "load" });
    const read = await readPage(page);
    await context.close();
    const count = (text) => (text.match(/vibe-coded/gi) ?? []).length;
    record("ai-built-apps", "vibe", { firstParagraph: read.firstParagraph, h2: read.h2.filter((h) => count(h)) });
    assert.equal(read.firstParagraph, aiBuiltIntro.lede, "the first paragraph in <main> is the lede");
    assert.equal(count(read.firstParagraph), 1);
    assert.equal(read.h2.reduce((n, h) => n + count(h), 0), 1, "one h2");
    assert.equal(count(read.mainText), 2, "nowhere else in <main>");
    assert.equal(count(read.title), 0);
    assert.equal(count(read.h1.join(" ")), 0);
    assert.equal(count(read.description), 0);
  });
});

describe("/demo/ (§3.12)", () => {
  const findings = [...demoSections.flatMap((s) => s.findings), fernwayBand.finding];

  test("the kept ids, and every finding's “About this check” links its check's page", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/demo/`, { waitUntil: "load" });
    const read = await readPage(page);
    const links = await page.evaluate(
      ({ ids, about }) =>
        ids.map((id) => {
          const holder = document.getElementById(id);
          const link = [...(holder?.querySelectorAll("a") ?? [])].find((a) => a.textContent.trim().startsWith(about));
          return { id, found: Boolean(holder), href: link?.getAttribute("href") ?? null, name: link?.textContent.trim() ?? null };
        }),
      { ids: findings.map((f) => f.check), about: aboutCheck },
    );
    await context.close();
    record("demo", "checkLinks", links);
    for (const id of ["features", "silent-failure", "accessibility", "security", "whole-page", "try", "fernway"]) assert.ok(read.ids.includes(id), `#${id}`);
    for (const link of links) {
      assert.ok(link.found, `#${link.id} is on the page`);
      assert.equal(link.href, resolveTarget(checkPageLink(link.id)), `#${link.id}: its “${aboutCheck}” link`);
      assert.ok(link.name.includes(link.id), `#${link.id}: the link's name says which check (${link.name})`);
    }
  });

  test("every GIF plays once (no looping extension in the bytes served) and has a still for reduced motion", async () => {
    // A recording (components/demo/recording.tsx) paints its still first and names its GIF on its frame,
    // data-recording; the GIF's <img> exists only once the frame is in view with motion allowed. So the recordings are
    // found by that attribute, not by a GIF <img>, and under reduced motion each is scrolled into view: it must keep
    // its still there, and the page must never request the GIF.
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    const requests = recordRequests(page);
    await page.goto(`${base}/demo/`, { waitUntil: "load" });
    const frames = page.locator("main [data-recording]");
    for (let i = 0; i < (await frames.count()); i += 1) {
      await frames.nth(i).scrollIntoViewIfNeeded();
      await sleep(300);
    }
    await page.waitForFunction(() => [...document.querySelectorAll("main [data-recording] img")].every((img) => img.complete), null, { timeout: 10_000 });
    const gifs = await page.evaluate(() =>
      [...document.querySelectorAll("main [data-recording]")].map((frame) => {
        const imgs = [...frame.querySelectorAll("img")];
        const still = imgs.find((img) => img.alt.trim() !== "");
        return {
          src: frame.getAttribute("data-recording"),
          still: still?.getAttribute("src") ?? null,
          current: imgs.map((img) => img.currentSrc),
        };
      }),
    );
    const gifRequests = requests.requests.filter((r) => /\.gif(\?|$)/.test(r.path)).map((r) => r.path);
    const bodies = [];
    for (const gif of gifs) {
      const response = await page.request.get(new URL(gif.src, base).href);
      bodies.push({ src: gif.src, status: response.status(), bytes: Buffer.from(await response.body()).toString("latin1") });
    }
    await context.close();
    record("demo", "gifs", { gifs, gifRequests });
    assert.equal(gifs.length, 2, "the double-submit and silent-failure recordings");
    for (const [i, body] of bodies.entries()) {
      assert.match(body.src, /\.gif$/, "data-recording names the GIF");
      assert.equal(body.status, 200, body.src);
      assert.ok(body.bytes.startsWith("GIF8"), body.src);
      for (const loop of ["NETSCAPE2.0", "ANIMEXTS1.0"]) assert.ok(!body.bytes.includes(loop), `${body.src} loops (${loop})`);
      assert.ok(gifs[i].still, `${body.src} has no still for reduced motion`);
      assert.doesNotMatch(gifs[i].still, /\.gif/, `${body.src}: the still is not the GIF`);
      for (const current of gifs[i].current) assert.doesNotMatch(current, /\.gif/, `reduced motion shows the still, not ${current}`);
    }
    assert.deepEqual(gifRequests, [], "no GIF is requested under reduced motion");
  });
});

describe("/how-it-works/ (§3.12)", () => {
  test("no get-started block, a Start snippet linking the quick start, and no more words than before the redesign", async () => {
    const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${base}/how-it-works/`, { waitUntil: "load" });
    const measures = await measurePage(page);
    const snippet = await page.evaluate((label) => {
      const blocks = [...document.querySelectorAll("main .code-block")];
      const block = blocks.find((b) => b.querySelector(".code-block-label")?.textContent.trim() === label);
      return {
        blocks: blocks.length,
        commands: block ? [...block.querySelectorAll(".code-cmd")].map((c) => c.textContent) : [],
        links: [...(block?.closest("section")?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href")),
        h3s: [...document.querySelectorAll("main h3")].map((h) => h.textContent.trim()),
      };
    }, startSnippet.label);
    await context.close();
    const before = baseline.pages["how-it-works"]["1440"].words;
    record("how-it-works", "words", { now: measures.mainWords, before });
    record("how-it-works", "startSnippet", snippet);
    assert.ok(measures.mainWords <= before, `${measures.mainWords} words in <main>, ${before} before`);
    assert.equal(snippet.blocks, 1, "one terminal block: the Start snippet");
    assert.deepEqual(snippet.commands, [...startSnippet.block.commands]);
    assert.ok(snippet.links.includes(resolveTarget(startSnippet.link.to)), `the snippet links the quick start (${snippet.links})`);
    // The get-started block's own headings are gone.
    for (const heading of ["Docker or Podman: pull and run", "Try it on the demo apps", "From source"]) assert.ok(!snippet.h3s.includes(heading), heading);
  });
});

describe("figure reveals on /how-it-works/ and /demo/ (a subset of the motion contract, §4.6)", () => {
  /** Logs each [data-motion="reveal"] root's data-motion-state changes from navigation. */
  const installStateLog = (page) =>
    page.addInitScript(() => {
      window.__revealLog = [];
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.target.getAttribute("data-motion") !== "reveal") continue;
          const roots = [...document.querySelectorAll('[data-motion="reveal"]')];
          window.__revealLog.push({ i: roots.indexOf(m.target), value: m.target.getAttribute("data-motion-state") });
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-motion-state"] });
    });

  for (const path of ["/how-it-works/", "/demo/"]) {
    for (const profile of ["desktop", "phone"]) {
      test(`${path} at ${profile}: each reveal plays once, on media only, moves no word, ends done, shifts nothing`, async () => {
        const { context, page } = await newPage(browser, { profile });
        await installStateLog(page);
        await installTextAudit(page);
        await installVitals(page);
        await page.goto(`${base}${path}`, { waitUntil: "load" });
        await sleep(3000); // load + idle (2 s at most): the scroll runtime arms
        const figures = await page.evaluate(() =>
          [...document.querySelectorAll('[data-motion="reveal"]')].map((root) => ({
            media: root.classList.contains("figure-media") && root.parentElement.tagName === "FIGURE",
            caption: Boolean(root.querySelector("figcaption")),
            words: (root.textContent.match(/[\p{L}\p{N}]+/gu) ?? []).length - [...root.querySelectorAll('[aria-hidden="true"]')].reduce((n, el) => n + (el.textContent.match(/[\p{L}\p{N}]+/gu) ?? []).length, 0),
          })),
        );
        await slowScroll(page, { step: 150, pause: 80 });
        await page.waitForFunction(() => !document.querySelector('[data-motion-state="playing"]'), null, { timeout: 8000, polling: 100 }).catch(() => {});
        await sleep(500);
        // Up and down again: nothing replays.
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(400);
        await slowScroll(page, { step: 300, pause: 60 });
        await sleep(800);
        const log = await page.evaluate(() => window.__revealLog);
        const states = await page.evaluate(() => [...document.querySelectorAll('[data-motion="reveal"]')].map((root) => root.getAttribute("data-motion-state")));
        const rest = await page.evaluate(() =>
          [...document.querySelectorAll('[data-motion="reveal"]')].map((root) => {
            const { opacity, transform } = getComputedStyle(root);
            return { opacity, transform, still: transform === "none" || new DOMMatrixReadOnly(transform).isIdentity };
          }),
        );
        const audit = await readTextAudit(page);
        const vitals = await readVitals(page);
        await context.close();
        record(path, `reveal ${profile}`, { figures, states, log, audit, cls: vitals.cls });
        assert.ok(figures.length >= 3, `${path}: ${figures.length} revealed figures`);
        for (const [i, root] of figures.entries()) {
          assert.ok(root.media, `reveal ${i} is not a figure's media wrapper`);
          assert.ok(!root.caption, `reveal ${i} holds its caption`);
          assert.equal(root.words, 0, `reveal ${i} holds words a reader needs`);
        }
        // A figure in view when the runtime armed stays as the server rendered it (no state); one below the fold is
        // armed as it comes near, plays once at 88% and ends "done". Both pages hold several figures below the fold, so
        // several must have played.
        const played = states.filter((state) => state === "done").length;
        assert.ok(played >= 3, `${path}: ${played} figures played`);
        for (const [i, state] of states.entries()) {
          assert.ok(state === null || state === "done", `reveal ${i} ended ${state}`);
          const plays = log.filter((entry) => entry.i === i && entry.value === "playing").length;
          assert.equal(plays, state === "done" ? 1 : 0, `reveal ${i} played ${plays} times`);
          assert.ok(log.filter((entry) => entry.i === i && entry.value === "armed").length <= 1, `reveal ${i} was armed again`);
          assert.equal(Number(rest[i].opacity), 1, `reveal ${i} rests at opacity ${rest[i].opacity}`);
          assert.ok(rest[i].still, `reveal ${i} rests moved: ${rest[i].transform}`);
        }
        assert.deepEqual(audit, [], `${path}: words faded or moved: ${JSON.stringify(audit)}`);
        assert.ok(vitals.cls <= 0.01, `${path}: CLS ${vitals.cls}`);
      });
    }

    test(`${path}, reduced motion: no motion code requested, every figure at rest, no state set`, async () => {
      const { context, page } = await newPage(browser, { reducedMotion: "reduce" });
      const log = recordRequests(page);
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await sleep(3000);
      await slowScroll(page, { step: 300, pause: 60 });
      await sleep(500);
      const figures = await page.evaluate(() =>
        [...document.querySelectorAll('[data-motion="reveal"]')].map((root) => ({ opacity: getComputedStyle(root).opacity, state: root.getAttribute("data-motion-state") })),
      );
      const gsap = await page.evaluate(() => typeof window.gsapVersions !== "undefined");
      await context.close();
      const motion = log.requests.filter((r) => r.type === "script" && (r.gsap || r.scrollTrigger || r.drawSVG));
      assert.ok(figures.length >= 3);
      for (const figure of figures) {
        assert.equal(Number(figure.opacity), 1);
        assert.equal(figure.state, null);
      }
      assert.equal(gsap, false, "gsapVersions is defined");
      assert.deepEqual(motion, [], "GSAP was requested");
    });
  }
});

// The registry promises nothing on these pages that the page lacks (check-registry fails the build otherwise); this
// only records what each promises, for the report.
test("what the registry promises on the product pages", () => {
  for (const { id } of pages) record(id, "promised", route(id).anchors);
});
