/**
 * The desktop app's update notice (desktop/src/update-check.ts, client/desktop-update.ts), in real Chromium against
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

const RELEASE = "https://github.com/rahul-bharati/run-hound/releases/tag/v0.7.0";
const NEWER = { latest: "0.7.0", current: "0.6.5", newer: true, url: RELEASE };

let runsDir: string;
let server: ServerType;
let base: string;
let browser: Browser;

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-ui-update-"));
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

type Window = { __checks?: number };

/** A page with a stand-in bridge whose version check answers `answer` (or throws when `answer` is "throw"), or with no bridge. */
async function openPage(answer?: object | "throw"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (answer !== undefined) {
    await page.addInitScript((reply) => {
      const w = window as unknown as Window & { runHoundDesktop: unknown };
      w.__checks = 0;
      w.runHoundDesktop = {
        version: {
          check: async () => {
            w.__checks = (w.__checks ?? 0) + 1;
            if (reply === "throw") throw new Error("ipc failed");
            return reply;
          },
        },
      };
    }, answer);
  }
  await page.goto(`${base}/#/new`);
  await page.locator("main#view h1").waitFor();
  if (answer !== undefined) {
    await page.waitForFunction(() => ((window as unknown as Window).__checks ?? 0) > 0);
    // The reply is handled in a later task than the call.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  return page;
}

describe("the desktop update notice", () => {
  it("shows nothing in a browser, where there is no desktop bridge", async () => {
    const page = await openPage();
    expect(await page.locator("#desktop-update").count()).toBe(0);
    expect(await page.locator(".update-note").count()).toBe(0);
    await page.close();
  });

  it("offers the download when a newer release exists: the message, a link to the release page, and the sidebar footer below it", async () => {
    const page = await openPage(NEWER);
    const note = page.locator("#sidebar #desktop-update");
    expect(await note.count()).toBe(1);
    expect((await note.locator("p").innerText()).trim()).toBe("Run Hound 0.7.0 is available.");
    const link = note.getByRole("link", { name: "Download" });
    expect(await link.getAttribute("href")).toBe(RELEASE);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    // Above the footer, inside the sidebar, and visible at the desktop window's width.
    const [noteBox, footBox] = await Promise.all([note.boundingBox(), page.locator(".side-foot").boundingBox()]);
    expect(noteBox && footBox && noteBox.y + noteBox.height <= footBox.y).toBe(true);
    // The notice lives in the sidebar, so the main view's content is untouched.
    expect(await page.locator("main#view #desktop-update").count()).toBe(0);
    await page.close();
  });

  it("asks the bridge once per page load, however many views the user opens", async () => {
    const page = await openPage(NEWER);
    await page.evaluate(() => { location.hash = "#/runs"; });
    await page.locator("main#view h1").waitFor();
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.locator("main#view h1").waitFor();
    expect(await page.evaluate(() => (window as unknown as Window).__checks)).toBe(1);
    expect(await page.locator("#desktop-update").count()).toBe(1);
    await page.close();
  });

  it("is dismissed with its button, stays dismissed for the session, and returns focus to the view", async () => {
    const page = await openPage(NEWER);
    const dismiss = page.getByRole("button", { name: "Dismiss the update notice" });
    await dismiss.focus();
    await dismiss.press("Enter");
    expect(await page.locator("#desktop-update").count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("view");
    // Still gone after a reload of the same window (sessionStorage), and across views.
    await page.reload();
    await page.locator("main#view h1").waitFor();
    await page.waitForFunction(() => ((window as unknown as Window).__checks ?? 0) > 0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.locator("#desktop-update").count()).toBe(0);
    await page.close();
  });

  it("is announced once to screen readers", async () => {
    const page = await openPage(NEWER);
    expect((await page.locator("#announcer").innerText()).trim()).toBe("Run Hound 0.7.0 is available.");
    await page.close();
  });

  const SHOWS_NOTHING: Array<[string, object | "throw"]> = [
    ["the release is the same version", { latest: "0.6.5", current: "0.6.5", newer: false, url: RELEASE }],
    ["the check failed (offline)", { latest: null, current: "0.6.5", newer: false, url: null, error: "offline" }],
    ["the check is turned off", { latest: null, current: "0.6.5", newer: false, url: null, error: "disabled" }],
    ["an older reply from a main process that has no release feed", { latest: null, current: "0.6.5" }],
    ["the reply says newer but has no link", { latest: "0.7.0", current: "0.6.5", newer: true, url: null }],
    ["the link is not on GitHub", { ...NEWER, url: "https://example.com/download" }],
    ["the link is not https", { ...NEWER, url: "http://github.com/rahul-bharati/run-hound/releases/tag/v0.7.0" }],
    ["the link is a script", { ...NEWER, url: "javascript:alert(1)" }],
    ["the version is not a version", { ...NEWER, latest: "<b>soon</b>" }],
    ["the reply is empty", {}],
    ["the bridge call fails", "throw"],
  ];
  it.each(SHOWS_NOTHING)("shows nothing, and the app keeps working, when %s", async (_name, answer) => {
    const page = await openPage(answer);
    expect(await page.locator("#desktop-update").count()).toBe(0);
    // The sidebar and the view are the browser UI's: the footer is there and the page rendered.
    expect(await page.locator(".side-foot").count()).toBe(1);
    expect(await page.locator("main#view h1").count()).toBe(1);
    await page.close();
  });

  it("is hidden in the narrow layout, which the desktop window (at least 960 px wide) never uses", async () => {
    const page = await openPage(NEWER);
    await page.setViewportSize({ width: 600, height: 800 });
    expect(await page.locator("#desktop-update").isVisible()).toBe(false);
    await page.close();
  });
});
