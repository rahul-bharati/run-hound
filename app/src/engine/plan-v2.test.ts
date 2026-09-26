/**
 * Planning the 0.4.0 (V2) checks: access-control, mass-assignment and deep-links (docs/v2-spec.md "Checks"), and the
 * sign-in hint a signed-out plan shows instead of the access scenarios. buildPlan passes PlanEnv to every check.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { startAccountsApp, type AccountsApp } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { check as accessControl } from "../checks/access-control.js";
import { check as deepLinks } from "../checks/deep-links.js";
import { checks as allChecks } from "../checks/index.js";
import { check as massAssignment } from "../checks/mass-assignment.js";
import type { AccountRef, CheckGroup, CheckId, DiscoveredForm, DiscoveredPage, FormControl, FormField, Plan, PlanEnv, Scenario } from "../core/types.js";
import { discoverPage } from "./discover.js";
import { buildPlan, WHOLE_PAGE } from "./plan.js";
import { planWarnings } from "./runner.js";

const V2 = [accessControl, massAssignment, deepLinks];
const A: AccountRef = { id: "a", label: "Account A" };
const SIGNED_OUT: PlanEnv = { signedIn: false, otherAccount: false };
const SIGNED_IN_ALONE: PlanEnv = { signedIn: true, otherAccount: false };
const SIGNED_IN_WITH_B: PlanEnv = { signedIn: true, otherAccount: true };
/** The hint a signed-out plan shows instead of the access scenarios (docs/v2-spec.md "Checks"). */
const HINT = /Sign in as a test account to run the access checks/;

let browser: Browser;
let app: AccountsApp;
/** /notes discovered as alice: forms "New note" and "Profile" (both save), links to /notes, /settings and /help. */
let notes: DiscoveredPage;
let target: string;
const servers: FixtureServer[] = [];

beforeAll(async () => {
  browser = await getBrowser();
  app = await startAccountsApp();
  target = `${app.url}/notes`;
  const context = await browser.newContext({ storageState: app.storageState("alice") });
  try {
    const page = await context.newPage();
    await page.goto(target);
    await page.getByRole("heading", { level: 1, name: "Your notes" }).waitFor();
    await page.waitForLoadState("networkidle");
    notes = await discoverPage(page);
  } finally {
    await context.close();
  }
  expect(notes.forms.map((f) => f.name)).toEqual(["New note", "Profile"]);
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(async () => {
  await app?.stop();
  await closeBrowser();
});

function scenariosOf(plan: Plan, checkId: CheckId): Scenario[] {
  return plan.scenarios.filter((s) => s.checkId === checkId);
}

function groupOfScenario(plan: Plan, id: string): CheckGroup | undefined {
  return plan.groups.find((g) => g.scenarioIds.includes(id))?.id;
}

function hints(plan: Plan): string[] {
  return planWarnings(plan).filter((w) => HINT.test(w));
}

/** A plan as discoverAndPlan returns it when signed in: it records the account it was discovered as. */
function signedIn(plan: Plan): Plan {
  return { ...plan, account: A };
}

function field(key: string, name: string, type = "text"): FormField {
  return { key, accessibleName: name, label: name, placeholder: null, type, role: type === "search" ? "searchbox" : "textbox", required: false, selector: `#${key}` };
}

function submit(text: string, selector: string): FormControl {
  return { accessibleName: text, text, role: "button", tag: "button", selector, isSubmit: true };
}

function form(index: number, name: string, fields: FormField[], extra: Partial<DiscoveredForm> = {}): DiscoveredForm {
  return { url: "http://127.0.0.1:9/app", index, selector: `#form-${index}`, name, fields, controls: [submit("Save", `#form-${index} button`)], ...extra };
}

function syntheticPage(forms: DiscoveredForm[]): DiscoveredPage {
  return { url: "http://127.0.0.1:9/app", title: "App", forms, controls: [], links: 0 };
}

const SAVING = form(0, "Edit your details", [field("name", "Name"), field("company", "Company"), field("email", "Email", "email")]);
const SEARCH = form(1, "Search", [field("q", "Search", "search")], { search: true });

describe("signed out: no access or mass-assignment scenarios, one hint instead", () => {
  it("plans neither with env absent, signedIn false, or otherAccount without signedIn, and planWarnings shows the hint once", () => {
    for (const env of [undefined, SIGNED_OUT, { signedIn: false, otherAccount: true }] satisfies (PlanEnv | undefined)[]) {
      const plan = buildPlan(target, notes, V2, env);
      const label = `env ${JSON.stringify(env)}`;
      expect(scenariosOf(plan, "access-control"), label).toEqual([]);
      expect(scenariosOf(plan, "mass-assignment"), label).toEqual([]);
      expect(hints(plan), label).toHaveLength(1);
      expect(hints(plan)[0], label).toMatch(/another account or a signed-out visitor reading your data/);
    }
  });

  it("does the same with every registered check (the default plan of a 0.3.0-style signed-out run)", () => {
    const plan = buildPlan(target, notes, allChecks);
    expect(plan.account).toBeUndefined();
    expect(plan.scenarios.filter((s) => s.checkId === "access-control" || s.checkId === "mass-assignment")).toEqual([]);
    expect(hints(plan)).toHaveLength(1);
  });
});

describe("access-control planning", () => {
  it("signed in without a second account: only access-control:signed-out, page scope, ticked, Security; no hint", () => {
    const plan = signedIn(buildPlan(target, notes, V2, SIGNED_IN_ALONE));
    const planned = scenariosOf(plan, "access-control");
    expect(planned.map((s) => s.id)).toEqual(["access-control:signed-out"]);
    expect(planned[0]).toMatchObject({ checkId: "access-control", scope: "page", scopeLabel: WHOLE_PAGE, defaultSelected: true, destructive: false });
    expect(planned[0]!.title).toMatch(/Signed-out visitors can't read/);
    expect(groupOfScenario(plan, "access-control:signed-out")).toBe("security");
    expect(hints(plan)).toEqual([]);
  });

  it("signed in with account B configured and isolated: access-control:other-account as well", () => {
    const plan = signedIn(buildPlan(target, notes, V2, SIGNED_IN_WITH_B));
    const planned = scenariosOf(plan, "access-control");
    expect(planned.map((s) => s.id).sort()).toEqual(["access-control:other-account", "access-control:signed-out"]);
    const other = planned.find((s) => s.id === "access-control:other-account")!;
    expect(other).toMatchObject({ checkId: "access-control", scope: "page", scopeLabel: WHOLE_PAGE, defaultSelected: true, destructive: false });
    expect(other.title).toMatch(/Another account can't read/);
    expect(groupOfScenario(plan, "access-control:other-account")).toBe("security");
    expect(hints(plan)).toEqual([]);
  });

  it("is planned for a signed-in page without any form (its data may come from the page's own requests)", () => {
    const plan = buildPlan("http://127.0.0.1:9/app", syntheticPage([]), V2, SIGNED_IN_WITH_B);
    expect(scenariosOf(plan, "access-control").map((s) => s.id).sort()).toEqual(["access-control:other-account", "access-control:signed-out"]);
  });
});

describe("mass-assignment planning", () => {
  it("signed in: one unticked, non-destructive Security scenario per saving form", () => {
    for (const env of [SIGNED_IN_ALONE, SIGNED_IN_WITH_B]) {
      const plan = signedIn(buildPlan(target, notes, V2, env));
      const planned = scenariosOf(plan, "mass-assignment");
      expect(planned.map((s) => [s.scope, s.formIndex, s.scopeLabel])).toEqual([
        ["form", 0, "New note form"],
        ["form", 1, "Profile form"],
      ]);
      expect(planned[1]!.id).toBe(`${planned[0]!.id}@form-2`);
      for (const s of planned) {
        expect(s.defaultSelected, s.id).toBe(false);
        expect(s.destructive, s.id).toBe(false);
        expect(groupOfScenario(plan, s.id), s.id).toBe("security");
      }
    }
  });

  it("leaves search forms out", () => {
    const withSearch = buildPlan("http://127.0.0.1:9/app", syntheticPage([SAVING, SEARCH]), V2, SIGNED_IN_ALONE);
    expect(scenariosOf(withSearch, "mass-assignment").map((s) => s.formIndex)).toEqual([0]);

    const onlySearch = buildPlan("http://127.0.0.1:9/app", syntheticPage([{ ...SEARCH, index: 0 }]), V2, SIGNED_IN_ALONE);
    expect(scenariosOf(onlySearch, "mass-assignment")).toEqual([]);
  });
});

describe("deep-links planning", () => {
  it("is planned ticked, page scope, in Features when the page links to other same-origin pages, signed in or not", () => {
    for (const env of [undefined, SIGNED_IN_WITH_B]) {
      const plan = buildPlan(target, notes, V2, env);
      const planned = scenariosOf(plan, "deep-links");
      expect(planned, `env ${JSON.stringify(env)}`).toHaveLength(1);
      expect(planned[0]).toMatchObject({ checkId: "deep-links", scope: "page", scopeLabel: WHOLE_PAGE, defaultSelected: true, destructive: false });
      expect(groupOfScenario(plan, planned[0]!.id)).toBe("features");
    }
  });

  it("is not planned when the only links go elsewhere (other origins, hash-only, mailto, the page itself) or there are none", async () => {
    const other = await startFixtureServer({ pages: { "/about": "<!doctype html><title>Other</title><h1>Other app</h1>" } });
    servers.push(other);
    const site = await startFixtureServer({
      pages: {
        "/home": `<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1><p><a href="/about">About us</a></p></body></html>`,
        "/solo": `<!doctype html><html><head><title>Solo</title></head><body><h1>Solo</h1><p>
<a href="https://example.com/elsewhere">Elsewhere</a>
<a href="${other.url}/about">The other app</a>
<a href="#details">Details</a>
<a href="/solo">This page</a>
<a href="/solo?tab=2">Second tab</a>
<a href="mailto:help@example.test">Email us</a>
</p><h2 id="details">Details</h2><p>Nothing else.</p></body></html>`,
        "/bare": `<!doctype html><html><head><title>Bare</title></head><body><h1>Bare</h1><p>No links at all.</p></body></html>`,
      },
    });
    servers.push(site);

    const planFor = async (path: string) => {
      const page = await browser.newPage();
      try {
        await page.goto(site.url + path, { waitUntil: "load" });
        return buildPlan(site.url + path, await discoverPage(page), V2);
      } finally {
        await page.close();
      }
    };
    expect(scenariosOf(await planFor("/home"), "deep-links"), "a same-origin link to another path").toHaveLength(1);
    expect(scenariosOf(await planFor("/solo"), "deep-links"), "no same-origin link to another path").toEqual([]);
    expect(scenariosOf(await planFor("/bare"), "deep-links"), "no links").toEqual([]);
  });
});

describe("run order", () => {
  it("with every check, signed in: the V2 Security scenarios come after the existing ones, access-control before mass-assignment", () => {
    const plan = signedIn(buildPlan(target, notes, allChecks, SIGNED_IN_WITH_B));
    const security = plan.groups.find((g) => g.id === "security")!.scenarioIds;
    const checkOf = (id: string) => plan.scenarios.find((s) => s.id === id)!.checkId;
    const firstAccess = security.findIndex((id) => checkOf(id) === "access-control");
    const firstMass = security.findIndex((id) => checkOf(id) === "mass-assignment");
    const lastOlder = security.findLastIndex((id) => checkOf(id) !== "access-control" && checkOf(id) !== "mass-assignment");
    expect(firstAccess).toBeGreaterThan(-1);
    expect(firstMass).toBeGreaterThan(firstAccess);
    expect(lastOlder).toBeLessThan(firstAccess);
    const features = plan.groups.find((g) => g.id === "features")!.scenarioIds;
    expect(features.map(checkOf)).toContain("deep-links");
  });
});
