/**
 * 0.4.0: discovery of non-native widgets (Radix/shadcn, Headless UI, cmdk) as fields (LOV-1), and fields that only
 * their label marks as required (LOV-6).
 */
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredForm, DiscoveredPage, FormField } from "../core/types.js";
import { discoverForm, discoverPage } from "./discover.js";

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

function field(form: DiscoveredForm, key: string): FormField {
  const found = form.fields.filter((f) => f.key === key);
  expect(found, `expected exactly one field "${key}" in ${JSON.stringify(form.fields.map((f) => f.key))}`).toHaveLength(1);
  return found[0]!;
}

/** What the element a selector finds is: tag, role and type, e.g. "button[role=combobox]" or "select". */
async function what(page: Page, selector: string): Promise<string> {
  expect(await page.locator(selector).count(), selector).toBe(1);
  return page.locator(selector).evaluate((el) => {
    const role = el.getAttribute("role");
    const type = el.tagName === "INPUT" ? `[type=${(el as HTMLInputElement).type}]` : "";
    return `${el.tagName.toLowerCase()}${type}${role ? `[role=${role}]` : ""}`;
  });
}

describe("discovery of Radix/shadcn widgets (LOV-1)", () => {
  let page: Page;
  let found: DiscoveredPage;
  let form: DiscoveredForm;

  beforeAll(async () => {
    page = await open("radix-widgets.html");
    found = await discoverPage(page);
    form = found.forms[0]!;
  });

  afterAll(async () => {
    await page?.close();
  });

  it("reports every widget once, in document order, and never a bubble input as a field of its own", () => {
    expect(found.forms).toHaveLength(1);
    expect(form.name).toBe("New project");
    expect(form.fields.map((f) => [f.key, f.type, f.widget ?? null])).toEqual([
      ["name", "text", null],
      ["teamSize", "select", "aria-select"],
      ["priority", "radio", "aria-radio"],
      ["budget", "range", "aria-slider"],
      ["notifyTheTeam", "checkbox", "aria-switch"],
      ["iAcceptTheTerms", "checkbox", "aria-checkbox"],
      ["owner", "select", "aria-select"],
    ]);
  });

  it("describes a Radix Select by its visible trigger, with the bubble select and its options", async () => {
    const team = field(form, "teamSize");
    expect(await what(page, team.selector)).toBe("button[role=combobox]");
    expect(team.role).toBe("combobox");
    expect(team.label).toBe("Team size (required)");
    expect(team.accessibleName).toMatch(/^Team size/);
    expect(team.placeholder).toBe("Select team size");
    expect(await what(page, team.nativeSelector!)).toBe("select");
    expect(team.options?.map((o) => o.label)).toEqual(["1–5", "6–20", "21–50"]);
    // The bubble select is what the widget reads its value from: choosing through it updates the trigger.
    await page.locator(team.nativeSelector!).selectOption({ label: "6–20" });
    expect(await page.locator(team.selector).innerText()).toBe("6–20");
  });

  it("describes a Radix RadioGroup as one field whose options are the visible radios", async () => {
    const priority = field(form, "priority");
    expect(await what(page, priority.selector)).toBe("div[role=radiogroup]");
    expect(priority.role).toBe("radiogroup");
    expect(priority.label).toBe("Priority");
    expect(priority.options?.map((o) => o.label)).toEqual(["low", "medium", "high"]);
    for (const o of priority.options!) expect(await what(page, o.selector)).toBe("button[role=radio]");
    // One selector for the group's bubble radios, in option order.
    expect(await page.locator(priority.nativeSelector!).count()).toBe(3);
    expect(await page.locator(priority.nativeSelector!).nth(1).getAttribute("value")).toBe("medium");
  });

  it("describes a slider by its thumb, with its range", async () => {
    const budget = field(form, "budget");
    expect(await what(page, budget.selector)).toBe("span[role=slider]");
    expect(budget.role).toBe("slider");
    expect(budget.label).toBe("Budget");
    expect(budget.constraints).toEqual({ min: "0", max: "50000" });
    expect(budget.nativeSelector).toBeUndefined();
  });

  it("describes a Radix Switch and Checkbox by their buttons, with the bubble checkbox", async () => {
    const notify = field(form, "notifyTheTeam");
    expect(await what(page, notify.selector)).toBe("button[role=switch]");
    expect(notify.role).toBe("switch");
    expect(notify.label).toBe("Notify the team");
    expect(await what(page, notify.nativeSelector!)).toBe("input[type=checkbox]");
    expect(notify.required).toBe(false);

    const terms = field(form, "iAcceptTheTerms");
    expect(await what(page, terms.selector)).toBe("button[role=checkbox]");
    expect(terms.accessibleName).toBe("I accept the terms");
    expect(await what(page, terms.nativeSelector!)).toBe("input[type=checkbox]");
    expect([terms.required, terms.requiredBy]).toEqual([true, "attribute"]);
  });

  it("reads the options of a combobox without a bubble (cmdk in a popover) by opening it, and closes it again", async () => {
    const owner = field(form, "owner");
    expect(await what(page, owner.selector)).toBe("button[role=combobox]");
    expect(owner.nativeSelector).toBeUndefined();
    expect(owner.options?.map((o) => o.label)).toEqual(["Alex Rivera", "Sam Lee", "Priya Shah"]);
    expect(await page.locator("[role=option]").count()).toBe(0);
    expect(await page.locator(owner.selector).getAttribute("aria-expanded")).toBe("false");
    // Team size has its options in the bubble select: discovery never opened it.
    expect(await page.evaluate("window.teamOpened || 0")).toBe(0);
  });

  it("lists only the submit button as a control: widgets are fields, not buttons", () => {
    expect(form.controls.map((c) => [c.text, c.isSubmit])).toEqual([["Create project", true]]);
    expect(found.controls.map((c) => c.text)).toEqual(["Switch to dark theme"]);
  });

  it("finds a form made only of widgets", async () => {
    const p = await open("radix-widgets.html");
    try {
      await p.evaluate(() => document.querySelector("input[name=name]")!.parentElement!.remove());
      const only = await discoverForm(p);
      expect(only.fields.map((f) => f.key)).toEqual(["teamSize", "priority", "budget", "notifyTheTeam", "iAcceptTheTerms", "owner"]);
    } finally {
      await p.close();
    }
  });
});

describe("discovery of Headless UI style widgets (LOV-1)", () => {
  let page: Page;
  let form: DiscoveredForm;

  beforeAll(async () => {
    page = await open("headless-widgets.html");
    form = await discoverForm(page);
  });

  afterAll(async () => {
    await page?.close();
  });

  it("reports the listbox button, input combobox, div radios and switch as widgets, and no hidden input", () => {
    expect(form.fields.map((f) => [f.key, f.type, f.widget ?? null])).toEqual([
      ["pet", "text", null],
      ["sitter", "select", "aria-select"],
      ["city", "text", "aria-combobox"],
      ["visitLength", "radio", "aria-radio"],
      ["petSize", "radio", "aria-radio"],
      ["sendReminders", "checkbox", "aria-switch"],
    ]);
    // The div radios used to look like a custom picker; they are one radio field now, not also a custom one.
    expect(form.fields.some((f) => f.type === "custom")).toBe(false);
  });

  it("groups radios without a radiogroup by their container, labelled by the text before it, with no borrowed accessible name", async () => {
    const sizes = form.fields.find((f) => f.key === "petSize")!;
    expect(sizes.label).toBe("Pet size");
    expect(sizes.options?.map((o) => o.label)).toEqual(["Small", "Large"]);
    expect(await page.locator(sizes.selector).getAttribute("class")).toBe("sizes");
    expect(sizes.accessibleName).toBeNull();
  });

  it("names the widgets from their labels and reads the listbox options by opening it", async () => {
    const sitter = field(form, "sitter");
    expect(sitter.label).toBe("Sitter");
    expect(sitter.role).toBe("button");
    expect(sitter.nativeSelector).toBeUndefined();
    expect(sitter.options?.map((o) => o.label)).toEqual(["Anyone", "Maya", "Theo"]);
    expect(await page.locator("#sitters").count()).toBe(0);

    const length = field(form, "visitLength");
    expect(length.accessibleName).toBe("Visit length");
    expect(length.options?.map((o) => o.label)).toEqual(["30 min", "1 hour"]);
    expect(await what(page, length.options![1]!.selector)).toBe("div[role=radio]");

    expect(field(form, "sendReminders").accessibleName).toBe("Send reminders");
    expect(field(form, "city").role).toBe("combobox");
    expect(form.controls.map((c) => c.text)).toEqual(["Book"]);
  });
});

describe("required fields marked only by their label (LOV-6)", () => {
  let form: DiscoveredForm;

  beforeAll(async () => {
    const page = await open("required-labels.html");
    try {
      form = await discoverForm(page);
    } finally {
      await page.close();
    }
  });

  it("marks a field required by its label with requiredBy \"label\"", () => {
    const required = (key: string) => {
      const f = field(form, key);
      return [f.required, f.requiredBy ?? null];
    };
    expect(required("fullName")).toEqual([true, "label"]);
    // The asterisk is aria-hidden, so it is not part of the label text; it still marks the field.
    expect(required("email")).toEqual([true, "label"]);
    expect(field(form, "email").label).toBe("Work email");
    expect(required("phone")).toEqual([true, "label"]);
    expect(required("team")).toEqual([true, "label"]);
    expect(required("plan")).toEqual([true, "label"]);
  });

  it("keeps requiredBy \"attribute\" for native required, and leaves optional fields alone", () => {
    const f = (key: string) => [field(form, key).required, field(form, key).requiredBy ?? null];
    expect(f("website")).toEqual([true, "attribute"]);
    expect(f("company")).toEqual([false, null]);
    expect(f("referral")).toEqual([false, null]);
    expect(f("notes")).toEqual([false, null]);
  });
});

describe("reading a widget's options never saves anything (LOV-1)", () => {
  it("doesn't click a trigger that would submit the form, and blocks writes while a list is open", async () => {
    const page = `<!doctype html><title>Assign</title><form id="f"><h1>Assign work</h1>
      <label for="t">Title</label><input id="t" name="title">
      <label for="o">Owner</label><button id="o" role="combobox" aria-expanded="false">Select owner</button>
      <label for="r">Reviewer</label><button type="button" id="r" role="combobox" aria-expanded="false">Select reviewer</button>
      <button type="submit">Assign</button></form>
      <script>
        const f = document.getElementById("f");
        f.addEventListener("submit", (e) => { e.preventDefault(); fetch("/api/assign", { method: "POST", body: "{}" }); });
        const r = document.getElementById("r");
        r.addEventListener("click", () => {
          fetch("/api/opened", { method: "POST", body: "{}" });
          const list = document.createElement("div");
          list.setAttribute("role", "listbox");
          list.innerHTML = '<div role="option">Maya</div><div role="option">Theo</div>';
          document.body.appendChild(list);
          r.setAttribute("aria-expanded", "true");
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") { document.querySelector("[role=listbox]")?.remove(); r.setAttribute("aria-expanded", "false"); } });
      </script>`;
    const s = await startFixtureServer({ pages: { "/": page }, fallback: (_req, res) => json(res, 200, {}) });
    try {
      const p = await (await getBrowser()).newPage();
      try {
        await p.goto(`${s.url}/`, { waitUntil: "networkidle" });
        const form = await discoverForm(p);
        expect(form.fields.map((f) => [f.key, f.widget ?? null])).toEqual([["title", null], ["o", "aria-select"], ["r", "aria-select"]]);
        expect(form.fields[1]!.options).toBeUndefined();
        expect(form.fields[2]!.options?.map((o) => o.label)).toEqual(["Maya", "Theo"]);
        expect(s.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
      } finally {
        await p.close();
      }
    } finally {
      await s.close();
    }
  });
});
