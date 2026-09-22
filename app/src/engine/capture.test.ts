import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Capture } from "../core/types.js";
import { attachCapture } from "./capture.js";

let site: FixtureServer;
let thirdParty: FixtureServer;

beforeAll(async () => {
  thirdParty = await startFixtureServer({
    routes: {
      "GET /data": (_req, res) => {
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify({ thirdParty: "cross-origin-body" }));
      },
    },
  });

  site = await startFixtureServer({
    pages: {
      "/": `<!doctype html><html><head><title>capture</title></head><body>
        <p>capture fixture</p>
        <script>
          console.log("hello from the page");
          console.warn("careful now");
          console.error("something broke");
          (async () => {
            await fetch("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ petName: "Rex" }) });
            await fetch("/api/missing");
            await fetch("/api/text");
            await fetch("/api/boom");
            await fetch("/api/drop").catch(() => {});
            await fetch("${thirdParty.url}/data");
            setTimeout(() => { throw new Error("kaboom from page"); }, 0);
            document.body.dataset.done = "yes";
          })();
        </script>
      </body></html>`,
    },
    routes: {
      "POST /api/echo": (req, res) => json(res, 201, { echoed: JSON.parse(req.body) }),
      "GET /api/text": (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("plain same-origin text");
      },
      "GET /api/boom": (_req, res) => json(res, 500, { error: "Something went wrong" }),
      "GET /api/drop": (_req, res) => {
        res.socket?.destroy();
      },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await site?.close();
  await thirdParty?.close();
});

async function openCapturedPage(): Promise<{ page: Page; capture: Capture }> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const capture = attachCapture(page);
  await page.goto(`${site.url}/`, { waitUntil: "load" });
  await page.waitForSelector("body[data-done=yes]");
  await waitUntil(() => capture.pageErrors.length > 0, "a page error to be captured");
  return { page, capture };
}

/** expect.poll() only works inside a test in vitest 5, so hooks wait with this instead. */
async function waitUntil(condition: () => boolean, what: string, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("attachCapture", () => {
  let capture: Capture;
  let page: Page;

  beforeAll(async () => {
    ({ page, capture } = await openCapturedPage());
    // Response bodies are read asynchronously; wait until the last same-origin body is in.
    await waitUntil(
      () => (capture.requests.find((r) => r.url.endsWith("/api/boom"))?.responseBody ?? null) !== null,
      "the /api/boom response body",
    );
  });

  afterAll(async () => {
    await page?.close();
  });

  const byPath = (path: string) => capture.requests.find((r) => new URL(r.url).pathname === path && r.url.startsWith(site.url));

  it("returns a live object with the documented shape", () => {
    expect(Array.isArray(capture.requests)).toBe(true);
    expect(Array.isArray(capture.console)).toBe(true);
    expect(Array.isArray(capture.pageErrors)).toBe(true);
  });

  it("records the document request", () => {
    const doc = byPath("/");
    expect(doc).toBeDefined();
    expect(doc!.method).toBe("GET");
    expect(doc!.resourceType).toBe("document");
    expect(doc!.status).toBe(200);
    expect(doc!.failure).toBeNull();
  });

  it("records method, postData, status and same-origin JSON body", () => {
    const echo = byPath("/api/echo");
    expect(echo).toBeDefined();
    expect(echo!.method).toBe("POST");
    expect(echo!.resourceType).toBe("fetch");
    expect(echo!.postData).toBe(JSON.stringify({ petName: "Rex" }));
    expect(echo!.status).toBe(201);
    expect(echo!.failure).toBeNull();
    expect(JSON.parse(echo!.responseBody!)).toEqual({ echoed: { petName: "Rex" } });
  });

  it("records null postData for GET requests", () => {
    expect(byPath("/api/missing")!.postData).toBeNull();
  });

  it("records 4xx and 5xx statuses", () => {
    expect(byPath("/api/missing")!.status).toBe(404);
    const boom = byPath("/api/boom")!;
    expect(boom.status).toBe(500);
    expect(JSON.parse(boom.responseBody!)).toEqual({ error: "Something went wrong" });
  });

  it("keeps same-origin text bodies", () => {
    expect(byPath("/api/text")!.responseBody).toBe("plain same-origin text");
  });

  it("records failed requests with a failure reason and no status", () => {
    const drop = byPath("/api/drop");
    expect(drop).toBeDefined();
    expect(drop!.failure).toEqual(expect.any(String));
    expect(drop!.failure!.length).toBeGreaterThan(0);
    expect(drop!.status).toBeNull();
    expect(drop!.responseBody).toBeNull();
  });

  it("records cross-origin requests but never their bodies", () => {
    const cross = capture.requests.find((r) => r.url === `${thirdParty.url}/data`);
    expect(cross).toBeDefined();
    expect(cross!.status).toBe(200);
    expect(cross!.responseBody).toBeNull();
  });

  it("records console messages with their type", () => {
    expect(capture.console).toEqual(
      expect.arrayContaining([
        { type: "log", text: "hello from the page" },
        { type: "warning", text: "careful now" },
        { type: "error", text: "something broke" },
      ]),
    );
  });

  it("records uncaught page errors", () => {
    expect(capture.pageErrors.some((e) => e.includes("kaboom from page"))).toBe(true);
  });

  it("keeps filling after attach (live)", async () => {
    const before = capture.requests.length;
    await page.evaluate(() => fetch("/api/text").then((r) => r.text()));
    await expect.poll(() => capture.requests.length).toBeGreaterThan(before);
    await page.evaluate(() => console.info("late message"));
    await expect.poll(() => capture.console.some((c) => c.text === "late message")).toBe(true);
  });
});

describe("attachCapture response body truncation", () => {
  it("truncates large same-origin bodies to at most 64 KB", async () => {
    const big = "x".repeat(200 * 1024);
    const server = await startFixtureServer({
      pages: { "/": `<!doctype html><title>big</title><script>fetch("/big").then(r=>r.text()).then(()=>{document.title="done"})</script>` },
      routes: {
        "GET /big": (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(big);
        },
      },
    });
    const page = await (await getBrowser()).newPage();
    try {
      const capture = attachCapture(page);
      await page.goto(`${server.url}/`);
      await page.waitForFunction(() => document.title === "done");
      await expect
        .poll(() => capture.requests.find((r) => r.url.endsWith("/big"))?.responseBody ?? null)
        .not.toBeNull();
      const body = capture.requests.find((r) => r.url.endsWith("/big"))!.responseBody!;
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThanOrEqual(64 * 1024 + 64); // small allowance for a truncation marker
      expect(body.length).toBeLessThan(big.length);
    } finally {
      await page.close();
      await server.close();
    }
  });
});

describe("attachCapture truncation never leaves part of a secret behind", () => {
  it("cuts before a secret that straddles the 64 KB limit", async () => {
    const key = "sk-proj-FAKEFAKEstraddle1234567890abcdefGHIJKL";
    // The key starts 10 characters before the cut, so a plain slice would keep "sk-proj-FA".
    const body = `${"x".repeat(64 * 1024 - 11)}"${key}"${"y".repeat(1000)}`;
    const server = await startFixtureServer({
      pages: { "/": `<!doctype html><title>big</title><script>fetch("/big").then(r=>r.text()).then(()=>{document.title="done"})</script>` },
      routes: {
        "GET /big": (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(body);
        },
      },
    });
    const page = await (await getBrowser()).newPage();
    try {
      const capture = attachCapture(page);
      await page.goto(`${server.url}/`);
      await page.waitForFunction(() => document.title === "done");
      await expect.poll(() => capture.requests.find((r) => r.url.endsWith("/big"))?.responseBody ?? null).not.toBeNull();
      const kept = capture.requests.find((r) => r.url.endsWith("/big"))!.responseBody!;
      expect(kept).not.toContain("sk-proj");
      expect(kept.startsWith("x".repeat(1000))).toBe(true);
      expect(kept).toContain("truncated");
    } finally {
      await page.close();
      await server.close();
    }
  });
});
