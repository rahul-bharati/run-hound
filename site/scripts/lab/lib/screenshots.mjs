/**
 * Screenshots and pixel comparison. The baseline spec saves every page at 1440 and 390 under reduced motion, and
 * compareImages() tells how many pixels of a later screenshot differ from it (G2's gate: at most 0.1% of pixels, at
 * threshold 0). The comparison
 * decodes both PNGs in the browser's canvas, so the lab needs no image library.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Loads every lazy image (a scroll to the end and back), waits for the rendered images (an image in a hidden tab panel
 * never loads, so it isn't waited for) and the fonts, at most `maxWaitMs`, then lets play-once GIFs reach their last
 * frame: what a screenshot of the page at rest needs.
 */
export async function settle(page, { gifMs = 3000, maxWaitMs = 10_000 } = {}) {
  await page.evaluate(async (limit) => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(200, innerHeight / 2)) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
    const rendered = [...document.images].filter((image) => !image.complete && image.getClientRects().length > 0);
    const loaded = Promise.all(
      rendered.map((image) => new Promise((resolve) => (image.addEventListener("load", resolve, { once: true }), image.addEventListener("error", resolve, { once: true })))),
    );
    await Promise.race([Promise.all([loaded, document.fonts.ready]), new Promise((resolve) => setTimeout(resolve, limit))]);
  }, maxWaitMs);
  if (gifMs) await page.waitForTimeout(gifMs);
}

/**
 * A full-page screenshot at CSS scale, with CSS animations finished, written to `path`. Animated GIFs are masked (a
 * GIF's frame depends on when it loaded), so two screenshots of an unchanged page compare equal.
 */
export async function fullPage(page, path) {
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({
    path,
    fullPage: true,
    scale: "css",
    animations: "disabled",
    caret: "hide",
    mask: [page.locator('img[src*=".gif"], img[srcset*=".gif"]')],
  });
  return path;
}

/** The file name a route's screenshot gets: "/" is "home", "/docs/quick-start/" "docs-quick-start". */
export const shotName = (route, viewport) => `${route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replaceAll("/", "-") || "home"}-${viewport}.png`;

/**
 * Compares two PNG files pixel by pixel in the page's canvas: the pixels whose channels differ by more than `threshold`
 * (0-255; default 0, any difference, which is what G2's 0.1% gate uses: the lab renders a page the same way every
 * time, so a tolerance would only hide a token that moved a few units), their share, the largest channel difference
 * found, and whether the sizes match. Needs any open page (it is only used as a canvas).
 */
export function compareImages(page, aPath, bPath, { threshold = 0 } = {}) {
  return page.evaluate(
    async ({ a, b, limit }) => {
      const load = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      const width = Math.min(x.width, y.width);
      const height = Math.min(x.height, y.height);
      let differ = 0;
      let maxChannelDiff = 0;
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          const i = (row * x.width + col) * 4;
          const j = (row * y.width + col) * 4;
          const diff = Math.max(
            Math.abs(x.pixels[i] - y.pixels[j]),
            Math.abs(x.pixels[i + 1] - y.pixels[j + 1]),
            Math.abs(x.pixels[i + 2] - y.pixels[j + 2]),
            Math.abs(x.pixels[i + 3] - y.pixels[j + 3]),
          );
          if (diff > maxChannelDiff) maxChannelDiff = diff;
          if (diff > limit) differ += 1;
        }
      }
      // Rows or columns only one image has count as different.
      const total = Math.max(x.width, y.width) * Math.max(x.height, y.height);
      differ += total - width * height;
      return {
        sameSize: x.width === y.width && x.height === y.height,
        sizes: [[x.width, x.height], [y.width, y.height]],
        differentPixels: differ,
        ratio: differ / total,
        maxChannelDiff,
      };
    },
    { a: readFileSync(aPath).toString("base64"), b: readFileSync(bPath).toString("base64"), limit: threshold },
  );
}
