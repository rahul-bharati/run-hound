import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredForm, FormField } from "../core/types.js";
import { discoverForm } from "./discover.js";
import { NoFormFoundError } from "./errors.js";

const root = fileURLToPath(new URL("../../test/fixtures/discover/", import.meta.url));

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer({ root });
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

async function open(file: string): Promise<Page> {
  const page = await (await getBrowser()).newPage();
  await page.goto(`${server.url}/${file}`, { waitUntil: "networkidle" });
  return page;
}

function field(form: DiscoveredForm, predicate: (f: FormField) => boolean, what: string): FormField {
  const found = form.fields.filter(predicate);
  expect(found, `expected exactly one field: ${what}`).toHaveLength(1);
  return found[0]!;
}

describe("discoverForm on a native form", () => {
  let page: Page;
  let form: DiscoveredForm;

  beforeAll(async () => {
    page = await open("native-form.html");
    form = await discoverForm(page);
  });

  afterAll(async () => {
    await page?.close();
  });

  it("describes the form itself", async () => {
    expect(form.url).toBe(`${server.url}/native-form.html`);
    expect(form.name).toBe("Book a sitter");
    expect(await page.locator(form.selector).count()).toBe(1);
    expect(await page.locator(form.selector).evaluate((el) => el.id)).toBe("booking");
  });

  it("finds each field once (radio group counts as one field)", () => {
    const keys = form.fields.map((f) => f.key).sort();
    expect(keys).toEqual(["email", "notes", "petName", "petType", "phone", "size", "startDate"]);
    expect(new Set(form.fields.map((f) => f.key)).size).toBe(form.fields.length);
  });

  it("describes labelled text inputs", () => {
    const petName = field(form, (f) => f.key === "petName", "petName");
    expect(petName.label).toBe("Pet name");
    expect(petName.accessibleName).toBe("Pet name");
    expect(petName.type).toBe("text");
    expect(petName.role).toBe("textbox");
    expect(petName.required).toBe(true);
    expect(petName.constraints?.maxLength).toBe(50);

    const email = field(form, (f) => f.key === "email", "email");
    expect(email.label).toBe("Owner email");
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
  });

  it("records native constraints", () => {
    const start = field(form, (f) => f.key === "startDate", "startDate");
    expect(start.type).toBe("date");
    expect(start.label).toBe("Start date");
    expect(start.constraints?.min).toBe("2026-01-01");
    expect(start.constraints?.max).toBe("2027-12-31");
  });

  it("reports a placeholder-only input with no label", () => {
    const phone = field(form, (f) => f.key === "phone", "phone");
    expect(phone.label).toBeNull();
    expect(phone.placeholder).toBe("Phone number");
    expect(phone.type).toBe("tel");
    expect(phone.required).toBe(false);
    // Chromium falls back to the placeholder for the accessible name; either value is acceptable.
    expect([null, "Phone number"]).toContain(phone.accessibleName);
  });

  it("reports a radio group as one field with its options", async () => {
    const petType = field(form, (f) => f.key === "petType", "petType");
    expect(petType.type).toBe("radio");
    expect(["radio", "radiogroup"]).toContain(petType.role);
    expect(petType.required).toBe(true);
    expect(petType.options?.map((o) => o.label)).toEqual(["Dog", "Cat", "Other"]);
    for (const option of petType.options!) {
      expect(await page.locator(option.selector).count(), option.selector).toBe(1);
    }
    expect(await page.locator(petType.options![1]!.selector).getAttribute("value")).toBe("cat");
  });

  it("reports a select with its options", () => {
    const size = field(form, (f) => f.key === "size", "size");
    expect(size.type).toBe("select");
    expect(size.role).toBe("combobox");
    expect(size.label).toBe("Pet size");
    expect(size.options?.map((o) => o.label)).toEqual(["Small", "Medium", "Large"]);
  });

  it("reports a textarea", () => {
    const notes = field(form, (f) => f.key === "notes", "notes");
    expect(notes.type).toBe("textarea");
    expect(notes.role).toBe("textbox");
    expect(notes.label).toBe("Special instructions");
    expect(notes.required).toBe(false);
    expect(notes.constraints?.minLength).toBe(2);
  });

  it("gives every non-radio field a selector that finds exactly that control", async () => {
    for (const f of form.fields.filter((f) => f.type !== "radio")) {
      const locator = page.locator(f.selector);
      expect(await locator.count(), `${f.key}: ${f.selector}`).toBe(1);
      expect(await locator.evaluate((el) => el.getAttribute("name")), f.key).toBe(f.key);
    }
  });

  it("lists buttons as controls and flags only the submit control", async () => {
    const submits = form.controls.filter((c) => c.isSubmit);
    expect(submits).toHaveLength(1);
    expect(submits[0]!.text).toBe("Book");
    expect(submits[0]!.accessibleName).toBe("Book");
    expect(submits[0]!.role).toBe("button");
    expect(submits[0]!.tag.toLowerCase()).toBe("button");
    expect(await page.locator(submits[0]!.selector).getAttribute("id")).toBe("book");

    const draft = form.controls.find((c) => c.text === "Save draft");
    expect(draft).toBeDefined();
    expect(draft!.isSubmit).toBe(false);

    const clear = form.controls.find((c) => c.accessibleName === "Clear pet name");
    expect(clear).toBeDefined();
    expect(clear!.isSubmit).toBe(false);
    expect(clear!.text).toBe("x");

    for (const c of form.controls) expect(await page.locator(c.selector).count(), c.selector).toBe(1);
  });
});

describe("discoverForm on a custom div picker", () => {
  let page: Page;
  let form: DiscoveredForm;

  beforeAll(async () => {
    page = await open("custom-picker.html");
    form = await discoverForm(page);
  });

  afterAll(async () => {
    await page?.close();
  });

  it("reports the picker as a custom field with generic role and its options", async () => {
    const picker = field(form, (f) => f.type === "custom", "custom picker");
    expect(picker.role).toBe("generic");
    expect(picker.options?.map((o) => o.label)).toEqual(["Dog", "Cat", "Other"]);
    expect(`${picker.label ?? ""} ${picker.accessibleName ?? ""}`).toMatch(/pet type/i);
    for (const option of picker.options!) {
      expect(await page.locator(option.selector).count(), option.selector).toBe(1);
    }
    await page.locator(picker.options![1]!.selector).click();
    expect(await page.locator(".picker").getAttribute("data-value")).toBe("cat");
  });

  it("still reports the native fields and the submit control", () => {
    expect(form.fields.some((f) => f.key === "petName" && f.type === "text")).toBe(true);
    expect(form.fields).toHaveLength(2);
    expect(form.controls.filter((c) => c.isSubmit).map((c) => c.text)).toEqual(["Book"]);
  });

  it("does not list the picker options as buttons", () => {
    expect(form.controls.some((c) => ["Dog", "Cat", "Other"].includes(c.text))).toBe(false);
  });
});

describe("discoverForm choosing a form", () => {
  it("chooses the form with the most fields", async () => {
    const page = await open("two-forms.html");
    try {
      const form = await discoverForm(page);
      expect(await page.locator(form.selector).evaluate((el) => el.id)).toBe("signup");
      expect(form.fields.map((f) => f.key).sort()).toEqual(["confirm", "email", "fullName", "password"]);
      expect(form.fields.find((f) => f.key === "password")?.type).toBe("password");
      // The autocomplete hint is recorded (it tells a sign-in form from a sign-up form); fields without one have none.
      expect(form.fields.find((f) => f.key === "password")?.autocomplete).toBe("new-password");
      expect(form.fields.filter((f) => !f.autocomplete).length).toBeGreaterThan(0);
      expect(form.controls.filter((c) => c.isSubmit).map((c) => c.text)).toEqual(["Sign up"]);
      expect(form.name).toBe("Create an account");
    } finally {
      await page.close();
    }
  });

  it("throws NoFormFoundError on a page without a form", async () => {
    const page = await open("no-form.html");
    try {
      const err = await discoverForm(page).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NoFormFoundError);
      expect((err as NoFormFoundError).url).toBe(`${server.url}/no-form.html`);
    } finally {
      await page.close();
    }
  });
});
