import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { createLlmClient } from "../../../src/ai/client.js";
import { DEFAULT_AI_CONFIG } from "../../../src/ai/config.js";
import { FAKE_AWS_KEY, FakeClient, REDACTED_AWS, schemaProblems } from "../../../src/ai/test-fixtures.js";
import { AiError, type AiConfig } from "../../../src/ai/types.js";
import { BRIEF_DRAFT_SCHEMA, briefDraftPrompt, draftBriefWithModel, validateBriefDraft } from "../../../src/agent/draft-brief.js";
import type { BriefDraft, BriefDraftAnswer, TestingBrief } from "../../../src/interfaces/agent.js";

/**
 * The model's one call for a brief (docs/agent-spec.md "Briefs" → Drafting, and the JSDoc of src/agent/draft-brief.ts).
 *
 * Contract these tests pin down (interpretations marked *):
 * - BRIEF_DRAFT_SCHEMA: {expectations, scopePaths, testData: [{name, value}], questions: [{kind, text, options,
 *   dataName}]} in the portable subset (ai/types.ts JsonSchema): every property required, additionalProperties
 *   false, dataName nullable (not optional), no numeric or length limits. * options is nullable (the answer type is
 *   string[] | null) or a plain list in which [] means free text; validateBriefDraft accepts both null and [].
 * - validateBriefDraft: accepts a BriefDraftAnswer by shape and types only (limits and kinds are applyModelDraft's
 *   business, so 20 expectations and an unknown kind pass); throws an Error that names the field otherwise.
 * - briefDraftPrompt: the start page is its path for a remote model and its origin and path for a local one; the
 *   model sees which of accounts A and B are ready and nothing else about accounts; the goal and the ticket text are
 *   described as the user's; the model never decides pass or fail.
 *   * The prompt tells the model the six question kinds (the others are dropped, so it has to know them).
 *   * The goal and ticket text are redacted again in the prompt (defence in depth; redacting twice is harmless).
 *   * The account labels and usernames can't be tested at this level (the function is not given them); the HTTP
 *     tests save an account and check that no request to the model holds them.
 * - draftBriefWithModel: briefDraftPrompt + generateJson with the schema name "brief_draft", BRIEF_DRAFT_SCHEMA and
 *   validateBriefDraft; resolves to the validated answer, rejects with AiError when the call fails.
 */

const ORIGIN = "http://127.0.0.1:5173";
const PATH = "/app/tasks";
const GOAL = "Check that adding a task saves it and that the list updates";
const TICKET = "Acceptance criteria\n- A saved task appears in the list\n- An empty title is refused";
const FEATURE = "Task list";

function brief(over: Partial<TestingBrief> = {}): TestingBrief {
  return {
    version: 1,
    goal: GOAL,
    feature: FEATURE,
    ticketContext: TICKET,
    target: { origin: ORIGIN, startPath: PATH },
    scopePaths: [],
    expectations: [
      { text: "A saved task appears in the list", source: "supplied" },
      { text: "An empty title is refused", source: "supplied" },
    ],
    account: "a",
    testData: {},
    permittedActions: ["observation", "test-data-creation"],
    mutationPermissions: { createTestRecords: true, modifyExisting: false, delete: false, changeCredentials: false, externalWrite: false },
    approval: null,
    ...over,
  };
}

function draft(over: Partial<TestingBrief> = {}): BriefDraft {
  return { id: "brief-1", brief: brief(over), questions: [], warnings: [], hash: null };
}

const READY = { a: true, b: false };
const LOCAL = { remote: false, accountsReady: READY };
const REMOTE = { remote: true, accountsReady: READY };
const both = (p: { system: string; user: string }) => `${p.system}\n${p.user}`;

const GOOD: BriefDraftAnswer = {
  expectations: ["The task count updates after saving", "A very long title is cut or wrapped"],
  scopePaths: ["/app", "/app/tasks"],
  testData: [{ name: "task title", value: "Buy milk {canary}" }],
  questions: [
    { kind: "permission", text: "May the agent change existing tasks?", options: ["yes", "no"], dataName: null },
    { kind: "test-data", text: "What title should it type?", options: null, dataName: "task title" },
  ],
};

/** Throws the Error the call threw, after checking it is a real, helpful one and not a stub's. */
function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const err = error as Error;
    expect(err.message).not.toMatch(/not implemented/i);
    expect(err.message.trim()).not.toBe("");
    return err;
  }
  throw new Error("expected a throw");
}

describe("BRIEF_DRAFT_SCHEMA", () => {
  type Schema = { type: unknown; properties: Record<string, any>; required: string[]; additionalProperties: unknown };
  const schema = () => BRIEF_DRAFT_SCHEMA as unknown as Schema;

  it("is an object schema in the portable subset", () => {
    expect(BRIEF_DRAFT_SCHEMA.type).toBe("object");
    expect(schemaProblems(BRIEF_DRAFT_SCHEMA)).toEqual([]);
    expect(schema().additionalProperties).toBe(false);
  });

  it("asks for expectations, scopePaths, testData and questions, all required", () => {
    expect(Object.keys(schema().properties).sort()).toEqual(["expectations", "questions", "scopePaths", "testData"]);
    expect([...schema().required].sort()).toEqual(["expectations", "questions", "scopePaths", "testData"]);
    expect(schema().properties.expectations).toMatchObject({ type: "array", items: { type: "string" } });
    expect(schema().properties.scopePaths).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("describes test data as {name, value} strings", () => {
    const item = schema().properties.testData.items;
    expect(schema().properties.testData.type).toBe("array");
    expect(Object.keys(item.properties).sort()).toEqual(["name", "value"]);
    expect([...item.required].sort()).toEqual(["name", "value"]);
    expect(item.properties.name).toMatchObject({ type: "string" });
    expect(item.properties.value).toMatchObject({ type: "string" });
    expect(item.additionalProperties).toBe(false);
  });

  it("describes a question as {kind, text, options, dataName}, all required, dataName nullable (options nullable or a list)", () => {
    const item = schema().properties.questions.items;
    expect(schema().properties.questions.type).toBe("array");
    expect(Object.keys(item.properties).sort()).toEqual(["dataName", "kind", "options", "text"]);
    expect([...item.required].sort()).toEqual(["dataName", "kind", "options", "text"]);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.kind).toMatchObject({ type: "string" });
    expect(item.properties.text).toMatchObject({ type: "string" });
    const nullable = (s: { type?: unknown; anyOf?: { type?: unknown }[] }) => (Array.isArray(s.type) ? s.type.includes("null") : (s.anyOf ?? []).some((x) => x.type === "null"));
    expect(nullable(item.properties.dataName)).toBe(true);
    // No options is null (BriefDraftAnswer.options is string[] | null); * an array schema is fine too, [] meaning free text.
    expect(nullable(item.properties.options) || item.properties.options.type === "array").toBe(true);
  });
});

describe("validateBriefDraft", () => {
  it("accepts a well-formed answer and returns it", () => {
    expect(validateBriefDraft(GOOD)).toEqual(GOOD);
  });

  it("accepts empty lists", () => {
    const empty: BriefDraftAnswer = { expectations: [], scopePaths: [], testData: [], questions: [] };
    expect(validateBriefDraft(empty)).toEqual(empty);
  });

  it("accepts questions with and without options and a data name", () => {
    const answer: BriefDraftAnswer = {
      ...GOOD,
      questions: [
        { kind: "scope", text: "Which section?", options: ["/app", "/settings"], dataName: null },
        { kind: "expectation", text: "What should happen?", options: null, dataName: null },
        { kind: "test-data", text: "What title?", options: null, dataName: "task title" },
      ],
    };
    expect(validateBriefDraft(answer)).toEqual(answer);
  });

  it("accepts an empty options list as well as null (*)", () => {
    const answer: BriefDraftAnswer = { ...GOOD, questions: [{ kind: "expectation", text: "What should happen?", options: [], dataName: null }] };
    expect(() => validateBriefDraft(answer)).not.toThrow(/^(?![\s\S]*not implemented)/);
    expect(validateBriefDraft(answer).questions).toHaveLength(1);
  });

  it("leaves limits and kinds to applyModelDraft: too many entries and an unknown kind pass", () => {
    const answer: BriefDraftAnswer = {
      expectations: Array.from({ length: 20 }, (_, i) => `Expectation ${i + 1}`),
      scopePaths: ["not a path", "https://evil.example"],
      testData: [{ name: "password", value: "x" }],
      questions: [{ kind: "banana", text: "Odd?", options: null, dataName: null }],
    };
    expect(validateBriefDraft(answer)).toEqual(answer);
  });

  it.each<[string, unknown, RegExp | null]>([
    ["null", null, null],
    ["a string", "expectations", null],
    ["a number", 3, null],
    ["an array", [], null],
    ["an empty object", {}, /expectations/],
    ["expectations that is not an array", { ...GOOD, expectations: "one" }, /expectations/],
    ["an expectation that is not a string", { ...GOOD, expectations: ["fine", 2] }, /expectations/],
    ["no scopePaths", { expectations: [], testData: [], questions: [] }, /scopePaths/],
    ["scopePaths that is not an array", { ...GOOD, scopePaths: "/app" }, /scopePaths/],
    ["a scope path that is not a string", { ...GOOD, scopePaths: [1] }, /scopePaths/],
    ["no testData", { expectations: [], scopePaths: [], questions: [] }, /testData/],
    ["testData as an object instead of a list", { ...GOOD, testData: { "task title": "x" } }, /testData/],
    ["a test-data entry that is not an object", { ...GOOD, testData: ["task title"] }, /testData/],
    ["a test-data entry without a value", { ...GOOD, testData: [{ name: "task title" }] }, /value/],
    ["a test-data value that is not a string", { ...GOOD, testData: [{ name: "task title", value: 5 }] }, /value/],
    ["a test-data name that is not a string", { ...GOOD, testData: [{ name: 5, value: "x" }] }, /name/],
    ["no questions", { expectations: [], scopePaths: [], testData: [] }, /questions/],
    ["questions that is not an array", { ...GOOD, questions: {} }, /questions/],
    ["a question that is not an object", { ...GOOD, questions: ["May I?"] }, /questions/],
    ["a question without a kind", { ...GOOD, questions: [{ text: "Q?", options: null, dataName: null }] }, /kind/],
    ["a question kind that is not a string", { ...GOOD, questions: [{ kind: 1, text: "Q?", options: null, dataName: null }] }, /kind/],
    ["a question without text", { ...GOOD, questions: [{ kind: "scope", options: null, dataName: null }] }, /text/],
    ["question text that is not a string", { ...GOOD, questions: [{ kind: "scope", text: 3, options: null, dataName: null }] }, /text/],
    ["options that is a string", { ...GOOD, questions: [{ kind: "scope", text: "Q?", options: "a,b", dataName: null }] }, /options/],
    ["an option that is not a string", { ...GOOD, questions: [{ kind: "scope", text: "Q?", options: ["a", 2], dataName: null }] }, /options/],
    ["a dataName that is a number", { ...GOOD, questions: [{ kind: "test-data", text: "Q?", options: null, dataName: 7 }] }, /dataName/],
  ])("rejects %s with an Error that says what is wrong", (_name, value, field) => {
    const error = thrownBy(() => validateBriefDraft(value));
    if (field) expect(error.message).toMatch(field);
  });
});

describe("briefDraftPrompt", () => {
  it("gives a system and a user prompt, both with text", () => {
    const p = briefDraftPrompt(draft(), LOCAL);
    expect(p.system.trim()).not.toBe("");
    expect(p.user.trim()).not.toBe("");
  });

  it("carries the goal, the ticket text and the feature name", () => {
    const text = both(briefDraftPrompt(draft(), LOCAL));
    expect(text).toContain(GOAL);
    expect(text).toContain("A saved task appears in the list");
    expect(text).toContain("An empty title is refused");
    expect(text).toContain(FEATURE);
  });

  it("leaves out the feature and the ticket when there are none, without printing undefined", () => {
    const text = both(briefDraftPrompt(draft({ feature: null, ticketContext: null }), LOCAL));
    expect(text).toContain(GOAL);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("[object");
  });

  it("shows a remote model only the path of the start page, never the origin", () => {
    const text = both(briefDraftPrompt(draft(), REMOTE));
    expect(text).toContain(PATH);
    expect(text).not.toContain(ORIGIN);
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("5173");
  });

  it("shows a local model the origin and the path", () => {
    const text = both(briefDraftPrompt(draft(), LOCAL));
    expect(text).toContain(ORIGIN);
    expect(text).toContain(PATH);
  });

  it("tells the model which of accounts A and B are ready, differently for each combination", () => {
    const prompts = [
      { a: false, b: false },
      { a: true, b: false },
      { a: false, b: true },
      { a: true, b: true },
    ].map((accountsReady) => briefDraftPrompt(draft(), { remote: false, accountsReady }).user);
    expect(new Set(prompts).size).toBe(4);
  });

  it("is the same for the same input", () => {
    expect(briefDraftPrompt(draft(), LOCAL)).toEqual(briefDraftPrompt(draft(), LOCAL));
  });

  it("says the goal and the ticket text are the user's", () => {
    expect(both(briefDraftPrompt(draft(), LOCAL))).toMatch(/user'?s|from the user|by the user|user wrote|user typed|user pasted/i);
  });

  it("says the model never decides whether anything passes or fails", () => {
    const text = both(briefDraftPrompt(draft(), LOCAL));
    expect(text).toMatch(/pass(es)? or fail/i);
    expect(text).toMatch(/never|not decide|cannot|can't|do not|don't/i);
  });

  it("names the question kinds the model may use (*)", () => {
    const { system } = briefDraftPrompt(draft(), LOCAL);
    for (const kind of ["expectation", "start-path", "scope", "test-data", "account", "permission"]) expect(system).toContain(kind);
  });

  it("redacts secrets in the goal and the ticket text (*)", () => {
    const text = both(briefDraftPrompt(draft({ goal: `Sign in with key ${FAKE_AWS_KEY}`, ticketContext: `- uses ${FAKE_AWS_KEY}` }), LOCAL));
    expect(text).not.toContain(FAKE_AWS_KEY);
    expect(text).toContain(REDACTED_AWS);
  });

  it("does not change the draft", () => {
    const d = draft();
    const snapshot = structuredClone(d);
    briefDraftPrompt(d, REMOTE);
    expect(d).toEqual(snapshot);
  });
});

describe("draftBriefWithModel with a scripted client", () => {
  it("resolves to the validated answer", async () => {
    const client = new FakeClient([GOOD]);
    expect(await draftBriefWithModel(client, draft(), LOCAL)).toEqual(GOOD);
    expect(client.requests).toHaveLength(1);
  });

  it("asks once, named brief_draft, with BRIEF_DRAFT_SCHEMA and the prompt for these options", async () => {
    const client = new FakeClient([GOOD]);
    await draftBriefWithModel(client, draft(), REMOTE);
    const sent = client.requests[0]!;
    const prompt = briefDraftPrompt(draft(), REMOTE);
    expect(sent.name).toBe("brief_draft");
    expect(sent.schema).toEqual(BRIEF_DRAFT_SCHEMA);
    expect(sent.system).toBe(prompt.system);
    expect(sent.user).toBe(prompt.user);
    expect(both(sent)).not.toContain(ORIGIN);
  });

  it("sends the origin to a local model", async () => {
    const client = new FakeClient([GOOD]);
    await draftBriefWithModel(client, draft(), LOCAL);
    expect(both(client.requests[0]!)).toContain(ORIGIN);
  });

  it("validates with validateBriefDraft", async () => {
    const client = new FakeClient([GOOD]);
    await draftBriefWithModel(client, draft(), LOCAL);
    const { validate } = client.requests[0]!;
    expect(validate(GOOD)).toEqual(GOOD);
    expect(() => validate({ expectations: "nope" })).toThrow(/^(?![\s\S]*not implemented)[\s\S]+/);
  });

  it("passes the abort signal on", async () => {
    const client = new FakeClient([GOOD]);
    const controller = new AbortController();
    await draftBriefWithModel(client, draft(), { ...LOCAL, signal: controller.signal });
    expect(client.requests[0]!.signal).toBe(controller.signal);
  });
});

describe("draftBriefWithModel against the fake model server", () => {
  let fake: FakeLlm;
  beforeEach(async () => {
    fake = await startFakeLlm();
  });
  afterEach(async () => {
    await fake.close();
  });

  const config = (over: Partial<AiConfig> = {}): AiConfig => ({
    ...DEFAULT_AI_CONFIG,
    enabled: true,
    provider: "openai-compatible",
    baseUrl: fake.baseUrl,
    model: "fake-model:9b",
    timeoutMs: 10_000,
    ...over,
  });

  async function caught(promise: Promise<unknown>): Promise<AiError> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      return error as AiError;
    }
    throw new Error("expected the call to reject");
  }

  it("returns the model's answer and sends the schema as brief_draft", async () => {
    fake.reply(GOOD);
    const answer = await draftBriefWithModel(createLlmClient(config(), { env: {} }), draft(), LOCAL);
    expect(answer).toEqual(GOOD);
    expect(fake.calls).toHaveLength(1);
    const body = fake.calls[0]!.body;
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("brief_draft");
    expect(body.response_format.json_schema.schema).toEqual(BRIEF_DRAFT_SCHEMA);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toContain(GOAL);
  });

  it("sends the schema to an Ollama-style endpoint too", async () => {
    fake.reply(GOOD);
    await draftBriefWithModel(createLlmClient(config({ provider: "ollama" }), { env: {} }), draft(), LOCAL);
    expect(fake.calls[0]!.path).toBe("/api/chat");
    expect(fake.calls[0]!.body.format).toEqual(BRIEF_DRAFT_SCHEMA);
  });

  it("sends a remote-style prompt without the origin", async () => {
    fake.reply(GOOD);
    await draftBriefWithModel(createLlmClient(config(), { env: {} }), draft(), REMOTE);
    const sent = JSON.stringify(fake.calls[0]!.body.messages);
    expect(sent).toContain(PATH);
    expect(sent).not.toContain("127.0.0.1");
  });

  it("asks once more when the first answer has the wrong shape, then returns the good one", async () => {
    fake.reply({ expectations: "nope" }, GOOD);
    const answer = await draftBriefWithModel(createLlmClient(config(), { env: {} }), draft(), LOCAL);
    expect(answer).toEqual(GOOD);
    expect(fake.calls).toHaveLength(2);
  });

  it("rejects with AiError bad-output when the answer is not valid twice", async () => {
    fake.reply({ raw: "I am not JSON" });
    const error = await caught(draftBriefWithModel(createLlmClient(config(), { env: {} }), draft(), LOCAL));
    expect(error.code).toBe("bad-output");
    expect(fake.calls).toHaveLength(2);
  });

  it("rejects with AiError http when the server fails", async () => {
    fake.reply({ status: 500, body: '{"error":"boom"}' });
    const error = await caught(draftBriefWithModel(createLlmClient(config(), { env: {} }), draft(), LOCAL));
    expect(error.code).toBe("http");
  });
});
