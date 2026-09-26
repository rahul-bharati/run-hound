/**
 * Renders the social preview image (1200 x 630) that every page shares: public/social-preview.png. The og:image and
 * twitter:image tags, with its size and alt text, come from socialImage in src/lib/metadata.ts.
 *
 * Not part of the build: the PNG is committed. Run it again after changing the card, from the repository root
 * (Playwright and its Chromium come with the Run Hound install; the fonts load from Google Fonts):
 *
 *   node site/scripts/og-image.mjs
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const site = join(import.meta.dirname, "..");
const { chromium } = createRequire(join(site, "..", "package.json"))("playwright");

const mark = (await readFile(join(site, "public/brand/hound-mark-light.png"))).toString("base64");

// The brand palette (docs/brand.md): bg #0A1014, fg #E9EFEC, muted #A7B4B0, dim #82918D, accent #5EE6A3.
const html = `<!doctype html>
<html>
<head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Geist:wght@400;500&family=Geist+Mono:wght@500&display=block">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #0A1014; color: #E9EFEC;
    font-family: "Geist", sans-serif; }
  .glow { position: absolute; inset: 0; background:
    radial-gradient(55% 75% at 88% 38%, rgba(94, 230, 163, 0.13), transparent 70%),
    radial-gradient(45% 60% at 0% 100%, rgba(94, 230, 163, 0.05), transparent 70%); }
  .mark { position: absolute; right: 40px; top: 150px; width: 510px; }
  .content { position: absolute; left: 80px; top: 76px; width: 690px; display: flex; flex-direction: column; gap: 30px; }
  .eyebrow { display: flex; align-items: center; gap: 14px; font-family: "Geist Mono", monospace; font-size: 20px;
    letter-spacing: 0.18em; color: #5EE6A3; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #5EE6A3; }
  h1 { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 78px; line-height: 0.98;
    letter-spacing: -0.03em; }
  h1 span { color: #5EE6A3; }
  p { font-size: 28px; line-height: 1.35; color: #A7B4B0; max-width: 540px; }
  .foot { position: absolute; left: 80px; right: 80px; bottom: 60px; display: flex; align-items: center;
    justify-content: space-between; border-top: 1px solid #1E2A31; padding-top: 26px; }
  .word { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 34px; letter-spacing: -0.02em; }
  .chips { display: flex; gap: 26px; font-family: "Geist Mono", monospace; font-size: 18px; letter-spacing: 0.12em;
    color: #82918D; }
</style>
</head>
<body>
  <div class="glow"></div>
  <img class="mark" src="data:image/png;base64,${mark}" alt="">
  <div class="content">
    <div class="eyebrow"><span class="dot"></span>OPEN SOURCE · MIT</div>
    <h1>Find the bugs your AI forgot <span>to test.</span></h1>
    <p>AI-assisted UI testing for AI-built apps, with real checks in a real browser.</p>
  </div>
  <div class="foot">
    <div class="word">Run Hound</div>
    <div class="chips"><span>RUNS LOCALLY</span><span>·</span><span>YOUR OWN MODEL</span><span>·</span><span>PLAYWRIGHT TESTS</span></div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = join(site, "public/social-preview.png");
  await page.screenshot({ path: out, type: "png" });
  console.log(`og-image: wrote ${out}`);
} finally {
  await browser.close();
}
