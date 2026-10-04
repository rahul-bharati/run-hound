// Launch the built desktop app in Electron and check what unit tests can't: the bundled engine loads, the window
// shows the engine's UI, the preload bridge answers, the renderer has no Node, and navigation stays on the engine.
// Run with `pnpm test:launch` (builds first). On Linux without a display, wrap it in xvfb-run.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "run-hound-desktop-check-"));

// CI runners can't use Chromium's setuid sandbox; the renderer sandbox the app asks for is unaffected.
// DESKTOP_EXECUTABLE checks a packaged build (release/linux-unpacked/run-hound, say) instead of the dev checkout.
const packaged = process.env.DESKTOP_EXECUTABLE;
const args = [...(packaged ? [] : [root]), ...(process.env.CI ? ["--no-sandbox"] : [])];
const app = await electron.launch({
  ...(packaged ? { executablePath: packaged } : {}),
  args,
  env: { ...process.env, RUNHOUND_CONFIG_DIR: join(scratch, "config"), RUNHOUND_RUNS_DIR: join(scratch, "runs") },
  timeout: 60_000,
});

// A one-form target page, so planning has something to open in Chromium.
const target = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><title>Target</title><form method="post"><label>Email <input name="email" type="email" required></label><button>Send</button></form>');
});
await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
const targetUrl = `http://127.0.0.1:${target.address().port}/`;

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (err) {
    results.push(`FAIL ${name}\n     ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const origin = new URL(page.url()).origin;

  // Record outside links instead of opening the real browser.
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => void globalThis.__opened.push(url);
  });

  await check("the window loads the engine's UI on loopback", async () => {
    assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.match(await page.title(), /Run Hound/);
  });

  await check("the engine's API answers", async () => {
    const status = await page.evaluate(async () => (await fetch("/api/runs")).status);
    assert.equal(status, 200);
  });

  await check("planning opens the target in Playwright's Chromium from inside the app", async () => {
    const reply = await page.evaluate(async (url) => {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      return { status: res.status, body: await res.json() };
    }, targetUrl);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(typeof reply.body.planId, "string");
  });

  await check("the renderer has no Node", async () => {
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process]), ["undefined", "undefined"]);
  });

  await check("the preload bridge answers the version check", async () => {
    const reply = await page.evaluate(() => window.runHoundDesktop.version.check());
    assert.equal(reply.latest, null);
    assert.match(reply.current, /^\d+\.\d+\.\d+/);
  });

  await check("the bridge exposes only the contract's surface", async () => {
    assert.deepEqual(await page.evaluate(() => Object.keys(window.runHoundDesktop).sort()), ["engine", "runsDir", "version"]);
  });

  // Each check reads what went to the default browser, so it fails if the app's own handlers aren't the ones acting
  // (Chromium alone would also refuse some of these navigations, but would never hand them to the OS).
  const opened = () => app.evaluate(() => globalThis.__opened.splice(0));
  const stays = async () => {
    await page.waitForTimeout(500);
    assert.equal(new URL(page.url()).origin, origin);
  };

  await check("a web link goes to the default browser, not the app window", async () => {
    await page.evaluate(() => { location.href = "https://example.com/"; });
    await stays();
    assert.deepEqual(await opened(), ["https://example.com/"]);
  });

  await check("another loopback port is not the engine: it leaves the app, it isn't shown in it", async () => {
    await page.evaluate(() => { location.href = "http://127.0.0.1:9/"; });
    await stays();
    assert.deepEqual(await opened(), ["http://127.0.0.1:9/"]);
  });

  await check("a non-web scheme is neither shown nor handed to the OS", async () => {
    await page.evaluate(() => { location.href = "x-run-hound-check:hello"; });
    await stays();
    assert.deepEqual(await opened(), []);
  });

  await check("window.open to another site opens outside and adds no app window", async () => {
    const before = app.windows().length;
    await page.evaluate(() => window.open("https://example.org/", "_blank"));
    await page.waitForTimeout(500);
    assert.equal(app.windows().length, before);
    assert.deepEqual(await opened(), ["https://example.org/"]);
  });

  await check("window.open to an engine page opens an app window without the bridge", async () => {
    const [child] = await Promise.all([app.waitForEvent("window"), page.evaluate(() => window.open("/api/runs", "_blank"))]);
    await child.waitForLoadState("domcontentloaded");
    assert.equal(new URL(child.url()).origin, origin);
    assert.equal(await child.evaluate(() => typeof window.runHoundDesktop), "undefined");
    await child.close();
  });

  await check("a subframe can't leave the engine, and isn't opened outside", async () => {
    const src = await page.evaluate(async () => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      frame.src = "https://example.net/";
      await new Promise((r) => setTimeout(r, 500));
      const value = frame.src;
      frame.remove();
      return value;
    });
    assert.equal(src, "https://example.net/");
    assert.deepEqual(await opened(), []);
    assert.equal(page.frames().some((f) => f.url().startsWith("https://example.net")), false);
  });
} finally {
  await app.close();
  target.close();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
