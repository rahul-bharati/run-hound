import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type BookingServer } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { allFindings } from "../../test/fixtures/checks/assert-finding.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan, findingText } from "../../test/fixtures/checks/_behavior/expectations.js";
import type { DiscoveredForm } from "../core/types.js";
import { check, isDestructiveControl } from "./dead-control.js";

const ID = "dead-control" as const;
const servers: BookingServer[] = [];

/**
 * Non-submit buttons, each proving a different kind of "it did something":
 * storage only, value + focus, focus only, request only, delayed DOM change, sessionStorage only, navigation.
 */
const BUTTONS = `
  <button type="button" id="saveDraft">Save draft</button>
  <button type="button" id="clearPetName" aria-label="Clear pet name">&#x2715;</button>
  <button type="button" id="skipToEmail">Skip to email</button>
  <button type="button" id="checkAvailability">Check availability</button>
  <button type="button" id="showTips" aria-expanded="false" aria-controls="tips">Show tips</button>
  <p id="tips" class="tips" hidden>Tip: add your vet's phone number.</p>
  <button type="button" id="rememberDevice">Remember this device</button>
  <button type="button" id="help">Help</button>
`;

function handlers(options: { deadSaveDraft?: boolean; deadClear?: boolean } = {}) {
  const lines = [
    'var $ = function (id) { return document.getElementById(id); };',
    // Storage only: no DOM change, no request, focus stays on the button itself.
    options.deadSaveDraft
      ? "/* Save draft has no handler */"
      : '$("saveDraft").addEventListener("click", function () { localStorage.setItem("kennel-draft", JSON.stringify({ petName: $("petName").value, savedAt: Date.now() })); });',
    // Clears the value (a property, not a DOM mutation) and moves focus to the input.
    options.deadClear
      ? "/* clear has no handler */"
      : '$("clearPetName").addEventListener("click", function () { $("petName").value = ""; $("petName").focus(); });',
    // Focus only.
    '$("skipToEmail").addEventListener("click", function () { $("email").focus(); });',
    // Request only, response ignored.
    '$("checkAvailability").addEventListener("click", function () { fetch("/api/availability?source=button"); });',
    // DOM change that lands a little later.
    '$("showTips").addEventListener("click", function () { setTimeout(function () { var open = $("tips").hidden; $("tips").hidden = !open; $("showTips").setAttribute("aria-expanded", String(open)); }, 300); });',
    // sessionStorage only.
    '$("rememberDevice").addEventListener("click", function () { sessionStorage.setItem("kennel-remember", "1"); });',
    // Navigation.
    '$("help").addEventListener("click", function () { location.href = "/help"; });',
  ];
  return lines.join("\n");
}

const HELP_PAGE = '<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><title>Help</title></head><body><h1>Help</h1></body></html>';

async function app(options: { deadSaveDraft?: boolean; deadClear?: boolean } = {}) {
  const s = await startBookingApp({ extraHtml: BUTTONS, extraScript: handlers(options) }, {}, { pages: { "/help": HELP_PAGE } });
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("dead-control: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario when the form has non-submit controls", () => {
    expectPlan(check, sampleForm(), "golden");
  });

  it("names the buttons it will click in a readable list", () => {
    const base = sampleForm();
    const submit = base.controls.find((c) => c.isSubmit)!;
    const button = (name: string) => ({ ...submit, accessibleName: name, text: name, isSubmit: false, selector: `#${name.replace(/\W/g, "")}` });
    const one = check.plan({ ...base, controls: [submit, button("Save draft")] })[0]!.description;
    expect(one).toMatch(/^Click "Save draft" and check that it causes /);
    const two = check.plan({ ...base, controls: [submit, button("Clear pet name"), button("Save draft")] })[0]!.description;
    expect(two).toMatch(/^Click "Clear pet name" and "Save draft" one at a time and check that each causes /);
  });

  it("plans nothing when the only control is the submit button", () => {
    const form: DiscoveredForm = { ...sampleForm(), controls: sampleForm().controls.filter((c) => c.isSubmit) };
    expect(check.plan(form)).toEqual([]);
  });
});

describe("dead-control: GOOD", () => {
  it("passes when every button causes a request, DOM change, navigation, storage change or focus change", async () => {
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("never activates the submit button (no booking is created)", async () => {
    const s = await app();
    await runCheck(check, s.url);
    expect(s.createRequests()).toHaveLength(0);
  });
});

describe("dead-control: BAD", () => {
  it('fails when "Save draft" has no handler (F01), and flags only that control', async () => {
    const s = await app({ deadSaveDraft: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["high", "medium"]);
    // Focus landing on the clicked button itself is not a "focus change"; the storage-only,
    // focus-only, request-only, delayed-DOM, sessionStorage and navigation buttons are all alive.
    expect(findings).toHaveLength(1);
    expect(findingText(findings[0]!)).toMatch(/Save draft/);
    for (const alive of ["Clear pet name", "Skip to email", "Check availability", "Show tips", "Remember this device", "Help"]) {
      expect(findings[0]!.title).not.toContain(alive);
      expect(findings[0]!.location ?? "").not.toContain(alive);
    }
  });

  it("names an icon-only dead control by its accessible name", async () => {
    const s = await app({ deadSaveDraft: true, deadClear: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["high", "medium"]);
    const text = findings.map(findingText).join("\n");
    expect(text).toMatch(/Save draft/);
    expect(text).toMatch(/Clear pet name/);
    // One problem, two buttons: one finding listing both (docs/v0-spec.md, "Tester release").
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toMatch(/\b2\b/);
    expect(f.locations).toHaveLength(2);
    expect(f.location).toBe(f.locations![0]);
    expect(f.locations!.join("\n")).toMatch(/Save draft/);
    expect(f.locations!.join("\n")).toMatch(/Clear pet name/);
  });
});

describe("isDestructiveControl", () => {
  const control = (text: string) => ({ accessibleName: text, text, role: "button", tag: "button", selector: "#x", isSubmit: false });
  it("treats deleting, paying and session-ending controls as destructive", () => {
    for (const name of ["Delete", "Remove booking", "Pay now", "Log out", "Logout", "Sign out", "Sign-out", "Log off", "Disconnect GitHub", "Clear all", "Empty cart", "Reset all settings", "Cancel subscription", "Cancel my booking", "Close account"]) {
      expect(isDestructiveControl(control(name)), name).toBe(true);
    }
  });
  it("leaves ordinary controls alone", () => {
    for (const name of ["Save draft", "Cancel", "Reset", "Refresh", "Show password", "Sign in", "Log in", "Menu", "Clear pet name", "Close"]) {
      expect(isDestructiveControl(control(name)), name).toBe(false);
    }
  });
});

describe("dead-control: destructive controls", () => {
  const DANGER_BUTTONS = `
    <button type="button" id="deleteAll">Delete all bookings</button>
    <button type="button" id="cancelBooking">Remove booking</button>
  `;
  const DANGER_HANDLERS = [
    'document.getElementById("deleteAll").addEventListener("click", function () { fetch("/api/bookings", { method: "DELETE" }); });',
    'document.getElementById("cancelBooking").addEventListener("click", function () { fetch("/api/bookings/1", { method: "DELETE" }); });',
  ].join("\n");

  const deletes = (s: BookingServer) => s.server.requests.filter((r) => r.method === "DELETE");

  async function dangerApp() {
    const s = await startBookingApp({ extraHtml: BUTTONS + DANGER_BUTTONS, extraScript: handlers() + "\n" + DANGER_HANDLERS });
    servers.push(s);
    return s;
  }

  it("does not activate delete/remove controls without --allow-destructive, and says so", async () => {
    const s = await dangerApp();
    const { results } = await runCheck(check, s.url);
    expect(deletes(s)).toHaveLength(0);
    expect(overallStatus(results)).toBe("pass");
    expect(results[0]!.notes ?? "").toMatch(/Delete all bookings.*(skipped|destructive)/i);
  });

  it("activates them with --allow-destructive", async () => {
    const s = await dangerApp();
    await runCheck(check, s.url, { allowDestructive: true });
    expect(deletes(s).length).toBeGreaterThanOrEqual(2);
  });

  it("never reports a skipped destructive control as dead", async () => {
    const s = await dangerApp();
    const { results } = await runCheck(check, s.url);
    expect(allFindings(results)).toEqual([]);
  });
});
