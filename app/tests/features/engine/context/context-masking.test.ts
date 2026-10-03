// Evidence images never show a registered account value (round-2 review, docs/v2-spec.md "Test accounts"): while a frame, screenshot or recording step is taken, text on the page that holds a registered username (any letter case) or literal secret is replaced with dots of the same length and put back right after; a page records every change of its text so the test sees what the screenshot saw; with nothing registered (signed-out runs), the page is never touched.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../support/server.js";
import { createCheckContext, type RunningCheckContext } from "../../../../src/engine/context.js";
import { emptyForm } from "../../../../src/engine/discover.js";
import { registerAccountUsernames, registerSecretLiterals } from "../../../../src/engine/redact.js";

const EMAIL = "Alice@Example.test";

let server: FixtureServer;
let dir: string;
let ctx: RunningCheckContext;
const held: (() => void)[] = [];

const PAGE = `<!doctype html><html lang="en"><head><title>Account</title></head><body>
<header><p id="who">Signed in as alice@example.test</p><p id="token">Token sess-9f8e7d6c5b4a</p>
<input id="email" aria-label="Email" value="ALICE@EXAMPLE.TEST"></header>
<main><h1>Your account</h1><p id="other">Nothing to hide here.</p></main>
<script>
window.__seen = [];
new MutationObserver(function () {
  window.__seen.push(document.getElementById("who").textContent + " | " + document.getElementById("token").textContent);
}).observe(document.body, { subtree: true, characterData: true, childList: true });
</script></body></html>`;

beforeAll(async () => {
  server = await startFixtureServer({ pages: { "/": PAGE } });
});
afterAll(async () => {
  await server?.close();
  await closeBrowser();
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rh-context-masking-"));
  ctx = createCheckContext({ browser: await getBrowser(), form: emptyForm(`${server.url}/`), targetUrl: `${server.url}/`, artifactsDir: dir, runToken: "t3st" });
});
afterEach(async () => {
  for (const unregister of held.splice(0)) unregister();
  await ctx.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function seen(page: Page): Promise<string[]> {
  return (await page.evaluate("window.__seen")) as string[];
}

describe("evidence images while account values are registered", () => {
  it("frames, screenshots and recordings are taken with the username and session values hidden, then the page is put back", async () => {
    held.push(registerAccountUsernames([EMAIL]), registerSecretLiterals(["sess-9f8e7d6c5b4a"]));
    const { page } = await ctx.openPage();

    for (const take of [
      () => ctx.capture(page, "Frame"),
      () => ctx.screenshot(page, "Shot"),
      async () => {
        const rec = ctx.record(page, "Gif");
        await rec.step("one");
        return rec.finish();
      },
    ]) {
      await page.evaluate("window.__seen = []");
      await take();
      const changes = await seen(page);
      // What the image saw: dots where the email and the token were.
      expect(changes.some((c) => !/alice@example\.test/i.test(c) && !c.includes("sess-9f8e7d6c5b4a")), JSON.stringify(changes)).toBe(true);
      // And the page is as it was.
      expect(await page.locator("#who").textContent()).toBe("Signed in as alice@example.test");
      expect(await page.locator("#token").textContent()).toBe("Token sess-9f8e7d6c5b4a");
      expect(await page.locator("#email").inputValue()).toBe("ALICE@EXAMPLE.TEST");
    }
  });

  it("hides a username typed in a field while the image is taken", async () => {
    held.push(registerAccountUsernames([EMAIL]));
    const { page } = await ctx.openPage();
    await page.evaluate(`(() => {
      const el = document.getElementById("email");
      window.__values = [];
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      Object.defineProperty(el, "value", { get() { return proto.get.call(this); }, set(v) { window.__values.push(v); proto.set.call(this, v); } });
    })()`);
    await ctx.capture(page, "Frame");
    const values = (await page.evaluate("window.__values")) as string[];
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values[0]).not.toMatch(/alice/i);
    expect(values.at(-1)).toBe("ALICE@EXAMPLE.TEST");
  });

  it("never hands a registered value the page does not itself show (a password) to the page's own scripts", async () => {
    // The token is shown on the page; the password is not. Both are registered as secrets.
    const PASSWORD = "topsecretpw-h7q2";
    held.push(registerAccountUsernames([EMAIL]), registerSecretLiterals(["sess-9f8e7d6c5b4a", PASSWORD]));
    const { page } = await ctx.openPage();
    // The page pre-hooks the RegExp constructor (which the mask builds from its needles) to capture the password.
    await page.evaluate(`(() => {
      window.__captured = [];
      const rawIndexOf = String.prototype.indexOf;
      const note = (v) => { try { if (typeof v === "string" && rawIndexOf.call(v, ${JSON.stringify(PASSWORD)}) >= 0) window.__captured.push(v); } catch (e) {} };
      const RealRegExp = window.RegExp;
      window.RegExp = function () { for (let i = 0; i < arguments.length; i++) note(arguments[i]); return new RealRegExp(...arguments); };
    })()`);
    await page.evaluate("window.__seen = []");
    await ctx.screenshot(page, "Shot");
    // The password, which the page never displays, is never passed to a page-world built-in.
    expect(await page.evaluate("window.__captured")).toEqual([]);
    // A value the page does display is still masked (so the mask really ran, only without the absent secret).
    const changes = (await seen(page)) as string[];
    expect(changes.some((c) => !c.includes("sess-9f8e7d6c5b4a")), JSON.stringify(changes)).toBe(true);
    expect(await page.locator("#token").textContent()).toBe("Token sess-9f8e7d6c5b4a");
  });

  it("with nothing registered, the page is never touched", async () => {
    const { page } = await ctx.openPage();
    await page.evaluate("window.__seen = []");
    await ctx.capture(page, "Frame");
    await ctx.screenshot(page, "Shot");
    expect(await seen(page)).toEqual([]);
  });
});
