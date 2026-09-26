/**
 * setField / setFieldSpec (0.4.0): the one way every check, and every exported spec, sets a field's value. Run against
 * test/fixtures/widgets/radix-form.html, which reproduces the DOM React 19 + Radix + shadcn + cmdk render: a Select
 * trigger with an aria-hidden bubble <select> and a portal listbox (modal: the page is aria-hidden and body has
 * pointer-events: none while it is open), a RadioGroup, a Slider, a Switch and a Checkbox with bubble inputs, a
 * Popover + cmdk Combobox and a Downshift-style autocomplete. The fields are the hand-written discovery result
 * (projectFields), so these tests don't depend on discovery.
 */
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../test-support/harness.js";
import { planField, projectFields, startWidgetApp, type WidgetApp } from "../../../test/fixtures/widgets/widget-app.js";
import type { FormField } from "../../core/types.js";
import { fieldKind, firstChoice, hasEmptyChoice, isConsentCheckbox, setField, setFieldSpec, showsLabel, type FieldSetting } from "./widgets.js";

let app: WidgetApp;
const pages: Page[] = [];

beforeAll(async () => {
  app = await startWidgetApp();
});

afterAll(async () => {
  await Promise.all(pages.map((p) => p.close().catch(() => undefined)));
  await app.close();
  await closeBrowser();
});

async function openProjects(): Promise<Page> {
  const page = await (await getBrowser()).newPage();
  pages.push(page);
  await page.goto(`${app.url}/projects`, { waitUntil: "networkidle" });
  return page;
}

const F = projectFields();
const attr = (page: Page, selector: string, name: string) => page.locator(selector).first().getAttribute(name);
const text = async (page: Page, selector: string) => (await page.locator(selector).first().innerText()).trim();
const value = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => (el as HTMLInputElement).value);
/** Nothing is left open: no portal listbox or popover, the page is not aria-hidden and takes pointer events. */
async function nothingOpen(page: Page) {
  expect(await page.locator("[data-radix-popper-content-wrapper]").count()).toBe(0);
  expect(await attr(page, "#root", "aria-hidden")).toBeNull();
  expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe("");
}

describe("setField: Radix Select (aria-select)", () => {
  it("sets it through its bubble <select>, and the trigger shows the choice", async () => {
    const page = await openProjects();
    await setField(page, F.teamSize!, { option: "6–20" });
    expect(await text(page, "#f-team")).toBe("6–20");
    expect(await value(page, "#f-team + select")).toBe("6-20");
    await nothingOpen(page);
  });

  it("opens the trigger and clicks the option when there is no bubble <select>", async () => {
    const page = await openProjects();
    const { nativeSelector: _, ...noBubble } = F.teamSize!;
    await setField(page, noBubble, { option: "21–50" });
    expect(await text(page, "#f-team")).toBe("21–50");
    expect(await value(page, "#f-team + select")).toBe("21-50");
    await nothingOpen(page);
  });

  it('"first" picks the first real option; the label matches whatever the case and spacing', async () => {
    const page = await openProjects();
    await setField(page, F.teamSize!, { option: "first" });
    expect(await text(page, "#f-team")).toBe("1–5");
    const { nativeSelector: _, ...noBubble } = F.teamSize!;
    await setField(page, noBubble, { option: "  6–20 " });
    expect(await text(page, "#f-team")).toBe("6–20");
  });

  it("throws a plain error naming the field for an option it doesn't have, and leaves nothing open", async () => {
    const page = await openProjects();
    const { nativeSelector: _, ...noBubble } = F.teamSize!;
    await expect(setField(page, noBubble, { option: "500+" })).rejects.toThrow(/Team size/);
    await expect(setField(page, noBubble, { option: "500+" })).rejects.toThrow(/500\+/);
    await nothingOpen(page);
    // The page still works: the next field can be set.
    await setField(page, F.name!, { text: "Apollo" });
    expect(await value(page, "#f-name")).toBe("Apollo");
  });
});

describe("setField: shadcn Combobox (Popover + cmdk) behind a button[role=combobox]", () => {
  it("opens the popover and clicks the named option", async () => {
    const page = await openProjects();
    await setField(page, F.owner!, { option: "Priya Shah" });
    expect(await text(page, "#f-owner")).toBe("Priya Shah");
    await nothingOpen(page);
  });

  it('"first" picks the first suggestion even though discovery listed no options', async () => {
    const page = await openProjects();
    await setField(page, F.owner!, { option: "first" });
    expect(await text(page, "#f-owner")).toBe("Alex Rivera");
  });

  it("throws naming the field for someone it doesn't list, after searching for them, and closes the popover", async () => {
    const page = await openProjects();
    await expect(setField(page, F.owner!, { option: "Nobody Atall" })).rejects.toThrow(/^Couldn't set Owner: it has no option "Nobody Atall"/);
    await nothingOpen(page);
    expect(await attr(page, "#f-owner", "aria-expanded")).toBe("false");
  });

  it("text on a picker means the option with that label", async () => {
    const page = await openProjects();
    await setField(page, F.owner!, { text: "Sam Lee" });
    expect(await text(page, "#f-owner")).toBe("Sam Lee");
  });

  it("picks an option shown on two lines (a name over a role) by the label discovery read, which runs the lines together", async () => {
    // Fernway's New project "Owner": each option is <span>Alex Rivera</span><span>Studio lead</span> in a column, so
    // its text is "Alex RiveraStudio lead" while the page shows "Alex Rivera Studio lead".
    const page = await (await getBrowser()).newPage();
    pages.push(page);
    await page.setContent(`<!doctype html><html lang="en"><body>
      <label for="owner">Owner</label>
      <button type="button" role="combobox" aria-expanded="false" aria-controls="owners" id="owner">Choose an owner</button>
      <div role="listbox" id="owners" hidden></div>
      <script>
        const people = [["Alex Rivera", "Studio lead"], ["Sam Okafor", "Designer"]];
        const owner = document.getElementById("owner");
        const list = document.getElementById("owners");
        for (const [name, role] of people) {
          const item = document.createElement("div");
          item.setAttribute("role", "option");
          item.style.cssText = "display:flex;flex-direction:column";
          item.innerHTML = "<span>" + name + "</span><span>" + role + "</span>";
          item.addEventListener("click", () => { owner.textContent = name; list.hidden = true; owner.setAttribute("aria-expanded", "false"); });
          list.appendChild(item);
        }
        owner.addEventListener("click", () => { list.hidden = !list.hidden; owner.setAttribute("aria-expanded", String(!list.hidden)); });
      </script></body></html>`);
    const field: FormField = {
      ...F.owner!,
      selector: "#owner",
      options: [
        { label: "Alex RiveraStudio lead", selector: "#owners > :nth-child(1)" },
        { label: "Sam OkaforDesigner", selector: "#owners > :nth-child(2)" },
      ],
    };
    await setField(page, field, { option: "Sam OkaforDesigner" });
    expect(await text(page, "#owner")).toBe("Sam Okafor");
    await setField(page, field, { option: "first" });
    expect(await text(page, "#owner")).toBe("Alex Rivera");
  });
});

describe("setField: autocomplete input (aria-combobox)", () => {
  it("types the label and clicks the matching suggestion", async () => {
    const page = await openProjects();
    await setField(page, F.city!, { option: "Porto" });
    expect(await value(page, "#f-city")).toBe("Porto");
    expect(await attr(page, "#f-city", "aria-expanded")).toBe("false");
  });

  it('"first" picks the first suggestion', async () => {
    const page = await openProjects();
    await setField(page, F.city!, { option: "first" });
    expect(await value(page, "#f-city")).toBe("Lisbon");
  });

  it("text is typed as is, and the suggestions are closed so the next field can be reached", async () => {
    const page = await openProjects();
    await setField(page, F.city!, { text: "Lis" });
    expect(await value(page, "#f-city")).toBe("Lis");
    expect(await attr(page, "#f-city", "aria-expanded")).toBe("false");
    // The suggestion list covered the Region select while it was open.
    await setField(page, F.region!, { option: "Americas" });
    expect(await value(page, "#f-region")).toBe("us");
  });
});

describe("setField: Radix Checkbox and Switch", () => {
  it("clicks until aria-checked matches, and leaves it alone when it already does", async () => {
    const page = await openProjects();
    await setField(page, F.terms!, { checked: true });
    expect(await attr(page, "#f-terms", "aria-checked")).toBe("true");
    expect(await page.locator("#f-terms + input").isChecked()).toBe(true);
    await setField(page, F.terms!, { checked: true });
    expect(await attr(page, "#f-terms", "aria-checked")).toBe("true");
    await setField(page, F.terms!, { checked: false });
    expect(await attr(page, "#f-terms", "aria-checked")).toBe("false");
  });

  it("sets a switch the same way", async () => {
    const page = await openProjects();
    await setField(page, F.notify!, { checked: true });
    expect(await attr(page, "#f-notify", "aria-checked")).toBe("true");
  });

  it('text on a checkbox reads as yes/no ("yes", "true", "on" check it; "no", "false", "off" clear it)', async () => {
    const page = await openProjects();
    await setField(page, F.terms!, { text: "yes" });
    expect(await attr(page, "#f-terms", "aria-checked")).toBe("true");
    await setField(page, F.terms!, { text: "off" });
    expect(await attr(page, "#f-terms", "aria-checked")).toBe("false");
  });
});

describe("setField: Radix RadioGroup (aria-radio)", () => {
  it("clicks the named option", async () => {
    const page = await openProjects();
    await setField(page, F.priority!, { option: "medium" });
    expect(await attr(page, "#f-p-medium", "aria-checked")).toBe("true");
    expect(await attr(page, "#f-p-low", "aria-checked")).toBe("false");
  });

  it('"first" picks the first option', async () => {
    const page = await openProjects();
    await setField(page, F.priority!, { option: "first" });
    expect(await attr(page, "#f-p-low", "aria-checked")).toBe("true");
  });

  it("throws naming the field for an option it doesn't have", async () => {
    const page = await openProjects();
    await expect(setField(page, F.priority!, { option: "urgent" })).rejects.toThrow(/Priority/);
  });

  it("sets shadcn radio cards, whose visually hidden radio sits under its label card, without waiting on the click", async () => {
    const page = await (await getBrowser()).newPage();
    pages.push(page);
    await page.goto(`${app.url}/plan`, { waitUntil: "networkidle" });
    const started = Date.now();
    await setField(page, planField(), { option: "studio" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await attr(page, "#plan-studio", "aria-checked")).toBe("true");
    expect(await attr(page, "#plan-starter", "aria-checked")).toBe("false");
  });
});

describe("setField: Radix Slider (aria-slider)", () => {
  it("moves the thumb with the keyboard to the value", async () => {
    const page = await openProjects();
    await setField(page, F.budget!, { number: 12000 });
    expect(await attr(page, "#f-budget [role=slider]", "aria-valuenow")).toBe("12000");
    expect(await text(page, "#budget-text")).toBe("$12000");
  });

  it("clamps to the slider's range, and reads a number from text", async () => {
    const page = await openProjects();
    await setField(page, F.budget!, { number: 999_999 });
    expect(await attr(page, "#f-budget [role=slider]", "aria-valuenow")).toBe("50000");
    await setField(page, F.budget!, { number: -5 });
    expect(await attr(page, "#f-budget [role=slider]", "aria-valuenow")).toBe("0");
    await setField(page, F.budget!, { text: "2500" });
    expect(await attr(page, "#f-budget [role=slider]", "aria-valuenow")).toBe("2500");
  });

  it("stops at the nearest step when the value falls between two", async () => {
    const page = await openProjects();
    await setField(page, F.budget!, { number: 12_300 });
    expect(await attr(page, "#f-budget [role=slider]", "aria-valuenow")).toBe("12500");
  });
});

describe("setField: native controls", () => {
  it("fills text, picks select options by label, and 'first' skips the empty placeholder", async () => {
    const page = await openProjects();
    await setField(page, F.name!, { text: "Apollo" });
    expect(await value(page, "#f-name")).toBe("Apollo");
    await setField(page, F.region!, { option: "Americas" });
    expect(await value(page, "#f-region")).toBe("us");
    await setField(page, F.region!, { option: "first" });
    expect(await value(page, "#f-region")).toBe("eu");
  });

  it("throws naming the field when the control is not on the page, within about 5 s", async () => {
    const page = await openProjects();
    const missing: FormField = { ...F.name!, label: "Nickname", accessibleName: "Nickname", selector: "#nope" };
    const started = Date.now();
    await expect(setField(page, missing, { text: "x" })).rejects.toThrow(/Nickname/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});

describe("setField: a whole Radix form", () => {
  it("sets every widget so the zod-style rules pass and the form saves", async () => {
    const page = await openProjects();
    await setField(page, F.name!, { text: "Apollo" });
    await setField(page, F.teamSize!, { option: "6–20" });
    await setField(page, F.priority!, { option: "high" });
    await setField(page, F.budget!, { number: 12000 });
    await setField(page, F.notify!, { checked: true });
    await setField(page, F.owner!, { option: "Jon Park" });
    await setField(page, F.city!, { option: "Oslo" });
    await setField(page, F.region!, { option: "Americas" });
    await setField(page, F.terms!, { checked: true });
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/projects"));
    await page.locator("#create").click();
    expect((await saved).status()).toBe(201);
    expect(app.posts("/api/projects").at(-1)).toEqual({
      name: "Apollo",
      teamSize: "6-20",
      priority: "high",
      budget: 12000,
      notify: true,
      owner: "Jon Park",
      city: "Oslo",
      region: "us",
      terms: true,
    });
  });
});

describe("setFieldSpec: role locators, never getByRole(\"button\") for a widget (LOV-14)", () => {
  it("a Radix Select: click the combobox, then the option", () => {
    expect(setFieldSpec(F.teamSize!, { option: "6–20" })).toEqual([
      `await page.getByRole("combobox", { name: "Team size", exact: true }).click();`,
      `await page.getByRole("option", { name: "6–20", exact: true }).click();`,
    ]);
    // "first" names the first option when discovery listed the options, else clicks the first one shown.
    expect(setFieldSpec(F.teamSize!, { option: "first" })[1]).toBe(`await page.getByRole("option", { name: "1–5", exact: true }).click();`);
    expect(setFieldSpec(F.owner!, { option: "first" })).toEqual([
      `await page.getByRole("combobox", { name: "Owner", exact: true }).click();`,
      `await page.getByRole("option").first().click();`,
    ]);
  });

  it("an autocomplete: type, then click the suggestion; plain text is only typed", () => {
    expect(setFieldSpec(F.city!, { option: "Porto" })).toEqual([
      `await page.getByRole("combobox", { name: "City", exact: true }).fill("Porto");`,
      `await page.getByRole("option", { name: "Porto", exact: true }).click();`,
    ]);
    expect(setFieldSpec(F.city!, { text: "Lis" })).toEqual([`await page.getByRole("combobox", { name: "City", exact: true }).fill("Lis");`]);
  });

  it("checkboxes and switches by role and name, checked or unchecked", () => {
    expect(setFieldSpec(F.terms!, { checked: true })).toEqual([`await page.getByRole("checkbox", { name: "I accept the terms", exact: true }).check();`]);
    expect(setFieldSpec(F.terms!, { checked: false })).toEqual([`await page.getByRole("checkbox", { name: "I accept the terms", exact: true }).uncheck();`]);
    expect(setFieldSpec(F.notify!, { checked: true })).toEqual([`await page.getByRole("switch", { name: "Notify the team", exact: true }).check();`]);
  });

  it("a radio group checks the option's radio", () => {
    expect(setFieldSpec(F.priority!, { option: "high" })).toEqual([`await page.getByRole("radio", { name: "high", exact: true }).check();`]);
    expect(setFieldSpec(F.priority!, { option: "first" })).toEqual([`await page.getByRole("radio", { name: "low", exact: true }).check();`]);
  });

  it("a slider is moved with the keyboard; one without a name falls back to its selector", () => {
    const lines = setFieldSpec(F.budget!, { number: 12000 });
    expect(lines[0]).toBe(`await page.locator("#f-budget [role=slider]").focus();`);
    expect(lines.join("\n")).toContain(`page.keyboard.press("Home")`);
    expect(lines.join("\n")).toContain(`page.keyboard.press("ArrowRight")`);
    const named: FormField = { ...F.budget!, accessibleName: "Budget" };
    expect(setFieldSpec(named, { number: 50_000 })).toEqual([
      `await page.getByRole("slider", { name: "Budget", exact: true }).focus();`,
      `await page.keyboard.press("End");`,
    ]);
  });

  it("native fields keep the locators the behaviour checks always used", () => {
    expect(setFieldSpec(F.name!, { text: "Apollo" })).toEqual([`await page.getByLabel("Project name *", { exact: true }).fill("Apollo");`]);
    expect(setFieldSpec(F.region!, { option: "Americas" })).toEqual([`await page.getByLabel("Region", { exact: true }).selectOption({ label: "Americas" });`]);
  });

  it("a widget keeps its own role when it has one: a Headless UI Listbox trigger is a real button", () => {
    const sitter: FormField = {
      key: "sitter",
      accessibleName: "Sitter",
      label: "Sitter",
      placeholder: null,
      type: "select",
      role: "button",
      required: false,
      selector: "#sitter",
      widget: "aria-select",
      options: [
        { label: "Anyone", selector: "#s1" },
        { label: "Maya", selector: "#s2" },
      ],
    };
    // "Anyone" means no preference, so "first" skips it.
    expect(setFieldSpec(sitter, { option: "first" })).toEqual([
      `await page.getByRole("button", { name: "Sitter", exact: true }).click();`,
      `await page.getByRole("option", { name: "Maya", exact: true }).click();`,
    ]);
  });

  it("no Radix widget line ever looks for a button", () => {
    const settings: [FormField, FieldSetting][] = [
      [F.teamSize!, { option: "6–20" }],
      [F.owner!, { option: "first" }],
      [F.city!, { option: "Oslo" }],
      [F.priority!, { option: "high" }],
      [F.terms!, { checked: true }],
      [F.notify!, { checked: true }],
      [F.budget!, { number: 1000 }],
    ];
    for (const [field, setting] of settings) expect(setFieldSpec(field, setting).join("\n"), field.key).not.toContain(`getByRole("button"`);
  });

  it("the exported lines really set the fields: run them against the page and the form saves", async () => {
    const page = await openProjects();
    const lines = [
      ...setFieldSpec(F.name!, { text: "Spec run" }),
      ...setFieldSpec(F.teamSize!, { option: "21–50" }),
      ...setFieldSpec(F.priority!, { option: "medium" }),
      ...setFieldSpec(F.budget!, { number: 3000 }),
      ...setFieldSpec(F.notify!, { checked: true }),
      ...setFieldSpec(F.owner!, { option: "Sam Lee" }),
      ...setFieldSpec(F.city!, { option: "London" }),
      ...setFieldSpec(F.region!, { option: "Europe" }),
      ...setFieldSpec(F.terms!, { checked: true }),
      `await page.getByRole("button", { name: "Create project", exact: true }).click();`,
      `await page.getByText("Project created").waitFor();`,
    ];
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (page: Page) => Promise<void>;
    await new AsyncFunction("page", lines.join("\n"))(page);
    expect(app.posts("/api/projects").at(-1)).toEqual({
      name: "Spec run",
      teamSize: "21-50",
      priority: "medium",
      budget: 3000,
      notify: true,
      owner: "Sam Lee",
      city: "London",
      region: "eu",
      terms: true,
    });
  });
});

describe("fill policy helpers", () => {
  it("fieldKind: widgets first, then the native type", () => {
    expect(fieldKind(F.teamSize!)).toBe("select");
    expect(fieldKind(F.owner!)).toBe("select");
    expect(fieldKind(F.city!)).toBe("combobox");
    expect(fieldKind(F.priority!)).toBe("radio");
    expect(fieldKind(F.terms!)).toBe("check");
    expect(fieldKind(F.notify!)).toBe("check");
    expect(fieldKind(F.budget!)).toBe("slider");
    expect(fieldKind(F.region!)).toBe("select");
    expect(fieldKind(F.name!)).toBe("text");
    expect(fieldKind({ ...F.name!, type: "file" })).toBe("none");
    expect(fieldKind({ ...F.name!, type: "custom", role: "generic", options: [{ label: "Dog", selector: "#dog" }] })).toBe("custom");
    expect(fieldKind({ ...F.name!, type: "custom", role: "generic" })).toBe("none");
  });

  it("isConsentCheckbox: terms, privacy and agreement boxes; never a preference", () => {
    expect(isConsentCheckbox(F.terms!)).toBe(true);
    const box = (name: string): FormField => ({ ...F.terms!, key: "c1", accessibleName: name, label: name });
    expect(isConsentCheckbox(box("I agree to the Terms of Service"))).toBe(true);
    expect(isConsentCheckbox(box("I have read the privacy policy"))).toBe(true);
    expect(isConsentCheckbox(box("I consent to being contacted"))).toBe(true);
    expect(isConsentCheckbox(box("Send me the newsletter"))).toBe(false);
    expect(isConsentCheckbox(F.notify!)).toBe(false);
    // Only checkboxes: a "Confirm password" text field is not consent.
    expect(isConsentCheckbox({ ...F.name!, label: "Confirm password", accessibleName: "Confirm password" })).toBe(false);
  });

  it("showsLabel: the label as a whole, never inside a longer value", () => {
    expect(showsLabel("1–5", "1–5")).toBe(true);
    expect(showsLabel("  Team size:  Sam   Lee ", "sam lee")).toBe(true);
    expect(showsLabel("21–50", "1–5")).toBe(false);
    expect(showsLabel("Samantha Lee", "Sam")).toBe(false);
    expect(showsLabel("Select owner", "")).toBe(false);
  });

  it("hasEmptyChoice / firstChoice: a 'None' or 'Select…' option makes the choice optional and is never picked", () => {
    expect(hasEmptyChoice(F.teamSize!)).toBe(false);
    expect(hasEmptyChoice(F.priority!)).toBe(false);
    const withNone: FormField = { ...F.region!, options: [{ label: "Select a region", selector: "#s" }, { label: "Europe", selector: "#e" }, { label: "None", selector: "#n" }] };
    expect(hasEmptyChoice(withNone)).toBe(true);
    expect(firstChoice(withNone)?.label).toBe("Europe");
    expect(firstChoice(F.teamSize!)?.label).toBe("1–5");
    expect(firstChoice(F.owner!)).toBeUndefined();
  });
});
