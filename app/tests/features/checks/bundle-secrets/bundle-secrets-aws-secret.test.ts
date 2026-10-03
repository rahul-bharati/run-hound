// bundle-secrets and a labelled AWS secret access key (0.6.1, docs/launch-spec.md "Redaction"): the new "aws-secret-key" pattern makes the check report a secret key shipped in a script as "an AWS secret access key", redacted everywhere in the results, and the exported spec tests for it with its own pattern (SPEC_PATTERNS), which matches the script that ships it.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../support/server.js";
import { bookingApp, scriptRoute } from "../../../fixtures/checks/booking-page.js";
import { allFindings } from "../../../fixtures/checks/assert-finding.js";
import { check } from "../../../../src/checks/bundle-secrets.js";

// AWS's documented example secret access key (not real).
const KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SCRIPT = `window.__AWS__ = { region: "eu-west-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "${KEY}" };\n`;

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

describe("bundle-secrets: an AWS secret access key in a loaded script", () => {
  it("is a critical finding named 'an AWS secret access key', redacted, with a spec that matches the script", async () => {
    const app = bookingApp({ head: '<script src="/assets/aws.js"></script>', routes: { "GET /assets/aws.js": scriptRoute(SCRIPT) } });
    const server = await startFixtureServer(app.options);
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/book`);
    const findings = allFindings(results);
    expect(overallStatus(results)).toBe("fail");
    const secret = findings.find((f) => f.title.includes("AWS secret access key"));
    expect(secret, JSON.stringify(findings.map((f) => f.title))).toBeDefined();
    expect(secret!.title).toBe("Secret key shipped to every visitor: an AWS secret access key");
    expect(secret!.severity).toBe("critical");
    const everything = JSON.stringify(results);
    expect(everything).not.toContain(KEY);
    for (let i = 4; i + 16 <= KEY.length; i += 4) expect(everything, `slice at ${i}`).not.toContain(KEY.slice(i, i + 16));
    const source = secret!.spec!.source;
    const pattern = /new RegExp\(("(?:[^"\\]|\\.)*")\)/.exec(source)?.[1];
    expect(pattern, "the spec tests with the kind's own pattern (SPEC_PATTERNS), not the JWT fallback").toBeDefined();
    expect(new RegExp(JSON.parse(pattern!) as string).test(SCRIPT)).toBe(true);
  });
});
