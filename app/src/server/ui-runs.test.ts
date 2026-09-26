/**
 * Run pages in the web UI, driven in real Chromium against renderUi's document with every /api/* call answered by a
 * stub (page.route):
 * - A failed run's page shows why Re-run was refused (409 busy, 400 target down) next to the button, as the report
 *   page does, instead of silently resetting the button.
 * - "Back to test plan" for a run whose address had a secret in it (the server only ever sends it redacted, e.g.
 *   ?t=[REDACTED:github-token]) does not plan the redacted address; it asks for the full address instead.
 */
import { chromium, type Browser, type Request, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderUi } from "./ui/index.js";

const ORIGIN = "http://rh.test";
const HTML = renderUi({ version: "0.4.0", canShowBrowser: false });

type Handler = (req: Request, url: URL) => { status?: number; body: unknown } | undefined;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(hash: string, handler: Handler) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`${ORIGIN}/**`, async (route: Route, req: Request) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    calls.push({ method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()!) : null });
    const out = handler(req, url) ?? (url.pathname === "/api/ai" ? { body: { enabled: false, problem: "AI is off" } } : { status: 404, body: { error: "not stubbed" } });
    return route.fulfill({ status: out.status ?? 200, contentType: "application/json", body: JSON.stringify(out.body) });
  });
  await page.goto(`${ORIGIN}/${hash}`);
  return { page, errors, calls };
}

describe("a failed run's page", () => {
  const failed = { status: "error", error: "The app closed the connection without answering.", startedAt: "2026-09-26T10:00:00.000Z", completed: 1, total: 3, durationMs: 4000 };

  it.each([
    [409, "2 runs are already in progress. Wait for one to finish."],
    [400, "Nothing is answering at http://localhost:3000/book."],
  ])("shows why Re-run was refused (%i) and resets the button", async (code, message) => {
    const o = await open("#/runs/r9", (req, url) => {
      if (url.pathname === "/api/runs/r9") return { body: failed };
      if (url.pathname === "/api/runs") return { body: { runs: [] } };
      if (url.pathname === "/api/runs/r9/rerun" && req.method() === "POST") return { status: code, body: { error: message } };
      return undefined;
    });
    const { page } = o;
    await page.getByRole("heading", { name: "Run failed" }).waitFor();
    await page.getByRole("button", { name: "Re-run" }).click();
    await expect.poll(() => page.locator("#report").innerText()).toContain("Could not re-run: " + message);
    expect(await page.getByRole("button", { name: "Re-run" }).isEnabled()).toBe(true);
    expect(o.calls.filter((c) => c.path === "/api/runs/r9/rerun")).toHaveLength(1);
    expect(o.errors).toEqual([]);
    await page.close();
  });
});

describe("Back to test plan", () => {
  const run = (target: string) => ({
    status: "done",
    startedAt: "2026-09-26T10:00:00.000Z",
    completed: 1,
    total: 1,
    report: { target, approved: ["dc:controls"] },
  });

  it("does not plan a redacted address; it asks for the full one", async () => {
    const target = "http://localhost:3000/admin?t=[REDACTED:github-token]";
    const o = await open("#/new?from=r7", (_req, url) => {
      if (url.pathname === "/api/runs") return { body: { runs: [{ runId: "r7", target, status: "done" }] } };
      if (url.pathname === "/api/runs/r7") return { body: run(target) };
      if (url.pathname === "/api/runs/r7/live") return { body: { scenarios: [{ id: "dc:controls" }] } };
      if (url.pathname === "/api/plan") return { body: { error: "should not be called" }, status: 500 };
      return undefined;
    });
    const { page } = o;
    await expect.poll(() => page.locator("#target-error").textContent()).toMatch(/secret.*hid.*full address/i);
    expect(await page.getByLabel("Page URL").inputValue()).toBe(target);
    expect(o.calls.some((c) => c.path === "/api/plan")).toBe(false);
    expect(o.errors).toEqual([]);
    await page.close();
  });

  it("still plans an ordinary address with the run's scenarios", async () => {
    const target = "http://localhost:3000/book";
    const o = await open("#/new?from=r8", (_req, url) => {
      if (url.pathname === "/api/runs") return { body: { runs: [{ runId: "r8", target, status: "done" }] } };
      if (url.pathname === "/api/runs/r8") return { body: run(target) };
      if (url.pathname === "/api/runs/r8/live") return { body: { scenarios: [{ id: "dc:controls" }] } };
      if (url.pathname === "/api/plan") return { status: 400, body: { error: "Nothing is answering at http://localhost:3000/book." } };
      return undefined;
    });
    await expect.poll(() => o.calls.filter((c) => c.path === "/api/plan").map((c) => (c.body as { url: string }).url)).toEqual([target]);
    await o.page.close();
  });
});
