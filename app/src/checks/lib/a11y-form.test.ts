/**
 * fillValid / fillActions / fillAndSubmitSpec (0.4.0): the accessibility checks' "fill with valid values" goes through
 * setField, and its policy covers schema-validated forms (react-hook-form + zod): fields required by attribute or by
 * label, choices a form can't be sent without (a select or radio group with no empty choice) and consent checkboxes.
 */
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../test-support/harness.js";
import { projectFields, projectForm, startWidgetApp, type WidgetApp } from "../../../test/fixtures/widgets/widget-app.js";
import type { DiscoveredForm, FormField } from "../../core/types.js";
import { canaries, fillActions, fillAndSubmitSpec, fillValid, submitAndWait, textValueFor } from "./a11y-form.js";

const URL_ = "http://127.0.0.1:4100/projects";
const F = projectFields();

describe("fillActions: which fields get a valid value (LOV-1)", () => {
  it("required fields (by attribute or label), choices without an empty choice and consent checkboxes", () => {
    const actions = fillActions(projectForm(URL_), canaries("tok1"));
    expect(actions.map((a) => [a.field.key, a.setting])).toEqual([
      ["name", { text: "Rh tok1" }],
      ["teamSize", { option: "first" }],
      ["priority", { option: "first" }],
      ["owner", { option: "first" }],
      ["region", { option: "first" }],
      ["terms", { checked: true }],
    ]);
  });

  it("leaves optional text, switches, sliders, comboboxes and choices that offer 'None' alone", () => {
    const optionalName: FormField = { ...F.name!, required: false, requiredBy: undefined, label: "Project name", accessibleName: "Project name" };
    const withNone: FormField = { ...F.region!, options: [...F.region!.options!, { label: "None", selector: "#none" }] };
    const form: DiscoveredForm = { ...projectForm(URL_), fields: [optionalName, F.notify!, F.budget!, F.city!, withNone] };
    expect(fillActions(form, canaries("tok1"))).toEqual([]);
    // Unless they are required.
    const required = form.fields.map((f) => ({ ...f, required: true, requiredBy: "label" as const }));
    expect(fillActions({ ...form, fields: required }, canaries("tok1")).map((a) => [a.field.key, a.setting])).toEqual([
      ["name", { text: "Rh tok1" }],
      ["notify", { checked: true }],
      ["city", { option: "first" }],
      ["region", { option: "first" }],
    ]);
  });

  it("keeps the password rule: every password gets the same value when one is required, none otherwise", () => {
    const pw = (key: string, required: boolean): FormField => ({ key, accessibleName: key, label: key, placeholder: null, type: "password", role: "textbox", required, selector: `#${key}` });
    const c = canaries("tok1");
    const both = fillActions({ ...projectForm(URL_), fields: [pw("password", true), pw("confirm", false)] }, c);
    expect(both.map((a) => [a.field.key, a.setting])).toEqual([
      ["password", { text: c.password }],
      ["confirm", { text: c.password }],
    ]);
    expect(fillActions({ ...projectForm(URL_), fields: [pw("password", false)] }, c)).toEqual([]);
  });

  it("textValueFor gives no text for widgets a person doesn't type into (only an autocomplete takes text)", () => {
    const c = canaries("tok1");
    expect(textValueFor(F.teamSize!, c)).toBeNull();
    expect(textValueFor(F.budget!, c)).toBeNull();
    expect(textValueFor(F.terms!, c)).toBeNull();
    expect(textValueFor(F.city!, c)).toBe(c.text);
    expect(textValueFor(F.name!, c)).toBe(c.name);
  });
});

describe("fillAndSubmitSpec (LOV-14)", () => {
  it("sets widgets with role locators, then clicks submit", () => {
    expect(fillAndSubmitSpec(projectForm(URL_), canaries("tok1")).split("\n")).toEqual([
      `await page.getByLabel("Project name *", { exact: true }).fill("Rh tok1");`,
      `await page.getByRole("combobox", { name: "Team size", exact: true }).click();`,
      `await page.getByRole("option", { name: "1–5", exact: true }).click();`,
      `await page.getByRole("radio", { name: "low", exact: true }).check();`,
      `await page.getByRole("combobox", { name: "Owner", exact: true }).click();`,
      `await page.getByRole("option").first().click();`,
      `await page.getByLabel("Region", { exact: true }).selectOption({ label: "Europe" });`,
      `await page.getByRole("checkbox", { name: "I accept the terms", exact: true }).check();`,
      `await page.getByRole("button", { name: "Create project", exact: true }).click();`,
    ]);
  });
});

describe("fillValid on a Radix/shadcn form (LOV-1)", () => {
  let app: WidgetApp;
  let page: Page | undefined;

  beforeAll(async () => {
    app = await startWidgetApp();
  });

  afterAll(async () => {
    await page?.close();
    await app.close();
    await closeBrowser();
  });

  it("fills it so the form's rules pass and the save is answered 201", async () => {
    page = await (await getBrowser()).newPage();
    const url = `${app.url}/projects`;
    await page.goto(url, { waitUntil: "networkidle" });
    const form = projectForm(url);
    expect(await fillValid(page, form, canaries("tok1"))).toEqual([]);
    const response = await submitAndWait(page, form, { targetUrl: url, runToken: "tok1" });
    expect(response?.status()).toBe(201);
    expect(app.posts("/api/projects").at(-1)).toMatchObject({ name: "Rh tok1", teamSize: "1-5", priority: "low", owner: "Alex Rivera", region: "eu", terms: true, notify: false, city: "" });
  });
});
