/**
 * 0.4.0: selectors never use framework-generated ids (LOV-7). React's useId (":r1:", "«r1»", "_r_1_"), Radix, Headless
 * UI and MUI number their ids in mount order, so an id can point at a different field on the next load.
 */
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { DiscoveredForm } from "../core/types.js";
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

const GENERATED = /:r|«r|_r_|radix-|headlessui-|mui-/;

/** Every selector discovery wrote for the form (form, fields, options, bubble inputs, controls). */
function selectors(form: DiscoveredForm): string[] {
  return [
    form.selector,
    ...form.fields.flatMap((f) => [f.selector, ...(f.nativeSelector ? [f.nativeSelector] : []), ...(f.options ?? []).map((o) => o.selector)]),
    ...form.controls.map((c) => c.selector),
  ];
}

describe("selectors on a page whose ids change on every load (LOV-7)", () => {
  it("builds the same selectors on two loads, none from a generated id, each finding the same element", async () => {
    const loads: { form: DiscoveredForm; ids: string[] }[] = [];
    for (let i = 0; i < 2; i++) {
      const page = await open("generated-ids.html");
      try {
        const ids = await page.evaluate(() => Array.from(document.querySelectorAll("form [id]"), (el) => el.id));
        const form = await discoverForm(page);
        // Each selector finds exactly the element the fixture marked for that field.
        for (const f of form.fields) {
          expect(await page.locator(f.selector).count(), f.selector).toBe(1);
          expect(await page.locator(f.selector).getAttribute("data-field"), f.selector).toBe(f.key);
        }
        const submit = form.controls.find((c) => c.isSubmit)!;
        expect(await page.locator(submit.selector).getAttribute("data-field")).toBe("submit");
        loads.push({ form, ids });
      } finally {
        await page.close();
      }
    }
    const [a, b] = loads as [(typeof loads)[0], (typeof loads)[0]];
    // The page really did number its ids differently.
    expect(a.ids).not.toEqual(b.ids);
    expect(a.form.fields.map((f) => f.key)).toEqual(["title", "notes", "estimate", "assignee", "due", "tags"]);
    expect(selectors(a.form)).toEqual(selectors(b.form));
    for (const s of selectors(a.form)) expect(s, s).not.toMatch(GENERATED);
  });

  it("prefers the name, then a stable id, then a label attribute, before a structural path", async () => {
    const page = await open("generated-ids.html");
    try {
      const form = await discoverForm(page);
      const sel = (key: string) => form.fields.find((f) => f.key === key)!.selector;
      expect(form.selector).toBe('form[aria-label="Quick add"]');
      expect(sel("title")).toBe('input[name="title"]');
      expect(sel("due")).toBe("#due");
      expect(sel("tags")).toBe('input[placeholder="Tags"]');
      // No name, a generated id and no label attribute: a path anchored at the form's stable selector.
      expect(sel("notes")).toMatch(/^form\[aria-label="Quick add"\] > /);
    } finally {
      await page.close();
    }
  });

  it("still uses a unique, hand-written id", async () => {
    const page = await open("native-form.html");
    try {
      const found = await discoverPage(page);
      expect(found.forms[0]!.selector).toBe("#booking");
      expect(found.forms[0]!.controls.find((c) => c.isSubmit)!.selector).toBe("#book");
    } finally {
      await page.close();
    }
  });
});
