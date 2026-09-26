import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/keyboard-completion/variants.js";
import { startWidgetForm, widgetForm } from "../../test/fixtures/checks/keyboard-completion/widgets.js";
import { CONTACT_FIELDS, startModernApp } from "../../test/fixtures/checks/modern-apps.js";
import type { DiscoveredForm } from "../core/types.js";
import { createCheckContext } from "../engine/context.js";
import { startSchemaFormApp } from "../../test/fixtures/checks/schema-form.js";
import { check } from "./keyboard-completion.js";
import { MULTI_STEP_NOTE } from "./lib/functional-form.js";

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
  return { scenarios, results, findings: allFindings(results), server, created: app.created };
}

describe("keyboard-completion check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("keyboard-completion");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: native radio group -> form completed with the keyboard only, booking created, pass", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "keyboard-completion");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // "Pass when ... the booking is created": exactly the keyboard-driven booking reached the server.
    expect(created).toHaveLength(1);
    const booking = created[0]!;
    expect(booking.petName).toEqual(expect.any(String));
    expect(["dog", "cat", "other"]).toContain(booking.petType);
    expect(String(booking.ownerEmail)).toContain("@");
  });

  it("BAD (A03): clickable-div pet picker can't be set from the keyboard -> fail naming the pet type picker", async () => {
    const { results, findings, created } = await run(fixtures.clickableDivPicker);
    expect(overallStatus(results)).toBe("fail");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expectWellFormedFinding(f, { checkId: "keyboard-completion", category: "accessibility", confidence: "confirmed" });
    }
    const picker = findings.find((f) => /pet type/i.test(f.location ?? "") || /pet type/i.test(f.title));
    expect(picker, "a finding whose location or title names the Pet type picker").toBeDefined();
    expect(picker!.severity).toBe(bug("A03").severity);
    // Only the picker is broken; the text fields are reachable and must not be reported.
    expect(findings.some((f) => /pet name|owner email/i.test(`${f.title} ${f.location ?? ""}`))).toBe(false);
    // The keyboard user could not complete the booking.
    expect(created).toHaveLength(0);
    expect(findingText(picker!)).toMatch(/keyboard/i);
  });

  it("ADVISORY: every field is reached and set from the keyboard but the server refuses the values -> advisory, not confirmed", async () => {
    const { results, findings } = await run({
      ...fixtures.good,
      routes: { "POST /api/bookings": (_req, res) => json(res, 422, { errors: { petName: "Choose another name" } }) },
    });
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.confidence).toBe("advisory");
    expect(findings[0]!.meaning).toMatch(/the server answered 422/);
    expect(findings[0]!.meaning).toMatch(/made-up test values/);
  });
});

/** Runs the check on `url` with a form described by hand (the 0.4.0 widget contract), not by discovery. */
async function runWithForm(url: string, form: DiscoveredForm) {
  const browser = await getBrowser();
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-kb-"));
  const ctx = createCheckContext({ browser, form, targetUrl: url, artifactsDir, allowDestructive: false, runToken: "t3st" });
  try {
    const scenarios = check.plan(form);
    const results = [];
    for (const s of scenarios) results.push(await check.run(ctx, s));
    return { scenarios, results, findings: allFindings(results) };
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

describe("keyboard-completion on forms built with AI app builders (LOV-2)", () => {
  const apps: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it("GOOD: a react-hook-form + zod form with no required attributes is filled and sent with the keyboard (201)", async () => {
    const a = await startModernApp({ path: "/contact", heading: "Contact us", fields: CONTACT_FIELDS, submitLabel: "Send message", after: "toast" });
    apps.push(a);
    const { results } = await runCheck(check, a.formUrl);
    expect(allFindings(results).map((f) => f.title)).toEqual([]);
    expect(overallStatus(results), results[0]!.notes).toBe("pass");
    expect(results[0]!.notes).toMatch(/submit status 201/);
    expect(a.records).toHaveLength(1);
  });

  it("GOOD: Radix Select, RadioGroup, Checkbox and a cmdk combobox are set with the keyboard only", async () => {
    const a = await startWidgetForm();
    apps.push(a);
    const { results, findings } = await runWithForm(a.formUrl, widgetForm(a.formUrl));
    expect(findings.map((f) => `${f.title}: ${f.meaning}`), results[0]!.notes).toEqual([]);
    expect(results[0]!.status).toBe("pass");
    expect(a.saved).toHaveLength(1);
    expect(a.saved[0]).toMatchObject({ teamSize: "1-5", priority: "low", owner: "Alex Rivera", terms: true });
    // The optional switch is left as it was, as the golden path leaves it.
    expect(a.saved[0]!.notify).toBe(false);
  });

  it("GOOD: a RadioGroup that already has a choice (a default, with a bubble radio per item) is left as it is", async () => {
    const a = await startWidgetForm({ priorityDefault: "high" });
    apps.push(a);
    const { results, findings } = await runWithForm(a.formUrl, widgetForm(a.formUrl, { priorityDefault: "high" }));
    expect(findings.map((f) => `${f.title}: ${f.meaning}`), results[0]!.notes).toEqual([]);
    expect(results[0]!.status).toBe("pass");
    expect(a.saved[0]).toMatchObject({ priority: "high" });
  });

  it("GOOD: a Select that gives focus back to its trigger a moment after closing doesn't cut the Tab walk short", async () => {
    const a = await startWidgetForm({ slowFocusReturn: true });
    apps.push(a);
    const { results, findings } = await runWithForm(a.formUrl, widgetForm(a.formUrl));
    expect(findings.map((f) => `${f.title}: ${f.meaning}`), results[0]!.notes).toEqual([]);
    expect(results[0]!.status).toBe("pass");
  });

  it("BAD: a Select that opens only on click is reported as not settable with the keyboard", async () => {
    const a = await startWidgetForm({ mouseOnlySelect: true });
    apps.push(a);
    const { findings } = await runWithForm(a.formUrl, widgetForm(a.formUrl));
    const select = findings.find((f) => /Team size/.test(f.title));
    expect(select, findings.map((f) => f.title).join("; ")).toBeDefined();
    expect(select!.title).toBe('"Team size" can\'t be set with the keyboard');
    expect(a.saved).toHaveLength(0);
  });

  it("never reports the form as impossible when Tab reached none of its fields and typed nothing: skipped with a reason", async () => {
    const a = await startModernApp({
      path: "/contact",
      heading: "Contact us",
      fields: CONTACT_FIELDS,
      submitLabel: "Send message",
      after: "toast",
      // Fields the page takes out of the Tab order (and marks as nothing required): Run Hound can't type into them.
      onLoad: 'new MutationObserver(function () { document.querySelectorAll("#form input, #form textarea").forEach(function (el) { el.tabIndex = -1; }); }).observe(document.getElementById("app"), { childList: true, subtree: true });',
    });
    apps.push(a);
    const { results } = await runCheck(check, a.formUrl);
    expect(allFindings(results).map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/^Skipped: /);
    expect(a.records).toHaveLength(0);
  });

  it("LOV-12: the first step of a wizard (Continue saves nothing) is skipped as a multi-step form, with no finding", async () => {
    const a = await startModernApp({
      path: "/wizard",
      heading: "Set up your workspace",
      fields: [
        { name: "workspace", label: "Workspace name", type: "text" },
        { name: "email", label: "Invite a teammate", type: "email" },
      ],
      submitLabel: "Finish setup",
      after: "toast",
      wizard: true,
    });
    apps.push(a);
    const { results } = await runCheck(check, a.formUrl);
    expect(allFindings(results).map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toBe(MULTI_STEP_NOTE);
  });
});

describe("keyboard-completion: a refused keyboard submit names the fields that showed an error (RH-07, RH-10)", () => {
  it("says which field the form refused, so the advisory doesn't read as a keyboard problem it can't prove", async () => {
    const a = await startSchemaFormApp({ taskMinLength: 80 });
    servers.push(a);
    const { results } = await runCheck(check, a.formUrl);
    const finding = results[0]!.findings.find((f) => f.title === "Form can't be completed with the keyboard");
    expect(finding, results[0]!.notes).toBeDefined();
    expect(finding!.confidence).toBe("advisory");
    expect(finding!.meaning).toMatch(/showed an error on "Task"/);
    expect(a.posts()).toEqual([]);
  });
});
