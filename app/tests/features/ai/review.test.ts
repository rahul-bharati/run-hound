import { describe, expect, it } from "vitest";
import { describePage } from "./payload.js";
import { PLAN_REVIEW_SCHEMA, mergeReview, planReviewPrompt, reviewPlan, validatePlanReview, type PlanReviewAnswer } from "./review.js";
import { AiError } from "./types.js";
import { FakeClient, makePlan, schemaProblems } from "./test-fixtures.js";

const entry = (id: string, recommended: boolean, priority: "high" | "medium" | "low" = "medium", rationale = `Why ${id}`) => ({ id, recommended, priority, rationale });

describe("validatePlanReview", () => {
  it("accepts a well-formed answer and returns it", () => {
    const answer = { scenarios: [entry("axe:1", true, "high"), entry("dead-control:1", false, "low")] };
    expect(validatePlanReview(answer)).toEqual(answer);
  });

  it("accepts an empty list and unknown ids (the merge handles those)", () => {
    expect(validatePlanReview({ scenarios: [] })).toEqual({ scenarios: [] });
    expect(validatePlanReview({ scenarios: [entry("nope", true)] }).scenarios).toHaveLength(1);
  });

  it.each([
    ["null", null],
    ["a string", "scenarios"],
    ["no scenarios", {}],
    ["scenarios not an array", { scenarios: { id: "a" } }],
    ["an entry that is not an object", { scenarios: ["axe:1"] }],
    ["id not a string", { scenarios: [{ id: 1, recommended: true, priority: "high", rationale: "r" }] }],
    ["recommended not a boolean", { scenarios: [{ id: "a", recommended: "yes", priority: "high", rationale: "r" }] }],
    ["priority not high/medium/low", { scenarios: [{ id: "a", recommended: true, priority: "urgent", rationale: "r" }] }],
    ["rationale missing", { scenarios: [{ id: "a", recommended: true, priority: "high" }] }],
    ["rationale not a string", { scenarios: [{ id: "a", recommended: true, priority: "high", rationale: 3 }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => validatePlanReview(value)).toThrow(/^(?![\s\S]*not implemented)/);
  });
});

describe("PLAN_REVIEW_SCHEMA", () => {
  it("is an object schema in the portable subset", () => {
    expect(PLAN_REVIEW_SCHEMA.type).toBe("object");
    expect(schemaProblems(PLAN_REVIEW_SCHEMA)).toEqual([]);
    const props = PLAN_REVIEW_SCHEMA.properties as Record<string, { type: string; items: { properties: Record<string, unknown> } }>;
    expect(props.scenarios!.type).toBe("array");
    expect(Object.keys(props.scenarios!.items.properties).sort()).toEqual(["id", "priority", "rationale", "recommended"]);
  });
});

describe("planReviewPrompt", () => {
  it("carries the payload as JSON and says page text is data, not instructions", () => {
    const payload = describePage(makePlan(), { remote: false });
    const { system, user } = planReviewPrompt(payload);
    expect(system.length).toBeGreaterThan(0);
    expect(user.includes(JSON.stringify(payload)) || user.includes(JSON.stringify(payload, null, 2))).toBe(true);
    expect(user).toMatch(/data,? not instructions/i);
  });
});

describe("mergeReview", () => {
  it("sets ai, priority and defaultSelected for each scenario the model answered", () => {
    const plan = makePlan();
    const answer: PlanReviewAnswer = {
      scenarios: [entry("axe:1", false, "low", "Not much here"), entry("double-submit:1", true, "high", "Booking twice charges twice")],
    };
    const { plan: merged, unknownIds } = mergeReview(plan, answer);
    expect(unknownIds).toEqual([]);
    const axe = merged.scenarios.find((s) => s.id === "axe:1")!;
    expect(axe.ai).toEqual({ rationale: "Not much here", recommended: false });
    expect(axe.priority).toBe("low");
    // Changed with AI-1: "not recommended" is advice shown with the scenario; it no longer unticks a default.
    expect(axe.defaultSelected).toBe(true);
    const ds = merged.scenarios.find((s) => s.id === "double-submit:1")!;
    expect(ds.ai).toEqual({ rationale: "Booking twice charges twice", recommended: true });
    expect(ds.priority).toBe("high");
    expect(ds.defaultSelected).toBe(true);
  });

  it("never unticks a scenario that is ticked by default: \"not recommended\" stays advice, visible in ai (AI-1)", () => {
    // A small model, or text on the page posing as instructions, answers "not recommended" for everything.
    const plan = makePlan();
    const { plan: merged } = mergeReview(plan, { scenarios: plan.scenarios.map((s) => entry(s.id, false, "low", "No security surface here")) });
    for (const s of merged.scenarios) {
      const original = plan.scenarios.find((o) => o.id === s.id)!;
      expect(s.defaultSelected, s.id).toBe(original.defaultSelected);
      expect(s.ai).toEqual({ rationale: "No security surface here", recommended: false });
    }
    expect(merged.scenarios.find((s) => s.id === "security-headers:1")!.defaultSelected).toBe(true);
  });

  it("keeps destructive scenarios unticked even when recommended", () => {
    const { plan } = mergeReview(makePlan(), { scenarios: [entry("persistence:1", true, "high")] });
    const s = plan.scenarios.find((x) => x.id === "persistence:1")!;
    expect(s.ai!.recommended).toBe(true);
    expect(s.defaultSelected).toBe(false);
    expect(s.destructive).toBe(true);
  });

  it("ticks a previously unticked, non-destructive scenario the model recommends", () => {
    const plan = makePlan();
    plan.scenarios[1]!.defaultSelected = false;
    const { plan: merged } = mergeReview(plan, { scenarios: [entry("dead-control:1", true)] });
    expect(merged.scenarios[1]!.defaultSelected).toBe(true);
  });

  it("trims, collapses whitespace in and cuts the rationale to 200 characters", () => {
    const { plan } = mergeReview(makePlan(), {
      scenarios: [entry("axe:1", true, "high", "  Many\n\n  states \t here  "), entry("dead-control:1", true, "high", `  ${"word ".repeat(100)}`)],
    });
    expect(plan.scenarios[0]!.ai!.rationale).toBe("Many states here");
    const long = plan.scenarios[1]!.ai!.rationale;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.length).toBeGreaterThan(150);
    expect(long).not.toMatch(/^\s|\s{2}/);
  });

  it("reports unknown ids and ignores them", () => {
    const plan = makePlan();
    const { plan: merged, unknownIds } = mergeReview(plan, { scenarios: [entry("made-up:1", true), entry("axe:1", true), entry("also-fake", false)] });
    expect(unknownIds).toEqual(["made-up:1", "also-fake"]);
    expect(merged.scenarios.map((s) => s.id)).toEqual(plan.scenarios.map((s) => s.id));
  });

  it("uses the first answer for a duplicated id", () => {
    const { plan, unknownIds } = mergeReview(makePlan(), { scenarios: [entry("axe:1", true, "high", "First"), entry("axe:1", false, "low", "Second")] });
    const axe = plan.scenarios[0]!;
    expect(axe.ai).toEqual({ rationale: "First", recommended: true });
    expect(axe.priority).toBe("high");
    expect(unknownIds).toEqual([]);
  });

  it("leaves unmentioned scenarios unchanged, without ai", () => {
    const plan = makePlan();
    const { plan: merged } = mergeReview(plan, { scenarios: [entry("axe:1", true)] });
    for (const s of merged.scenarios.slice(1)) {
      const original = plan.scenarios.find((o) => o.id === s.id)!;
      expect(s).toEqual(original);
      expect(s.ai).toBeUndefined();
    }
  });

  it("never adds, removes or reorders scenarios and leaves groups unchanged", () => {
    const plan = makePlan();
    const answer: PlanReviewAnswer = { scenarios: [...plan.scenarios].reverse().map((s) => entry(s.id, true, "low")) };
    const { plan: merged } = mergeReview(plan, answer);
    expect(merged.scenarios.map((s) => s.id)).toEqual(plan.scenarios.map((s) => s.id));
    expect(merged.groups).toEqual(plan.groups);
    expect(merged.target).toBe(plan.target);
    expect(merged.page).toEqual(plan.page);
  });

  it("does not mutate the input plan", () => {
    const plan = makePlan();
    const before = structuredClone(plan);
    mergeReview(plan, { scenarios: plan.scenarios.map((s) => entry(s.id, false, "low")) });
    expect(plan).toEqual(before);
  });
});

describe("reviewPlan", () => {
  it("sends the page payload with the review schema and returns the merged plan", async () => {
    const plan = makePlan();
    const client = new FakeClient([{ scenarios: [entry("axe:1", false, "low", "Few states"), entry("unknown:9", true)] }]);
    const controller = new AbortController();
    const reviewed = await reviewPlan(plan, client, { remote: true, signal: controller.signal });

    expect(client.requests).toHaveLength(1);
    const request = client.requests[0]!;
    expect(request.name).toMatch(/^[a-z_]+$/);
    expect(request.name).toContain("review");
    expect(request.schema).toEqual(PLAN_REVIEW_SCHEMA);
    expect(request.signal).toBe(controller.signal);
    const expected = planReviewPrompt(describePage(plan, { remote: true }));
    expect(request.user).toBe(expected.user);
    expect(request.system).toBe(expected.system);
    expect(request.user).not.toContain("localhost:5310");

    expect(reviewed.scenarios[0]!.ai).toEqual({ rationale: "Few states", recommended: false });
    // Changed with AI-1: the model's "not recommended" never unticks a scenario that is ticked by default.
    expect(reviewed.scenarios[0]!.defaultSelected).toBe(true);
    expect(reviewed.scenarios.map((s) => s.id)).toEqual(plan.scenarios.map((s) => s.id));
    expect(plan.scenarios[0]!.ai).toBeUndefined();
  });

  it("a review answering \"not recommended\" for everything leaves the default approval as it was (AI-1)", async () => {
    const plan = makePlan();
    const client = new FakeClient([{ scenarios: plan.scenarios.map((s) => entry(s.id, false, "low", "Skip it")) }]);
    const reviewed = await reviewPlan(plan, client, { remote: false });
    const ticked = (p: typeof plan) => p.scenarios.filter((s) => s.defaultSelected).map((s) => s.id);
    expect(ticked(reviewed)).toEqual(ticked(plan));
  });

  it("rejects with the client's AiError", async () => {
    const client = new FakeClient([new AiError("timeout", "The model took too long")]);
    const error = await reviewPlan(makePlan(), client, { remote: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("timeout");
  });

  it("rejects when the model's answer fails validation", async () => {
    const client = new FakeClient([{ scenarios: "nope" }]);
    await expect(reviewPlan(makePlan(), client, { remote: false })).rejects.toThrow(/^(?![\s\S]*not implemented)/);
  });
});
