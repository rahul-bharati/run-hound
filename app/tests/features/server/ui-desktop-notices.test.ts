/**
 * The desktop app's in-app notices (desktop/src/notices.ts, client/desktop-notices.ts), in real Chromium against
 * createApp served on a random port. The desktop preload gives the page `window.runHoundDesktop`; these tests stand in
 * for it with an init script, so they run in a plain browser. Without the bridge the UI is the browser UI, unchanged.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/app.js";

const IMPORTED = { type: "info", message: "Imported your settings from /home/me/.config/run-hound." };
const FAILED = {
  type: "warning",
  message: "Run Hound could not import your settings from /home/me/.config/run-hound. They are unchanged there.",
  detail: "EACCES: permission denied",
};

let runsDir: string;
let server: ServerType;
let base: string;
let browser: Browser;

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-notices-"));
  const app = createApp({ checks: [], runsDir, canShowBrowser: false });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

type Window = { __takes?: number };

/**
 * A page with a stand-in bridge whose notices.take answers `answer` once (and [] after, like the main process), or throws
 * when `answer` is "throw"; with "no-notices" the bridge has only the older members; with undefined there is no bridge.
 */
async function openPage(answer?: unknown, hash = "#/new"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (answer !== undefined) {
    await page.addInitScript((reply) => {
      const w = window as unknown as Window & { runHoundDesktop: Record<string, unknown> };
      w.__takes = 0;
      w.runHoundDesktop = { version: { check: async () => ({ latest: null, current: "0.6.5", newer: false, url: null }) } };
      if (reply === "no-notices") return;
      w.runHoundDesktop.notices = {
        take: async () => {
          w.__takes = (w.__takes ?? 0) + 1;
          if (reply === "throw") throw new Error("ipc failed");
          return w.__takes === 1 ? reply : [];
        },
      };
    }, answer);
  }
  await page.goto(`${base}/${hash}`);
  await page.locator("main#view h1").waitFor();
  if (answer !== undefined && answer !== "no-notices") {
    await page.waitForFunction(() => ((window as unknown as Window).__takes ?? 0) > 0);
    // The reply is handled in a later task than the call.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  return page;
}

describe("the desktop notices", () => {
  it("show nothing in a browser, where there is no desktop bridge", async () => {
    const page = await openPage();
    expect(await page.locator("#desktop-notices").count()).toBe(0);
    expect(await page.locator(".desktop-notice").count()).toBe(0);
    await page.close();
  });

  it("show nothing, and the app keeps working, from a bridge without a notices method", async () => {
    const page = await openPage("no-notices");
    expect(await page.locator("#desktop-notices").count()).toBe(0);
    expect(await page.locator("main#view h1").count()).toBe(1);
    await page.close();
  });

  it("show an info notice at the top of the main view, neutral, with its label, text and a Dismiss button", async () => {
    const page = await openPage([IMPORTED]);
    const box = page.locator("main#view > #desktop-notices");
    expect(await box.count()).toBe(1);
    expect(await page.evaluate(() => document.querySelector("main#view")?.firstElementChild?.id)).toBe("desktop-notices");
    const note = box.locator(".desktop-notice");
    expect(await note.count()).toBe(1);
    expect(await note.getAttribute("data-type")).toBe("info");
    expect(await note.getAttribute("class")).toBe("desktop-notice");
    expect((await note.locator(".desktop-notice-label").innerText()).trim().toLowerCase()).toBe("notice");
    expect((await note.locator("p").innerText()).trim()).toBe(IMPORTED.message);
    expect(await note.locator(".desktop-notice-detail").count()).toBe(0);
    expect(await note.getByRole("button", { name: "Dismiss this notice" }).innerText()).toBe("Dismiss");
    // Neutral: a plain line-strong edge, not the warning amber, and above the page's heading.
    const edge = await note.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(edge).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--line-strong").trim()).then(hexToRgb));
    const [noteBox, headingBox] = await Promise.all([note.boundingBox(), page.locator("main#view h1").boundingBox()]);
    expect(noteBox && headingBox && noteBox.y + noteBox.height <= headingBox.y).toBe(true);
    await page.close();
  });

  it("show a warning notice with the --warn edge, its label, the message and the detail", async () => {
    const page = await openPage([FAILED]);
    const note = page.locator("#desktop-notices .desktop-notice");
    expect(await note.getAttribute("data-type")).toBe("warning");
    expect(await note.getAttribute("class")).toContain("is-warning");
    expect((await note.locator(".desktop-notice-label").innerText()).trim().toLowerCase()).toBe("warning");
    expect((await note.locator("p").first().innerText()).trim()).toBe(FAILED.message);
    expect((await note.locator(".desktop-notice-detail").innerText()).trim()).toBe(FAILED.detail);
    const warn = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--warn").trim());
    expect(await note.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(hexToRgb(warn));
    expect(await note.locator(".desktop-notice-label").evaluate((el) => getComputedStyle(el).color)).toBe(hexToRgb(warn));
    await page.close();
  });

  it("show several notices in the order they were taken", async () => {
    const page = await openPage([IMPORTED, FAILED]);
    expect(await page.locator("#desktop-notices .desktop-notice").evaluateAll((els) => els.map((el) => el.getAttribute("data-type")))).toEqual(["info", "warning"]);
    await page.close();
  });

  it("are text only: markup in a message or detail is shown as typed, never parsed", async () => {
    const page = await openPage([{ type: "warning", message: "<img src=x onerror=window.__pwned=1> & <b>bold</b>", detail: "<script>window.__pwned=1</script>" }]);
    const note = page.locator("#desktop-notices .desktop-notice");
    expect((await note.locator("p").first().innerText()).trim()).toBe("<img src=x onerror=window.__pwned=1> & <b>bold</b>");
    expect((await note.locator(".desktop-notice-detail").innerText()).trim()).toBe("<script>window.__pwned=1</script>");
    expect(await note.locator("img, b, script").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await page.close();
  });

  it("are asked for once per page load, and stay at the top of the view across routes until dismissed", async () => {
    const page = await openPage([IMPORTED]);
    for (const hash of ["#/runs", "#/settings", "#/new"]) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.locator("main#view h1").waitFor();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await page.locator("main#view > #desktop-notices").count(), hash).toBe(1);
      expect(await page.evaluate(() => document.querySelector("main#view")?.firstElementChild?.id), hash).toBe("desktop-notices");
    }
    expect(await page.evaluate(() => (window as unknown as Window).__takes)).toBe(1);
    await page.close();
  });

  it("are dismissed one at a time with their button: the banner goes with the last one, and focus returns to the view", async () => {
    const page = await openPage([IMPORTED, FAILED]);
    const buttons = page.getByRole("button", { name: "Dismiss this notice" });
    await buttons.first().focus();
    await buttons.first().press("Enter");
    expect(await page.locator(".desktop-notice").evaluateAll((els) => els.map((el) => el.getAttribute("data-type")))).toEqual(["warning"]);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("view");
    await buttons.first().click();
    expect(await page.locator("#desktop-notices").count()).toBe(0);
    // Gone for good in this page load, even after moving between views.
    await page.evaluate(() => { location.hash = "#/runs"; });
    await page.locator("main#view h1").waitFor();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.locator("#desktop-notices").count()).toBe(0);
    await page.close();
  });

  it("are announced once, as one message with every notice, through the live region", async () => {
    const page = await openPage([IMPORTED, FAILED]);
    expect((await page.locator("#announcer").innerText()).trim()).toBe(`${IMPORTED.message} Warning: ${FAILED.message} ${FAILED.detail}`);
    await page.close();
  });

  it("are the desktop window's: they sit below the title bar strip", async () => {
    const page = await openPage([IMPORTED]);
    await page.evaluate(() => {
      document.documentElement.dataset.shell = "desktop";
      const strip = document.createElement("div");
      strip.className = "desktop-titlebar";
      document.body.prepend(strip);
    });
    const top = await page.locator(".desktop-notice").evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(36);
    await page.close();
  });

  const SHOW_NOTHING: Array<[string, unknown]> = [
    ["there are none", []],
    ["the reply is not a list", { type: "info", message: "x" }],
    ["the reply is null", null],
    ["a notice has an unknown type", [{ type: "error", message: "x" }]],
    ["a notice has no message", [{ type: "info" }]],
    ["a notice has an empty message", [{ type: "info", message: "" }]],
    ["a notice's message is not text", [{ type: "info", message: { html: "<b>x</b>" } }]],
    ["the bridge call fails", "throw"],
  ];
  it.each(SHOW_NOTHING)("show nothing, and the app keeps working, when %s", async (_name, answer) => {
    const page = await openPage(answer);
    expect(await page.locator("#desktop-notices").count()).toBe(0);
    expect(await page.locator(".side-foot").count()).toBe(1);
    expect(await page.locator("main#view h1").count()).toBe(1);
    await page.close();
  });
});

/** "#2A3841" to the "rgb(42, 56, 65)" a computed colour reads as. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
