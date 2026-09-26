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
import { startSchemaFormApp, type SchemaFormOptions } from "../../test/fixtures/checks/schema-form.js";
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

describe("error-announcement on schema-validated forms that mark nothing as required (LOV-6, RH-08)", () => {
  async function schema(options: SchemaFormOptions) {
    const a = await startSchemaFormApp(options);
    servers.push(a);
    return a;
  }

  it("is planned for a form with fields and a submit button even when no field is marked required", async () => {
    const a = await schema({});
    const { scenarios } = await runCheck(check, a.formUrl);
    expect(scenarios.map((s) => s.id)).toEqual(["error-announcement:empty-submit"]);
  });

  it("GOOD: the fields the page refuses when empty are marked aria-invalid with their message: pass", async () => {
    const a = await schema({});
    const { results } = await runCheck(check, a.formUrl);
    expect(allFindings(results)).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
    expect(results[0]!.notes).toMatch(/Checked 2 required field/);
    expect(a.posts()).toEqual([]);
  });

  it("BAD (W10-style): red text only is reported for the fields the page refuses, never for the optional one", async () => {
    const a = await schema({ errors: "text" });
    const { results } = await runCheck(check, a.formUrl);
    expect(overallStatus(results)).toBe("fail");
    const findings = allFindings(results);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.locations ?? [findings[0]!.location]).toEqual(["Task", "Email"]);
    expect(JSON.stringify(findings[0])).not.toMatch(/Notes/);
  });

  it("skips with a plain reason when the page refuses nothing, and the empty form never reaches the app", async () => {
    const a = await schema({ validate: false, serverChecks: false });
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/^Skipped: /);
    expect(results[0]!.notes).toMatch(/no error/);
    expect(a.posts()).toEqual([]);
    expect(a.tasks).toEqual([]);
  });
});

/** A settings form that loads with the saved values; red text only when a field is emptied (W10-style). */
const SETTINGS = (accessible: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Profile</title><link rel="icon" href="data:,"></head><body><main>
<form id="profile" novalidate><h1>Profile</h1>
<div><label for="name">Display name</label><input id="name" name="displayName" value="Alex Rivera"><p id="name-msg" style="color:#b00020"></p></div>
<div><label for="email">Email</label><input id="email" name="email" type="email" value="alex@example.test"><p id="email-msg" style="color:#b00020"></p></div>
<button type="submit">Save changes</button>
</form>
<script>
document.getElementById("profile").addEventListener("submit", async (e) => {
  e.preventDefault();
  let bad = false;
  for (const [id, text] of [["name", "Enter a display name"], ["email", "Enter your email"]]) {
    const el = document.getElementById(id);
    if (el.value.trim()) continue;
    bad = true;
    document.getElementById(id + "-msg").textContent = text;
    ${accessible ? 'el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", id + "-msg");' : ""}
  }
  if (!bad) await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
});
</script></main></body></html>`;

describe("error-announcement on a settings form whose fields all load with values", () => {
  it("empties its text fields first, then checks the errors: pass when they are announced", async () => {
    const server = await startFixtureServer({ pages: { "/profile": SETTINGS(true) } });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/profile`);
    expect(allFindings(results)).toEqual([]);
    expect(overallStatus(results), results[0]!.notes).toBe("pass");
    expect(results[0]!.notes).toMatch(/Checked 2 required field.*emptied/);
  });

  it("reports red text only on the emptied fields", async () => {
    const server = await startFixtureServer({ pages: { "/profile": SETTINGS(false) } });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/profile`);
    const findings = allFindings(results);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.locations).toEqual(["Display name", "Email"]);
  });
});
