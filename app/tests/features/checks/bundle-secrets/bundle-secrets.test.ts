import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { CheckResult } from "../core/types.js";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/bundle-secrets/variants.js";
import { startHangApp } from "../../test/fixtures/checks/hang-app.js";
import { check, groupSecrets } from "./bundle-secrets.js";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { scenarios, results } = await runCheck(check, `${server.url}/book`);
  return { scenarios, results, findings: allFindings(results), server };
}

/** The secret must not appear anywhere in the results: not whole, and not a long-enough slice to reuse. */
function expectRedacted(results: CheckResult[], secret: string) {
  const everything = JSON.stringify(results);
  expect(everything).not.toContain(secret);
  // Any 16-char window of the secret beyond the first 4 chars would leak most of it.
  for (let i = 4; i + 16 <= secret.length; i += 4) {
    expect(everything, `leaks secret slice at ${i}`).not.toContain(secret.slice(i, i + 16));
  }
}

describe("bundle-secrets check", () => {
  it("is registered under its id as a security check", () => {
    expect(check.id).toBe("bundle-secrets");
    expect(check.category).toBe("security");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: a Supabase anon JWT and a Stripe pk_ key are publishable -> pass, zero findings", async () => {
    const { scenarios, results, findings, server } = await run(fixtures.good);
    expectPlanShape(scenarios, "bundle-secrets");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // Sanity: the script with the keys was actually served, so the pass is meaningful.
    expect(server.requests.some((r) => r.url === "/assets/app-config.js")).toBe(true);
  });

  it("BAD (S01): LLM-provider-shaped key in a loaded script -> critical finding, value redacted", async () => {
    const { results, findings } = await run(fixtures.llmKey);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, {
      checkId: "bundle-secrets",
      category: "security",
      severity: bug("S01").severity,
      confidence: "confirmed",
    });
    // Points at the script that ships it.
    expect(findingText(f)).toContain("/assets/app-config.js");
    expectRedacted(results, fixtures.FAKE_LLM_KEY);
    // Evidence still identifies the key safely: the redacted preview starts with its first 4 chars.
    expect(JSON.stringify(f.evidence)).toContain(fixtures.FAKE_LLM_KEY.slice(0, 4));
  });

  it("BAD (S02): service_role JWT in a loaded script -> critical finding; the anon key beside it is not reported", async () => {
    const { results, findings } = await run(fixtures.serviceRoleJwt);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expectWellFormedFinding(f, {
      checkId: "bundle-secrets",
      category: "security",
      severity: bug("S02").severity,
      confidence: "confirmed",
    });
    expect(findingText(f)).toMatch(/service_role/);
    expect(findingText(f)).toContain("/assets/app-config.js");
    expectRedacted(results, fixtures.FAKE_SERVICE_ROLE_JWT);
    const [, payload, signature] = fixtures.FAKE_SERVICE_ROLE_JWT.split(".");
    expect(JSON.stringify(results)).not.toContain(payload);
    expect(JSON.stringify(results)).not.toContain(signature);
  });
});

describe("bundle-secrets does not follow redirects off the target", () => {
  it("never re-fetches a script through a redirect to another host", async () => {
    const elsewhere = await startFixtureServer({
      routes: {
        "GET /leak.js": (_req, res) => {
          res.writeHead(200, { "content-type": "text/javascript" });
          res.end(`window.k = "${fixtures.FAKE_LLM_KEY}";`);
        },
      },
    });
    servers.push(elsewhere);
    const variant: BookingVariant = {
      head: '<script src="/assets/app-config.js"></script>',
      routes: {
        "GET /assets/app-config.js": (_req, res) => {
          res.writeHead(302, { location: `${elsewhere.url}/leak.js` });
          res.end();
        },
      },
    };
    const { results, findings } = await run(variant);
    // Following the redirect would have read the key out of the other host's file and reported it.
    expect(findings).toEqual([]);
    expect(results[0]!.status).toBe("pass");
  });
});

describe("bundle-secrets excerpt and claims", () => {
  it("numbers the excerpt as the file does, without a second gutter in the text", async () => {
    const { excerptAround } = await import("./bundle-secrets.js");
    const text = ["// 1", "// 2", "// 3", "// 4", "// 5", `const key = "${fixtures.FAKE_LLM_KEY}";`, "// 7"].join("\n");
    const excerpt = excerptAround(text, text.indexOf(fixtures.FAKE_LLM_KEY), "openai-key");
    expect(excerpt.line).toBe(6);
    expect(excerpt.firstLine).toBe(2);
    expect(excerpt.lines[0]!.text).toBe("// 2");
    expect(excerpt.lines.find((l) => l.mark)!.text).toContain("[REDACTED:openai-key]");
    expect(excerpt.lines.some((l) => /│/.test(l.text))).toBe(false);
  });

  it("reads the role claim of a service_role JWT without returning any part of the token", async () => {
    const { jwtClaims } = await import("./bundle-secrets.js");
    const text = `key: "${fixtures.FAKE_SERVICE_ROLE_JWT}"`;
    const claims = jwtClaims(text, text.indexOf("eyJ"));
    expect(claims.find((c) => /role/i.test(c.label))?.value).toBe("service_role");
    const [, payload, signature] = fixtures.FAKE_SERVICE_ROLE_JWT.split(".");
    expect(JSON.stringify(claims)).not.toContain(payload);
    expect(JSON.stringify(claims)).not.toContain(signature);
    expect(jwtClaims("not a token", 0)).toEqual([]);
  });
});

describe("bundle-secrets: distinct secrets are never merged (CHK-8)", () => {
  it("groups by the key itself, not its preview: two AWS keys with the same preview are two entries", () => {
    const text = `const prod = "${fixtures.FAKE_AWS_KEY_PROD}";\nconst staging = "${fixtures.FAKE_AWS_KEY_STAGING}";`;
    const groups = groupSecrets([{ where: "http://x/app.js", url: "http://x/app.js", text }]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.preview)).toEqual(["AKIA…(20 chars)", "AKIA…(20 chars)"]);
    expect(groups.map((g) => g.excerpt.line)).toEqual([1, 2]);
    // Nothing kept in a group holds the key.
    for (const secret of [fixtures.FAKE_AWS_KEY_PROD, fixtures.FAKE_AWS_KEY_STAGING]) expect(JSON.stringify(groups)).not.toContain(secret);
  });

  it("still groups one key found in several scripts into one entry listing every script", () => {
    const groups = groupSecrets([
      { where: "http://x/a.js", url: "http://x/a.js", text: `k = "${fixtures.FAKE_AWS_KEY_PROD}"` },
      { where: "http://x/b.js", url: "http://x/b.js", text: `k = "${fixtures.FAKE_AWS_KEY_PROD}"` },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.places).toEqual(["http://x/a.js", "http://x/b.js"]);
  });

  it("BAD: a production and a staging AWS key in one script -> two critical findings, each pointing at its own line", async () => {
    const { results, findings } = await run(fixtures.twoAwsKeys);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(2);
    for (const f of findings) expectWellFormedFinding(f, { checkId: "bundle-secrets", category: "security", severity: "critical", confidence: "confirmed" });
    const lines = findings.map((f) => (f.evidence.find((e) => e.kind === "network")!.data as { line: number }).line);
    expect(new Set(lines).size).toBe(2);
    // The two findings can be told apart.
    expect(new Set(findings.map((f) => f.title)).size).toBe(2);
    expectRedacted(results, fixtures.FAKE_AWS_KEY_PROD);
    expectRedacted(results, fixtures.FAKE_AWS_KEY_STAGING);
  });

  it("BAD: one key shipped in two scripts -> one finding naming both scripts", async () => {
    const { findings } = await run(fixtures.oneKeyTwoScripts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.locations?.join(" ")).toContain("/assets/vendor.js");
  });
});

describe("bundle-secrets: a server that never answers the re-fetch of a script (ENG-1)", () => {
  it("gives up on the re-fetch after 10 seconds and scans what the browser loaded", async () => {
    const s = await startHangApp("refetch");
    servers.push(s);
    const started = Date.now();
    const { results } = await runCheck(check, `${s.url}/contact`);
    expect(Date.now() - started, "the check finished on its own").toBeLessThan(30_000);
    expect(s.hung(), "the re-fetch reached the server and was never answered").toBeGreaterThan(0);
    expect(results[0]!.status, results[0]!.notes).toBe("pass");
  }, 45_000);
});
