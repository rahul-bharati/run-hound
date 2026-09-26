/**
 * Exported spec lines (LOV-14): controls and fields are found by the role they really have, so a Radix Select trigger
 * (button[role=combobox]) or a Radix radio is never looked for as a button, and fillLines sets widgets the way
 * fillForm did (setFieldSpec).
 */
import { describe, expect, it } from "vitest";
import { projectForm } from "../../../test/fixtures/widgets/widget-app.js";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { openFormSpec } from "../../engine/open-form.js";
import { playwrightSpec } from "./a11y-common.js";
import { controlLocator, fieldLocator, fillLines, specSource } from "./functional-finding.js";
import { canaryValues } from "./functional-form.js";

describe("controlLocator (LOV-14)", () => {
  const control = (role: string, accessibleName: string | null = "Team size") => ({ role, accessibleName, selector: "#x", text: "" });

  it("keeps any role getByRole can find a control by", () => {
    expect(controlLocator(control("combobox"))).toBe(`page.getByRole("combobox", { name: "Team size", exact: true })`);
    for (const role of ["radio", "option", "menuitemcheckbox", "menuitemradio", "slider", "switch", "checkbox", "tab", "link", "menuitem", "treeitem", "spinbutton"]) {
      expect(controlLocator(control(role, "low")), role).toBe(`page.getByRole(${JSON.stringify(role)}, { name: "low", exact: true })`);
    }
  });

  it("falls back to a button for generic or unknown roles, and to the selector without a name", () => {
    expect(controlLocator(control("generic", "Save"))).toBe(`page.getByRole("button", { name: "Save", exact: true })`);
    expect(controlLocator(control("", "Save"))).toBe(`page.getByRole("button", { name: "Save", exact: true })`);
    expect(controlLocator(control("presentation", "Save"))).toBe(`page.getByRole("button", { name: "Save", exact: true })`);
    expect(controlLocator(control("combobox", null))).toBe(`page.locator("#x")`);
  });
});

describe("fieldLocator", () => {
  const form = projectForm("http://127.0.0.1:4100/projects");
  const f = (key: string) => form.fields.find((x) => x.key === key)!;

  it("finds widgets by their role and name, never as a button", () => {
    expect(fieldLocator(f("teamSize"))).toBe(`page.getByRole("combobox", { name: "Team size", exact: true })`);
    expect(fieldLocator(f("terms"))).toBe(`page.getByRole("checkbox", { name: "I accept the terms", exact: true })`);
    expect(fieldLocator(f("notify"))).toBe(`page.getByRole("switch", { name: "Notify the team", exact: true })`);
    expect(fieldLocator(f("city"))).toBe(`page.getByRole("combobox", { name: "City", exact: true })`);
    // No accessible name: its selector.
    expect(fieldLocator(f("budget"))).toBe(`page.locator("#f-budget [role=slider]")`);
  });

  it("keeps the label, role and placeholder locators for native fields", () => {
    const base: FormField = { key: "k", accessibleName: null, label: null, placeholder: null, type: "text", role: "textbox", required: false, selector: "#k" };
    expect(fieldLocator({ ...base, label: "Pet name" })).toBe(`page.getByLabel("Pet name", { exact: true })`);
    expect(fieldLocator({ ...base, accessibleName: "Pet name" })).toBe(`page.getByRole("textbox", { name: "Pet name", exact: true })`);
    expect(fieldLocator({ ...base, accessibleName: "Pet", placeholder: "Pet" })).toBe(
      `page.getByPlaceholder("Pet", { exact: true }).or(page.getByLabel("Pet", { exact: true })).first()`,
    );
    expect(fieldLocator(base)).toBe(`page.locator("#k")`);
  });
});

describe("fillLines", () => {
  it("sets a Radix form's widgets the way fillForm does, never through a button", () => {
    const values = canaryValues(projectForm("http://127.0.0.1:4100/projects"), "tok1", "keep");
    const lines = fillLines(values);
    expect(lines).toEqual([
      `await page.getByLabel("Project name *", { exact: true }).fill("name tok1keep");`,
      `await page.getByRole("combobox", { name: "Team size", exact: true }).click();`,
      `await page.getByRole("option", { name: "1–5", exact: true }).click();`,
      `await page.getByRole("radio", { name: "low", exact: true }).check();`,
      `await page.getByRole("combobox", { name: "Owner", exact: true }).click();`,
      `await page.getByRole("option").first().click();`,
      `await page.getByRole("combobox", { name: "City", exact: true }).click();`,
      `await page.getByRole("option").first().click();`,
      `await page.getByLabel("Region", { exact: true }).selectOption({ label: "Europe" });`,
      `await page.getByRole("checkbox", { name: "I accept the terms", exact: true }).check();`,
    ]);
    expect(lines.join("\n")).not.toContain(`getByRole("button"`);
  });

  it("writes the same lines as before for native forms", () => {
    const base = { accessibleName: null, placeholder: null, required: false } as const;
    const form: DiscoveredForm = {
      url: "http://127.0.0.1:4100/book",
      selector: "form",
      name: null,
      controls: [],
      fields: [
        { ...base, key: "petName", label: "Pet name", type: "text", role: "textbox", selector: "#petName" },
        { ...base, key: "petType", label: null, accessibleName: "Pet type", type: "radio", role: "radio", selector: "input[name=petType]", options: [{ label: "Dog", selector: "#dog" }, { label: "Cat", selector: "#cat" }] },
        { ...base, key: "size", label: "Size", type: "select", role: "combobox", selector: "#size", options: [{ label: "Small", selector: "#s" }] },
        { ...base, key: "sitter", label: null, accessibleName: "Sitter", type: "custom", role: "generic", selector: "#sitter", options: [{ label: "Maya", selector: "#maya" }] },
        { ...base, key: "agree", label: "I agree", type: "checkbox", role: "checkbox", selector: "#agree", required: true },
        { ...base, key: "news", label: "Newsletter", type: "checkbox", role: "checkbox", selector: "#news" },
        { ...base, key: "photo", label: "Photo", type: "file", role: "button", selector: "#photo" },
      ],
    };
    expect(fillLines(canaryValues(form, "tok1", "keep"))).toEqual([
      `await page.getByLabel("Pet name", { exact: true }).fill("name tok1keep");`,
      `await page.getByRole("radio", { name: "Dog", exact: true }).check();`,
      `await page.getByLabel("Size", { exact: true }).selectOption({ label: "Small" });`,
      `await page.getByText("Maya", { exact: true }).first().click(); // Sitter`,
      `await page.getByLabel("I agree", { exact: true }).check();`,
    ]);
  });
});

describe("exported specs of a form in a dialog (LOV-8)", () => {
  const form = projectForm("http://127.0.0.1:4100/projects");
  const inDialog: DiscoveredForm = { ...form, opener: { selector: "#new-project", name: "New project" } };

  it("open the dialog right after loading the page, the way the check did", () => {
    const lines = specSource("http://127.0.0.1:4100/projects", "saves", ["await page.keyboard.press(\"Enter\");"], inDialog).split("\n");
    const goto = lines.indexOf("  await page.goto(TARGET);");
    expect(lines.slice(goto + 1, goto + 4)).toEqual([
      `  // The form is in a dialog; open it: click "New project".`,
      `  await page.locator("#new-project").first().click();`,
      `  await page.locator(${JSON.stringify(form.selector)}).first().waitFor();`,
    ]);
    const spec = playwrightSpec("error-announcement", 1, "errors are announced", "http://127.0.0.1:4100/projects", "expect(1).toBe(1);", [], inDialog).source;
    expect(spec).toMatch(/await page\.goto\(TARGET, \{ waitUntil: "networkidle" \}\);\n {2}\/\/ The form is in a dialog; open it: click "New project"\.\n {2}await page\.locator\("#new-project"\)\.first\(\)\.click\(\);/);
  });

  it("stay as they were for a form on the page", () => {
    expect(openFormSpec(form)).toEqual([]);
    expect(specSource("http://x.test/", "t", ["x();"], form)).toBe(specSource("http://x.test/", "t", ["x();"]));
    expect(playwrightSpec("pii-leak", 1, "t", "http://x.test/", "x();", [], form)).toEqual(playwrightSpec("pii-leak", 1, "t", "http://x.test/", "x();"));
  });
});
