// Launch the built desktop app in Electron and check what unit tests can't: the bundled engine loads, the window
// shows the engine's UI, the preload bridge answers, the renderer has no Node, navigation stays on the engine, the
// packaged app finds its own Chromium and uses it, saved keys never reach disk as plain text, the first launch
// imports the command line's settings, and every window the app shows has the Run Hound look (dark, with the page's own
// 36 px title bar): the main window, the report and engine pages in child windows (which have no bridge), and the
// start-up error window, with a small right-click menu everywhere and no native message box or error box.
// Run with `pnpm test:launch` (builds first). On Linux without a display, wrap it in xvfb-run.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "run-hound-desktop-check-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// CI runners can't use Chromium's setuid sandbox; the renderer sandbox the app asks for is unaffected.
// DESKTOP_EXECUTABLE checks a packaged build (release/linux-unpacked/run-hound, say) instead of the dev checkout.
const packaged = process.env.DESKTOP_EXECUTABLE;
const args = [...(packaged ? [] : [root]), ...(process.env.CI ? ["--no-sandbox"] : [])];

// A packaged app must run on the Chromium it ships. On Linux an empty home puts Playwright's per-user browser cache out of
// reach, so a planning run that opens a page can only have used the bundled one. macOS and Windows keep the real profile:
// a fake one has no login keychain on macOS (a blocking "Keychain Not Found" dialog before the window) and crashes the app
// on Windows (an empty USERPROFILE and AppData), which no user has. There, the check that Playwright's executable path
// lies inside the app's resources, on a runner with no per-user browser cache, is the proof.
const home = join(scratch, "home");
const emptyHome = packaged && process.platform === "linux"
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

  await check("the app is named Run Hound, so its profile folder and its keychain item are", async () => {
    // desktop/package.json "productName": Electron prefers it to the package's own (scoped, lowercase) name.
    const [name, userData] = await app.evaluate(({ app }) => [app.getName(), app.getPath("userData")]);
    assert.equal(name, "Run Hound");
    assert.equal(basename(userData), "Run Hound");
  });

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

  let planned;
  await check("planning opens the target in Playwright's Chromium from inside the app", async () => {
    const reply = await page.evaluate(async (url) => {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      return { status: res.status, body: await res.json() };
    }, targetUrl);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(typeof reply.body.planId, "string");
    planned = reply.body;
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
    assert.deepEqual(await page.evaluate(() => Object.keys(window.runHoundDesktop).sort()), ["engine", "notices", "runsDir", "version"]);
  });

  await check("notices.take answers an empty list when the app has nothing to say, and never anything twice", async () => {
    assert.deepEqual(await page.evaluate(() => window.runHoundDesktop.notices.take()), []);
    assert.deepEqual(await page.evaluate(() => window.runHoundDesktop.notices.take()), []);
    assert.equal(await page.locator("#desktop-notices").count(), 0);
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

  await check("the page declares color-scheme: dark, so scrollbars, form controls and select popups are drawn dark, and the scrollbars are thin", async () => {
    const style = await page.evaluate(() => {
      const select = document.createElement("select");
      document.body.append(select);
      const out = { root: getComputedStyle(document.documentElement).colorScheme, select: getComputedStyle(select).colorScheme, thin: getComputedStyle(document.querySelector("#sidebar")).scrollbarWidth };
      select.remove();
      return out;
    });
    assert.deepEqual(style, { root: "dark", select: "dark", thin: "thin" });
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

  await check("a scrolled page never shows through the strip, and the sticky results panel sits below it when sticky", async () => {
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
      const out = { scrolled: scrollY, sidebarTop: sidebar.top, sidebarHeight: sidebar.height, innerHeight, hit: document.elementFromPoint(innerWidth - 300, 20)?.className, panelPosition: sticky.position, panelTop: sticky.top, panelMaxHeight: sticky.maxHeight, wide: matchMedia("(min-width: 68.01rem)").matches };
      filler.remove();
      panel.remove();
      scrollTo(0, 0);
      return out;
    });
    assert.equal(reply.scrolled, 500);
    assert.equal(reply.hit, "desktop-titlebar");
    assert.equal(reply.sidebarTop, 0);
    assert.equal(reply.sidebarHeight, reply.innerHeight);
    // The results panel is sticky only from 68rem wide (styles.ts); a runner with a small screen shrinks the window below that.
    if (reply.wide) assert.deepEqual([reply.panelPosition, reply.panelTop, reply.panelMaxHeight], ["sticky", "52px", `${reply.innerHeight - 32 - 36}px`]);
    else assert.deepEqual([reply.panelPosition, reply.panelTop, reply.panelMaxHeight], ["static", "auto", "none"]);
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

  // The right-click menu (src/context-menu.ts). The menu is recorded instead of shown, so the check sees what the app built.
  await app.evaluate(({ Menu }) => {
    globalThis.__menus = [];
    Menu.prototype.popup = function recordedPopup() { globalThis.__menus.push(this); };
  });
  const menus = () => app.evaluate(() => globalThis.__menus.splice(0).map((menu) => menu.items.map((item) => ({ role: item.role ?? null, label: item.label, enabled: item.enabled, type: item.type }))));
  /** Right-clicks `selector` and returns the menu that was built, or [] when none was. */
  const rightClick = async (selector) => {
    await page.locator(selector).click({ button: "right" });
    await page.waitForTimeout(300);
    const [menu = []] = await menus();
    return menu;
  };
  // Running from source adds Inspect Element to every menu (like the macOS Developer menu); the checks look past it.
  const INSPECT = "Inspect Element";
  const shown = (menu) => menu.filter((item) => item.type !== "separator" && item.label !== INSPECT);
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "menu-probe";
    box.style.cssText = "position:fixed;top:60px;left:300px;z-index:50;background:#10171C;padding:8px;display:grid;gap:8px";
    box.innerHTML = '<input id="probe-input" value="launch-check text"><p id="probe-text">Some selectable words</p><a id="probe-link" href="https://example.com/probe?x=1">a web link</a><a id="probe-js" href="javascript:void(0)">a script link</a><button id="probe-button">A button</button>';
    document.body.append(box);
  });

  await check("right-click in a text field: Cut, Copy, Paste and Select All, enabled by what the field can do", async () => {
    await page.focus("#probe-input");
    await page.evaluate(() => document.querySelector("#probe-input").select());
    await app.evaluate(({ clipboard }) => clipboard.writeText("something to paste"));
    const menu = await rightClick("#probe-input");
    assert.deepEqual(shown(menu).map((item) => [item.role, item.enabled]), [["cut", true], ["copy", true], ["paste", true], ["selectall", true]]);
    assert.equal(menu[3]?.type, "separator", "Select All is set apart from the clipboard items");
  });

  await check("right-click in an empty field: only Paste and Select All can be used", async () => {
    await page.fill("#probe-input", "");
    assert.deepEqual(shown(await rightClick("#probe-input")).map((item) => [item.role, item.enabled]), [["cut", false], ["copy", false], ["paste", true], ["selectall", false]]);
    await page.fill("#probe-input", "launch-check text");
  });

  await check("right-click on selected text: Copy only; on plain text, a button or a script link: nothing (macOS: Copy for the word the click selects)", async () => {
    await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector("#probe-text")); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    assert.deepEqual(shown(await rightClick("#probe-text")).map((item) => [item.role, item.enabled]), [["copy", true]]);
    for (const selector of ["#probe-text", "#probe-button", "#probe-js"]) {
      await page.evaluate(() => getSelection().removeAllRanges());
      const menu = shown(await rightClick(selector)).map((item) => [item.role, item.enabled]);
      // On macOS a right-click on text selects the word under the pointer, as in Safari, so Copy is offered for it.
      const selected = await page.evaluate(() => getSelection().toString().trim() !== "");
      if (process.platform !== "darwin") assert.equal(selected, false, `${selector}: a right-click selected text`);
      assert.deepEqual(menu, selected ? [["copy", true]] : [], selector);
    }
  });

  await check("right-click on a web link: Copy Link Address, and choosing it puts the address on the clipboard", async () => {
    await page.locator("#probe-link").click({ button: "right" });
    await page.waitForTimeout(300);
    const labels = await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText("before");
      const menu = globalThis.__menus.pop();
      menu.items.find((item) => item.label === "Copy Link Address").click();
      return menu.items.filter((item) => item.type !== "separator" && item.label !== "Inspect Element").map((item) => item.label);
    });
    assert.deepEqual(labels, ["Copy Link Address"]);
    await page.waitForTimeout(300);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), "https://example.com/probe?x=1");
  });

  await check("the right-click menu has no Inspect in a packaged app; from source it is the one extra item", async () => {
    const inspect = (await rightClick("#probe-input")).filter((item) => item.label === INSPECT);
    assert.equal(inspect.length, packaged ? 0 : 1);
  });
  await page.evaluate(() => document.querySelector("#menu-probe").remove());

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

  // One scenario of the plan, run for real, so the report window below shows a real report.
  let reportPath = null;
  await check("a one-scenario run finishes and has an HTML report", async () => {
    assert.ok(planned, "no plan from the planning check");
    const approved = (planned.scenarios ?? []).slice(0, 1).map((scenario) => scenario.id);
    const started = await api("POST", "/api/runs", { planId: planned.planId, ...(approved.length ? { approved } : {}) });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    const id = started.body.runId ?? started.body.id;
    for (let i = 0; i < 120; i++) {
      const state = await api("GET", `/api/runs/${id}`);
      if (!["running", "queued"].includes(state.body.status)) break;
      await page.waitForTimeout(1000);
    }
    const report = await page.evaluate(async (path) => (await fetch(path)).status, `/api/runs/${id}/report.html`);
    assert.equal(report, 200);
    reportPath = `/api/runs/${id}/report.html`;
  });

  // Every window the app opens looks like the app. The engine pages the UI opens (the report, evidence, JSON) get the same
  // title bar strip, background and scrollbars from the child windows' preload (src/chrome-preload.ts), and no bridge.
  const BG = "rgb(10, 16, 20)"; // BRAND.bg
  const BG_DEEP = "rgb(7, 11, 14)"; // BRAND.bgDeep
  /** Opens `path` as the UI would (window.open) and returns the new window's page. */
  const openChild = async (path) => {
    const [child] = await Promise.all([app.waitForEvent("window"), page.evaluate((p) => window.open(p, "_blank"), path)]);
    await child.waitForLoadState("load");
    return child;
  };
  for (const [name, getPath] of [["the HTML report", () => reportPath], ["an engine page with the strictest policy (JSON)", () => "/api/runs"]]) {
    await check(`${name} opens in an app window with the Run Hound look and no bridge`, async () => {
      const path = getPath();
      assert.ok(path, "no report to open");
      const child = await openChild(path);
      try {
        assert.equal(new URL(child.url()).origin, origin);
        assert.equal(await child.evaluate(() => typeof window.runHoundDesktop), "undefined");
        assert.deepEqual(await child.evaluate(() => [typeof require, typeof process, typeof ipcRenderer, typeof electron]), ["undefined", "undefined", "undefined", "undefined"]);
        const look = await child.evaluate(() => {
          const strips = document.querySelectorAll(".desktop-titlebar");
          const strip = strips[0];
          const style = strip && getComputedStyle(strip);
          const box = strip?.getBoundingClientRect();
          const probe = document.elementFromPoint(innerWidth / 2, 10);
          const first = [...document.body.children].find((el) => el !== strip && getComputedStyle(el).position !== "fixed");
          return {
            shell: [document.documentElement.dataset.shell, document.documentElement.dataset.platform],
            count: strips.length,
            first: document.body.firstElementChild === strip,
            ariaHidden: strip?.getAttribute("aria-hidden"),
            position: style?.position,
            region: style?.getPropertyValue("-webkit-app-region"),
            height: box?.height,
            width: box?.width,
            viewport: innerWidth,
            background: style?.backgroundColor,
            atTop: probe === strip,
            contentTop: first?.getBoundingClientRect().top,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
            colorScheme: getComputedStyle(document.documentElement).colorScheme,
          };
        });
        assert.deepEqual(look.shell, ["desktop", hostPlatform]);
        assert.deepEqual([look.count, look.first, look.ariaHidden, look.position, look.region, look.height, look.atTop], [1, true, "true", "fixed", "drag", 36, true]);
        // Fixed to the viewport's edges: as wide as the page, less the vertical scrollbar's thin track.
        assert.ok(look.width <= look.viewport && look.viewport - look.width <= 16, `the strip is ${look.width} px wide in a ${look.viewport} px window`);
        assert.equal(look.background, BG_DEEP);
        assert.ok(look.contentTop >= 36, `the page's first content starts at ${look.contentTop}, under the strip`);
        assert.equal(look.scrollbarWidth, "thin");
        assert.ok(look.colorScheme.includes("dark"), look.colorScheme);
        // The window: the page colour from the first frame, a fixed 36 px overlay on Windows and Linux, the app's icon.
        const window = await app.browserWindow(child);
        assert.equal((await window.evaluate((w) => w.getBackgroundColor())).toLowerCase().replace(/^#ff(?=[0-9a-f]{6}$)/, "#"), "#0a1014");
        if (name === "the HTML report") assert.equal(look.bodyBackground, BG);
      } finally {
        await child.close();
      }
    });
  }

  await check("window.open to an engine page opens an app window without the bridge", async () => {
    const child = await openChild("/api/runs");
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
// The message about it is an in-app banner (the notices channel), never a native message box.
if (process.platform === "linux") {
  const xdg = join(scratch, "xdg");
  const cliDir = join(xdg, "run-hound");
  const desktopDir = join(xdg, "run-hound-desktop");
  const saved = `${JSON.stringify({ version: 2, enabled: true, provider: "openai", model: "gpt-launch-check" }, null, 2)}\n`;
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(join(cliDir, "ai.json"), saved);
  const imported = await launch({ RUNHOUND_CONFIG_DIR: undefined, XDG_CONFIG_HOME: xdg });
  // Record, instead of showing, any native message or error box (the old import notice was one, on ready-to-show).
  await imported.evaluate(({ dialog }) => {
    globalThis.__dialogs = [];
    for (const name of ["showMessageBox", "showMessageBoxSync", "showErrorBox"]) dialog[name] = () => { globalThis.__dialogs.push(name); return name === "showMessageBox" ? Promise.resolve({ response: 0 }) : 0; };
  });
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
    await check("the import's notice appears in the page as an info banner at the top of the view, and no native dialog opens", async () => {
      // Wait for the message itself, not only the banner: a slow machine can see the banner a moment before its text.
      await page.locator("#desktop-notices .desktop-notice").filter({ hasText: "Imported your settings from" }).waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => (document.getElementById("announcer")?.textContent ?? "") !== "", undefined, { timeout: 5_000 }).catch(() => undefined);
      const banner = await page.evaluate(() => ({
        first: document.querySelector("main#view")?.firstElementChild?.id,
        types: [...document.querySelectorAll("#desktop-notices .desktop-notice")].map((el) => el.getAttribute("data-type")),
        text: document.querySelector("#desktop-notices .desktop-notice p:not(.desktop-notice-detail):not(.desktop-notice-label)")?.textContent,
        label: document.querySelector("#desktop-notices .desktop-notice-label")?.textContent,
        announced: document.getElementById("announcer")?.textContent,
        top: document.querySelector("#desktop-notices")?.getBoundingClientRect().top,
      }));
      assert.deepEqual([banner.first, banner.types, banner.label], ["desktop-notices", ["info"], "Notice"]);
      assert.equal(banner.text, `Imported your settings from ${cliDir}.`);
      assert.equal(banner.announced, banner.text);
      assert.ok(banner.top >= 36, `the banner starts at ${banner.top}, under the title bar strip`);
      assert.deepEqual(await imported.evaluate(() => globalThis.__dialogs), []);
      assert.equal(imported.windows().length, 1);
      // The bridge hands each notice over once: the UI has taken it.
      assert.deepEqual(await page.evaluate(() => window.runHoundDesktop.notices.take()), []);
      // The source has no native message box at all; the packaged build keeps its source inside the app archive.
      if (!packaged) assert.ok(!readFileSync(join(root, "dist/main.js"), "utf8").includes("showMessageBox"), "dist/main.js still calls dialog.showMessageBox");
    });
    await check("dismissing the banner removes it", async () => {
      await page.getByRole("button", { name: "Dismiss this notice" }).click();
      assert.equal(await page.locator("#desktop-notices").count(), 0);
    });
  } finally {
    await imported.close();
  }

  // An import that fails (a settings file the user can't read) is a warning banner, and the app still starts. Not as root,
  // which reads anything.
  if (process.getuid?.() !== 0) {
    const xdg2 = join(scratch, "xdg-unreadable");
    mkdirSync(join(xdg2, "run-hound"), { recursive: true });
    writeFileSync(join(xdg2, "run-hound", "ai.json"), saved);
    chmodSync(join(xdg2, "run-hound", "ai.json"), 0o000);
    const failed = await launch({ RUNHOUND_CONFIG_DIR: undefined, XDG_CONFIG_HOME: xdg2 });
    try {
      const page = await failed.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await check("a failed import is a warning banner with its reason, and the app still starts", async () => {
        await page.locator("#desktop-notices .desktop-notice").waitFor({ timeout: 15_000 });
        const banner = await page.evaluate(() => ({
          type: document.querySelector("#desktop-notices .desktop-notice")?.getAttribute("data-type"),
          label: document.querySelector("#desktop-notices .desktop-notice-label")?.textContent,
          text: document.querySelector("#desktop-notices .desktop-notice p:not(.desktop-notice-detail)")?.textContent,
          detail: document.querySelector("#desktop-notices .desktop-notice-detail")?.textContent,
          edge: getComputedStyle(document.querySelector("#desktop-notices .desktop-notice")).borderLeftColor,
        }));
        assert.deepEqual([banner.type, banner.label], ["warning", "Warning"]);
        assert.ok(banner.text.startsWith("Run Hound could not import your settings from "), banner.text);
        assert.match(banner.detail, /EACCES/);
        assert.equal(banner.edge, "rgb(245, 182, 66)"); // BRAND.warn
        assert.ok((await page.title()).includes("Run Hound"));
      });
    } finally {
      await failed.close();
      chmodSync(join(xdg2, "run-hound", "ai.json"), 0o600);
    }
  }
}

// A start-up problem opens the branded error window, not a native error box. Here the results folder is a file, so it
// can't be made. Closing the window (its button does) ends the app with exit code 1.
{
  const blocker = join(scratch, "not-a-folder");
  writeFileSync(blocker, "a file where the results folder should be");
  const broken = await launch({ RUNHOUND_CONFIG_DIR: join(scratch, "config-broken"), RUNHOUND_RUNS_DIR: blocker });
  const proc = broken.process();
  const exited = new Promise((resolve) => proc.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    await broken.evaluate(({ dialog }) => {
      globalThis.__dialogs = [];
      dialog.showErrorBox = (...args) => void globalThis.__dialogs.push(args);
    });
    const page = await broken.firstWindow();
    await page.waitForLoadState("load");
    await check("a start-up problem opens a branded window on startup-error.html with the title, one paragraph per problem and a Quit button", async () => {
      const url = new URL(page.url());
      assert.ok(url.pathname.endsWith("/startup-error.html"), page.url());
      assert.equal(url.searchParams.get("title"), "Run Hound can't start");
      const view = await page.evaluate(() => ({
        h1: document.querySelector("h1")?.textContent,
        title: document.title,
        paragraphs: [...document.querySelectorAll("#problems p")].map((p) => p.textContent),
        button: document.querySelector("#quit")?.textContent,
        focused: document.activeElement?.id,
        bridge: typeof window.runHoundDesktop,
        node: [typeof require, typeof process],
      }));
      assert.equal(view.h1, "Run Hound can't start");
      assert.equal(view.title, "Run Hound can't start");
      assert.ok(view.paragraphs.some((text) => text.includes(blocker) && text.includes("to keep your run results")), JSON.stringify(view.paragraphs));
      assert.equal(view.button, "Quit Run Hound");
      assert.equal(view.focused, "quit");
      assert.equal(view.bridge, "undefined", "the error window has no preload");
      assert.deepEqual(view.node, ["undefined", "undefined"]);
      assert.equal(broken.windows().length, 1);
      assert.deepEqual(await broken.evaluate(() => globalThis.__dialogs), [], "a native error box opened");
    });
    await check("the start-up error window has the Run Hound look: brand colours, the 36 px drag strip, fixed 600 by 380", async () => {
      const look = await page.evaluate(() => {
        const strip = document.querySelector(".desktop-titlebar");
        const box = strip.getBoundingClientRect();
        const button = getComputedStyle(document.querySelector("#quit"));
        return {
          strip: [box.top, box.height, box.width === innerWidth, getComputedStyle(strip).getPropertyValue("-webkit-app-region"), getComputedStyle(strip).backgroundColor],
          body: getComputedStyle(document.body).backgroundColor,
          button: [button.backgroundColor, button.color],
          scrollbar: getComputedStyle(document.body).scrollbarWidth,
        };
      });
      assert.deepEqual(look.strip, [0, 36, true, "drag", "rgb(7, 11, 14)"]);
      assert.equal(look.body, "rgb(10, 16, 20)");
      assert.deepEqual(look.button, ["rgb(94, 230, 163)", "rgb(4, 21, 13)"]); // BRAND.accent on BRAND.accentInk
      assert.equal(look.scrollbar, "thin");
      const win = await broken.browserWindow(page);
      const state = await win.evaluate((w) => ({ resizable: w.isResizable(), minimizable: w.isMinimizable(), maximizable: w.isMaximizable(), size: w.getContentSize(), bg: w.getBackgroundColor() }));
      // electron.d.ts: minimizable and maximizable are "not implemented on Linux"; resizable and the size are everywhere.
      assert.deepEqual([state.resizable, state.size], [false, [600, 380]]);
      if (process.platform !== "linux") assert.deepEqual([state.minimizable, state.maximizable], [false, false]);
      assert.equal(state.bg.toLowerCase().replace(/^#ff(?=[0-9a-f]{6}$)/, "#"), "#0a1014");
    });
    await check("quitting from the error window ends the app with exit code 1", async () => {
      // Quit closes the window and ends the app, so the click may report the page as closed while it completes.
      await page.click("#quit", { noWaitAfter: true }).catch((error) => {
        if (!/closed/i.test(String(error))) throw error;
      });
      const { code, signal } = await Promise.race([exited, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("the app was still running 20 s after Quit")), 20_000))]);
      assert.deepEqual([code, signal], [1, null]);
    });
  } finally {
    await broken.close().catch(() => undefined);
  }

  // Playwright reads the app's output only once launch() returns, after the problem is logged, so this launch (once the
  // one above has quit and freed the single-instance lock) reads stderr from the first byte, then ends the app.
  await check("the start-up problem is also logged to stderr", async () => {
    const executable = packaged ?? createRequire(import.meta.url)("electron");
    const child = spawn(executable, args, { env: appEnv({ RUNHOUND_CONFIG_DIR: join(scratch, "config-broken"), RUNHOUND_RUNS_DIR: blocker }), stdio: ["ignore", "ignore", "pipe"] });
    const ended = new Promise((resolve) => child.once("exit", resolve));
    let stderr = "";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`nothing logged within 30 s:\n${stderr}`)), 30_000);
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          if (stderr.includes(blocker)) {
            clearTimeout(timer);
            resolve();
          }
        });
        void ended.then((code) => {
          clearTimeout(timer);
          reject(new Error(`the app exited (${code}) without logging the problem:\n${stderr}`));
        });
      });
    } finally {
      // The app ends on SIGTERM; SIGKILL only if it hasn't within 10 s, so this check can't hold the run up.
      child.kill();
      const forced = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await ended;
      clearTimeout(forced);
    }
    assert.match(stderr, /\[run-hound\] Run Hound can't start:\r?\n/);
  });
}

console.log(results.join("\n"));
if (results.some((line) => line.startsWith("FAIL"))) process.exit(1);
