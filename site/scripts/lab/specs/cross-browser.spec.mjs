/**
 * The smoke set in Firefox and WebKit (DESIGN.md §5.4 E1, risk R1: the prototypes measured Chromium only): the home
 * page with motion and reduced, a docs page, a check page, search, the phone menu and the 404, each loading without a
 * script error or a CSP violation; the hero run and the 404 trail (GSAP, DrawSVG) reach their rest; search finds a
 * check under the hash CSP (Pagefind's WASM, so 'wasm-unsafe-eval' is added only if a browser needs it). What each
 * browser supports of `@media (scripting)`, `@starting-style`, the scroll-driven header and `<details name>` is
 * recorded with what the page did, in <lab out>/cross-browser.json.
 *
 * A browser that can't start here (WebKit needs system libraries: `sudo pnpm exec playwright install-deps webkit`) is
 * skipped, saying why, unless LAB_ALL_BROWSERS=1 (CI's site-lab job installs both with --with-deps and sets it).
 * Run: pnpm lab cross-browser.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { firefox, webkit } from "playwright";
import { origin, sleep } from "../lib/browser.mjs";
import { writeJson } from "../lib/out.mjs";
import { notFoundPath } from "../lib/routes.mjs";

const base = origin();
const requireAll = process.env.LAB_ALL_BROWSERS === "1";
const result = {};
after(() => writeJson("cross-browser.json", result));

/** A page that records script errors and CSP violations. */
async function open(browser, { viewport = { width: 1440, height: 900 }, reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
  });
  return { context, page, errors, csp: () => page.evaluate(() => window.__csp) };
}

const stateOf = (page, name) => page.evaluate((n) => document.querySelector(`[data-motion="${n}"]`)?.getAttribute("data-motion-state") ?? null, name);

async function waitForRest(page, name, ms) {
  const until = Date.now() + ms;
  let state = null;
  while (Date.now() < until) {
    state = await stateOf(page, name);
    if (state === "done") return state;
    await sleep(100);
  }
  return state;
}

for (const [name, type] of [
  ["firefox", firefox],
  ["webkit", webkit],
]) {
  describe(name, () => {
    let browser;
    let unavailable;
    const ready = async (t) => {
      if (!browser && !unavailable) {
        try {
          browser = await type.launch();
          result[name] = { version: browser.version() };
        } catch (error) {
          const line = String(error.message).split("\n").find((l) => /missing|Executable|install/i.test(l)) ?? "it can't start";
          unavailable = line.replace(/[║╔╗╚╝═]/g, "").trim();
          result[name] = { unavailable };
        }
      }
      if (unavailable) {
        if (requireAll) assert.fail(`${name} didn't start: ${unavailable}`);
        t.skip(`${name} can't start on this machine: ${unavailable.trim()}`);
        return false;
      }
      return true;
    };
    after(() => browser?.close());

    test("the home page, motion on: the hero run rests; no script error, no CSP violation; what the browser supports", async (t) => {
      if (!(await ready(t))) return;
      const { context, page, errors, csp } = await open(browser);
      await page.goto(`${base}/`, { waitUntil: "load" });
      const hero = await waitForRest(page, "hero-run", 12_000);
      const supports = await page.evaluate(() => ({
        scripting: matchMedia("(scripting: enabled)").matches,
        startingStyle: typeof window.CSSStartingStyleRule !== "undefined",
        scrollTimeline: CSS.supports("animation-timeline: scroll()"),
        detailsName: "name" in HTMLDetailsElement.prototype,
        gsap: Boolean(window.gsapVersions),
      }));
      const header = async () => page.evaluate(() => getComputedStyle(document.querySelector("header")).backgroundColor);
      const atTop = await header();
      await page.mouse.wheel(0, 400);
      await sleep(600);
      const scrolled = await header();
      const violations = await csp();
      await context.close();
      result[name].home = { hero, supports, header: { atTop, scrolled }, errors, csp: violations };
      assert.equal(hero, "done", "the hero run rests");
      assert.deepEqual(errors, []);
      assert.deepEqual(violations, []);
      assert.ok(supports.scripting, "@media (scripting) matches with scripts on");
      if (supports.scrollTimeline) assert.notEqual(scrolled, atTop, "the scroll-driven header turns opaque after a scroll");
    });

    test("the home page, reduced motion: GSAP never loads, the finished frame shows", async (t) => {
      if (!(await ready(t))) return;
      const { context, page, errors, csp } = await open(browser, { reducedMotion: "reduce" });
      const scripts = [];
      page.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
      await page.goto(`${base}/`, { waitUntil: "load" });
      await sleep(3000);
      const gsap = await page.evaluate(() => typeof window.gsapVersions);
      const h1 = await page.locator("h1").isVisible();
      const violations = await csp();
      await context.close();
      result[name].reduced = { gsap, scripts: scripts.length, errors, csp: violations };
      assert.equal(gsap, "undefined");
      assert.ok(h1);
      assert.deepEqual(errors, []);
      assert.deepEqual(violations, []);
    });

    for (const path of ["/docs/quick-start/", "/checks/double-submit/"]) {
      test(`${path}: its h1, no script error, no CSP violation`, async (t) => {
        if (!(await ready(t))) return;
        const { context, page, errors, csp } = await open(browser);
        const response = await page.goto(`${base}${path}`, { waitUntil: "load" });
        await sleep(1500);
        const h1 = await page.locator("main h1").first().isVisible();
        const violations = await csp();
        await context.close();
        result[name][path] = { status: response.status(), errors, csp: violations };
        assert.equal(response.status(), 200);
        assert.ok(h1);
        assert.deepEqual(errors, []);
        assert.deepEqual(violations, []);
      });
    }

    test("search: Ctrl+K opens it, and it finds double-submit under the hash CSP", async (t) => {
      if (!(await ready(t))) return;
      const { context, page, errors, csp } = await open(browser);
      await page.goto(`${base}/docs/`, { waitUntil: "load" });
      await sleep(500);
      await page.keyboard.press("Control+k");
      await page.waitForSelector("dialog[open]", { timeout: 10_000 });
      await page.keyboard.type("double-submit", { delay: 30 });
      await page.waitForFunction(() => /\d+ results?$/.test(document.querySelector("dialog [role='status']")?.textContent.trim() ?? ""), null, { timeout: 15_000 });
      const status = await page.evaluate(() => document.querySelector("dialog [role='status']").textContent.trim());
      const links = await page.evaluate(() => [...document.querySelectorAll("dialog a[href]")].map((a) => a.getAttribute("href")));
      const violations = await csp();
      await context.close();
      result[name].search = { status, links: links.slice(0, 5), errors, csp: violations };
      assert.ok(links.some((href) => href.startsWith("/checks/double-submit/")), JSON.stringify(links));
      assert.deepEqual(errors, []);
      assert.deepEqual(violations, [], "no CSP violation: Pagefind's WASM runs without 'wasm-unsafe-eval'");
    });

    test("the phone menu: Menu opens it, Escape closes it and returns focus", async (t) => {
      if (!(await ready(t))) return;
      const { context, page, errors } = await open(browser, { viewport: { width: 390, height: 844 } });
      await page.goto(`${base}/`, { waitUntil: "load" });
      const menu = page.getByRole("button", { name: "Menu" });
      await menu.click();
      const opened = await menu.getAttribute("aria-expanded");
      await page.keyboard.press("Escape");
      const closed = await menu.getAttribute("aria-expanded");
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
      await context.close();
      result[name].menu = { opened, closed, focused, errors };
      assert.equal(opened, "true");
      assert.equal(closed, "false");
      assert.equal(focused, "Menu");
      assert.deepEqual(errors, []);
    });

    test("the 404: status 404, the trail draws (DrawSVG) and rests", async (t) => {
      if (!(await ready(t))) return;
      const { context, page, errors, csp } = await open(browser);
      const response = await page.goto(`${base}${notFoundPath}`, { waitUntil: "load" });
      const trail = await waitForRest(page, "trail-404", 10_000);
      const violations = await csp();
      await context.close();
      result[name].notFound = { status: response.status(), trail, errors, csp: violations };
      assert.equal(response.status(), 404);
      assert.equal(trail, "done");
      assert.deepEqual(errors, []);
      assert.deepEqual(violations, []);
    });
  });
}
