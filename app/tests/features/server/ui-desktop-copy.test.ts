/**
 * The web UI's wording inside the desktop app (D9), driven in real Chromium. The desktop's preload marks
 * <html data-shell="desktop"> before any script runs (desktop/src/chrome.ts); an init script does the same here. Every
 * /api/* call is answered by a stub. Pinned:
 * - Desktop: no RUNHOUND_* variable anywhere a user reads (the URL hint, Settings, a refused target), since a desktop
 *   user has no environment to set; Settings speaks of "this computer", not a server or a browser, and has no
 *   server host names row.
 * - Browser (Docker, CLI): the same pages keep the server wording and the variables, unchanged.
 */
import { chromium, type Browser, type Page, type Route, type Request } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountStatus, AccountsStatus } from "../../../src/interfaces/accounts.js";
import { renderUi } from "../../../src/server/ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.6.1", canShowBrowser: true });
const REFUSED =
  "Refusing to test http://example.com/: example.com resolves to a public address (93.184.216.34); Run Hound only tests localhost, private addresses or hosts listed in RUNHOUND_ALLOWED_HOSTS";

const unsetSlot = (id: "a" | "b"): AccountStatus => ({ id, label: id === "a" ? "Account A" : "Account B", loginUrl: "", username: "", hasPassword: false, ready: false } as AccountStatus);
const NO_ACCOUNTS = { isolated: true, isolatedSource: "default", accounts: { a: unsetSlot("a"), b: unsetSlot("b") }, file: "/home/me/.config/run-hound/accounts.json" } as AccountsStatus;
const AI_OFF = { enabled: false, provider: null, baseUrl: null, model: "", region: null, allowRemote: false, features: { review: true, suggest: true, explain: true }, timeoutMs: 120_000, hasKey: false, remote: false, host: null, problem: "AI is off", sources: {}, file: "/home/me/.config/run-hound/ai.json" };

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(hash: string, desktop: boolean): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // The refused plan answers 400 on purpose.
    if (m.type() === "error" && !/status of 400/.test(m.text())) errors.push(m.text());
  });
  if (desktop) {
    // As desktop/src/chrome.ts does: the script runs before there is an <html>, so it waits for the element itself.
    await page.addInitScript(() => {
      const mark = () => {
        if (!document.documentElement) return false;
        document.documentElement.dataset.shell = "desktop";
        return true;
      };
      if (!mark()) new MutationObserver((_r, observer) => { if (mark()) observer.disconnect(); }).observe(document, { childList: true });
    });
  }
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    if (url.pathname === "/api/settings") return json({ version: "0.6.1", runsDir: "/home/me/run-hound/runs", allowedHosts: [], serverHosts: [], ai: AI_OFF });
    if (url.pathname === "/api/accounts") return json(NO_ACCOUNTS);
    if (url.pathname === "/api/ai") return json(AI_OFF);
    if (url.pathname === "/api/ai/models") return json({ models: [], error: null });
    if (url.pathname === "/api/plan") return json({ error: REFUSED }, 400);
    if (url.pathname === "/api/runs") return json({ runs: [] });
    return json({ error: "not stubbed" }, 404);
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, errors };
}

/** What a person can read on the page: rendered text only (display:none excluded). */
const visibleText = (page: Page) => page.locator("body").innerText();

describe("in the desktop app", () => {
  it("New run: the URL hint names no environment variable", async () => {
    const { page, errors } = await open("#/new", true);
    await expect.poll(() => page.locator("#target-hint").innerText()).toBe("Use localhost or a private network address.");
    expect(await visibleText(page)).not.toContain("RUNHOUND_");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("New run: a refused target says what the desktop tests, without RUNHOUND_ALLOWED_HOSTS", async () => {
    const { page, errors } = await open("#/new", true);
    await page.fill("#target-url", "http://example.com/");
    await page.click("#plan-button");
    await expect.poll(() => page.locator("#target-error").innerText()).toContain("Run Hound only tests localhost and private network addresses");
    expect(await page.locator("#target-error").innerText()).not.toContain("RUNHOUND_");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("Settings: this computer, not a server or a browser, and no variables to set", async () => {
    const { page, errors } = await open("#/settings", true);
    await page.locator("#about-h").waitFor();
    // Where the keys and passwords are kept is said in "this computer" terms too.
    await expect.poll(() => page.locator("#keys-card").innerText()).toContain("this computer");
    await expect.poll(() => visibleText(page)).toContain("None. Run Hound tests this computer");
    const text = await visibleText(page);
    expect(text).toContain("how Run Hound is set up on this computer.");
    expect(text).toContain("Saved on this computer.");
    expect(text).toContain("None. Run Hound tests this computer (localhost) and private network addresses.");
    for (const gone of ["RUNHOUND_", "this browser only", "Run Hound server", "Accepted server host names"]) expect(text).not.toContain(gone);
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe("in a browser (Docker, CLI)", () => {
  it("New run and a refused target keep RUNHOUND_ALLOWED_HOSTS", async () => {
    const { page } = await open("#/new", false);
    await expect.poll(() => page.locator("#target-hint").innerText()).toContain("Add other hosts you own with RUNHOUND_ALLOWED_HOSTS.");
    await page.fill("#target-url", "http://example.com/");
    await page.click("#plan-button");
    await expect.poll(() => page.locator("#target-error").innerText()).toContain("hosts listed in RUNHOUND_ALLOWED_HOSTS");
    await page.close();
  });

  it("Settings keeps the server wording and its variables", async () => {
    const { page } = await open("#/settings", false);
    await page.locator("#about-h").waitFor();
    await expect.poll(() => page.locator("#keys-card").innerText()).toContain("this machine");
    await expect.poll(() => visibleText(page)).toContain("Accepted server host names");
    const text = await visibleText(page);
    for (const kept of ["Saved in this browser only.", "how this Run Hound server is set up", "RUNHOUND_ALLOWED_HOSTS", "Accepted server host names", "RUNHOUND_SERVER_HOSTS"]) expect(text).toContain(kept);
    await page.close();
  });
});
