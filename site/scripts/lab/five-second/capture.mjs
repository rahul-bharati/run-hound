/**
 * The screenshot pack for the people tests (DESIGN.md §5.4 E1, §5.9): a five-second test of the new first screen at
 * both sizes, and five people watching the hero run once. For each of desktop (1440×900) and phone (390×844):
 * - first-screen.png: the first viewport as a reader first sees it, reduced motion (the finished frame the server
 *   renders; what a five-second test shows);
 * - full-page.png: the whole homepage, reduced motion, for the tree test's context;
 * - hero-run/: the hero run as it plays once with motion on, a JPEG every 250 ms for 7 s, with frames.json (the time
 *   of each frame), throttled as the lab's time-to-bug gate is; on the phone the run window is scrolled into view at
 *   1 s.
 * Written to <lab out>/five-second/<profile>/ (site/.lab-out/<build>/, git-ignored).
 *
 *   pnpm build && node scripts/lab/serve.mjs --port 4870 &     (or any running lab server)
 *   LAB_ORIGIN=http://127.0.0.1:4870 node scripts/lab/five-second/capture.mjs
 *
 * Or through the lab runner, which starts and stops the server: pnpm lab scripts/lab/five-second/capture.mjs
 */
import { mkdirSync } from "node:fs";
import { launch, newPage, origin, sleep } from "../lib/browser.mjs";
import { labOut, writeJson } from "../lib/out.mjs";
import { filmstrip } from "../lib/timeline.mjs";

const base = origin();
const browser = await launch();
const pack = {};
try {
  for (const profile of ["desktop", "phone"]) {
    const dir = labOut("five-second", profile);
    mkdirSync(dir, { recursive: true });
    {
      const { context, page } = await newPage(browser, { profile, reducedMotion: "reduce" });
      await page.goto(`${base}/`, { waitUntil: "load" });
      await sleep(500);
      await page.screenshot({ path: `${dir}/first-screen.png` });
      await page.screenshot({ path: `${dir}/full-page.png`, fullPage: true });
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { profile, throttle: true });
      await page.goto(`${base}/`, { waitUntil: "commit" });
      // On a phone the run window starts below the first screen and plays once half of it is in view: scroll to it at
      // 1 s, as a reader would.
      const toRun = () => page.evaluate(() => document.querySelector('[data-motion="hero-run"]')?.scrollIntoView({ block: "center" }));
      const frames = await filmstrip(page, `${dir}/hero-run`, { frames: 29, stepMs: 250, between: (i) => (profile === "phone" && i === 4 ? toRun() : undefined) });
      const state = await page.evaluate(() => document.querySelector('[data-motion="hero-run"]')?.getAttribute("data-motion-state") ?? null);
      await context.close();
      pack[profile] = { dir, frames: frames.length, heroState: state };
    }
  }
} finally {
  await browser.close();
}
writeJson("five-second/pack.json", pack);
console.log(`five-second: ${JSON.stringify(pack)}`);
