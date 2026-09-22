import { describe, expect, it } from "vitest";
import { TargetNotAllowedError } from "./errors.js";
import { assertAllowedTarget, checkTarget, isAllowedUrl, isPrivateAddress, pinArgs } from "./safety.js";

describe("isPrivateAddress", () => {
  const privateAddresses = [
    // IPv4 loopback
    "127.0.0.1",
    "127.255.255.254",
    // RFC 1918
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    // IPv4 link-local
    "169.254.0.1",
    "169.254.255.254",
    // IPv6 loopback
    "::1",
    // RFC 4193 unique local (fc00::/7)
    "fc00::1",
    "fd12:3456:789a::1",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // IPv6 link-local (fe80::/10)
    "fe80::1",
    "febf::1",
    // IPv4-mapped IPv6 of private addresses (dotted and hex forms)
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
    "::ffff:192.168.0.10",
    "::ffff:7f00:1", // 127.0.0.1, the form WHATWG URL normalises [::ffff:127.0.0.1] to
    "::ffff:c0a8:a", // 192.168.0.10
  ];

  const publicAddresses = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "11.0.0.1",
    "9.255.255.255",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "169.253.255.255",
    "169.255.0.1",
    "100.64.0.1", // carrier-grade NAT is not in the allowed ranges
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "fe00::1", // just outside fc00::/7
    "fec0::1", // just outside fe80::/10
    "::ffff:8.8.8.8",
    "::ffff:808:808", // 8.8.8.8 in hex form
  ];

  it.each(privateAddresses)("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(publicAddresses)("%s is not private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it.each(["", "not-an-ip", "localhost", "999.1.1.1", "10.0.0"])("rejects non-address %j", (value) => {
    expect(isPrivateAddress(value)).toBe(false);
  });
});

describe("assertAllowedTarget", () => {
  /** Fake DNS: IP literals resolve to themselves, names come from the table, unknown names fail. */
  function fakeLookup(table: Record<string, string[]>) {
    const calls: string[] = [];
    const lookup = async (hostname: string): Promise<string[]> => {
      calls.push(hostname);
      const bare = hostname.replace(/^\[|\]$/g, "");
      if (/^[\d.]+$/.test(bare) || bare.includes(":")) return [bare];
      const hit = table[bare];
      if (!hit) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${bare}`), { code: "ENOTFOUND" });
      return hit;
    };
    return { lookup, calls };
  }

  const dns = {
    "localhost": ["127.0.0.1", "::1"],
    "intranet.test": ["10.0.0.5"],
    "dual.intranet.test": ["192.168.1.20", "fd00::20"],
    "public.example.test": ["93.184.216.34"],
    "mixed.example.test": ["10.0.0.5", "93.184.216.34"],
    "mixed6.example.test": ["::1", "2606:4700:4700::1111"],
    "staging.example.test": ["93.184.216.34"],
    "evil.staging.example.test": ["93.184.216.34"],
  };

  async function expectRefused(url: string, options: Parameters<typeof assertAllowedTarget>[1]) {
    const err = await assertAllowedTarget(url, options).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err, `${url} should be refused`).toBeInstanceOf(TargetNotAllowedError);
    const refused = err as TargetNotAllowedError;
    expect(refused.url).toBe(url);
    expect(refused.reason.length).toBeGreaterThan(0);
    return refused;
  }

  it.each([
    "http://localhost:3000/book",
    "http://localhost/",
    "https://localhost:8443/",
    "http://127.0.0.1:1234/form",
    "http://[::1]:8080/",
    "http://intranet.test/book",
    "https://dual.intranet.test/",
    "http://10.1.2.3/",
    "http://192.168.1.50:5173/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]:3000/",
    "http://2130706433/", // decimal form of 127.0.0.1
  ])("allows %s", async (url) => {
    const { lookup } = fakeLookup(dns);
    await expect(assertAllowedTarget(url, { lookup })).resolves.toBeUndefined();
  });

  it("always allows localhost, even when DNS would say otherwise", async () => {
    const lookup = async () => ["93.184.216.34"];
    await expect(assertAllowedTarget("http://localhost:3000/", { lookup })).resolves.toBeUndefined();
  });

  it.each([
    "http://8.8.8.8/",
    "https://1.1.1.1/",
    "http://public.example.test/book",
    "http://[2606:4700:4700::1111]/",
    "http://[::ffff:8.8.8.8]/",
    "http://134744072/", // decimal form of 8.8.8.8
    "http://localhost@8.8.8.8/", // userinfo trick: the host is 8.8.8.8
    "http://100.64.0.1/",
  ])("refuses public target %s", async (url) => {
    const { lookup } = fakeLookup(dns);
    await expectRefused(url, { lookup });
  });

  it("refuses a host that resolves to a mix of private and public addresses", async () => {
    const { lookup } = fakeLookup(dns);
    await expectRefused("http://mixed.example.test/", { lookup });
    await expectRefused("http://mixed6.example.test/", { lookup });
  });

  it("refuses when the injected lookup returns no addresses", async () => {
    await expectRefused("http://nothing.test/", { lookup: async () => [] });
  });

  it("refuses when DNS lookup fails", async () => {
    const { lookup } = fakeLookup(dns);
    await expectRefused("http://does-not-exist.test/", { lookup });
  });

  it("uses the injected lookup for hostnames", async () => {
    const { lookup, calls } = fakeLookup(dns);
    await assertAllowedTarget("http://intranet.test/book", { lookup });
    expect(calls).toContain("intranet.test");
  });

  it("allows a public host listed in allowedHosts", async () => {
    const { lookup } = fakeLookup(dns);
    await expect(
      assertAllowedTarget("https://staging.example.test/book", { lookup, allowedHosts: ["staging.example.test"] }),
    ).resolves.toBeUndefined();
  });

  it("allowedHosts is an exact hostname match, not a suffix match", async () => {
    const { lookup } = fakeLookup(dns);
    await expectRefused("https://evil.staging.example.test/", { lookup, allowedHosts: ["staging.example.test"] });
  });

  it("allowedHosts does not let other public hosts through", async () => {
    const { lookup } = fakeLookup(dns);
    await expectRefused("http://public.example.test/", { lookup, allowedHosts: ["staging.example.test"] });
  });

  it.each([
    "file:///etc/passwd",
    "ftp://localhost/",
    "ws://localhost:3000/",
    "javascript:alert(1)",
    "data:text/html,<form></form>",
    "chrome://settings",
    "about:blank",
  ])("refuses non-http(s) scheme %s", async (url) => {
    const { lookup } = fakeLookup(dns);
    await expectRefused(url, { lookup, allowedHosts: ["localhost"] });
  });

  it.each(["", "not a url", "localhost:3000", "//localhost/"])("refuses unparsable target %j", async (url) => {
    const { lookup } = fakeLookup(dns);
    await expectRefused(url, { lookup });
  });
});

describe("more address forms", () => {
  it.each([
    "http://0.0.0.0:3000/", // "this host": not loopback by the spec's ranges, refused
    "http://[::]/",
    "http://[::127.0.0.1]/", // deprecated IPv4-compatible form, not IPv4-mapped
    "http://[64:ff9b::7f00:1]/", // NAT64 of 127.0.0.1: routes to a public translator
    "http://[2002:7f00:1::1]/", // 6to4
    "http://[fe80::1%25eth0]/", // zone ids are not valid in URLs; WHATWG URL rejects this
  ])("refuses %s", async (url) => {
    await expect(assertAllowedTarget(url, { lookup: async () => ["93.184.216.34"] })).rejects.toBeInstanceOf(TargetNotAllowedError);
  });

  it.each(["http://0x7f.1:3000/", "http://0177.0.0.1/", "http://127.1/"])("normalises numeric IPv4 shorthand %s to loopback", async (url) => {
    await expect(assertAllowedTarget(url, { lookup: async () => ["93.184.216.34"] })).resolves.toBeUndefined();
  });

  it("does not let a trailing dot sneak past allowedHosts or localhost", async () => {
    const lookup = async () => ["93.184.216.34"];
    await expect(assertAllowedTarget("http://staging.example.test./", { lookup, allowedHosts: ["staging.example.test"] })).rejects.toBeInstanceOf(
      TargetNotAllowedError,
    );
  });
});

describe("checkTarget and DNS pinning", () => {
  it("reports the addresses a DNS name was approved for, marked as resolved", async () => {
    const result = await checkTarget("http://intranet.test:8080/book", { lookup: async () => ["10.0.0.5", "fd00::5"] });
    expect(result).toEqual({ host: "intranet.test", addresses: ["10.0.0.5", "fd00::5"], resolved: true });
  });

  it("does not resolve localhost, IP literals or allowed hosts", async () => {
    const lookup = async (): Promise<string[]> => {
      throw new Error("lookup must not be called");
    };
    expect((await checkTarget("http://localhost:3000/", { lookup })).resolved).toBe(false);
    expect((await checkTarget("http://127.0.0.1:3000/", { lookup })).resolved).toBe(false);
    expect((await checkTarget("http://[::1]:3000/", { lookup })).resolved).toBe(false);
    expect((await checkTarget("http://kennel:3000/", { lookup, allowedHosts: ["kennel"] })).resolved).toBe(false);
  });

  it("pins a resolved host to the first approved address, so the browser can't be rebound to another IP", () => {
    expect(pinArgs({ host: "intranet.test", addresses: ["10.0.0.5"], resolved: true })).toEqual(["--host-resolver-rules=MAP intranet.test 10.0.0.5"]);
    expect(pinArgs({ host: "v6.test", addresses: ["fd00::5"], resolved: true })).toEqual(["--host-resolver-rules=MAP v6.test [fd00::5]"]);
  });

  it("pins nothing for hosts that were not resolved through DNS", () => {
    expect(pinArgs({ host: "localhost", addresses: [], resolved: false })).toEqual([]);
    expect(pinArgs({ host: "10.0.0.5", addresses: ["10.0.0.5"], resolved: false })).toEqual([]);
  });

  it("refuses a host name that could not be written safely into a resolver rule", async () => {
    await expect(checkTarget("http://a.test,exclude/", { lookup: async () => ["10.0.0.5"] })).rejects.toBeInstanceOf(TargetNotAllowedError);
  });
});

describe("isAllowedUrl", () => {
  it("answers true/false instead of throwing", async () => {
    const lookup = async (host: string) => (host === "intranet.test" ? ["10.0.0.5"] : ["93.184.216.34"]);
    expect(await isAllowedUrl("http://intranet.test/", { lookup })).toBe(true);
    expect(await isAllowedUrl("https://www.example.test/", { lookup })).toBe(false);
    expect(await isAllowedUrl("file:///etc/passwd", { lookup })).toBe(false);
  });
});
