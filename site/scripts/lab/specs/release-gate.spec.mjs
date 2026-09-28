/**
 * The release gate (DESIGN.md §5.2 and §5.4 E1): the gates of §5.2 that hold on every route, measured on every page of
 * the registry, /_design/ and the 404, where the other specs measure a sample or one template:
 * - axe-core 4.13: 0 violations at 1280×720 and 390×844, motion on (after every reveal has played: a slow scroll down
 *   and back, then rest) and reduced;
 * - reflow: 0 px of horizontal overflow at 320 px (320×720, and 320×800 as Run Hound's reflow-320 opens it), motion
 *   on and reduced;
 * - CSP: 0 securitypolicyviolation events through load, the motion and a slow scroll, at both sizes;
 * - first-viewport prefetches: at most 10 route prefetches and 120 KB, desktop, at rest after load;
 * - every check page shows a real finding (no "No finding from the test apps is shown here yet"), for all 26 checks;
 * - LCP ≤ 1,200 ms and CLS ≤ 0.01, throttled, the median of 3, on one page of every template other than / (the home
 *   page's own gates are home.spec.mjs's and motion-contract.spec.mjs's), desktop and phone;
 * - Run Hound's own focus-visible and reflow-320 checks pass on the built site, one page per template (needs the app's
 *   dependencies at ../app; skipped, saying so, without them).
 * Results go to <lab out>/release-gate.json. Run: pnpm lab release-gate.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { siteDir } from "../../lib/build-output.mjs";
import { runAxe } from "../lib/audits.mjs";
import { cspViolations, launch, median, newPage, origin, sleep, slowScroll } from "../lib/browser.mjs";
import { reflow } from "../lib/keyboard.mjs";
import { labOut, writeJson } from "../lib/out.mjs";
import { prefetches, recordRequests } from "../lib/requests.mjs";
import { labRoutes } from "../lib/routes.mjs";
import { installVitals, readVitals } from "../lib/vitals.mjs";

const base = origin();
const { indexable, internal, notFound } = await labRoutes();
const paths = [...indexable.map((r) => r.path), ...internal.map((r) => r.path), notFound];
const checkPaths = indexable.map((r) => r.path).filter((p) => /^\/checks\/[^/]+\/$/.test(p));
const result = { routes: {}, templates: {}, runHound: {} };
let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  writeJson("release-gate.json", result);
});

/** Runs the tasks with at most `limit` at a time; resolves to their results in order. */
async function pool(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i]);
      }
    }),
  );
  return out;
}

const sizes = [
  ["1280×720", { width: 1280, height: 720 }, "desktop"],
  ["390×844", { width: 390, height: 844 }, "phone"],
];

/** Everything measured on one route (motion on and reduced, both sizes, 320 px, the first viewport's prefetches). */
async function sweep(path) {
  const r = { axe: {}, csp: {}, overflow: {}, prefetch: null, status: null };
  {
    const { context, page } = await newPage(browser, { profile: "desktop" });
    const log = recordRequests(page);
    const response = await page.goto(`${base}${path}`, { waitUntil: "load" });
    r.status = response?.status() ?? null;
    await sleep(3000);
    r.prefetch = prefetches(log.requests);
    await context.close();
  }
  for (const [name, viewport, profile] of sizes) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const { context, page } = await newPage(browser, { profile, viewport, reducedMotion });
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      if (reducedMotion === "no-preference") {
        // The motion gate loads after load plus idle; the reveals play as they come into view; then everything rests.
        await sleep(2500);
        await slowScroll(page, { step: 300, pause: 80, back: true });
        await sleep(2500);
      }
      const axe = await runAxe(page);
      r.axe[`${name} ${reducedMotion}`] = axe.violations;
      r.csp[`${name} ${reducedMotion}`] = await cspViolations(page);
      await context.close();
    }
  }
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 320, height: 800 },
  ]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const { context, page } = await newPage(browser, { viewport, reducedMotion });
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await sleep(reducedMotion === "reduce" ? 300 : 2500);
      r.overflow[`${viewport.width}×${viewport.height} ${reducedMotion}`] = (await reflow(page)).overflowX;
      await context.close();
    }
  }
  return r;
}

let sweeps;
const allSweeps = () => (sweeps ??= pool(paths, 4, sweep).then((list) => Object.fromEntries(paths.map((p, i) => [p, list[i]]))));

describe(`every route (${paths.length}: the registry's pages, /_design/ and the 404)`, () => {
  test("they answer: 200, and 404 for the 404", async () => {
    const all = await allSweeps();
    Object.assign(result.routes, all);
    for (const path of paths) assert.equal(all[path].status, path === notFound ? 404 : 200, path);
  });

  test("axe-core finds nothing at 1280×720 and 390×844, motion on (after every reveal) and reduced", async () => {
    const all = await allSweeps();
    const found = paths.flatMap((p) => Object.entries(all[p].axe).flatMap(([at, v]) => v.map((x) => `${p} ${at}: ${x.id} (${x.targets.join(", ")})`)));
    assert.deepEqual(found, []);
  });

  test("0 px of horizontal overflow at 320 px, motion on and reduced", async () => {
    const all = await allSweeps();
    const found = paths.flatMap((p) => Object.entries(all[p].overflow).filter(([, px]) => px > 0).map(([at, px]) => `${p} ${at}: ${px} px`));
    assert.deepEqual(found, []);
  });

  test("0 CSP violations through load, the motion and a slow scroll", async () => {
    const all = await allSweeps();
    const found = paths.flatMap((p) => Object.entries(all[p].csp).flatMap(([at, v]) => v.map((x) => `${p} ${at}: ${JSON.stringify(x)}`)));
    assert.deepEqual(found, []);
  });

  test("the first viewport's route prefetches: at most 10 and 120 KB, desktop", async () => {
    const all = await allSweeps();
    const over = paths.filter((p) => all[p].prefetch.count > 10 || all[p].prefetch.bytes > 120_000);
    assert.deepEqual(
      over.map((p) => `${p}: ${all[p].prefetch.count} prefetches, ${all[p].prefetch.bytes} B`),
      [],
    );
  });
});

describe("the check pages", () => {
  test("26 pages, each with a real finding (none says no finding from the test apps is shown yet)", async () => {
    assert.equal(checkPaths.length, 26);
    const without = [];
    for (const path of checkPaths) {
      const html = await (await fetch(`${base}${path}`)).text();
      if (html.includes("No finding from the test apps is shown here yet")) without.push(path);
    }
    assert.deepEqual(without, []);
  });
});

describe("LCP and CLS on every template but the home page, throttled (the median of 3)", () => {
  const templates = [
    "/docs/",
    "/docs/quick-start/",
    "/checks/",
    "/checks/double-submit/",
    "/how-it-works/",
    "/demo/",
    "/ai-built-apps/",
    "/open-source/",
    "/faq/",
    "/compare/",
    "/privacy/",
    notFound,
  ];
  for (const profile of ["desktop", "phone"]) {
    test(`${profile}: LCP ≤ 1,200 ms and CLS ≤ 0.01 through load and a scroll`, async () => {
      const failures = [];
      for (const path of templates) {
        const runs = [];
        for (let i = 0; i < 3; i += 1) {
          const { context, page } = await newPage(browser, { profile, throttle: true });
          await installVitals(page);
          await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 60_000 });
          await sleep(1500);
          const atLoad = await readVitals(page);
          await slowScroll(page, { step: 500, pause: 100, back: true });
          await sleep(1000);
          const end = await readVitals(page);
          runs.push({ lcp: atLoad.lcp?.t ?? null, element: atLoad.lcp?.el ?? null, cls: end.cls });
          await context.close();
        }
        const lcp = median(runs.map((r) => r.lcp ?? Infinity));
        const cls = median(runs.map((r) => r.cls));
        result.templates[`${profile} ${path}`] = { lcp, cls, runs };
        if (!(lcp <= 1200)) failures.push(`${path}: LCP ${lcp} ms (${runs.map((r) => r.element).join(" | ")})`);
        if (!(cls <= 0.01)) failures.push(`${path}: CLS ${cls}`);
      }
      assert.deepEqual(failures, []);
    });
  }
});

describe("Run Hound's own focus-visible and reflow-320 checks on the built site", () => {
  const appDir = resolve(siteDir, "../app");
  // The workspace hoists its dependencies (node-linker=hoisted), so tsx is in the root's node_modules/.bin.
  const tsx = [join(appDir, "node_modules", ".bin", "tsx"), resolve(siteDir, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const ready = Boolean(tsx);
  const pages = ["/", "/docs/quick-start/", "/docs/", "/checks/", "/checks/double-submit/", "/open-source/", "/faq/", "/demo/"];
  for (const path of pages) {
    test(`${path}: both pass`, { skip: ready ? false : "the app's dependencies are not installed (pnpm install at the root)" }, () => {
      const run = spawnSync(
        tsx,
        [
          "src/cli.ts",
          "run",
          `${base}${path}`,
          "--approve",
          "focus-visible:tab-through,reflow-320:narrow-viewport",
          "--json",
          "--runs-dir",
          labOut("run-hound"),
        ],
        { cwd: appDir, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
      );
      let report;
      try {
        report = JSON.parse(run.stdout);
      } catch {
        assert.fail(`no JSON report (exit ${run.status}): ${run.stderr.slice(-2000)}`);
      }
      const results = Object.fromEntries(report.results.map((r) => [r.scenarioId, r.status]));
      result.runHound[path] = { exit: run.status, results, findings: report.findings.map((f) => ({ check: f.checkId, title: f.title, facts: f.evidence?.flatMap((e) => e.facts ?? []) })) };
      assert.deepEqual(results, { "focus-visible:tab-through": "pass", "reflow-320:narrow-viewport": "pass" }, JSON.stringify(result.runHound[path].findings));
      assert.equal(run.status, 0);
    });
  }
});
