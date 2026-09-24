import { describe, expect, it } from "vitest";
import { CHECK_GROUPS, type Category, type Check, type CheckId, type DiscoveredForm, type Scenario } from "../core/types.js";
import { buildPlan } from "./plan.js";

const FORM: DiscoveredForm = { url: "http://127.0.0.1:5173/book", selector: "form", name: "Book a sitter", fields: [], controls: [] };

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
}

function fakeCheck(id: CheckId, category: Category, ids: string[]): Check {
  return {
    id,
    title: `Fake ${id}`,
    category,
    plan: () => ids.map((s) => scenario(id, s)),
    run: async () => {
      throw new Error("not run in plan tests");
    },
  };
}

/** Mixed categories, deliberately scrambled (neither CHECK_IDS nor group order). */
const SCRAMBLED: Check[] = [
  fakeCheck("verbose-errors", "security", ["ve:1"]),
  fakeCheck("reflow-320", "accessibility", ["rf:1"]),
  fakeCheck("client-only-validation", "validation", ["cov:1", "cov:2"]),
  fakeCheck("dead-control", "broken-feature", ["dc:1"]),
  fakeCheck("bundle-secrets", "security", ["bs:1"]),
  fakeCheck("axe-states", "accessibility", ["axe:1", "axe:2"]),
  fakeCheck("console-network-errors", "broken-feature", ["cne:1"]),
  fakeCheck("focus-visible", "accessibility", ["fv:1"]),
];

describe("buildPlan groups", () => {
  it("orders scenarios group by group (CHECK_GROUPS order), CHECK_IDS order within a group", () => {
    const plan = buildPlan(FORM.url, FORM, SCRAMBLED);
    expect(plan.scenarios.map((s) => s.id)).toEqual([
      // Accessibility: axe-states, focus-visible, reflow-320
      "axe:1",
      "axe:2",
      "fv:1",
      "rf:1",
      // Features: console-network-errors, dead-control, client-only-validation
      "cne:1",
      "dc:1",
      "cov:1",
      "cov:2",
      // Security: bundle-secrets, verbose-errors
      "bs:1",
      "ve:1",
    ]);
  });

  it("lists every non-empty group in CHECK_GROUPS order with its id, label and scenario ids", () => {
    const plan = buildPlan(FORM.url, FORM, SCRAMBLED);
    expect(plan.groups).toEqual([
      { id: "accessibility", label: "Accessibility", scenarioIds: ["axe:1", "axe:2", "fv:1", "rf:1"] },
      { id: "features", label: "Features", scenarioIds: ["cne:1", "dc:1", "cov:1", "cov:2"] },
      { id: "security", label: "Security", scenarioIds: ["bs:1", "ve:1"] },
    ]);
    // Labels come from CHECK_GROUPS.
    for (const g of plan.groups) expect(g.label).toBe(CHECK_GROUPS.find((c) => c.id === g.id)!.label);
    // Concatenating the groups gives the plan's run order.
    expect(plan.groups.flatMap((g) => g.scenarioIds)).toEqual(plan.scenarios.map((s) => s.id));
  });

  it("leaves out groups with no scenarios (including checks that propose none)", () => {
    const checks = [
      fakeCheck("pii-leak", "security", ["pii:1"]),
      fakeCheck("keyboard-completion", "accessibility", []),
      fakeCheck("silent-failure", "broken-feature", ["sf:1"]),
    ];
    const plan = buildPlan(FORM.url, FORM, checks);
    expect(plan.scenarios.map((s) => s.id)).toEqual(["sf:1", "pii:1"]);
    expect(plan.groups).toEqual([
      { id: "features", label: "Features", scenarioIds: ["sf:1"] },
      { id: "security", label: "Security", scenarioIds: ["pii:1"] },
    ]);
  });

  it("gives an empty plan no groups", () => {
    const plan = buildPlan(FORM.url, FORM, [fakeCheck("dead-control", "broken-feature", [])]);
    expect(plan.scenarios).toEqual([]);
    expect(plan.groups).toEqual([]);
  });

  it("keeps scenario ids unique across groups, and the group lists use the final ids", () => {
    const checks = [
      fakeCheck("verbose-errors", "security", ["same", "ve:1"]),
      fakeCheck("focus-visible", "accessibility", ["same"]),
      fakeCheck("dead-control", "broken-feature", ["same", "dc:1"]),
    ];
    const plan = buildPlan(FORM.url, FORM, checks);
    const ids = plan.scenarios.map((s) => s.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(plan.groups.flatMap((g) => g.scenarioIds)).toEqual(ids);
    expect(plan.groups.map((g) => g.id)).toEqual(["accessibility", "features", "security"]);
    const byGroup = Object.fromEntries(plan.groups.map((g) => [g.id, g.scenarioIds.map((id) => plan.scenarios.find((s) => s.id === id)!.checkId)]));
    expect(byGroup).toEqual({
      accessibility: ["focus-visible"],
      features: ["dead-control", "dead-control"],
      security: ["verbose-errors", "verbose-errors"],
    });
  });
});
