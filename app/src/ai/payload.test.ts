import { describe, expect, it } from "vitest";
import type { DiscoveredForm } from "../core/types.js";
import { describePage } from "./payload.js";
import {
  FAKE_AWS_KEY,
  PAGE_URL,
  REDACTED_AWS,
  SELECTOR_MARKER,
  allStrings,
  bookingForm,
  builtInScenarios,
  control,
  discoveredPage,
  field,
  makePlan,
  newsletterForm,
  scenario,
} from "./test-fixtures.js";

describe("describePage: page URL", () => {
  it("keeps the origin for a local endpoint", () => {
    expect(describePage(makePlan(), { remote: false }).page).toBe(PAGE_URL);
  });

  it("sends only path and query to a remote endpoint", () => {
    const payload = describePage(makePlan(), { remote: true });
    expect(payload.page).toBe("/book?step=1");
    expect(JSON.stringify(payload)).not.toContain("localhost:5310");
  });
});

describe("describePage: what is never sent", () => {
  it("contains no selectors anywhere", () => {
    const json = JSON.stringify(describePage(makePlan(), { remote: false }));
    expect(json).not.toContain(SELECTOR_MARKER);
  });

  it("redacts secrets in titles, form names, labels, control names and scenario texts", () => {
    const secretForm = bookingForm({
      name: `Form ${FAKE_AWS_KEY}`,
      fields: [field({ key: "token", accessibleName: `Token ${FAKE_AWS_KEY}`, label: `Token ${FAKE_AWS_KEY}` })],
      controls: [control(`Send ${FAKE_AWS_KEY}`, { isSubmit: true })],
    });
    const plan = makePlan({
      page: discoveredPage({ title: `Title ${FAKE_AWS_KEY}`, forms: [secretForm], controls: [control(`Outside ${FAKE_AWS_KEY}`)] }),
      scenarios: [scenario({ id: "axe:1", checkId: "axe-states", title: `T ${FAKE_AWS_KEY}`, description: `D ${FAKE_AWS_KEY}` })],
    });
    const payload = describePage(plan, { remote: false });
    const json = JSON.stringify(payload);
    expect(json).not.toContain(FAKE_AWS_KEY);
    expect(payload.title).toContain(REDACTED_AWS);
    expect(payload.forms[0]!.fields[0]!.label).toContain(REDACTED_AWS);
    expect(payload.forms[0]!.controls[0]!.name).toContain(REDACTED_AWS);
    expect(payload.outsideControls[0]!.name).toContain(REDACTED_AWS);
    expect(payload.scenarios[0]!.title).toContain(REDACTED_AWS);
    expect(payload.scenarios[0]!.description).toContain(REDACTED_AWS);
  });
});

describe("describePage: limits", () => {
  it("cuts every string to 200 characters", () => {
    const long = "x".repeat(500);
    const plan = makePlan({
      page: discoveredPage({
        title: long,
        forms: [bookingForm({ name: long, fields: [field({ key: "f", accessibleName: long, label: long })], controls: [control(long)] })],
        controls: [control(long)],
      }),
      scenarios: [scenario({ id: "axe:1", checkId: "axe-states", title: long, description: long })],
    });
    const payload = describePage(plan, { remote: true });
    for (const s of allStrings(payload)) expect(s.length).toBeLessThanOrEqual(200);
    expect(payload.title!.length).toBeGreaterThan(0);
    expect(payload.scenarios[0]!.description.length).toBe(200);
  });

  it("sends at most 20 option labels per field", () => {
    const options = Array.from({ length: 30 }, (_, i) => ({ label: `Option ${i + 1}`, selector: `#${SELECTOR_MARKER}-o${i}` }));
    const plan = makePlan({ page: discoveredPage({ forms: [bookingForm({ fields: [field({ key: "pick", type: "select", role: "combobox", options })] })] }) });
    const opts = describePage(plan, { remote: false }).forms[0]!.fields[0]!.options!;
    expect(opts).toHaveLength(20);
    expect(opts[0]).toBe("Option 1");
    expect(opts[19]).toBe("Option 20");
  });

  it("sends at most 5 forms, 40 fields per form and 40 controls", () => {
    const manyFields = Array.from({ length: 50 }, (_, i) => field({ key: `f${i}` }));
    const manyControls = Array.from({ length: 50 }, (_, i) => control(`Button ${i}`));
    const forms: DiscoveredForm[] = Array.from({ length: 7 }, (_, i) => bookingForm({ index: i, name: `Form ${i}`, fields: manyFields, controls: manyControls }));
    const plan = makePlan({ page: discoveredPage({ forms, controls: manyControls }) });
    const payload = describePage(plan, { remote: false });
    expect(payload.forms).toHaveLength(5);
    expect(payload.forms[0]!.fields).toHaveLength(40);
    expect(payload.forms[0]!.controls).toHaveLength(40);
    expect(payload.forms[0]!.fields.map((f) => f.key).slice(0, 3)).toEqual(["f0", "f1", "f2"]);
    expect(payload.outsideControls.length).toBeLessThanOrEqual(40);
  });
});

describe("describePage: forms and controls", () => {
  it("describes each form's fields with key, label, type, role, required, constraints and options", () => {
    const payload = describePage(makePlan(), { remote: false });
    expect(payload.forms.map((f) => f.index)).toEqual([0, 1]);
    const main = payload.forms[0]!;
    expect(main.name).toContain("Book a sitter");
    expect(main.search).toBe(false);
    expect(main.fields.map((f) => f.key)).toEqual(["name", "date", "pet", "notes"]);
    const [name, date, pet, notes] = main.fields;
    expect(name).toMatchObject({ key: "name", label: "Your name", type: "text", role: "textbox", required: true, constraints: null, options: null });
    expect(date!.constraints).toContain("2026-01-01");
    expect(date!.constraints).toContain("2026-12-31");
    expect(pet!.options).toEqual(["Dog", "Cat", "Bird"]);
    expect(notes!.constraints).toContain("40");
    expect(payload.forms[1]!.fields.map((f) => f.key)).toEqual(["email"]);
  });

  it("numbers controls by their position in DiscoveredForm.controls and flags submit and destructive ones", () => {
    const payload = describePage(makePlan(), { remote: false });
    expect(payload.forms[0]!.controls).toEqual([
      { index: 0, name: "Add pet", role: "button", submit: false, destructive: false },
      { index: 1, name: "Delete account", role: "button", submit: false, destructive: true },
      { index: 2, name: "Book", role: "button", submit: true, destructive: false },
    ]);
    expect(payload.forms[1]!.controls).toEqual([{ index: 0, name: "Subscribe", role: "button", submit: true, destructive: false }]);
  });

  it("uses controlName for a control without an accessible name", () => {
    const plan = makePlan({ page: discoveredPage({ forms: [bookingForm({ controls: [control("x", { accessibleName: null, text: "Save draft" })] })] }) });
    expect(describePage(plan, { remote: false }).forms[0]!.controls[0]!.name).toBe("Save draft");
  });

  it("lists controls outside the forms with name, role and destructive only", () => {
    const payload = describePage(makePlan(), { remote: false });
    expect(payload.outsideControls).toEqual([
      { name: "Log out", role: "button", destructive: true },
      { name: "Toggle menu", role: "button", destructive: false },
    ]);
  });

  it("describes a page with no forms", () => {
    const plan = makePlan({ page: discoveredPage({ forms: [], controls: [control("Menu")] }) });
    const payload = describePage(plan, { remote: false });
    expect(payload.forms).toEqual([]);
    expect(payload.outsideControls).toEqual([{ name: "Menu", role: "button", destructive: false }]);
    expect(payload.title).toBe("Book a sitter");
  });

  it("describes a V0 plan (no page) from plan.form", () => {
    const plan = makePlan();
    delete plan.page;
    plan.form = newsletterForm({ index: undefined });
    const payload = describePage(plan, { remote: false });
    expect(payload.forms).toHaveLength(1);
    expect(payload.forms[0]!.index).toBe(0);
    expect(payload.forms[0]!.fields.map((f) => f.key)).toEqual(["email"]);
    expect(payload.outsideControls).toEqual([]);
  });
});

describe("describePage: scenario catalog", () => {
  it("lists the built-in scenarios in plan order with id, check, title, description, scope and destructive", () => {
    const plan = makePlan();
    const payload = describePage(plan, { remote: false });
    expect(payload.scenarios.map((s) => s.id)).toEqual(builtInScenarios().map((s) => s.id));
    expect(payload.scenarios[0]).toEqual({
      id: "axe:1",
      check: "axe-states",
      title: "Accessibility of every state",
      description: "Tests axe:1",
      scope: expect.any(String),
      destructive: false,
    });
    expect(payload.scenarios.find((s) => s.id === "persistence:1")!.destructive).toBe(true);
    expect(payload.scenarios.find((s) => s.id === "security-headers:1")!.scope).toContain("page");
  });

  it("does not mutate the plan", () => {
    const plan = makePlan();
    const before = structuredClone(plan);
    describePage(plan, { remote: true });
    expect(plan).toEqual(before);
  });
});
