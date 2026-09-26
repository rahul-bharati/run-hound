/**
 * The /app/help contract (CONTRACT.md "/app/help Help & shortcuts"): a signed-in page in the app shell with the keyboard
 * shortcuts, a short FAQ and how to contact support. No form, no mailto link, and nothing loaded but the session. The
 * sidebar and the command palette link to it; V05 (accounts.test.ts) makes a direct load of it answer 404. The
 * route-wide checks (one h1 and main, no errors, axe in light and dark, 320 px) are in server.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, openPage, useFernway } from "./support.js";

afterAll(closeBrowser);

describe("/app/help (clean mode)", () => {
  const ref = useFernway("none");

  it("renders Help & shortcuts in the app shell, with the sidebar's Help link as the current page", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/help", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Help & shortcuts" }).waitFor();
      expect(await page.title()).toBe("Fernway: Help & shortcuts");
      const help = page.getByRole("navigation", { name: "App" }).first().getByRole("link", { name: "Help" });
      expect(await help.getAttribute("aria-current")).toBe("page");
      expect(await help.getAttribute("href")).toBe("/app/help");
      expect(await page.getByText("Signed in as Alex Rivera · Rivera Studio").count()).toBeGreaterThan(0);
      expect(events.badResponses).toEqual([]);
      expect(events.consoleErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("lists the keyboard shortcuts, and the search shortcut it names opens the command palette", async () => {
    const { page, close } = await openPage(ref.fw, "/app/help", { as: "alex" });
    try {
      const shortcuts = page.getByRole("region", { name: "Keyboard shortcuts" });
      await shortcuts.waitFor();
      const terms = (await shortcuts.locator("dt").allInnerTexts()).map((t) => t.trim());
      expect(terms.length).toBeGreaterThanOrEqual(5);
      expect(terms).toContain("Open search and commands");
      expect(terms).toContain("Close a dialog, menu or popover");
      const search = shortcuts.locator("dl > div").filter({ hasText: "Open search and commands" });
      expect(await search.locator("kbd").allInnerTexts()).toEqual(expect.arrayContaining(["Ctrl", "K"]));
      expect(await shortcuts.locator("kbd").count()).toBeGreaterThanOrEqual(terms.length);

      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Search Fernway" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Search Fernway" }).waitFor({ state: "hidden" });
    } finally {
      await close();
    }
  });

  it("answers common questions and says how to reach support, with no form and no mailto link", async () => {
    const { page, close } = await openPage(ref.fw, "/app/help", { as: "alex" });
    try {
      const faq = page.getByRole("region", { name: "Frequently asked questions" });
      await faq.waitFor();
      expect(await faq.getByRole("heading", { level: 3 }).count()).toBeGreaterThanOrEqual(3);

      const support = page.getByRole("region", { name: "Contact support" });
      const text = await support.innerText();
      expect(text).toContain("support@fernway.test");
      // Names the signed-in workspace, so a reader knows what to quote.
      expect(text).toContain("Rivera Studio");

      expect(await page.locator("form").count()).toBe(0);
      expect(await page.locator('a[href^="mailto:"]').count()).toBe(0);
      expect(await page.locator("main").getByRole("textbox").count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("asks the server only who is signed in (no workspace data)", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app/help", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Help & shortcuts" }).waitFor();
      const api = [...new Set(events.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.startsWith("/api/")))].sort();
      expect(api).toEqual(["/api/__config", "/api/me"]);
    } finally {
      await close();
    }
  });

  it("is one click from the dashboard: the sidebar's Help link and the command palette's Go to Help", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app", { as: "alex" });
    try {
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await page.getByRole("navigation", { name: "App" }).first().getByRole("link", { name: "Help" }).click();
      await page.waitForURL(`${ref.fw.url}/app/help`);
      await page.getByRole("heading", { level: 1, name: "Help & shortcuts" }).waitFor();

      await page.getByRole("navigation", { name: "App" }).first().getByRole("link", { name: "Dashboard" }).click();
      await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Search Fernway" }).fill("help");
      await page.getByRole("option", { name: "Help" }).click();
      await page.waitForURL(`${ref.fw.url}/app/help`);
      await page.getByRole("heading", { level: 1, name: "Help & shortcuts" }).waitFor();
      expect(events.badResponses).toEqual([]);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });
});
