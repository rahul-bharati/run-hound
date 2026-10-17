import { describe, expect, it, vi } from "vitest";
import { checkLatestRelease, compareVersions, createUpdateChecker, parseVersion, updateCheckDisabled, type FetchLike } from "../src/update-check.js";

const REPO = "rahul-bharati/run-hound";
const page = (tag: string): string => `https://github.com/${REPO}/releases/tag/${tag}`;

/** A fetch double that answers once with a release, or with whatever `reply` builds. */
function release(tag: string, htmlUrl = page(tag)): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: htmlUrl, name: "ignored" }) });
}

const status = (code: number): FetchLike => async () => ({ ok: code >= 200 && code < 300, status: code, json: async () => ({ message: "API rate limit exceeded" }) });

const OFFLINE = { latest: null, newer: false, url: null, error: "offline" };

describe("version comparison", () => {
  it("parses plain, v-prefixed, pre-release and build versions, and rejects the rest", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("1.2.3-rc.1+build.5")).toEqual({ major: 1, minor: 2, patch: 3, pre: ["rc", "1"] });
    for (const bad of ["", "1.2", "1.2.3.4", "01.2.3", "latest", "v", "1.2.3-", "1.2.x"]) expect(parseVersion(bad)).toBeNull();
  });

  it("orders versions by number, not by text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.6.5", "0.6.5")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.6.4", "0.6.5")).toBeLessThan(0);
  });

  it("orders pre-releases below their release and among themselves as semver says", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    // The semver.org example chain, each older than the next.
    const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(compareVersions(chain[i]!, chain[i + 1]!), `${chain[i]} < ${chain[i + 1]}`).toBeLessThan(0);
      expect(compareVersions(chain[i + 1]!, chain[i]!), `${chain[i + 1]} > ${chain[i]}`).toBeGreaterThan(0);
    }
  });

  it("ignores build metadata and returns null for a non-version", () => {
    expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
    expect(compareVersions("nope", "1.0.0")).toBeNull();
  });
});

describe("checkLatestRelease", () => {
  it("reports a newer release with its page", async () => {
    expect(await checkLatestRelease({ fetch: release("v0.7.0"), current: "0.6.5" })).toEqual({ latest: "0.7.0", current: "0.6.5", newer: true, url: page("v0.7.0") });
  });

  it("accepts a tag without the v prefix", async () => {
    expect(await checkLatestRelease({ fetch: release("0.7.0", page("0.7.0")), current: "0.6.5" })).toMatchObject({ latest: "0.7.0", newer: true });
  });

  it("is not newer when the release is the same version", async () => {
    expect(await checkLatestRelease({ fetch: release("v0.6.5"), current: "0.6.5" })).toMatchObject({ latest: "0.6.5", newer: false, url: page("v0.6.5") });
  });

  it("is not newer when the running app is ahead of the latest release", async () => {
    expect(await checkLatestRelease({ fetch: release("v0.6.5"), current: "0.7.0" })).toMatchObject({ latest: "0.6.5", newer: false });
  });

  it("orders a pre-release current version below its release, and a pre-release latest below the running release", async () => {
    expect(await checkLatestRelease({ fetch: release("v1.0.0"), current: "1.0.0-rc.1" })).toMatchObject({ newer: true });
    expect(await checkLatestRelease({ fetch: release("v1.0.0-rc.2"), current: "1.0.0-rc.1" })).toMatchObject({ newer: true });
    expect(await checkLatestRelease({ fetch: release("v1.0.0-rc.1"), current: "1.0.0" })).toMatchObject({ newer: false });
  });

  it("asks GitHub for the latest release anonymously, with only the accept and user-agent headers", async () => {
    const fetch = vi.fn<FetchLike>(release("v0.7.0"));
    await checkLatestRelease({ fetch, current: "0.6.5" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.github.com/repos/${REPO}/releases/latest`);
    expect(init.headers).toEqual({ accept: "application/vnd.github+json", "user-agent": "Run-Hound-Desktop/0.6.5" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the repository it is given, for both the request and the accepted link", async () => {
    const fetch = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ tag_name: "v2.0.0", html_url: "https://github.com/fork/rh/releases/tag/v2.0.0" }) }));
    expect(await checkLatestRelease({ fetch, current: "1.0.0", repo: "fork/rh" })).toMatchObject({ newer: true, url: "https://github.com/fork/rh/releases/tag/v2.0.0" });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.github.com/repos/fork/rh/releases/latest");
  });

  it("reports offline when the request fails", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await checkLatestRelease({ fetch, current: "0.6.5" })).toEqual({ ...OFFLINE, current: "0.6.5" });
  });

  it("gives up after the timeout, even when the fetch ignores its abort signal", async () => {
    const fetch: FetchLike = () => new Promise(() => undefined);
    const started = Date.now();
    expect(await checkLatestRelease({ fetch, current: "0.6.5", timeoutMs: 30 })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("aborts the request when it times out", async () => {
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = (_url, init) => {
      signal = init.signal;
      return new Promise(() => undefined);
    };
    await checkLatestRelease({ fetch, current: "0.6.5", timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
  });

  it("times out a body that never arrives", async () => {
    const fetch: FetchLike = async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) });
    expect(await checkLatestRelease({ fetch, current: "0.6.5", timeoutMs: 30 })).toMatchObject({ latest: null, newer: false, error: "timeout" });
  });

  it.each([403, 429])("reports a rate limit on HTTP %i", async (code) => {
    expect(await checkLatestRelease({ fetch: status(code), current: "0.6.5" })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "rate limited" });
  });

  it.each([404, 500, 503])("reports other HTTP errors (%i) without throwing", async (code) => {
    expect(await checkLatestRelease({ fetch: status(code), current: "0.6.5" })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: `HTTP ${code}` });
  });

  it("reports malformed JSON", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse("<html>not json"),
    });
    expect(await checkLatestRelease({ fetch, current: "0.6.5" })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "malformed response" });
  });

  it.each([
    ["null", null],
    ["a string", "v0.7.0"],
    ["an array", []],
    ["no tag", { html_url: page("v0.7.0") }],
    ["no link", { tag_name: "v0.7.0" }],
    ["a non-string tag", { tag_name: 7, html_url: page("v0.7.0") }],
    ["a tag that is not a version", { tag_name: "nightly", html_url: page("nightly") }],
    ["a four-part tag", { tag_name: "v0.7.0.1", html_url: page("v0.7.0.1") }],
  ])("reports a malformed body: %s", async (_name, body) => {
    const fetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => body });
    expect(await checkLatestRelease({ fetch, current: "0.6.5" })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "malformed response" });
  });

  it.each([
    ["another site", "https://example.com/rahul-bharati/run-hound/releases/tag/v0.7.0"],
    ["a look-alike host", "https://github.com.evil.example/rahul-bharati/run-hound/releases/tag/v0.7.0"],
    ["userinfo that hides the host", "https://github.com@evil.example/rahul-bharati/run-hound/releases/tag/v0.7.0"],
    ["another repository", "https://github.com/someone-else/run-hound/releases/tag/v0.7.0"],
    ["a non-release page of this repository", `https://github.com/${REPO}/issues/1`],
    ["a path that climbs out of the releases folder", `https://github.com/${REPO}/releases/../../../evil/repo/releases/tag/v0.7.0`],
    ["plain http", `http://github.com/${REPO}/releases/tag/v0.7.0`],
    ["a custom scheme", "run-hound-evil://github.com/rahul-bharati/run-hound/releases/tag/v0.7.0"],
    ["javascript:", "javascript:alert(1)"],
    ["not a URL", "releases/tag/v0.7.0"],
  ])("rejects a link to %s, and offers no update", async (_name, htmlUrl) => {
    expect(await checkLatestRelease({ fetch: release("v0.7.0", htmlUrl), current: "0.6.5" })).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "unexpected release link" });
  });

  it("gives up cleanly when the running version is not a version", async () => {
    const fetch = vi.fn<FetchLike>(release("v0.7.0"));
    expect(await checkLatestRelease({ fetch, current: "dev" })).toEqual({ latest: null, current: "dev", newer: false, url: null, error: "unrecognised current version" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never throws, even when the fetch throws synchronously", async () => {
    const fetch: FetchLike = () => {
      throw new Error("boom");
    };
    await expect(checkLatestRelease({ fetch, current: "0.6.5" })).resolves.toMatchObject({ latest: null, newer: false, url: null, error: "offline" });
  });
});

describe("createUpdateChecker", () => {
  it("makes one request however many times it is asked, and returns the same answer", async () => {
    const fetch = vi.fn<FetchLike>(release("v0.7.0"));
    const check = createUpdateChecker({ fetch, current: "0.6.5" });
    const [a, b] = await Promise.all([check(), check()]);
    const c = await check();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(c).toMatchObject({ latest: "0.7.0", newer: true });
  });

  it("makes no request until it is first asked", () => {
    const fetch = vi.fn<FetchLike>(release("v0.7.0"));
    createUpdateChecker({ fetch, current: "0.6.5" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a failure for the session instead of retrying", async () => {
    const fetch = vi.fn<FetchLike>(status(429));
    const check = createUpdateChecker({ fetch, current: "0.6.5" });
    await check();
    expect(await check()).toMatchObject({ error: "rate limited" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("makes no request at all when disabled", async () => {
    const fetch = vi.fn<FetchLike>(release("v0.7.0"));
    const check = createUpdateChecker({ fetch, current: "0.6.5", disabled: true });
    expect(await check()).toEqual({ latest: null, current: "0.6.5", newer: false, url: null, error: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("RUNHOUND_NO_UPDATE_CHECK", () => {
  it("turns the check off for 1 or true, and leaves it on otherwise", () => {
    expect(updateCheckDisabled({ RUNHOUND_NO_UPDATE_CHECK: "1" })).toBe(true);
    expect(updateCheckDisabled({ RUNHOUND_NO_UPDATE_CHECK: "true" })).toBe(true);
    expect(updateCheckDisabled({ RUNHOUND_NO_UPDATE_CHECK: " TRUE " })).toBe(true);
    for (const value of [undefined, "", "0", "false", "no"]) expect(updateCheckDisabled({ RUNHOUND_NO_UPDATE_CHECK: value })).toBe(false);
    expect(updateCheckDisabled({})).toBe(false);
  });
});
