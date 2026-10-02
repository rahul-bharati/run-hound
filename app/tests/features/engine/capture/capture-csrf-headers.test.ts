// attachCapture (0.6.0 close-out round 1): a write to the app carries its anti-CSRF token in a header on many apps (Django's X-CSRFToken, axios' X-XSRF-TOKEN, Rails' X-CSRF-Token), so the capture keeps the anti-CSRF headers (a name with csrf or xsrf, lower-case) of each write to the page's origin or another local origin (write-access sends Account B's replay with B's own token); never a read's, never any other header; in memory only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { Capture } from "../../../../src/core/types.js";
import { attachCapture } from "../../../../src/engine/capture.js";

let site: FixtureServer;

beforeAll(async () => {
  site = await startFixtureServer({
    pages: {
      "/": `<!doctype html><html><head><title>capture</title></head><body><p>capture</p>
        <script>
          (async () => {
            await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json", "X-CSRFToken": "acsrf7Hq2Lm9Xc4Pz81", "X-Client-Version": "1.2.3", "X-Auth-Token": "secret-tok" }, body: "{}" });
            await fetch("/api/xsrf", { method: "PUT", headers: { "content-type": "application/json", "X-XSRF-TOKEN": "eyJpdiI6IjEyMyJ9==" }, body: "{}" });
            await fetch("/api/read", { headers: { "X-CSRF-Token": "read-token-1234567" } });
            await fetch("/api/plain", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
            document.body.dataset.done = "yes";
          })();
        </script></body></html>`,
    },
    routes: {
      "POST /api/save": (_req, res) => json(res, 200, { ok: true }),
      "PUT /api/xsrf": (_req, res) => json(res, 200, { ok: true }),
      "GET /api/read": (_req, res) => json(res, 200, { ok: true }),
      "POST /api/plain": (_req, res) => json(res, 200, { ok: true }),
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await site?.close();
});

describe("attachCapture: the anti-CSRF headers of a write", () => {
  let capture: Capture;

  beforeAll(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    capture = attachCapture(page);
    await page.goto(`${site.url}/`);
    await page.waitForSelector("body[data-done=yes]");
    await page.close();
  });

  const byPath = (path: string) => capture.requests.find((r) => new URL(r.url).pathname === path);

  it("keeps a write's anti-CSRF headers, by lower-case name, and no other header", () => {
    expect(byPath("/api/save")!.csrfHeaders).toEqual({ "x-csrftoken": "acsrf7Hq2Lm9Xc4Pz81" });
    expect(byPath("/api/xsrf")!.csrfHeaders).toEqual({ "x-xsrf-token": "eyJpdiI6IjEyMyJ9==" });
  });

  it("keeps none for a read, or a write without one", () => {
    expect(byPath("/api/read")!.csrfHeaders).toBeUndefined();
    expect(byPath("/api/plain")!.csrfHeaders).toBeUndefined();
  });
});
