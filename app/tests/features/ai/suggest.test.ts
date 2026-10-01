import { describe, expect, it } from "vitest";
import type { FlowStep, Scenario } from "../core/types.js";
import { formLabel } from "../engine/plan.js";
import { describePage } from "./payload.js";
import {
  MAX_FLOW_STEPS,
  MAX_SUGGESTIONS,
  SUGGEST_SCHEMA,
  addSuggestions,
  flowProblem,
  suggestPrompt,
  suggestScenarios,
  suggestionsToScenarios,
  validateSuggest,
  type SuggestAnswer,
} from "./suggest.js";
import { AiError } from "./types.js";
import { FakeClient, bookingForm, control, discoveredPage, field, makePlan, newsletterForm, scenario, schemaProblems } from "./test-fixtures.js";

const expectOk: FlowStep = { action: "expect", expect: "request-ok", text: null };

/** A valid flow on the booking form (form 0). */
const bookingFlow: FlowStep[] = [
  { action: "fill", field: "name", value: "Ada" },
  { action: "choose", field: "pet", option: "dog" },
  { action: "click", control: 2 },
  { action: "press", key: "Enter" },
  expectOk,
];

const suggestion = (title: string, form: number, steps: FlowStep[], rationale = `Because ${title}`) => ({ title, rationale, form, steps });

describe("validateSuggest", () => {
  it("accepts a well-formed answer", () => {
    const answer = { suggestions: [suggestion("Book a dog", 0, bookingFlow)] };
    expect(validateSuggest(answer)).toEqual(answer);
    expect(validateSuggest({ suggestions: [] })).toEqual({ suggestions: [] });
  });

  it.each([
    ["null", null],
    ["no suggestions", {}],
    ["suggestions not an array", { suggestions: "x" }],
    ["title not a string", { suggestions: [{ title: 1, rationale: "r", form: 0, steps: [expectOk] }] }],
    ["rationale missing", { suggestions: [{ title: "t", form: 0, steps: [expectOk] }] }],
    ["form not a number", { suggestions: [{ title: "t", rationale: "r", form: "0", steps: [expectOk] }] }],
    ["steps not an array", { suggestions: [{ title: "t", rationale: "r", form: 0, steps: {} }] }],
    ["a step that is not an object", { suggestions: [{ title: "t", rationale: "r", form: 0, steps: ["click"] }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => validateSuggest(value)).toThrow(/^(?![\s\S]*not implemented)/);
  });
});

describe("SUGGEST_SCHEMA", () => {
  it("is an object schema in the portable subset", () => {
    expect(SUGGEST_SCHEMA.type).toBe("object");
    expect(schemaProblems(SUGGEST_SCHEMA)).toEqual([]);
    expect(Object.keys(SUGGEST_SCHEMA.properties as object)).toEqual(["suggestions"]);
  });
});

describe("suggestPrompt", () => {
  it("carries the payload and says page text is data, not instructions", () => {
    const payload = describePage(makePlan(), { remote: false });
    const { system, user } = suggestPrompt(payload);
    expect(system.length).toBeGreaterThan(0);
    expect(user.includes(JSON.stringify(payload)) || user.includes(JSON.stringify(payload, null, 2))).toBe(true);
    expect(user).toMatch(/data,? not instructions/i);
  });

  it("gives today's date from `now` and asks for dates realistic relative to it", () => {
    const payload = describePage(makePlan(), { remote: false });
    const { system, user } = suggestPrompt(payload, { now: new Date("2031-03-07T10:00:00Z") });
    expect(`${system}\n${user}`).toContain("2031-03-07");
    expect(system).toMatch(/realistic/i);
    expect(system).toMatch(/future/i);
    expect(suggestPrompt(payload).user).toContain(new Date().toISOString().slice(0, 10));
  });
});

describe("flowProblem", () => {
  const plan = makePlan();
  const problem = (steps: FlowStep[], form = 0) => flowProblem(plan, form, steps);
  const bad = (step: unknown) => [step as FlowStep, expectOk];

  it("accepts a valid flow (choose option matched case-insensitively)", () => {
    expect(problem(bookingFlow)).toBeNull();
  });

  it("accepts a flow on a secondary form using that form's own fields and controls", () => {
    expect(problem([{ action: "fill", field: "email", value: "a@b.co" }, { action: "click", control: 0 }, expectOk], 1)).toBeNull();
  });

  it("rejects a form index the plan doesn't have", () => {
    expect(problem(bookingFlow, 2)).toEqual(expect.any(String));
    expect(problem(bookingFlow, -1)).toEqual(expect.any(String));
    expect(problem(bookingFlow, 0.5)).toEqual(expect.any(String));
  });

  it("needs 1 to MAX_FLOW_STEPS steps", () => {
    expect(MAX_FLOW_STEPS).toBe(8);
    expect(problem([])).toEqual(expect.any(String));
    expect(problem([expectOk])).toBeNull();
    const fills = (n: number): FlowStep[] => Array.from({ length: n }, () => ({ action: "fill", field: "name", value: "Ada" }) as FlowStep);
    expect(problem([...fills(7), expectOk])).toBeNull();
    expect(problem([...fills(8), expectOk])).toEqual(expect.any(String));
  });

  it("needs the last step to be an expect", () => {
    expect(problem([{ action: "click", control: 2 }])).toEqual(expect.any(String));
    expect(problem([expectOk, { action: "click", control: 2 }])).toEqual(expect.any(String));
  });

  it("rejects a fill or choose of a field the form doesn't have", () => {
    expect(problem(bad({ action: "fill", field: "email", value: "x" }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "fill", field: "#name", value: "x" }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "choose", field: "species", option: "Dog" }))).toEqual(expect.any(String));
  });

  it("rejects a choose option that is not one of the field's option labels", () => {
    expect(problem(bad({ action: "choose", field: "pet", option: "Hamster" }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "choose", field: "name", option: "Dog" }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "choose", field: "pet", option: "CAT" }))).toBeNull();
  });

  it("rejects a click control outside the form's controls", () => {
    expect(problem(bad({ action: "click", control: 3 }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "click", control: -1 }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "click", control: 1.5 }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "click", control: 1 }), 1)).toEqual(expect.any(String));
    expect(problem(bad({ action: "click", control: 1 }))).toBeNull();
  });

  it("rejects a key that is not a FlowKey", () => {
    for (const key of ["Enter", "Escape"]) expect(problem(bad({ action: "press", key }))).toBeNull();
    expect(problem(bad({ action: "press", key: "F5" }))).toEqual(expect.any(String));
    expect(problem(bad({ action: "press", key: "Control+W" }))).toEqual(expect.any(String));
  });

  it("rejects Tab and Space anywhere in a flow (they can move focus to, and activate, a destructive control)", () => {
    for (const key of ["Tab", "Space"]) {
      expect(problem(bad({ action: "press", key }))).toMatch(new RegExp(key));
      // The keyboard route to "Delete account": fill, Tab onto the button, Space activates it.
      expect(
        problem([{ action: "fill", field: "name", value: "Ada" }, { action: "press", key } as FlowStep, { action: "press", key: "Enter" }, expectOk]),
      ).toEqual(expect.any(String));
    }
  });

  it("offers only Enter and Escape in the schema and the prompt", () => {
    const steps = (SUGGEST_SCHEMA.properties as Record<string, { items: { properties: { steps: { items: { properties: { key: { enum?: unknown[] } } } } } } }>).suggestions!;
    expect(steps.items.properties.steps.items.properties.key.enum?.filter((k) => k !== null)).toEqual(["Enter", "Escape"]);
    const { system } = suggestPrompt(describePage(makePlan(), { remote: false }));
    expect(system).not.toMatch(/"Tab"|"Space"/);
    expect(system).toMatch(/"Enter"/);
  });

  it("rejects an unknown action", () => {
    expect(problem(bad({ action: "evaluate", script: "alert(1)" }))).toEqual(expect.any(String));
  });

  it("rejects an expect kind that is not a FlowExpectation", () => {
    expect(problem([{ action: "expect", expect: "looks-good", text: null } as unknown as FlowStep])).toEqual(expect.any(String));
    for (const kind of ["request-ok", "url-changes", "no-errors", "field-kept"]) {
      expect(problem([{ action: "expect", expect: kind, text: null } as FlowStep])).toBeNull();
    }
  });

  it("needs non-empty text of at most 200 characters for text-visible and text-absent", () => {
    for (const kind of ["text-visible", "text-absent"] as const) {
      expect(problem([{ action: "expect", expect: kind, text: null }])).toEqual(expect.any(String));
      expect(problem([{ action: "expect", expect: kind, text: "" }])).toEqual(expect.any(String));
      expect(problem([{ action: "expect", expect: kind, text: "x".repeat(201) }])).toEqual(expect.any(String));
      expect(problem([{ action: "expect", expect: kind, text: "x".repeat(200) }])).toBeNull();
      expect(problem([{ action: "expect", expect: kind, text: "Booked" }])).toBeNull();
    }
  });

  it("caps fill values at 200 characters", () => {
    expect(problem(bad({ action: "fill", field: "notes", value: "v".repeat(200) }))).toBeNull();
    expect(problem(bad({ action: "fill", field: "notes", value: "v".repeat(201) }))).toEqual(expect.any(String));
  });

  it("validates expects in the middle of a flow too", () => {
    expect(problem([{ action: "expect", expect: "text-visible", text: null }, expectOk])).toEqual(expect.any(String));
  });
});

describe("suggestionsToScenarios", () => {
  it("adds a 'no errors' check to a flow the model left without a final check (small models often do)", () => {
    const flow: FlowStep[] = [{ action: "fill", field: "name", value: "Ada" }, { action: "press", key: "Enter" }];
    const { scenarios, rejected } = suggestionsToScenarios(makePlan(), { suggestions: [suggestion("Book", 0, flow)] });
    expect(rejected).toEqual([]);
    expect(scenarios[0]!.flow).toEqual([...flow, { action: "expect", expect: "no-errors", text: null }]);
    expect(scenarios[0]!.description).toContain("no page errors");
  });

  it("still rejects a flow with no check when it has no room left for one", () => {
    const flow: FlowStep[] = Array.from({ length: 8 }, () => ({ action: "fill", field: "name", value: "Ada" }) as FlowStep);
    const { scenarios, rejected } = suggestionsToScenarios(makePlan(), { suggestions: [suggestion("Long", 0, flow)] });
    expect(scenarios).toEqual([]);
    expect(rejected).toEqual([expect.stringContaining("Long")]);
  });

  it("shortens a typed value over 200 characters instead of dropping the flow", () => {
    const flow: FlowStep[] = [{ action: "fill", field: "name", value: "x".repeat(500) }, expectOk];
    const { scenarios, rejected } = suggestionsToScenarios(makePlan(), { suggestions: [suggestion("Long note", 0, flow)] });
    expect(rejected).toEqual([]);
    const step = scenarios[0]!.flow![0]!;
    expect(step.action === "fill" && step.value.length).toBe(200);
  });

  it("describes a flow by what it checks, never by repeating the rationale", () => {
    const flow: FlowStep[] = [
      { action: "fill", field: "name", value: "Ada" },
      { action: "click", control: 2 },
      { action: "expect", expect: "text-visible", text: "Booked" },
      { action: "expect", expect: "no-errors", text: null },
    ];
    const { scenarios } = suggestionsToScenarios(makePlan(), { suggestions: [suggestion("Book", 0, flow, "Same text")] });
    expect(scenarios[0]!.description).toBe(
      '4 steps on the Book a sitter form; it passes when "Booked" is shown on the page and no page errors, console errors or failed requests.',
    );
    expect(scenarios[0]!.description).not.toContain("Same text");
  });

  it("turns a valid suggestion into an ai-flow scenario with exactly the contract's fields", () => {
    const plan = makePlan();
    const { scenarios, rejected } = suggestionsToScenarios(plan, { suggestions: [suggestion("Book a dog", 0, bookingFlow, "Booking is the main job")] });
    expect(rejected).toEqual([]);
    expect(scenarios).toEqual([
      {
        id: "ai-flow:1",
        checkId: "ai-flow",
        title: "Book a dog",
        // Not the rationale (the UI shows that separately): what the flow does and when it passes.
        description: "5 steps on the Book a sitter form; it passes when a save request reaches the app and succeeds.",
        kind: "golden",
        priority: "medium",
        destructive: false,
        defaultSelected: false,
        scope: "form",
        formIndex: 0,
        scopeLabel: formLabel(bookingForm()),
        flow: bookingFlow,
        ai: { rationale: "Booking is the main job", recommended: true, suggested: true },
      } satisfies Scenario,
    ]);
  });

  it("numbers kept suggestions ai-flow:1.. in answer order and uses the suggestion's form", () => {
    const plan = makePlan();
    const newsletterFlow: FlowStep[] = [{ action: "fill", field: "email", value: "a@b.co" }, { action: "click", control: 0 }, expectOk];
    const { scenarios } = suggestionsToScenarios(plan, {
      suggestions: [suggestion("Newsletter", 1, newsletterFlow), suggestion("Book", 0, bookingFlow)],
    });
    expect(scenarios.map((s) => [s.id, s.title, s.formIndex, s.scopeLabel])).toEqual([
      ["ai-flow:1", "Newsletter", 1, formLabel(newsletterForm())],
      ["ai-flow:2", "Book", 0, formLabel(bookingForm())],
    ]);
  });

  it("drops invalid suggestions and describes them in rejected", () => {
    const plan = makePlan();
    const { scenarios, rejected } = suggestionsToScenarios(plan, {
      suggestions: [
        suggestion("Good one", 0, bookingFlow),
        suggestion("Clicks a ghost", 0, [{ action: "click", control: 99 }, expectOk]),
        suggestion("Another good one", 0, [expectOk]),
      ],
    });
    expect(scenarios.map((s) => s.title)).toEqual(["Good one", "Another good one"]);
    expect(scenarios.map((s) => s.id)).toEqual(["ai-flow:1", "ai-flow:2"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("Clicks a ghost");
  });

  it("marks a flow destructive when it clicks a destructive control, and still leaves it unticked", () => {
    const { scenarios } = suggestionsToScenarios(makePlan(), {
      suggestions: [suggestion("Delete it", 0, [{ action: "click", control: 1 }, expectOk])],
    });
    expect(scenarios[0]!.destructive).toBe(true);
    expect(scenarios[0]!.defaultSelected).toBe(false);
  });

  it("marks a flow destructive when Enter in a field submits a form whose submit control is destructive", () => {
    // "Delete account" form: a confirm-email field and a destructive submit button. Enter submits it.
    const deleteForm = newsletterForm({
      name: "Delete your account",
      fields: [field({ key: "confirm", accessibleName: "Confirm your email", label: "Confirm your email", type: "email" })],
      controls: [control("Delete account", { isSubmit: true })],
    });
    const plan = makePlan({ page: discoveredPage({ forms: [bookingForm(), deleteForm] }) });
    const enterFlow: FlowStep[] = [{ action: "fill", field: "confirm", value: "a@b.co" }, { action: "press", key: "Enter" }, expectOk];
    const { scenarios } = suggestionsToScenarios(plan, { suggestions: [suggestion("Confirm by Enter", 1, enterFlow)] });
    expect(scenarios[0]!.destructive).toBe(true);
    expect(scenarios[0]!.defaultSelected).toBe(false);
    // Escape never submits.
    const escape = suggestionsToScenarios(plan, { suggestions: [suggestion("Escape", 1, [{ action: "fill", field: "confirm", value: "x" }, { action: "press", key: "Escape" }, expectOk])] });
    expect(escape.scenarios[0]!.destructive).toBe(false);
  });

  it("marks an Enter flow destructive when the form has no identifiable submit control and any control is destructive", () => {
    const noSubmit = newsletterForm({ controls: [control("Remove subscription")] });
    const plan = makePlan({ page: discoveredPage({ forms: [bookingForm(), noSubmit] }) });
    const { scenarios } = suggestionsToScenarios(plan, {
      suggestions: [suggestion("Enter", 1, [{ action: "fill", field: "email", value: "a@b.co" }, { action: "press", key: "Enter" }, expectOk])],
    });
    expect(scenarios[0]!.destructive).toBe(true);
  });

  it("does not mark an Enter flow destructive when the submit control is safe (a destructive non-submit control nearby)", () => {
    // bookingForm: "Delete account" is a plain button, "Book" is the submit control.
    const { scenarios } = suggestionsToScenarios(makePlan(), {
      suggestions: [suggestion("Enter", 0, [{ action: "fill", field: "name", value: "Ada" }, { action: "press", key: "Enter" }, expectOk])],
    });
    expect(scenarios[0]!.destructive).toBe(false);
  });

  it("trims titles and cuts them to 80 characters", () => {
    const { scenarios } = suggestionsToScenarios(makePlan(), {
      suggestions: [suggestion(`   ${"T".repeat(120)}  `, 0, [expectOk]), suggestion("  Short  ", 0, [expectOk])],
    });
    expect(scenarios[0]!.title.length).toBeLessThanOrEqual(80);
    expect(scenarios[0]!.title.startsWith("T")).toBe(true);
    expect(scenarios[1]!.title).toBe("Short");
  });

  it("keeps at most MAX_SUGGESTIONS", () => {
    expect(MAX_SUGGESTIONS).toBe(5);
    const answer: SuggestAnswer = { suggestions: Array.from({ length: 7 }, (_, i) => suggestion(`Flow ${i + 1}`, 0, [expectOk])) };
    const { scenarios } = suggestionsToScenarios(makePlan(), answer);
    expect(scenarios.map((s) => s.id)).toEqual(["ai-flow:1", "ai-flow:2", "ai-flow:3", "ai-flow:4", "ai-flow:5"]);
    expect(scenarios.map((s) => s.title)).toEqual(["Flow 1", "Flow 2", "Flow 3", "Flow 4", "Flow 5"]);
  });

  it("does not mutate the plan or the answer", () => {
    const plan = makePlan();
    const answer: SuggestAnswer = { suggestions: [suggestion("  Padded  ", 0, bookingFlow)] };
    const before = structuredClone({ plan, answer });
    suggestionsToScenarios(plan, answer);
    expect({ plan, answer }).toEqual(before);
  });
});

function aiScenario(n: number): Scenario {
  return scenario({
    id: `ai-flow:${n}`,
    checkId: "ai-flow",
    title: `Flow ${n}`,
    defaultSelected: false,
    flow: [expectOk],
    ai: { rationale: "r", recommended: true, suggested: true },
  });
}

describe("addSuggestions", () => {
  it("places suggestions after the Features built-ins and appends them to the Features group", () => {
    const plan = makePlan();
    const out = addSuggestions(plan, [aiScenario(1), aiScenario(2)]);
    expect(out.scenarios.map((s) => s.id)).toEqual([
      "axe:1",
      "dead-control:1",
      "double-submit:1",
      "persistence:1",
      "ai-flow:1",
      "ai-flow:2",
      "security-headers:1",
    ]);
    expect(out.groups).toEqual([
      plan.groups[0],
      { id: "features", label: "Features", scenarioIds: ["dead-control:1", "double-submit:1", "persistence:1", "ai-flow:1", "ai-flow:2"] },
      plan.groups[2],
    ]);
  });

  it("creates the Features group in CHECK_GROUPS order when the plan has none", () => {
    const base = makePlan();
    const plan = makePlan({ scenarios: base.scenarios.filter((s) => s.checkId === "axe-states" || s.checkId === "security-headers") });
    expect(plan.groups.map((g) => g.id)).toEqual(["accessibility", "security"]);
    const out = addSuggestions(plan, [aiScenario(1)]);
    expect(out.scenarios.map((s) => s.id)).toEqual(["axe:1", "ai-flow:1", "security-headers:1"]);
    expect(out.groups).toEqual([
      { id: "accessibility", label: "Accessibility", scenarioIds: ["axe:1"] },
      { id: "features", label: "Features", scenarioIds: ["ai-flow:1"] },
      { id: "security", label: "Security", scenarioIds: ["security-headers:1"] },
    ]);
  });

  it("creates the Features group first when only Security exists", () => {
    const plan = makePlan({ scenarios: makePlan().scenarios.filter((s) => s.checkId === "security-headers") });
    const out = addSuggestions(plan, [aiScenario(1)]);
    expect(out.scenarios.map((s) => s.id)).toEqual(["ai-flow:1", "security-headers:1"]);
    expect(out.groups.map((g) => g.id)).toEqual(["features", "security"]);
  });

  it("skips scenarios whose id is already taken", () => {
    const plan = addSuggestions(makePlan(), [aiScenario(1)]);
    const out = addSuggestions(plan, [{ ...aiScenario(1), title: "Duplicate" }, aiScenario(2), { ...aiScenario(3), id: "axe:1" }]);
    expect(out.scenarios.filter((s) => s.id === "ai-flow:1")).toHaveLength(1);
    expect(out.scenarios.find((s) => s.id === "ai-flow:1")!.title).toBe("Flow 1");
    expect(out.scenarios.filter((s) => s.id === "axe:1")).toHaveLength(1);
    expect(out.scenarios.find((s) => s.id === "axe:1")!.checkId).toBe("axe-states");
    expect(out.groups.find((g) => g.id === "features")!.scenarioIds.slice(-2)).toEqual(["ai-flow:1", "ai-flow:2"]);
    expect(out.scenarios).toHaveLength(makePlan().scenarios.length + 2);
  });

  it("returns an equal plan for no suggestions and never mutates the input", () => {
    const plan = makePlan();
    const before = structuredClone(plan);
    expect(addSuggestions(plan, [])).toEqual(plan);
    addSuggestions(plan, [aiScenario(1)]);
    expect(plan).toEqual(before);
  });
});

describe("suggestScenarios", () => {
  it("asks the model with the suggest schema and adds the valid flows to the plan", async () => {
    const plan = makePlan();
    const client = new FakeClient([
      { suggestions: [suggestion("Book a dog", 0, bookingFlow), suggestion("Fill a ghost", 0, [{ action: "fill", field: "ghost", value: "x" }, expectOk])] },
    ]);
    const controller = new AbortController();
    const now = new Date("2031-03-07T10:00:00Z");
    const { plan: out, rejected } = await suggestScenarios(plan, client, { remote: true, signal: controller.signal, now });

    expect(client.requests).toHaveLength(1);
    const request = client.requests[0]!;
    expect(request.name).toMatch(/^[a-z_]+$/);
    expect(request.schema).toEqual(SUGGEST_SCHEMA);
    expect(request.signal).toBe(controller.signal);
    const expected = suggestPrompt(describePage(plan, { remote: true }), { now });
    expect(request.user).toBe(expected.user);
    expect(request.system).toBe(expected.system);

    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("Fill a ghost");
    const added = out.scenarios.filter((s) => s.checkId === "ai-flow");
    expect(added.map((s) => [s.id, s.title, s.defaultSelected])).toEqual([["ai-flow:1", "Book a dog", false]]);
    expect(out.groups.find((g) => g.id === "features")!.scenarioIds).toContain("ai-flow:1");
    expect(plan.scenarios.some((s) => s.checkId === "ai-flow")).toBe(false);
  });

  it("rejects with the client's AiError", async () => {
    const client = new FakeClient([new AiError("bad-output", "Not JSON")]);
    const error = await suggestScenarios(makePlan(), client, { remote: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("bad-output");
  });
});
