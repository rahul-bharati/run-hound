// Launch the built desktop app in Electron and check what unit tests can't: the bundled engine loads, the window
// shows the engine's UI, the preload bridge answers, the renderer has no Node, navigation stays on the engine, the
// packaged app finds its own Chromium and uses it, saved keys never reach disk as plain text, the first launch
// imports the command line's settings, and the window has the Run Hound look (dark, with the UI's own 36 px title bar).
// Run with `pnpm test:launch` (builds first). On Linux without a display, wrap it in xvfb-run.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "run-hound-desktop-check-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// CI runners can't use Chromium's setuid sandbox; the renderer sandbox the app asks for is unaffected.
// DESKTOP_EXECUTABLE checks a packaged build (release/linux-unpacked/run-hound, say) instead of the dev checkout.
const packaged = process.env.DESKTOP_EXECUTABLE;
const args = [...(packaged ? [] : [root]), ...(process.env.CI ? ["--no-sandbox"] : [])];

// A packaged app must run on the Chromium it ships. Giving it an empty home puts Playwright's per-user browser cache
// out of reach, so a planning run that opens a page can only have used the bundled one.
const home = join(scratch, "home");
const emptyHome = packaged
  ? { HOME: home, USERPROFILE: home, XDG_CACHE_HOME: join(home, ".cache"), LOCALAPPDATA: join(home, "AppData", "Local"), APPDATA: join(home, "AppData", "Roaming") }
  : {};

/** The app's environment: the desktop sets its browser variables itself, so none may leak in from the caller. */
function appEnv(extra) {
  // RUNHOUND_NO_UPDATE_CHECK: the version check would call GitHub; CI never does.
  const env = { ...process.env, ...emptyHome, RUNHOUND_RUNS_DIR: join(scratch, "runs"), RUNHOUND_NO_UPDATE_CHECK: "1", ...extra };
  for (const name of ["RUNHOUND_FULL_CHROMIUM", "RUNHOUND_SECRETS", ...(packaged ? ["PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_SKIP_BROWSER_GC"] : [])]) delete env[name];
  for (const [name, value] of Object.entries(extra)) if (value === undefined) delete env[name];
  return env;
}

const launch = (extra) =>
  electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args, env: appEnv(extra), timeout: 60_000 });

const app = await launch({ RUNHOUND_CONFIG_DIR: join(scratch, "config") });

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

  /** A call to the engine's API from the page, with the header its settings routes require. */
  const api = (method, path, body) =>
    page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(path, { method, headers: { "x-run-hound": "1", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: res.status, body: await res.json() };
      },
      { method, path, body },
    );

  await check("the app makes headless launches use the full Chromium", async () => {
    assert.equal(await app.evaluate(() => process.env.RUNHOUND_FULL_CHROMIUM), "1");
  });

  if (packaged) {
    await check("the packaged app resolves its bundled Chromium, and ships no headless shell", async () => {
      const resources = await app.evaluate(() => process.resourcesPath);
      const browsers = await app.evaluate(() => process.env.PLAYWRIGHT_BROWSERS_PATH);
      assert.equal(browsers, join(resources, "playwright-browsers"));
      assert.equal(await app.evaluate(() => process.env.PLAYWRIGHT_SKIP_BROWSER_GC), "1");
      assert.deepEqual(readdirSync(browsers).filter((name) => name.startsWith("chromium_headless_shell")), []);
      // Playwright's own answer for that folder, asked in a fresh process so nothing is cached: the executable is
      // inside it and exists.
      const asked = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", 'const { chromium } = await import("playwright"); console.log(chromium.executablePath());'],
        { cwd: root, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers }, encoding: "utf8" },
      );
      assert.equal(asked.status, 0, asked.stderr);
      const executable = asked.stdout.trim();
      assert.ok(executable.startsWith(browsers), `${executable} is not inside ${browsers}`);
      assert.ok(existsSync(executable), `${executable} does not exist`);
    });
  }

  await check("settings report how saved keys are protected", async () => {
    const reply = await api("GET", "/api/ai");
    assert.equal(reply.status, 200);
    assert.ok(["os-keychain", "run-hound"].includes(reply.body.secretProtection), `secretProtection was ${JSON.stringify(reply.body.secretProtection)}`);
  });

  await check("a saved key leaves no plain text in the config folder", async () => {
    // A made-up key, never a real one.
    const fake = "sk-ant-launch-check-FAKE-0123456789abcdefghijklmnopqrstuv";
    const reply = await api("PUT", "/api/ai", { provider: "anthropic", apiKey: fake });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.ok(reply.body.savedKeys.includes("anthropic"), JSON.stringify(reply.body.savedKeys));
    assert.ok(!JSON.stringify(reply.body).includes(fake), "the API echoed the key");
    const configDir = join(scratch, "config");
    const files = readdirSync(configDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    assert.ok(files.some((entry) => entry.name === "secrets.json"), `no secrets.json in ${configDir}: ${files.map((entry) => entry.name)}`);
    for (const entry of files) {
      const text = readFileSync(join(entry.parentPath, entry.name)).toString("latin1");
      assert.ok(!text.includes(fake), `${entry.name} holds the key in plain text`);
    }
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

  // The look (src/shell.ts, the preload, and the .desktop-titlebar rules in app/src/server/ui/styles.ts).
  const hostPlatform = await app.evaluate(() => process.platform);
  await page.waitForSelector("main#view > *");

  await check("the window is dark before the page paints: its background is the UI's page colour", async () => {
    const window = await app.browserWindow(page);
    const colour = await window.evaluate((w) => w.getBackgroundColor());
    assert.equal(colour.toLowerCase().replace(/^#ff(?=[0-9a-f]{6}$)/, "#"), "#0a1014");
    assert.deepEqual(await app.evaluate(({ nativeTheme }) => [nativeTheme.themeSource, nativeTheme.shouldUseDarkColors], undefined), ["dark", true]);
  });

  await check("the preload marks the page as the desktop app's", async () => {
    assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.shell, document.documentElement.dataset.platform]), ["desktop", hostPlatform]);
  });

  await check("the title bar strip is one aria-hidden, fixed, draggable, 36 px div, first in <body>, above the sidebar", async () => {
    const strip = await page.evaluate(() => {
      const el = document.querySelector(".desktop-titlebar");
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const stack = (x) => document.elementFromPoint(x, 10)?.className;
      return {
        count: document.querySelectorAll(".desktop-titlebar").length,
        first: document.body.firstElementChild === el,
        tag: el.tagName,
        ariaHidden: el.getAttribute("aria-hidden"),
        position: style.position,
        region: style.getPropertyValue("-webkit-app-region"),
        top: box.top,
        height: box.height,
        width: box.width,
        viewport: innerWidth,
        atSidebar: stack(100),
        atContent: stack(innerWidth - 200),
      };
    });
    const { region, viewport, ...rest } = strip;
    assert.deepEqual(rest, { count: 1, first: true, tag: "DIV", ariaHidden: "true", position: "fixed", top: 0, height: 36, width: viewport, atSidebar: "desktop-titlebar", atContent: "desktop-titlebar" });
    assert.equal(region, "drag");
  });

  await check("nothing interactive or visible lies under the strip: the sidebar's brand and the view's first content start below 36 px", async () => {
    const tops = await page.evaluate(() => ({
      brand: document.querySelector("#sidebar .brand").getBoundingClientRect().top,
      view: document.querySelector("main#view").firstElementChild.getBoundingClientRect().top,
    }));
    assert.ok(tops.brand >= 36, `the brand starts at ${tops.brand}`);
    assert.ok(tops.view >= 36, `the view's first content starts at ${tops.view}`);
  });

  await check("a scrolled page never shows through the strip, and the sticky results panel sits below it", async () => {
    const reply = await page.evaluate(async () => {
      const filler = document.createElement("div");
      filler.style.cssText = "height:3000px";
      const panel = document.createElement("div");
      panel.className = "results-panel";
      document.querySelector("main#view").append(filler, panel);
      scrollTo(0, 500);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const sidebar = document.querySelector("#sidebar").getBoundingClientRect();
      const sticky = getComputedStyle(panel);
      const out = { scrolled: scrollY, sidebarTop: sidebar.top, sidebarHeight: sidebar.height, innerHeight, hit: document.elementFromPoint(innerWidth - 300, 20)?.className, panelPosition: sticky.position, panelTop: sticky.top, panelMaxHeight: sticky.maxHeight };
      filler.remove();
      panel.remove();
      scrollTo(0, 0);
      return out;
    });
    assert.equal(reply.scrolled, 500);
    assert.equal(reply.hit, "desktop-titlebar");
    assert.equal(reply.sidebarTop, 0);
    assert.equal(reply.sidebarHeight, reply.innerHeight);
    assert.deepEqual([reply.panelPosition, reply.panelTop, reply.panelMaxHeight], ["sticky", "52px", `${reply.innerHeight - 32 - 36}px`]);
  });

  await check("the application menu is minimal on macOS and absent elsewhere", async () => {
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? null);
    if (hostPlatform === "darwin") assert.deepEqual(labels.slice(0, 3), ["Run Hound", "Edit", "Window"]);
    else assert.equal(labels, null);
  });

  await check("copy and paste shortcuts work in a text field (without the Edit menu on Windows and Linux)", async () => {
    const mod = hostPlatform === "darwin" ? "Meta" : "Control";
    await page.evaluate(() => {
      for (const id of ["copy-from", "paste-to"]) {
        const input = document.createElement("input");
        input.id = id;
        input.style.cssText = "position:fixed;top:60px;left:300px;z-index:50";
        document.body.append(input);
      }
      document.querySelector("#paste-to").style.top = "100px";
    });
    await page.fill("#copy-from", "launch-check clipboard text");
    await page.focus("#copy-from");
    await page.keyboard.press(`${mod}+A`);
    await page.keyboard.press(`${mod}+C`);
    await page.focus("#paste-to");
    await page.keyboard.press(`${mod}+V`);
    assert.equal(await page.inputValue("#paste-to"), "launch-check clipboard text");
    await page.evaluate(() => document.querySelectorAll("#copy-from, #paste-to").forEach((el) => el.remove()));
  });

  await check("the window icon ships and Electron can read it (a 512 px PNG)", async () => {
    const icon = `${await app.evaluate(({ app }) => app.getAppPath())}/dist/icon.png`;
    const size = await app.evaluate(({ nativeImage }, path) => {
      const image = nativeImage.createFromPath(path);
      return image.isEmpty() ? null : image.getSize();
    }, icon);
    assert.deepEqual(size, { width: 512, height: 512 });
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
}

// The first launch with no RUNHOUND_CONFIG_DIR imports what the command line saved, once, and leaves its copy alone.
// The folders differ by OS (macOS and Windows keep the desktop app's own folder), so this runs where they are known.
if (process.platform === "linux") {
  const xdg = join(scratch, "xdg");
  const cliDir = join(xdg, "run-hound");
  const desktopDir = join(xdg, "run-hound-desktop");
  const saved = `${JSON.stringify({ version: 2, enabled: true, provider: "openai", model: "gpt-launch-check" }, null, 2)}\n`;
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(join(cliDir, "ai.json"), saved);
  const imported = await launch({ RUNHOUND_CONFIG_DIR: undefined, XDG_CONFIG_HOME: xdg });
  try {
    const page = await imported.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await check("the first launch imports the command line's settings into the desktop folder, once", async () => {
      const reply = await page.evaluate(async () => (await fetch("/api/ai", { headers: { "x-run-hound": "1" } })).json());
      assert.equal(reply.provider, "openai");
      assert.equal(reply.model, "gpt-launch-check");
      assert.equal(reply.file, join(desktopDir, "ai.json"));
      assert.ok(existsSync(join(desktopDir, "imported-from-cli.json")), "no import marker");
      assert.equal(readFileSync(join(cliDir, "ai.json"), "utf8"), saved, "the command line's file changed");
    });
  } finally {
    await imported.close();
  }
}

console.log(results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
