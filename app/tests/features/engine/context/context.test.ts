import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredForm } from "../core/types.js";
import { createCheckContext } from "./context.js";

let server: FixtureServer;
let artifactsDir: string;

const form: DiscoveredForm = {
  url: "",
  selector: "#f",
  name: "Test form",
  fields: [
    { key: "name", accessibleName: "Name", label: "Name", placeholder: null, type: "text", role: "textbox", required: true, selector: "#name" },
  ],
  controls: [{ accessibleName: "Send", text: "Send", role: "button", tag: "button", selector: "#send", isSubmit: true }],
};

beforeAll(async () => {
  server = await startFixtureServer({
    pages: {
      "/form": `<!doctype html><html><head><title>Context fixture</title></head><body>
        <form id="f"><label for="name">Name</label><input id="name" name="name" required><button id="send">Send</button></form>
        <script>fetch("/api/ping").then(r => r.json()).then(() => { document.body.dataset.loaded = "1"; });</script>
      </body></html>`,
    },
    routes: { "GET /api/ping": (_req, res) => json(res, 200, { ok: true }) },
  });
  form.url = `${server.url}/form`;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), "rh-context-"));
});

afterEach(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

async function makeContext(extra: { allowDestructive?: boolean; runToken?: string; log?: (m: string) => void } = {}) {
  return createCheckContext({ browser: await getBrowser(), form, targetUrl: `${server.url}/form`, artifactsDir, ...extra });
}

describe("createCheckContext", () => {
  it("exposes the options it was given", async () => {
    const ctx = await makeContext({ allowDestructive: true, runToken: "tok123" });
    try {
      expect(ctx.form).toBe(form);
      expect(ctx.targetUrl).toBe(`${server.url}/form`);
      expect(ctx.artifactsDir).toBe(artifactsDir);
      expect(ctx.allowDestructive).toBe(true);
      expect(ctx.runToken).toBe("tok123");
      expect(ctx.browser).toBe(await getBrowser());
    } finally {
      await ctx.dispose();
    }
  });

  it("defaults allowDestructive to false and generates a run token", async () => {
    const ctx = await makeContext();
    try {
      expect(ctx.allowDestructive).toBe(false);
      expect(typeof ctx.runToken).toBe("string");
      expect(ctx.runToken.length).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
    }
  });

  it("openPage navigates to the target, waits for network idle and captures traffic", async () => {
    const ctx = await makeContext();
    try {
      const { page, capture, context } = await ctx.openPage();
      expect(page.url()).toBe(`${server.url}/form`);
      expect(await page.title()).toBe("Context fixture");
      // networkidle: the ping request finished before openPage resolved
      expect(await page.evaluate(() => document.body.dataset.loaded)).toBe("1");
      expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
      expect(context.pages()).toContain(page);
      expect(capture.requests.some((r) => r.url === `${server.url}/form` && r.status === 200)).toBe(true);
      expect(capture.requests.some((r) => r.url === `${server.url}/api/ping` && r.status === 200)).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  it("openPage honours a custom viewport", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage({ viewport: { width: 320, height: 800 } });
      expect(page.viewportSize()).toEqual({ width: 320, height: 800 });
      expect(await page.evaluate(() => window.innerWidth)).toBe(320);
    } finally {
      await ctx.dispose();
    }
  });

  it("each openPage call gets a fresh, isolated browser context", async () => {
    const ctx = await makeContext();
    try {
      const first = await ctx.openPage();
      await first.page.evaluate(() => localStorage.setItem("draft", "rex"));
      const second = await ctx.openPage();
      expect(second.context).not.toBe(first.context);
      expect(await second.page.evaluate(() => localStorage.getItem("draft"))).toBeNull();
      // capture is per page
      expect(second.capture).not.toBe(first.capture);
    } finally {
      await ctx.dispose();
    }
  });

  it("dispose closes every context it opened", async () => {
    const ctx = await makeContext();
    const a = await ctx.openPage();
    const b = await ctx.openPage();
    await ctx.dispose();
    expect(a.page.isClosed()).toBe(true);
    expect(b.page.isClosed()).toBe(true);
  });

  it("opens no page once disposed: a check abandoned at a stop or its time limit can't start another one", async () => {
    const ctx = await makeContext();
    await ctx.dispose();
    await expect(ctx.openPage()).rejects.toThrow("The scenario has ended, so no new page is opened.");
  });

  it("screenshot writes a PNG under artifactsDir and returns relative evidence", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const evidence = await ctx.screenshot(page, "Initial state");
      expect(evidence.kind).toBe("screenshot");
      expect(evidence.label).toBe("Initial state");
      expect(evidence.path).toBeDefined();
      expect(isAbsolute(evidence.path!)).toBe(false);
      expect(evidence.path!.endsWith(".png")).toBe(true);
      const file = resolve(artifactsDir, evidence.path!);
      expect(file.startsWith(artifactsDir + sep)).toBe(true);
      expect((await stat(file)).size).toBeGreaterThan(0);
      const bytes = await readFile(file);
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const second = await ctx.screenshot(page, "Initial state");
      expect(second.path).not.toBe(evidence.path);
    } finally {
      await ctx.dispose();
    }
  });

  it("retries a screenshot Chromium could not capture (a transient error on a busy machine)", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const real = page.screenshot.bind(page);
      const spy = vi.spyOn(page, "screenshot");
      spy.mockRejectedValueOnce(new Error("page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot"));
      spy.mockRejectedValueOnce(new Error("page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot"));
      spy.mockImplementation(real);
      const shot = await ctx.screenshot(page, "Busy machine");
      expect((await stat(resolve(artifactsDir, shot.path!))).size).toBeGreaterThan(0);
      const frame = await ctx.capture(page, "Busy machine frame");
      expect((await stat(resolve(artifactsDir, frame.path!))).size).toBeGreaterThan(0);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    } finally {
      await ctx.dispose();
    }
  });

  it("does not retry other screenshot errors", async () => {
    const ctx = await makeContext();
    try {
      const { page } = await ctx.openPage();
      const spy = vi.spyOn(page, "screenshot").mockRejectedValue(new Error("page.screenshot: Target page, context or browser has been closed"));
      await expect(ctx.screenshot(page, "Closed")).rejects.toThrow(/has been closed/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      await ctx.dispose();
    }
  });

  it("openPage installs the navigation guard: a page can't be driven to a public host", async () => {
    const ctx = await makeContext();
    const { page } = await ctx.openPage();
    try {
      await expect(page.goto("http://8.8.8.8/")).rejects.toThrow();
      expect(ctx.blocked.join(" ")).toContain("8.8.8.8");
      expect(ctx.escaped).toEqual([]);
      expect(page.url()).not.toContain("8.8.8.8");
    } finally {
      await ctx.dispose();
    }
  });

  it("log redacts secrets before they reach the log", async () => {
    const lines: string[] = [];
    const ctx = await makeContext({ log: (m) => lines.push(m) });
    ctx.log("token sk-proj-FAKEFAKEctx1234567890abcdefGHIJ seen");
    expect(lines).toEqual(["token [REDACTED:openai-key] seen"]);
  });

  it("log forwards messages to the log option", async () => {
    const messages: string[] = [];
    const ctx = await makeContext({ log: (m) => messages.push(m) });
    try {
      ctx.log("hello");
      expect(messages).toContain("hello");
    } finally {
      await ctx.dispose();
    }
  });
});
