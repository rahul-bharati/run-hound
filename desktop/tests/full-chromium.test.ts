import { afterEach, describe, expect, it } from "vitest";
import type { Browser, BrowserType, LaunchOptions } from "playwright";
import { FULL_CHROMIUM_ENV, launchChromium } from "../../app/src/engine/isolation.js";

/** Browsers a test opened; closing them removes the per-launch folders launchChromium made. */
const opened: Browser[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((browser) => browser.close()));
});
const launch = async (...args: Parameters<typeof launchChromium>): Promise<void> => void opened.push(await launchChromium(...args));

/** A launcher that records what it was asked to launch and returns a browser that does nothing. */
function recorder(): { launcher: Pick<BrowserType, "launch">; launched: LaunchOptions[] } {
  const launched: LaunchOptions[] = [];
  const browser = {
    newContext: async () => ({}),
    newPage: async () => ({}),
    close: async () => undefined,
    on: () => browser,
  } as unknown as Browser;
  return {
    launched,
    launcher: {
      launch: async (options?: LaunchOptions) => {
        launched.push(options ?? {});
        return browser;
      },
    },
  };
}

describe("headless launches under the desktop app (RUNHOUND_FULL_CHROMIUM=1)", () => {
  it("names the variable the desktop main sets", () => {
    expect(FULL_CHROMIUM_ENV).toBe("RUNHOUND_FULL_CHROMIUM");
  });

  it("launch the full Chromium, since the app does not ship Playwright's headless shell", async () => {
    const { launcher, launched } = recorder();
    await launch({ headless: true }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "1" } });
    expect(launched[0]?.channel).toBe("chromium");
    expect(launched[0]?.headless).toBe(true);
  });

  it("do the same for a headed launch (the full build is what a headed launch uses anyway)", async () => {
    const { launcher, launched } = recorder();
    await launch({ headless: false }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "1" } });
    expect(launched[0]?.channel).toBe("chromium");
  });

  it("leave a caller's own channel or executable alone", async () => {
    const { launcher, launched } = recorder();
    await launch({ channel: "chrome" }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "1" } });
    await launch({ executablePath: "/opt/chrome/chrome" }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "1" } });
    expect(launched[0]?.channel).toBe("chrome");
    expect(launched[1]?.channel).toBeUndefined();
    expect(launched[1]?.executablePath).toBe("/opt/chrome/chrome");
  });
});

describe("launches everywhere else (the command line, the Docker images)", () => {
  it("are Playwright's default: no channel, so headless uses the headless shell", async () => {
    const { launcher, launched } = recorder();
    await launch({ headless: true }, { launcher, env: {} });
    await launch({ headless: true }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "" } });
    await launch({ headless: true }, { launcher, env: { RUNHOUND_FULL_CHROMIUM: "0" } });
    for (const options of launched) expect("channel" in options).toBe(false);
  });
});
