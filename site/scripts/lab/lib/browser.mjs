/**
 * Chromium (Playwright 1.63, the site's devDependency) with the lab's profiles (§5.1 rule 6 of the design):
 * - desktop: 1440×900;
 * - phone: 390×844 at DPR 3 with touch;
 * - throttled: 4× CPU, 1.6 Mbps down, 750 kbps up, 150 ms RTT, cache off (Chrome DevTools Protocol);
 * - reduced motion, and Save-Data (navigator.connection.saveData, as the motion gate reads it).
 *
 * Every spec opens pages through newPage(), so the profiles mean the same thing in every measurement.
 */
import { chromium } from "playwright";

export const profiles = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

export const throttling = { cpuRate: 4, latencyMs: 150, downloadBps: (1.6 * 1024 * 1024) / 8, uploadBps: (750 * 1024) / 8 };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The lab's server: LAB_ORIGIN (run.mjs sets it). */
export function origin() {
  const value = process.env.LAB_ORIGIN;
  if (!value) throw new Error("LAB_ORIGIN is not set: run specs through scripts/lab/run.mjs (pnpm lab)");
  return value.replace(/\/$/, "");
}

export function launch() {
  return chromium.launch();
}

/**
 * A new context and page. `profile` is "desktop" or "phone" (or pass `viewport` for another size); `reducedMotion`
 * "reduce" or "no-preference"; `saveData` fakes navigator.connection.saveData; `throttle` applies the throttled
 * profile; `csp` records securitypolicyviolation events into window.__cspViolations.
 */
export async function newPage(
  browser,
  { profile = "desktop", viewport, reducedMotion = "no-preference", saveData = false, throttle = false, csp = true } = {},
) {
  const options = { ...profiles[profile] };
  if (viewport) Object.assign(options, { viewport });
  const context = await browser.newContext({ ...options, reducedMotion });
  const page = await context.newPage();
  if (saveData) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: { saveData: true, effectiveType: "4g", addEventListener() {}, removeEventListener() {} },
      });
    });
  }
  if (csp) {
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI, sample: event.sample });
      });
    });
  }
  let cdp;
  if (throttle) {
    cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: throttling.latencyMs,
      downloadThroughput: throttling.downloadBps,
      uploadThroughput: throttling.uploadBps,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttling.cpuRate });
  }
  return { context, page, cdp };
}

/** The CSP violations the page reported so far. */
export const cspViolations = (page) => page.evaluate(() => window.__cspViolations ?? []);

/** Scrolls to the end in steps (real scroll events), then optionally back to the top. */
export async function slowScroll(page, { step = 200, pause = 60, back = false } = {}) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= height + step; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await sleep(pause);
  }
  if (back) await page.evaluate(() => window.scrollTo(0, 0));
}

/** The median of a list of numbers (the mean of the middle two for an even count). */
export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
