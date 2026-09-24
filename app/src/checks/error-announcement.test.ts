import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectUniqueIds,
  expectWellFormedFinding,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/error-announcement/variants.js";
import { check } from "./error-announcement.js";

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
  return { scenarios, results, findings: allFindings(results), created: app.created };
}

const requiredFields = [/pet name/i, /pet type/i, /owner email/i];

describe("error-announcement check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("error-announcement");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: aria-invalid + aria-describedby + polite live region -> pass, zero findings", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "error-announcement");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // The scenario submits EMPTY required fields, so nothing is created.
    expect(created).toHaveLength(0);
  });

  it("GOOD: a form that relies on the browser's own validation is not reported", async () => {
    const { results, findings, created } = await run(fixtures.nativeValidation);
    expect(findings).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
    expect(created).toHaveLength(0);
  });

  it("BAD (A05): errors are red text only -> fail, and every required field is covered", async () => {
    const { results, findings } = await run(fixtures.redTextOnly);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expectUniqueIds(findings);
    for (const f of findings) {
      expectWellFormedFinding(f, {
        checkId: "error-announcement",
        category: "accessibility",
        severity: bug("A05").severity,
        confidence: "confirmed",
      });
    }
    // Whether reported as one finding per field or one grouped finding, each required field is named.
    const text = findings.map((f) => `${f.title} ${f.location ?? ""} ${JSON.stringify(f.evidence)}`).join("\n");
    for (const field of requiredFields) expect(text).toMatch(field);
    // Optional fields were not invalid and must not be reported.
    expect(findings.some((f) => /phone|password/i.test(f.location ?? ""))).toBe(false);
  });

  it("BAD: aria-invalid set but the message is not associated or announced -> fail", async () => {
    const { results, findings } = await run(fixtures.invalidWithoutMessage);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expectWellFormedFinding(f, { checkId: "error-announcement", category: "accessibility", confidence: "confirmed" });
    }
    // Pet name keeps its hint in aria-describedby; a describedby that doesn't point at the error message is not enough.
    const text = findings.map((f) => `${f.title} ${f.location ?? ""} ${JSON.stringify(f.evidence)}`).join("\n");
    for (const field of requiredFields) expect(text).toMatch(field);
  });
});

/** Two required fields with no wrapper of their own; only the first gets a (visual-only) error message. */
const SHARED_CONTAINER = `<!doctype html><html lang="en"><head><title>Join</title></head><body><main>
<form id="join" novalidate><h1>Join the list</h1>
<label for="name">Name</label><input id="name" name="name" required>
<label for="email">Email</label><input id="email" name="email" type="email" required>
<p id="name-msg"></p>
<button type="submit">Join</button>
</form>
<script>document.getElementById("join").addEventListener("submit", (e) => { e.preventDefault(); document.getElementById("name-msg").textContent = "Enter your name"; });</script>
</main></body></html>`;

/** A required field with a valid default ("1"), next to an empty one. */
const PREFILLED = `<!doctype html><html lang="en"><head><title>RSVP</title></head><body><main>
<form id="rsvp" novalidate><h1>RSVP</h1>
<div><label for="name">Name</label><input id="name" name="name" required aria-describedby="name-error"><p id="name-error"></p></div>
<div><label for="guests">Guests</label><input id="guests" name="guests" type="number" value="1" required></div>
<button type="submit">Send</button>
</form>
<script>document.getElementById("rsvp").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("name");
  if (!name.value) { name.setAttribute("aria-invalid", "true"); document.getElementById("name-error").textContent = "Enter your name"; }
});</script>
</main></body></html>`;

describe("error-announcement on forms it was not built for", () => {
  it("never shows another field's message as a field's visible error (a container holding other fields is not its wrapper)", async () => {
    const server = await startFixtureServer({ pages: { "/join": SHARED_CONTAINER } });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/join`);
    const findings = allFindings(results);
    expect(findings).toHaveLength(1);
    const wiring = findings[0]!.evidence.find((e) => e.kind === "dom")!.data as { field: string; visibleError: string | null }[];
    const email = wiring.find((w) => /email/i.test(w.field));
    expect(email, JSON.stringify(wiring)).toBeDefined();
    expect(email!.visibleError).not.toBe("Enter your name");
  });

  it("leaves out a required field that already holds a value, and says so", async () => {
    const server = await startFixtureServer({ pages: { "/rsvp": PREFILLED } });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/rsvp`);
    expect(allFindings(results)).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
    expect(results[0]!.notes).toMatch(/Checked 1 required field.*left out "Guests", which already had a value/);
  });
});
