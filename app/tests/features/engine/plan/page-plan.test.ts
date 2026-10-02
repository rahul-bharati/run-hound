import { afterAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, DiscoveredForm, DiscoveredPage, Scenario } from "../core/types.js";
import { discoverPage } from "./discover.js";
import { NoFormFoundError } from "./errors.js";
import { buildPlan, formLabel, formOfScenario, WHOLE_PAGE } from "./plan.js";
import { discoverAndPlan, planWarnings } from "./runner.js";

let browser: Browser | undefined;
const servers: FixtureServer[] = [];
afterAll(async () => {
  await browser?.close();
  await Promise.all(servers.map((s) => s.close()));
});

const PAGE = `<!doctype html><html><head><title>  Pet   shop </title></head><body>
<nav><a href="/">Home</a><a href="/about">About</a><a href="#" id="fav">Favourites</a><button type="button" id="menu">Menu</button></nav>
<form id="search" role="search"><label for="q">Search</label><input id="q" name="q"><button>Go</button></form>
<h2>Book a sitter</h2>
<form id="book"><label for="pet">Pet name</label><input id="pet" name="pet" required>
<label for="email">Email</label><input id="email" name="email" type="email">
<button type="button" id="draft">Save draft</button><button>Book</button></form>
<section><button type="button" id="refresh">Refresh list</button><button type="button" id="gone" hidden>Hidden</button><button disabled>Disabled</button></section>
</body></html>`;

async function serve(pages: Record<string, string>, status = 200) {
  const s = await startFixtureServer({
    routes: Object.fromEntries(
      Object.entries(pages).map(([path, html]) => [
        `GET ${path}`,
        (_req: unknown, res: import("node:http").ServerResponse) => {
          res.writeHead(status, { "content-type": "text/html" });
          res.end(html);
        },
      ]),
    ),
  });
  servers.push(s);
  return s.url;
}

async function discover(html: string): Promise<DiscoveredPage> {
  browser ??= await chromium.launch();
  const url = await serve({ "/": html });
  const page = await browser.newPage();
  await page.goto(`${url}/`);
  try {
    return await discoverPage(page);
  } finally {
    await page.close();
  }
}

describe("discoverPage", () => {
  it("finds every form, main form (most fields) first, and the controls outside them", async () => {
    const found = await discover(PAGE);
    expect(found.title).toBe("Pet shop");
    expect(found.forms.map((f) => [f.selector, f.index, f.name])).toEqual([
      ["#book", 0, "Book a sitter"],
      ["#search", 1, null],
    ]);
    expect(found.forms[0]!.fields.map((f) => f.key)).toEqual(["pet", "email"]);
    expect(found.forms[0]!.controls.map((c) => [c.text, c.isSubmit])).toEqual([["Save draft", false], ["Book", true]]);
    // Outside the forms: the menu button, the href="#" link and the refresh button; not hidden or disabled ones,
    // not real links (only counted).
    expect(found.controls.map((c) => c.selector)).toEqual(["#fav", "#menu", "#refresh"]);
    expect(found.controls.find((c) => c.selector === "#refresh")!.accessibleName).toBe("Refresh list");
    expect(found.controls.every((c) => !c.isSubmit)).toBe(true);
    expect(found.links).toBe(2);
  });

  it("returns no forms (and does not throw) on a page without one", async () => {
    const found = await discover(`<!doctype html><title>Hi</title><h1>Hello</h1><button type="button">Like</button>`);
    expect(found.forms).toEqual([]);
    expect(found.controls.map((c) => c.text)).toEqual(["Like"]);
  });

  it("keeps V0's choice of main form: fields outside any form form a scope of their own", async () => {
    const found = await discover(`<!doctype html><div id="w"><label for="a">A</label><input id="a"><label for="b">B</label><input id="b"><button type="button">Send</button></div>
      <form id="f"><label for="c">C</label><input id="c"><button>Go</button></form>`);
    expect(found.forms.map((f) => f.selector)).toEqual(["#w", "#f"]);
  });
});

const form = (name: string | null, index: number): DiscoveredForm => ({
  url: "http://127.0.0.1:1/",
  index,
  selector: `#f${index}`,
  name,
  fields: [{ key: "a", accessibleName: "A", label: "A", placeholder: null, type: "text", role: "textbox", required: false, selector: `#a${index}` }],
  controls: [],
});

function fake(id: CheckId, scope: "form" | "page" | undefined, category: Check["category"] = "broken-feature"): Check {
  return {
    id,
    title: id,
    category,
    ...(scope ? { scope } : {}),
    plan: (f): Scenario[] => [{ id: `${id}:s`, checkId: id, title: `Test ${f.name ?? "it"}`, description: "", kind: "golden", priority: "low", destructive: false, defaultSelected: true }],
    run: async () => {
      throw new Error("not run");
    },
  };
}

describe("buildPlan for a page", () => {
  const page: DiscoveredPage = { url: "http://127.0.0.1:1/", title: null, forms: [form("Sign up", 0), form(null, 1)], controls: [], links: 0 };

  it("plans form checks once per form (later forms get @form-<n> ids and titles name the form) and page checks once", () => {
    const plan = buildPlan("http://127.0.0.1:1/", page, [fake("dead-control", undefined), fake("security-headers", "page", "security")]);
    expect(plan.scenarios.map((s) => [s.id, s.scope, s.formIndex, s.scopeLabel, s.title])).toEqual([
      ["dead-control:s", "form", 0, "Sign up form", "Test Sign up (Sign up form)"],
      ["dead-control:s@form-2", "form", 1, "Form 2", "Test it (Form 2)"],
      ["security-headers:s", "page", undefined, WHOLE_PAGE, "Test Sign up"],
    ]);
    expect(plan.form).toBe(page.forms[0]);
    expect(plan.page).toBe(page);
    expect(plan.groups.map((g) => [g.id, g.scenarioIds])).toEqual([
      ["features", ["dead-control:s", "dead-control:s@form-2"]],
      ["security", ["security-headers:s"]],
    ]);
    expect(formOfScenario(plan, plan.scenarios[1]!)).toBe(page.forms[1]);
    expect(formOfScenario(plan, plan.scenarios[2]!)).toBe(page.forms[0]);
  });

  it("keeps titles unchanged with one form, and plans only page checks without a form", () => {
    const one = buildPlan("http://x/", { ...page, forms: [form("Sign up", 0)] }, [fake("dead-control", undefined)]);
    expect(one.scenarios[0]!.title).toBe("Test Sign up");
    const none = buildPlan("http://x/", { ...page, forms: [] }, [fake("dead-control", undefined), fake("cors", "page", "security")]);
    expect(none.scenarios.map((s) => s.id)).toEqual(["cors:s"]);
    expect(none.form.fields).toEqual([]);
    expect(planWarnings(none).join(" ")).toMatch(/No form was found on this page/);
  });

  it("formLabel names forms as people would", () => {
    expect(formLabel(form("Contact us", 0))).toBe("Contact us form");
    expect(formLabel(form("Signup form", 0))).toBe("Signup form");
    expect(formLabel(form(null, 2))).toBe("Form 3");
  });
});

describe("discoverAndPlan (V1)", () => {
  it("plans the page-wide checks on a page without a form, with a warning", async () => {
    const url = await serve({ "/": `<!doctype html><title>Home</title><h1>Welcome</h1><button type="button" id="x">Menu</button>` });
    const plan = await discoverAndPlan(`${url}/`);
    expect(plan.page!.forms).toEqual([]);
    expect(plan.scenarios.every((s) => s.scope === "page")).toBe(true);
    expect(plan.scenarios.map((s) => s.checkId)).toEqual(
      expect.arrayContaining(["page-controls", "security-headers", "cookie-flags", "cors", "source-maps", "bundle-secrets", "reflow-320"]),
    );
    expect(planWarnings(plan)).toHaveLength(1);
  });

  it("still refuses an error page", async () => {
    const url = await serve({ "/": "<h1>Not found</h1>" }, 404);
    await expect(discoverAndPlan(`${url}/`)).rejects.toBeInstanceOf(NoFormFoundError);
  });
});
