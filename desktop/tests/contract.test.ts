import { describe, expect, it } from "vitest";
import type {
  DesktopEngineReady,
  DesktopEngineHandle,
  DesktopEntry,
  DesktopIpcChannels,
  DesktopLaunchOptions,
  DesktopPlatform,
  DesktopPreloadBridge,
  DesktopVersionCheckChannel,
} from "../src/contract.js";

describe("D2 contract: launch options", () => {
  it("accepts a complete options object with every field", () => {
    const opts: DesktopLaunchOptions = {
      runsDir: "/tmp/runs",
      configDir: "/tmp/config",
      headedBrowser: true,
      port: 8123,
      onEngineReady: () => {},
      onStartupError: () => {},
    };
    expect(opts.runsDir).toBe("/tmp/runs");
    expect(opts.configDir).toBe("/tmp/config");
    expect(opts.headedBrowser).toBe(true);
    expect(opts.port).toBe(8123);
    expect(typeof opts.onEngineReady).toBe("function");
    expect(typeof opts.onStartupError).toBe("function");
  });

  it("treats every field as optional; the entry must apply defaults", () => {
    const opts: DesktopLaunchOptions = {};
    expect(opts.runsDir).toBeUndefined();
    expect(opts.configDir).toBeUndefined();
    expect(opts.headedBrowser).toBeUndefined();
    expect(opts.port).toBeUndefined();
  });
});

describe("D2 contract: engine ready info", () => {
  it("contains the loopback URL the UI loads", () => {
    const info: DesktopEngineReady = {
      url: "http://127.0.0.1:8123/",
      runsDir: "/tmp/runs",
      configDir: "/tmp/config",
      platform: "darwin",
      runHoundVersion: "0.6.5",
    };
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
    expect(info.platform).toBe("darwin");
  });

  it("documents each field as readonly; the contract is the source of truth", () => {
    // The TypeScript type marks every field as readonly. The next slice
    // may add a runtime Object.freeze if the renderer requires it; the
    // current contract leaves the runtime check to the implementation.
    const info: DesktopEngineReady = {
      url: "http://127.0.0.1:8123/",
      runsDir: "/tmp/runs",
      configDir: "/tmp/config",
      platform: "linux",
      runHoundVersion: "0.6.5",
    };
    expect(info.url).toBe("http://127.0.0.1:8123/");
    expect(info.runsDir).toBe("/tmp/runs");
    expect(info.configDir).toBe("/tmp/config");
    expect(info.platform).toBe("linux");
    expect(info.runHoundVersion).toBe("0.6.5");
  });
});

describe("D2 contract: entry and handle shapes", () => {
  it("the entry is a function returning a promise of a handle", () => {
    const entry: DesktopEntry = async () => {
      const handle: DesktopEngineHandle = {
        url: "http://127.0.0.1:8123/",
        stop: async () => {},
      };
      return handle;
    };
    expect(typeof entry).toBe("function");
    const result = entry();
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("D2 contract: IPC channel names", () => {
  it("declares the version-check request and response shapes", () => {
    const channels: DesktopIpcChannels["desktop:version:check"] = {
      request: undefined,
      response: { latest: "0.6.6", current: "0.6.5", newer: true, url: "https://github.com/rahul-bharati/run-hound/releases/tag/v0.6.6" },
    };
    expect(channels.request).toBeUndefined();
    const response: DesktopVersionCheckChannel["response"] = channels.response;
    expect(response.current).toBe("0.6.5");
    expect(typeof response.latest === "string" || response.latest === null).toBe(true);
    expect(response.newer).toBe(true);
  });

  it("a failed version check is latest null, not newer and without a link, with a short reason", () => {
    const failed: DesktopVersionCheckChannel["response"] = { latest: null, current: "0.6.5", newer: false, url: null, error: "offline" };
    expect(failed).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "offline" });
  });

  it("engine-ready channel carries a single payload", () => {
    const channel: DesktopIpcChannels["desktop:engine:ready"] = {
      payload: {
        url: "http://127.0.0.1:8123/",
        runsDir: "/tmp/runs",
        configDir: "/tmp/config",
        platform: "linux",
        runHoundVersion: "0.6.5",
      },
    };
    expect(channel.payload.platform).toBe<DesktopPlatform>("linux");
  });
});

describe("D2 contract: preload bridge surface", () => {
  it("exposes only the agreed channels, no Node integration", () => {
    const bridge: DesktopPreloadBridge = {
      version: { check: async () => ({ latest: null, current: "0.6.5", newer: false, url: null }) },
      runsDir: { open: async () => ({ ok: true }) },
      engine: { onReady: () => () => {} },
    };
    expect(typeof bridge.version.check).toBe("function");
    expect(typeof bridge.runsDir.open).toBe("function");
    expect(typeof bridge.engine.onReady).toBe("function");
    // The bridge must not include arbitrary keys; the type is a closed interface.
    expect(Object.keys(bridge).sort()).toEqual(["engine", "runsDir", "version"]);
  });
});
