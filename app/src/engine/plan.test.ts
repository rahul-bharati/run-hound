import { describe, expect, it } from "vitest";
import { CHECK_IDS, type Check, type CheckId, type DiscoveredForm, type Scenario } from "../core/types.js";
import { NotImplementedError } from "./errors.js";
import { buildPlan } from "./plan.js";

const form: DiscoveredForm = {
  url: "http://127.0.0.1:1/book",
  selector: "form",
  name: "Book a sitter",
  fields: [
    { key: "petName", accessibleName: "Pet name", label: "Pet name", placeholder: null, type: "text", role: "textbox", required: true, selector: "#petName" },
  ],
  controls: [{ accessibleName: "Book", text: "Book", role: "button", tag: "button", selector: "#book", isSubmit: true }],
};

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return {
    id,
    checkId,
    title: `${checkId} ${id}`,
    description: "fake scenario",
    kind: "golden",
    priority: "medium",
    destructive: false,
    defaultSelected: true,
    ...extra,
  };
}

function fakeCheck(id: CheckId, scenarios: (form: DiscoveredForm) => Scenario[]): Check & { seen: DiscoveredForm[] } {
  const seen: DiscoveredForm[] = [];
  return {
    id,
    title: `Fake ${id}`,
    category: "broken-feature",
    seen,
    plan(f) {
      seen.push(f);
      return scenarios(f);
    },
    async run(_ctx, s) {
      return { checkId: id, scenarioId: s.id, status: "pass", findings: [], durationMs: 0 };
    },
  };
}

describe("buildPlan", () => {
  it("returns target, form and scenarios", () => {
    const check = fakeCheck("dead-control", () => [scenario("dead-control", "dead-control:all")]);
    const plan = buildPlan("http://127.0.0.1:1/book", form, [check]);
    expect(plan.target).toBe("http://127.0.0.1:1/book");
    expect(plan.form).toBe(form);
    expect(plan.scenarios.map((s) => s.id)).toEqual(["dead-control:all"]);
    expect(check.seen).toEqual([form]);
  });

  it("orders scenarios by CHECK_IDS regardless of the order checks are passed in", () => {
    const ids: CheckId[] = ["reflow-320", "console-network-errors", "axe-states", "dead-control"];
    const checks = ids.map((id) => fakeCheck(id, () => [scenario(id, `${id}:a`), scenario(id, `${id}:b`)]));
    const plan = buildPlan("http://127.0.0.1:1/book", form, checks);
    const order = plan.scenarios.map((s) => CHECK_IDS.indexOf(s.checkId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(plan.scenarios.map((s) => s.id)).toEqual([
      "console-network-errors:a",
      "console-network-errors:b",
      "dead-control:a",
      "dead-control:b",
      "axe-states:a",
      "axe-states:b",
      "reflow-320:a",
      "reflow-320:b",
    ]);
  });

  it("keeps scenario fields and a check's own scenario order", () => {
    const s1 = scenario("persistence", "persistence:reload", { kind: "golden", priority: "high", title: "Reload keeps data" });
    const s2 = scenario("persistence", "persistence:other", { kind: "danger", priority: "low", defaultSelected: false });
    const plan = buildPlan("http://127.0.0.1:1/book", form, [fakeCheck("persistence", () => [s1, s2])]);
    expect(plan.scenarios).toEqual([s1, s2]);
  });

  it("skips checks that propose nothing", () => {
    const plan = buildPlan("http://127.0.0.1:1/book", form, [
      fakeCheck("credential-fields", () => []),
      fakeCheck("reflow-320", () => [scenario("reflow-320", "reflow-320:load")]),
    ]);
    expect(plan.scenarios.map((s) => s.checkId)).toEqual(["reflow-320"]);
  });

  it("returns an empty plan with no checks", () => {
    expect(buildPlan("http://127.0.0.1:1/book", form, []).scenarios).toEqual([]);
  });

  it("produces unique scenario ids across the plan", () => {
    const checks = CHECK_IDS.map((id) => fakeCheck(id, () => [scenario(id, `${id}:one`), scenario(id, `${id}:two`)]));
    const plan = buildPlan("http://127.0.0.1:1/book", form, checks);
    const ids = plan.scenarios.map((s) => s.id);
    expect(ids).toHaveLength(CHECK_IDS.length * 2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never produces duplicate ids, even when checks collide (disambiguates or throws)", () => {
    const checks = [
      fakeCheck("dead-control", () => [scenario("dead-control", "main")]),
      fakeCheck("persistence", () => [scenario("persistence", "main")]),
    ];
    let plan;
    try {
      plan = buildPlan("http://127.0.0.1:1/book", form, checks);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NotImplementedError);
      expect((err as Error).message).toContain("main");
      return;
    }
    const ids = plan.scenarios.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("includes destructive scenarios but never selects them by default", () => {
    const plan = buildPlan("http://127.0.0.1:1/book", form, [
      fakeCheck("client-only-validation", () => [
        scenario("client-only-validation", "cov:replay", { destructive: true, defaultSelected: true }),
        scenario("client-only-validation", "cov:safe", { destructive: false, defaultSelected: true }),
      ]),
    ]);
    const destructive = plan.scenarios.find((s) => s.id === "cov:replay");
    expect(destructive).toBeDefined();
    expect(destructive!.destructive).toBe(true);
    expect(destructive!.defaultSelected).toBe(false);
    expect(plan.scenarios.find((s) => s.id === "cov:safe")!.defaultSelected).toBe(true);
  });

  it("keeps non-default scenarios unselected", () => {
    const plan = buildPlan("http://127.0.0.1:1/book", form, [
      fakeCheck("dead-control", () => [scenario("dead-control", "dc:optional", { defaultSelected: false })]),
    ]);
    expect(plan.scenarios[0]!.defaultSelected).toBe(false);
  });
});
