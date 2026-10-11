import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BRIEF_LIMITS, DEFAULT_BRIEF_ACTIONS } from "../../../src/config/agent.js";
import type { BriefDraft, BriefDraftAnswer, BriefEdit, BriefQuestion, TestingBrief } from "../../../src/interfaces/agent.js";
import type { ActionClass } from "../../../src/types/grant.js";
import type { BriefQuestionKind } from "../../../src/types/agent.js";
import {
  applyModelDraft,
  approvalProblems,
  approveDraft,
  briefHash,
  editDraft,
  isBriefPath,
  newDraft,
  ticketExpectations,
  type CheckedBriefRequest,
} from "../../../src/agent/brief.js";

/**
 * The pure functions behind testing briefs (docs/agent-spec.md "Briefs", and the JSDoc of src/agent/brief.ts).
 *
 * Contract these tests pin down (interpretations marked *):
 * - isBriefPath: starts with "/", at most 2,048 characters, no scheme, no "//", no "..", no query or hash.
 * - ticketExpectations: each list line ("- ", "* ", "• ", "1. ", "- [ ] ") without its marker, collapsed to one
 *   line, cut to 300 characters, duplicates dropped, at most 20. null or no list lines → [].
 *   * Whitespace inside a line collapses to single spaces ("collapsed to one line" read as oneLine()). Continuation
 *     lines are not joined into the item above them (not tested either way). A marker with nothing after it gives
 *     no expectation. Indented list lines and CRLF line ends count. "10. " is a numbered marker. "1.5 s" and "-x"
 *     (no space after the marker) are prose. Duplicates are compared after cleaning (the same text, one line).
 * - newDraft: the checked request + the ticket's supplied expectations; permittedActions = DEFAULT_BRIEF_ACTIONS (a
 *   copy *); mutationPermissions {createTestRecords: true, modifyExisting: false, delete/changeCredentials/
 *   externalWrite: false}; no questions, no warnings, approval null, hash null, version 1, empty scope and test data.
 * - applyModelDraft: the model's expectations are "inferred", after the supplied ones, repeats skipped, at most 8;
 *   up to 5 scope paths that pass isBriefPath; up to 8 test-data values whose names don't look like a credential
 *   (password, secret, token, key); up to 3 questions of a known kind. Each drop of a path, a name, an unknown kind or
 *   a question beyond the third adds a warning. It never changes what the brief permits.
 *   * One warning per drop ("Each drop adds a warning"); the JSDoc adds "What was dropped is named in the draft's
 *     warnings", tested apart from the count (it.each "names ... it dropped"). A credential-like test-data warning
 *     never holds the value. Overflow of expectations, scope paths and test data is cut without a warning being
 *     required (the spec lists warnings only for the drops above). More than 6 options are cut to six or the question
 *     takes free text. Over-long strings are cut or the entry dropped (only "within the limit" is
 *     tested). Blank model expectations are ignored. dataName is kept for test-data questions and null otherwise.
 *     A pure function: the draft it is given is not changed.
 * - editDraft: an expectation whose text matches an existing one keeps that one's source, any other text is
 *   supplied; the client can't set a source; allowModification toggles "modification" and modifyExisting; answers are
 *   applied by question kind (expectation → supplied expectation, start-path → startPath, scope → scope path,
 *   test-data → the value named by dataName, account → a | b | signed-out, permission → yes | no); null dismisses; a
 *   question is settled once answered or dismissed; an invalid edit returns {problems} and applies nothing; any change
 *   clears approval and hash.
 *   * The account's readiness is the flow's business (editDraft is pure), so only the vocabulary is checked here.
 *   * Invalid: an empty or over-long goal (2,000), feature (80) or ticket (8,000); an over-long (300) expectation,
 *     more than 30; a start path or scope path that isn't a brief path; testData over 8 values or a value over 200;
 *     an account other than a, b or null; an answer for an unknown question; an answer that its kind rejects. A blank
 *     expectation and a test-data name over 40 characters are refused or dealt with (ignored, cut): only "never
 *     kept as sent" is tested. A goal problem may say "goal" or "what to test" (the New run page's words). Surrounding whitespace doesn't stop a text from matching. testData replaces the
 *     whole table. A scope answer that is already in the scope adds nothing twice. An edit that changes nothing is
 *     not tested against approval (the spec says "any change").
 *   * A client that sends expectations as objects with a source gets either problems or no effect on the source.
 * - approvalProblems: no goal, no expectation, an open question (settled false). * A problem names the question by
 *   its text or its id. Dismissed questions (settled, answer null) are not open.
 * - approveDraft: approval {by, at: at.toISOString()} and hash = briefHash(brief).
 * - briefHash: SHA-256 hex of the brief with approval null, as JSON with keys sorted at every level.
 *   * Compact JSON.stringify output; arrays keep their order (reordering expectations changes the hash).
 */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;

const request: CheckedBriefRequest = {
  goal: "Check that adding a task saves it",
  ticketContext: null,
  feature: null,
  account: null,
  target: { origin: "http://127.0.0.1:5173", startPath: "/app/tasks" },
};

const DEFAULT_MUTATIONS = { createTestRecords: true, modifyExisting: false, delete: false, changeCredentials: false, externalWrite: false };

function brief(over: Partial<TestingBrief> = {}): TestingBrief {
  return {
    version: 1,
    goal: "Check that adding a task saves it",
    feature: null,
    ticketContext: null,
    target: { origin: "http://127.0.0.1:5173", startPath: "/app/tasks" },
    scopePaths: [],
    expectations: [],
    account: null,
    testData: {},
    permittedActions: ["observation", "test-data-creation"],
    mutationPermissions: { ...DEFAULT_MUTATIONS },
    approval: null,
    ...over,
  };
}

function draft(over: Partial<TestingBrief> = {}, rest: Partial<Omit<BriefDraft, "brief">> = {}): BriefDraft {
  return { id: "brief-1", brief: brief(over), questions: [], warnings: [], hash: null, ...rest };
}

/** supplied S1, S2 and inferred I1, I2, in that order. */
function mixed(over: Partial<TestingBrief> = {}, rest: Partial<Omit<BriefDraft, "brief">> = {}): BriefDraft {
  return draft(
    {
      expectations: [
        { text: "S1 a saved task appears in the list", source: "supplied" },
        { text: "S2 empty titles are refused", source: "supplied" },
        { text: "I1 the task count updates after saving", source: "inferred" },
        { text: "I2 titles are trimmed", source: "inferred" },
      ],
      ...over,
    },
    rest,
  );
}

function question(id: string, kind: BriefQuestionKind, over: Partial<BriefQuestion> = {}): BriefQuestion {
  return { id, kind, text: `Question ${id}?`, options: null, dataName: null, answer: null, settled: false, ...over };
}

const APPROVAL = { by: "self", at: "2026-10-09T10:00:00.000Z" };
function approved(base: BriefDraft = mixed()): BriefDraft {
  return { ...base, brief: { ...base.brief, approval: { ...APPROVAL } }, hash: "a".repeat(64) };
}

function edited(d: BriefDraft, edit: BriefEdit): BriefDraft {
  const result = editDraft(d, edit);
  if (!("draft" in result)) throw new Error(`expected an edited draft, got problems: ${result.problems.join("; ")}`);
  return result.draft;
}

function problemsOf(d: BriefDraft, edit: BriefEdit): string[] {
  const result = editDraft(d, edit);
  if (!("problems" in result)) throw new Error("expected problems, but the edit was applied");
  return result.problems;
}

const texts = (d: BriefDraft) => d.brief.expectations.map((e) => e.text);
const sourceOf = (d: BriefDraft, text: string) => d.brief.expectations.find((e) => e.text === text)?.source;
const sameSet = (actual: readonly ActionClass[], expected: readonly ActionClass[]) => expect([...actual].sort()).toEqual([...expected].sort());
const lines = (n: number, make: (i: number) => string = (i) => `Expectation number ${i}`) => Array.from({ length: n }, (_, i) => make(i + 1));

describe("isBriefPath", () => {
  it.each(["/", "/app", "/app/", "/app/tasks", "/app/tasks/new", "/a-b_c.d/e~f", "/Tasks/42"])("accepts %s", (path) => {
    expect(isBriefPath(path)).toBe(true);
  });

  it("accepts a path of exactly 2,048 characters and rejects one of 2,049", () => {
    expect(isBriefPath(`/${"a".repeat(2047)}`)).toBe(true);
    expect(isBriefPath(`/${"a".repeat(2048)}`)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not starting with a slash", "app/tasks"],
    ["a bare word", "tasks"],
    ["an absolute URL", "https://evil.example/app"],
    ["a scheme", "javascript:alert(1)"],
    ["a scheme-relative URL", "//evil.example/app"],
    ["a double slash inside", "/app//tasks"],
    ["a scheme and a double slash inside", "/redirect/https://evil.example"],
    ["a parent segment alone", "/.."],
    ["a parent segment first", "/../etc/passwd"],
    ["a parent segment in the middle", "/app/../admin"],
    ["a query", "/app/tasks?x=1"],
    ["a hash", "/app/tasks#top"],
    ["a query and a hash", "/app?x=1#top"],
    ["only a query", "?x=1"],
    ["only a hash", "#top"],
  ])("rejects %s", (_name, path) => {
    expect(isBriefPath(path)).toBe(false);
  });
});

describe("ticketExpectations", () => {
  it("returns nothing for null, empty or blank text", () => {
    expect(ticketExpectations(null)).toEqual([]);
    expect(ticketExpectations("")).toEqual([]);
    expect(ticketExpectations("  \n \n\t ")).toEqual([]);
  });

  it("returns nothing for text that has no list lines", () => {
    expect(ticketExpectations("Acceptance criteria\nThe form should save.\nSee the design doc.")).toEqual([]);
  });

  it.each([
    ["a dash", "- Saving shows a toast"],
    ["an asterisk", "* Saving shows a toast"],
    ["a bullet", "• Saving shows a toast"],
    ["a number", "1. Saving shows a toast"],
    ["an unchecked box", "- [ ] Saving shows a toast"],
  ])("takes a line that starts with %s, without the marker", (_name, line) => {
    expect(ticketExpectations(line)).toEqual(["Saving shows a toast"]);
  });

  it("takes every marker in one ticket, in order, and skips prose between them", () => {
    const ticket = [
      "As a user I want to add tasks.",
      "Acceptance criteria:",
      "- A saved task appears in the list",
      "* An empty title is refused",
      "• Tasks are sorted by date",
      "1. The count updates",
      "2. The form clears",
      "- [ ] A toast confirms the save",
      "",
      "Notes: ask design.",
    ].join("\n");
    expect(ticketExpectations(ticket)).toEqual([
      "A saved task appears in the list",
      "An empty title is refused",
      "Tasks are sorted by date",
      "The count updates",
      "The form clears",
      "A toast confirms the save",
    ]);
  });

  it("takes a multi-digit number as a marker (*)", () => {
    expect(ticketExpectations("10. The tenth thing")).toEqual(["The tenth thing"]);
  });

  it("takes indented list lines and CRLF line ends (*)", () => {
    expect(ticketExpectations("  - Nested item\r\n- Next item\r\n")).toEqual(["Nested item", "Next item"]);
  });

  it("collapses the whitespace inside a line to one line (*)", () => {
    expect(ticketExpectations("-   Saving   shows\ta  toast   ")).toEqual(["Saving shows a toast"]);
  });

  it("does not treat prose that merely starts like a marker as a list line (*)", () => {
    expect(ticketExpectations("1.5 seconds is too slow\n-not a list\n*emphasis*")).toEqual([]);
  });

  it("gives no expectation for a marker with nothing after it (*)", () => {
    expect(ticketExpectations("- \n-\n* \n1. \n- Real one")).toEqual(["Real one"]);
  });

  it("cuts each expectation to 300 characters and keeps one of exactly 300", () => {
    expect(BRIEF_LIMITS.expectationChars).toBe(300);
    const [cut] = ticketExpectations(`- ${"x".repeat(400)}`);
    expect(cut).toBe("x".repeat(300));
    expect(ticketExpectations(`- ${"y".repeat(300)}`)).toEqual(["y".repeat(300)]);
  });

  it("drops duplicates, keeping the first (*: compared after cleaning)", () => {
    expect(ticketExpectations("- Same\n* Same\n- Other\n- Same\n1. Same")).toEqual(["Same", "Other"]);
    expect(ticketExpectations("- Same thing\n* Same   thing")).toEqual(["Same thing"]);
  });

  it("keeps at most 20, the first ones, in order", () => {
    expect(BRIEF_LIMITS.ticketExpectations).toBe(20);
    const all = lines(30);
    const found = ticketExpectations(all.map((l) => `- ${l}`).join("\n"));
    expect(found).toHaveLength(20);
    expect(found).toEqual(all.slice(0, 20));
  });
});

describe("newDraft", () => {
  it("starts from the checked request", () => {
    const d = newDraft("brief-7", { goal: "Check tasks", ticketContext: "Prose only", feature: "Tasks", account: "a", target: { origin: "http://localhost:3000", startPath: "/tasks" } });
    expect(d.id).toBe("brief-7");
    expect(d.brief.version).toBe(1);
    expect(d.brief.goal).toBe("Check tasks");
    expect(d.brief.feature).toBe("Tasks");
    expect(d.brief.ticketContext).toBe("Prose only");
    expect(d.brief.account).toBe("a");
    expect(d.brief.target).toEqual({ origin: "http://localhost:3000", startPath: "/tasks" });
  });

  it("keeps a missing feature, ticket and account as null", () => {
    const d = newDraft("b", request);
    expect(d.brief.feature).toBeNull();
    expect(d.brief.ticketContext).toBeNull();
    expect(d.brief.account).toBeNull();
  });

  it("makes each list line of the ticket a supplied expectation, in order", () => {
    const d = newDraft("b", { ...request, ticketContext: "Criteria:\n- A saved task appears\n* An empty title is refused" });
    expect(d.brief.expectations).toEqual([
      { text: "A saved task appears", source: "supplied" },
      { text: "An empty title is refused", source: "supplied" },
    ]);
  });

  it("has no expectations for a ticket without list lines, and caps the ticket's at 20", () => {
    expect(newDraft("b", { ...request, ticketContext: "Just prose." }).brief.expectations).toEqual([]);
    expect(newDraft("b", request).brief.expectations).toEqual([]);
    const many = newDraft("b", { ...request, ticketContext: lines(25).map((l) => `- ${l}`).join("\n") });
    expect(many.brief.expectations).toHaveLength(20);
    expect(many.brief.expectations.every((e) => e.source === "supplied")).toBe(true);
  });

  it("permits only observation and test-data creation, and no deletion, credential change or external write", () => {
    const { brief: b } = newDraft("b", request);
    sameSet(b.permittedActions, DEFAULT_BRIEF_ACTIONS);
    expect(b.permittedActions).not.toBe(DEFAULT_BRIEF_ACTIONS);
    expect(b.mutationPermissions).toEqual(DEFAULT_MUTATIONS);
  });

  it("starts with no scope, no test data, no questions, no warnings, no approval and no hash", () => {
    const d = newDraft("b", request);
    expect(d.brief.scopePaths).toEqual([]);
    expect(d.brief.testData).toEqual({});
    expect(d.brief.approval).toBeNull();
    expect(d.questions).toEqual([]);
    expect(d.warnings).toEqual([]);
    expect(d.hash).toBeNull();
  });

  it("gives each draft its own arrays", () => {
    const one = newDraft("one", request);
    const two = newDraft("two", request);
    one.brief.permittedActions.push("deletion");
    one.brief.scopePaths.push("/x");
    expect(two.brief.permittedActions).not.toContain("deletion");
    expect(two.brief.scopePaths).toEqual([]);
    expect(DEFAULT_BRIEF_ACTIONS).not.toContain("deletion");
  });
});

describe("applyModelDraft", () => {
  const answer = (over: Partial<BriefDraftAnswer> = {}): BriefDraftAnswer => ({ expectations: [], scopePaths: [], testData: [], questions: [], ...over });
  const ask = (kind: string, text = `About ${kind}?`, over: Partial<BriefDraftAnswer["questions"][number]> = {}) => ({ kind, text, options: null, dataName: null, ...over });
  const base = () =>
    draft({
      expectations: [
        { text: "A saved task appears", source: "supplied" },
        { text: "An empty title is refused", source: "supplied" },
      ],
    });
  const newWarnings = (before: BriefDraft, after: BriefDraft) => after.warnings.slice(before.warnings.length);

  it("adds the model's expectations as inferred, after the supplied ones", () => {
    const out = applyModelDraft(base(), answer({ expectations: ["The count updates", "The form clears"] }));
    expect(out.brief.expectations).toEqual([
      { text: "A saved task appears", source: "supplied" },
      { text: "An empty title is refused", source: "supplied" },
      { text: "The count updates", source: "inferred" },
      { text: "The form clears", source: "inferred" },
    ]);
  });

  it("skips a model expectation that repeats a supplied one (which stays supplied) or an earlier model one", () => {
    const out = applyModelDraft(base(), answer({ expectations: ["A saved task appears", "The count updates", "The count updates", "The form clears"] }));
    expect(texts(out)).toEqual(["A saved task appears", "An empty title is refused", "The count updates", "The form clears"]);
    expect(sourceOf(out, "A saved task appears")).toBe("supplied");
  });

  it("takes at most 8 expectations from the model (the supplied ones don't count against them)", () => {
    expect(BRIEF_LIMITS.modelExpectations).toBe(8);
    const out = applyModelDraft(base(), answer({ expectations: lines(12) }));
    expect(out.brief.expectations.filter((e) => e.source === "inferred").map((e) => e.text)).toEqual(lines(8));
    expect(out.brief.expectations).toHaveLength(10);
    const full = draft({ expectations: lines(20).map((text) => ({ text, source: "supplied" as const })) });
    const fullOut = applyModelDraft(full, answer({ expectations: lines(12).map((l) => `Model ${l}`) }));
    expect(fullOut.brief.expectations).toHaveLength(28);
    expect(fullOut.brief.expectations.slice(0, 20).every((e) => e.source === "supplied")).toBe(true);
  });

  it("keeps a model expectation within 300 characters and ignores blank ones (*)", () => {
    const out = applyModelDraft(base(), answer({ expectations: ["x".repeat(500), "   ", ""] }));
    const added = out.brief.expectations.slice(2);
    expect(added).toHaveLength(1);
    expect(added[0]!.source).toBe("inferred");
    expect(added[0]!.text.length).toBeLessThanOrEqual(300);
    expect(added[0]!.text.startsWith("xxxxxxxxxx")).toBe(true);
  });

  it("keeps scope paths that pass isBriefPath, in order, without repeats", () => {
    const out = applyModelDraft(base(), answer({ scopePaths: ["/app", "/app/tasks", "/app", "/settings"] }));
    expect(out.brief.scopePaths).toEqual(["/app", "/app/tasks", "/settings"]);
    expect(out.warnings).toEqual([]);
  });

  it.each(["app/tasks", "https://evil.example/app", "//evil.example/app", "/app/../admin", "/app?token=1", "/app#frag"])("drops the scope path %s, with a warning", (path) => {
    const before = base();
    const out = applyModelDraft(before, answer({ scopePaths: ["/app", path] }));
    expect(out.brief.scopePaths).toEqual(["/app"]);
    expect(newWarnings(before, out)).toHaveLength(1);
  });

  it("adds one warning for each scope path it drops", () => {
    const before = base();
    const out = applyModelDraft(before, answer({ scopePaths: ["/app", "app/tasks", "https://evil.example/app", "/app/../admin"] }));
    expect(out.brief.scopePaths).toEqual(["/app"]);
    expect(newWarnings(before, out)).toHaveLength(3);
  });

  it("takes at most 5 scope paths", () => {
    expect(BRIEF_LIMITS.scopePaths).toBe(5);
    const out = applyModelDraft(base(), answer({ scopePaths: ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"] }));
    expect(out.brief.scopePaths).toEqual(["/a", "/b", "/c", "/d", "/e"]);
  });

  it("keeps test data with ordinary names", () => {
    const out = applyModelDraft(
      base(),
      answer({
        testData: [
          { name: "task title", value: "Buy milk {canary}" },
          { name: "due date", value: "2027-01-31" },
        ],
      }),
    );
    expect(out.brief.testData).toEqual({ "task title": "Buy milk {canary}", "due date": "2027-01-31" });
    expect(out.warnings).toEqual([]);
  });

  it.each(["password", "Password", "new password", "secret", "client secret", "token", "auth token", "api key", "API_KEY"])("drops test data named %s, with a warning that never holds its value", (name) => {
    const before = base();
    const out = applyModelDraft(before, answer({ testData: [{ name: "task title", value: "Buy milk" }, { name, value: "hunter2-hunter2" }] }));
    expect(out.brief.testData).toEqual({ "task title": "Buy milk" });
    const added = newWarnings(before, out);
    expect(added).toHaveLength(1);
    expect(added[0]).not.toContain("hunter2");
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("adds one warning for each test-data value it drops", () => {
    const before = base();
    const out = applyModelDraft(before, answer({ testData: [{ name: "password", value: "x" }, { name: "task title", value: "y" }, { name: "api token", value: "z" }] }));
    expect(out.brief.testData).toEqual({ "task title": "y" });
    expect(newWarnings(before, out)).toHaveLength(2);
  });

  it.each<[string, Partial<BriefDraftAnswer>, string]>([
    ["a scope path", { scopePaths: ["/app", "../etc"] }, "../etc"],
    ["a test-data name", { testData: [{ name: "client secret", value: "x" }] }, "client secret"],
    ["a question kind", { questions: [{ kind: "banana", text: "Odd question?", options: null, dataName: null }] }, "banana"],
  ])("names %s it dropped in its warning (JSDoc: 'What was dropped is named in the draft's warnings') (*)", (_name, over, dropped) => {
    const before = base();
    const out = applyModelDraft(before, answer(over));
    expect(newWarnings(before, out).join("\n")).toContain(dropped);
  });

  it("takes at most 8 test-data values, and none beyond the name and value limits", () => {
    expect(BRIEF_LIMITS.testData).toBe(8);
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `field ${i + 1}`, value: `value ${i + 1}` }));
    expect(Object.keys(applyModelDraft(base(), answer({ testData: many })).brief.testData)).toHaveLength(8);
    const long = applyModelDraft(base(), answer({ testData: [{ name: "n".repeat(100), value: "v".repeat(500) }, { name: "short", value: "w".repeat(500) }] }));
    for (const [name, value] of Object.entries(long.brief.testData)) {
      expect(name.length).toBeLessThanOrEqual(BRIEF_LIMITS.dataNameChars);
      expect(value.length).toBeLessThanOrEqual(BRIEF_LIMITS.dataValueChars);
    }
  });

  it("turns questions of known kinds into open questions with their own ids", () => {
    const out = applyModelDraft(
      base(),
      answer({
        questions: [
          ask("expectation", "What should happen to a very long title?"),
          ask("permission", "May the agent edit existing tasks?", { options: ["yes", "no"] }),
          ask("test-data", "What title should it type?", { dataName: "task title" }),
        ],
      }),
    );
    expect(out.questions).toHaveLength(3);
    const ids = out.questions.map((x) => x.id);
    expect(ids.every((id) => typeof id === "string" && id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(out.questions.map((x) => x.kind)).toEqual(["expectation", "permission", "test-data"]);
    expect(out.questions.map((x) => x.text)).toEqual(["What should happen to a very long title?", "May the agent edit existing tasks?", "What title should it type?"]);
    expect(out.questions[1]!.options).toEqual(["yes", "no"]);
    expect(out.questions[0]!.options).toBeNull();
    expect(out.questions[2]!.dataName).toBe("task title");
    for (const x of out.questions) {
      expect(x.settled).toBe(false);
      expect(x.answer).toBeNull();
    }
  });

  it.each(["expectation", "start-path", "scope", "account", "permission"] as const)("keeps no dataName on a %s question (*)", (kind) => {
    const out = applyModelDraft(base(), answer({ questions: [ask(kind, "Q?", { dataName: "task title" })] }));
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.dataName).toBeNull();
  });

  it("keeps all six kinds when asked for them one at a time", () => {
    for (const kind of ["expectation", "start-path", "scope", "test-data", "account", "permission"]) {
      const out = applyModelDraft(base(), answer({ questions: [ask(kind, "Q?", { dataName: kind === "test-data" ? "task title" : null })] }));
      expect(out.questions.map((x) => x.kind)).toEqual([kind]);
    }
  });

  it.each(["delete-data", "banana", "Permission", ""])("drops a question of the unknown kind %j and says so", (kind) => {
    const before = base();
    const out = applyModelDraft(before, answer({ questions: [ask(kind, "Odd question?"), ask("scope", "Which section?")] }));
    expect(out.questions.map((x) => x.kind)).toEqual(["scope"]);
    expect(newWarnings(before, out)).toHaveLength(1);
  });

  it("keeps the first three questions and drops the rest, one warning each", () => {
    expect(BRIEF_LIMITS.questions).toBe(3);
    const before = base();
    const out = applyModelDraft(before, answer({ questions: [1, 2, 3, 4, 5].map((n) => ask("expectation", `Question number ${n}?`)) }));
    expect(out.questions.map((x) => x.text)).toEqual(["Question number 1?", "Question number 2?", "Question number 3?"]);
    expect(newWarnings(before, out)).toHaveLength(2);
  });

  it("offers at most 6 options, and keeps a question's text within 200 characters", () => {
    expect(BRIEF_LIMITS.questionOptions).toBe(6);
    const options = Array.from({ length: 9 }, (_, i) => `Option ${i + 1}`);
    const out = applyModelDraft(base(), answer({ questions: [ask("scope", "w".repeat(400), { options })] }));
    // Cut to the first six, or turned into a free-text question: never more than six (*).
    const kept = out.questions[0]!.options;
    expect(kept === null || (kept.length <= 6 && kept.every((o) => options.includes(o)))).toBe(true);
    expect(out.questions[0]!.text.length).toBeLessThanOrEqual(BRIEF_LIMITS.questionChars);
  });

  it("never changes what the brief permits, whatever the answer holds", () => {
    const before = base();
    const sneaky = {
      ...answer({
        expectations: ["Deleting a task works"],
        questions: [ask("permission", "May the agent delete tasks?", { options: ["yes", "no"] }), ask("account", "Which account?", { options: ["a", "b", "signed-out"] })],
      }),
      permittedActions: ["observation", "test-data-creation", "modification", "deletion", "credential-change", "external-communication"],
      mutationPermissions: { createTestRecords: true, modifyExisting: true, delete: true, changeCredentials: true, externalWrite: true },
      account: "b",
      approval: { by: "self", at: "2026-10-09T10:00:00.000Z" },
      target: { origin: "https://evil.example", startPath: "/" },
    } as unknown as BriefDraftAnswer;
    const out = applyModelDraft(before, sneaky);
    sameSet(out.brief.permittedActions, DEFAULT_BRIEF_ACTIONS);
    expect(out.brief.mutationPermissions).toEqual(DEFAULT_MUTATIONS);
    expect(out.brief.account).toBeNull();
    expect(out.brief.approval).toBeNull();
    expect(out.brief.target).toEqual(before.brief.target);
    expect(out.hash).toBeNull();
    // A permission question stays open: the model can ask, only the user can answer.
    expect(out.questions.find((x) => x.kind === "permission")?.settled).toBe(false);
  });

  it("leaves everything else as it was, keeps earlier warnings, and does not change the draft it was given", () => {
    const before = draft({ goal: "G", feature: "Tasks", ticketContext: "- one", account: "a" }, { warnings: ["an earlier warning"] });
    const snapshot = structuredClone(before);
    const out = applyModelDraft(before, answer({ expectations: ["More"], scopePaths: ["/app", "nope"], testData: [{ name: "password", value: "x" }], questions: [ask("scope")] }));
    expect(before).toEqual(snapshot);
    expect(out.id).toBe(before.id);
    expect(out.brief.goal).toBe("G");
    expect(out.brief.feature).toBe("Tasks");
    expect(out.brief.ticketContext).toBe("- one");
    expect(out.brief.account).toBe("a");
    expect(out.warnings[0]).toBe("an earlier warning");
    expect(out.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("changes nothing for an empty answer", () => {
    const before = base();
    expect(applyModelDraft(before, answer())).toEqual(before);
  });
});

describe("editDraft: fields", () => {
  it("applies the fields that are present and leaves the rest alone", () => {
    const before = mixed({ feature: "Tasks", ticketContext: "- one", scopePaths: ["/app"], account: "a", testData: { x: "1" } });
    const out = edited(before, { goal: "A new goal" });
    expect(out.brief).toEqual({ ...before.brief, goal: "A new goal" });
    expect(out.questions).toEqual(before.questions);
    expect(out.id).toBe(before.id);
  });

  it("changes nothing for an empty edit or one that repeats what is there", () => {
    const before = mixed({ feature: "Tasks" });
    expect(edited(before, {})).toEqual(before);
    expect(edited(before, { goal: before.brief.goal, feature: "Tasks", account: null })).toEqual(before);
  });

  it("sets and clears the feature and the ticket text", () => {
    const before = mixed({ feature: "Tasks", ticketContext: "- one" });
    expect(edited(before, { feature: null, ticketContext: null }).brief).toMatchObject({ feature: null, ticketContext: null });
    expect(edited(mixed(), { feature: "Billing", ticketContext: "- two" }).brief).toMatchObject({ feature: "Billing", ticketContext: "- two" });
  });

  it("sets the start path, keeping the origin", () => {
    const out = edited(mixed(), { startPath: "/app/tasks/new" });
    expect(out.brief.target).toEqual({ origin: "http://127.0.0.1:5173", startPath: "/app/tasks/new" });
  });

  it("replaces the scope paths", () => {
    const out = edited(mixed({ scopePaths: ["/old"] }), { scopePaths: ["/app", "/settings"] });
    expect(out.brief.scopePaths).toEqual(["/app", "/settings"]);
    expect(edited(out, { scopePaths: [] }).brief.scopePaths).toEqual([]);
  });

  it("sets the account to a, b or none", () => {
    expect(edited(mixed(), { account: "b" }).brief.account).toBe("b");
    expect(edited(mixed({ account: "a" }), { account: null }).brief.account).toBeNull();
  });

  it("replaces the test data as a whole (*)", () => {
    const out = edited(mixed({ testData: { old: "1" } }), { testData: { "task title": "Buy milk {canary}" } });
    expect(out.brief.testData).toEqual({ "task title": "Buy milk {canary}" });
  });

  it("allowModification: true permits modification and changing existing records, and nothing else", () => {
    const out = edited(mixed(), { allowModification: true });
    sameSet(out.brief.permittedActions, [...DEFAULT_BRIEF_ACTIONS, "modification"]);
    expect(out.brief.mutationPermissions).toEqual({ ...DEFAULT_MUTATIONS, modifyExisting: true });
  });

  it("allowModification: false takes it away again", () => {
    const on = edited(mixed(), { allowModification: true });
    const off = edited(on, { allowModification: false });
    sameSet(off.brief.permittedActions, DEFAULT_BRIEF_ACTIONS);
    expect(off.brief.mutationPermissions).toEqual(DEFAULT_MUTATIONS);
  });

  it("does not list a class twice when modification is allowed twice", () => {
    const out = edited(edited(mixed(), { allowModification: true }), { allowModification: true, goal: "Again" });
    expect(out.brief.permittedActions.filter((a) => a === "modification")).toHaveLength(1);
  });

  it("leaves permissions alone when the edit does not mention them", () => {
    const on = edited(mixed(), { allowModification: true });
    const out = edited(on, { goal: "Other goal" });
    sameSet(out.brief.permittedActions, [...DEFAULT_BRIEF_ACTIONS, "modification"]);
    expect(out.brief.mutationPermissions.modifyExisting).toBe(true);
  });

  it("can't be made to permit deletion, credential changes or external writes", () => {
    const out = edited(mixed(), {
      allowModification: true,
      ...({ permittedActions: ["deletion", "credential-change", "external-communication"], mutationPermissions: { delete: true, changeCredentials: true, externalWrite: true } } as object),
    } as BriefEdit);
    expect(out.brief.permittedActions).not.toContain("deletion");
    expect(out.brief.permittedActions).not.toContain("credential-change");
    expect(out.brief.permittedActions).not.toContain("external-communication");
    expect(out.brief.mutationPermissions).toMatchObject({ delete: false, changeCredentials: false, externalWrite: false });
  });

  it("does not change the draft it was given", () => {
    const before = approved(mixed({ scopePaths: ["/app"], testData: { x: "1" } }));
    const snapshot = structuredClone(before);
    edited(before, { goal: "Changed", expectations: ["Only this"], scopePaths: [], testData: {}, allowModification: true });
    expect(before).toEqual(snapshot);
  });
});

describe("editDraft: expectations and their source", () => {
  it("keeps the source of an expectation whose text is unchanged, in the order sent", () => {
    const d = mixed();
    const out = edited(d, { expectations: [texts(d)[2]!, texts(d)[0]!, texts(d)[3]!] });
    expect(out.brief.expectations).toEqual([
      { text: texts(d)[2], source: "inferred" },
      { text: texts(d)[0], source: "supplied" },
      { text: texts(d)[3], source: "inferred" },
    ]);
  });

  it("makes new text supplied", () => {
    const d = mixed();
    const out = edited(d, { expectations: [...texts(d), "A brand new expectation"] });
    expect(sourceOf(out, "A brand new expectation")).toBe("supplied");
    expect(sourceOf(out, texts(d)[2]!)).toBe("inferred");
  });

  it("makes a reworded expectation supplied, even when it was inferred", () => {
    const d = mixed();
    const out = edited(d, { expectations: [texts(d)[0]!, "I1 the task count updates after saving, live"] });
    expect(sourceOf(out, "I1 the task count updates after saving, live")).toBe("supplied");
    expect(texts(out)).not.toContain(texts(d)[2]);
  });

  it("removes the expectations that are not sent, or all of them", () => {
    const d = mixed();
    expect(texts(edited(d, { expectations: [texts(d)[1]!] }))).toEqual([texts(d)[1]]);
    expect(edited(d, { expectations: [] }).brief.expectations).toEqual([]);
  });

  it("ignores whitespace around the text when it matches an existing one (*)", () => {
    const d = mixed();
    const out = edited(d, { expectations: [`  ${texts(d)[2]!}  `] });
    expect(out.brief.expectations).toHaveLength(1);
    expect(out.brief.expectations[0]!.source).toBe("inferred");
  });

  it("does not let the client set a source (*: refused or ignored)", () => {
    const d = mixed();
    const inferred = texts(d)[2]!;
    const result = editDraft(d, { expectations: [{ text: inferred, source: "supplied" }] as unknown as string[] });
    if ("draft" in result) expect(sourceOf(result.draft, inferred)).toBe("inferred");
    else expect(result.problems.length).toBeGreaterThan(0);
    const result2 = editDraft(d, { expectations: [inferred], ...({ source: "supplied", expectationSources: { [inferred]: "supplied" } } as object) } as BriefEdit);
    if ("draft" in result2) expect(sourceOf(result2.draft, inferred)).toBe("inferred");
    else expect(result2.problems.length).toBeGreaterThan(0);
  });

  it("accepts 30 expectations of 300 characters", () => {
    const thirty = lines(30, (i) => `${i}`.padStart(3, "0") + "x".repeat(297));
    expect(thirty.every((t) => t.length === 300)).toBe(true);
    expect(edited(mixed(), { expectations: thirty }).brief.expectations).toHaveLength(30);
  });
});

describe("editDraft: answers", () => {
  const withQuestions = (...qs: BriefQuestion[]) => mixed({}, { questions: qs });
  const answered = (d: BriefDraft, id: string) => d.questions.find((x) => x.id === id)!;

  it("marks an answered question settled, with the answer, and leaves the others open", () => {
    const d = withQuestions(question("q1", "expectation"), question("q2", "scope"));
    const out = edited(d, { answers: { q1: "Empty titles show an error" } });
    expect(answered(out, "q1")).toMatchObject({ settled: true, answer: "Empty titles show an error" });
    expect(answered(out, "q2")).toMatchObject({ settled: false, answer: null });
  });

  it("expectation: the answer becomes a supplied expectation", () => {
    const d = withQuestions(question("q1", "expectation"));
    const out = edited(d, { answers: { q1: "Empty titles show an error" } });
    expect(out.brief.expectations.at(-1)).toEqual({ text: "Empty titles show an error", source: "supplied" });
    expect(out.brief.expectations).toHaveLength(d.brief.expectations.length + 1);
  });

  it("start-path: the answer sets startPath", () => {
    const out = edited(withQuestions(question("q1", "start-path")), { answers: { q1: "/app/tasks/new" } });
    expect(out.brief.target).toEqual({ origin: "http://127.0.0.1:5173", startPath: "/app/tasks/new" });
  });

  it("scope: the answer adds a scope path, once (*)", () => {
    const d = withQuestions(question("q1", "scope"), question("q2", "scope"));
    d.brief.scopePaths = ["/app"];
    const first = edited(d, { answers: { q1: "/settings" } });
    expect(first.brief.scopePaths).toEqual(["/app", "/settings"]);
    expect(edited(first, { answers: { q2: "/settings" } }).brief.scopePaths).toEqual(["/app", "/settings"]);
  });

  it("test-data: the answer sets the value named by dataName", () => {
    const d = withQuestions(question("q1", "test-data", { dataName: "task title" }));
    d.brief.testData = { "due date": "2027-01-31" };
    const out = edited(d, { answers: { q1: "Buy milk {canary}" } });
    expect(out.brief.testData).toEqual({ "due date": "2027-01-31", "task title": "Buy milk {canary}" });
  });

  it.each([
    ["a", "a"],
    ["b", "b"],
    ["signed-out", null],
  ] as const)("account: %s sets the account to %j", (answer, account) => {
    const d = withQuestions(question("q1", "account"));
    d.brief.account = answer === "signed-out" ? "a" : null;
    expect(edited(d, { answers: { q1: answer } }).brief.account).toBe(account);
  });

  it("permission: yes allows changing existing records, no refuses it", () => {
    const yes = edited(withQuestions(question("q1", "permission")), { answers: { q1: "yes" } });
    sameSet(yes.brief.permittedActions, [...DEFAULT_BRIEF_ACTIONS, "modification"]);
    expect(yes.brief.mutationPermissions).toEqual({ ...DEFAULT_MUTATIONS, modifyExisting: true });
    const asked = withQuestions(question("q2", "permission"));
    const allowed = edited(asked, { allowModification: true });
    const no = edited(allowed, { answers: { q2: "no" } });
    sameSet(no.brief.permittedActions, DEFAULT_BRIEF_ACTIONS);
    expect(no.brief.mutationPermissions).toEqual(DEFAULT_MUTATIONS);
    expect(answered(no, "q2")).toMatchObject({ settled: true, answer: "no" });
  });

  it.each([
    ["expectation", {}],
    ["start-path", {}],
    ["scope", {}],
    ["test-data", { dataName: "task title" }],
    ["account", {}],
    ["permission", {}],
  ] as const)("a null answer dismisses a %s question: settled, no answer, nothing applied", (kind, extra) => {
    const d = withQuestions(question("q1", kind, extra));
    const out = edited(d, { answers: { q1: null } });
    expect(answered(out, "q1")).toMatchObject({ settled: true, answer: null });
    expect(out.brief).toEqual(d.brief);
  });

  it("applies several answers and fields together", () => {
    const d = withQuestions(question("q1", "expectation"), question("q2", "permission"), question("q3", "test-data", { dataName: "task title" }));
    const out = edited(d, { goal: "Better goal", answers: { q1: "A toast shows", q2: "yes", q3: "Buy milk" } });
    expect(out.brief.goal).toBe("Better goal");
    expect(sourceOf(out, "A toast shows")).toBe("supplied");
    expect(out.brief.mutationPermissions.modifyExisting).toBe(true);
    expect(out.brief.testData).toEqual({ "task title": "Buy milk" });
    expect(out.questions.every((x) => x.settled)).toBe(true);
  });
});

describe("editDraft: invalid edits return problems and apply nothing", () => {
  const open = () => mixed({}, { questions: [question("q1", "start-path"), question("q2", "account"), question("q3", "permission"), question("q4", "scope")] });

  it.each<[string, BriefEdit]>([
    ["an empty goal", { goal: "" }],
    ["a blank goal", { goal: "   " }],
    ["a goal over 2,000 characters", { goal: "g".repeat(2001) }],
    ["a feature over 80 characters", { feature: "f".repeat(81) }],
    ["a ticket over 8,000 characters", { ticketContext: "t".repeat(8001) }],
    ["an expectation over 300 characters", { expectations: ["e".repeat(301)] }],
    ["more than 30 expectations", { expectations: lines(31) }],
    ["a start path with a scheme", { startPath: "https://evil.example/" }],
    ["a start path that is not a path", { startPath: "app/tasks" }],
    ["a start path that climbs", { startPath: "/app/../admin" }],
    ["a start path with a query", { startPath: "/app?token=1" }],
    ["a scope path that is not a path", { scopePaths: ["/app", "//evil.example"] }],
    ["more than 5 scope paths", { scopePaths: ["/a", "/b", "/c", "/d", "/e", "/f"] }],
    ["more than 8 test-data values", { testData: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`field ${i + 1}`, "v"])) }],
    ["a test-data value over 200 characters", { testData: { title: "v".repeat(201) } }],
    ["an account that is neither a nor b", { account: "c" as never }],
    ["an answer for a question that is not there", { answers: { nope: "x" } }],
    ["a start-path answer that is not a path", { answers: { q1: "https://evil.example/" } }],
    ["an account answer other than a, b or signed-out", { answers: { q2: "c" } }],
    ["a permission answer other than yes or no", { answers: { q3: "maybe" } }],
    ["a scope answer that is not a path", { answers: { q4: "../etc" } }],
  ])("%s", (_name, edit) => {
    const before = open();
    const snapshot = structuredClone(before);
    const problems = problemsOf(before, edit);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => typeof p === "string" && p.trim() !== "")).toBe(true);
    expect(before).toEqual(snapshot);
  });

  it("names every problem, and applies none of the edit when one part is bad", () => {
    const before = open();
    const snapshot = structuredClone(before);
    const result = editDraft(before, { goal: "A fine new goal", feature: "f".repeat(81), startPath: "nope", answers: { q3: "maybe" } });
    expect("problems" in result).toBe(true);
    if ("problems" in result) expect(result.problems.length).toBeGreaterThanOrEqual(3);
    expect(before).toEqual(snapshot);
  });

  it("refuses or ignores a blank expectation, but never keeps it (*)", () => {
    const result = editDraft(open(), { expectations: ["Fine", "   "] });
    if ("draft" in result) expect(texts(result.draft)).toEqual(["Fine"]);
    else expect(result.problems.length).toBeGreaterThan(0);
  });

  it("refuses or cuts a test-data name over 40 characters, but never keeps it whole (*)", () => {
    const long = "n".repeat(41);
    const result = editDraft(open(), { testData: { [long]: "v" } });
    if ("draft" in result) expect(Object.keys(result.draft.brief.testData).every((name) => name.length <= BRIEF_LIMITS.dataNameChars)).toBe(true);
    else expect(result.problems.length).toBeGreaterThan(0);
  });

  it("names the goal when the goal is the problem", () => {
    expect(problemsOf(open(), { goal: "" }).join(" ")).toMatch(/goal|what to test/i);
  });

  it("returns problems for an approved draft too, and leaves it approved", () => {
    const before = approved();
    const snapshot = structuredClone(before);
    expect(problemsOf(before, { goal: "" }).length).toBeGreaterThan(0);
    expect(before).toEqual(snapshot);
    expect(before.brief.approval).not.toBeNull();
  });

  it("accepts values at the limits", () => {
    const out = edited(mixed(), { goal: "g".repeat(2000), feature: "f".repeat(80), ticketContext: "t".repeat(8000) });
    expect(out.brief.goal).toHaveLength(2000);
    expect(out.brief.feature).toHaveLength(80);
    expect(out.brief.ticketContext).toHaveLength(8000);
  });
});

describe("editDraft: approval", () => {
  it.each<[string, BriefEdit]>([
    ["the goal", { goal: "Another goal" }],
    ["the feature", { feature: "Billing" }],
    ["the ticket text", { ticketContext: "- a new line" }],
    ["the start path", { startPath: "/app/elsewhere" }],
    ["the scope", { scopePaths: ["/app"] }],
    ["the expectations", { expectations: ["Only this one"] }],
    ["the account", { account: "b" }],
    ["the test data", { testData: { x: "1" } }],
    ["whether existing records may change", { allowModification: true }],
    ["an answer", { answers: { q1: "Something should be true" } }],
    ["a dismissed question", { answers: { q1: null } }],
  ])("changing %s clears the approval and the hash", (_name, edit) => {
    const before = approved(mixed({}, { questions: [question("q1", "expectation")] }));
    expect(before.brief.approval).not.toBeNull();
    const out = edited(before, edit);
    expect(out.brief.approval).toBeNull();
    expect(out.hash).toBeNull();
  });

  it("keeps the rest of the brief when it clears the approval", () => {
    const before = approved();
    const out = edited(before, { goal: "Another goal" });
    expect(out.brief).toEqual({ ...before.brief, goal: "Another goal", approval: null });
  });
});

describe("approvalProblems", () => {
  const ready = () => mixed();

  it("has none for a draft with a goal, an expectation and no open question", () => {
    expect(approvalProblems(ready())).toEqual([]);
    expect(approvalProblems(mixed({}, { questions: [question("q1", "scope", { settled: true, answer: "/app" })] }))).toEqual([]);
  });

  it("does not count a dismissed question as open", () => {
    expect(approvalProblems(mixed({}, { questions: [question("q1", "scope", { settled: true, answer: null })] }))).toEqual([]);
  });

  it("names a missing goal", () => {
    for (const goal of ["", "   "]) {
      const problems = approvalProblems(mixed({ goal }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/goal|what to test/i);
    }
  });

  it("names missing expectations", () => {
    const problems = approvalProblems(draft({ expectations: [] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/expectation/i);
  });

  it("names an open question by its text or id (*)", () => {
    const d = mixed({}, { questions: [question("q-open", "permission", { text: "May the agent change existing tasks?" }), question("q-done", "scope", { settled: true, answer: "/app", text: "Which section?" })] });
    const problems = approvalProblems(d);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.includes("May the agent change existing tasks?") || problems[0]!.includes("q-open")).toBe(true);
    expect(problems.join(" ")).not.toContain("Which section?");
  });

  it("lists every open question", () => {
    const d = mixed({}, { questions: [question("q1", "scope", { text: "First open question?" }), question("q2", "account", { text: "Second open question?" })] });
    const text = approvalProblems(d).join(" ");
    expect(text.includes("First open question?") || text.includes("q1")).toBe(true);
    expect(text.includes("Second open question?") || text.includes("q2")).toBe(true);
  });

  it("lists every problem at once", () => {
    const problems = approvalProblems(draft({ goal: "", expectations: [] }, { questions: [question("q1", "scope")] }));
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("does not change the draft", () => {
    const d = draft({ goal: "" });
    const snapshot = structuredClone(d);
    approvalProblems(d);
    expect(d).toEqual(snapshot);
  });
});

describe("approveDraft", () => {
  const at = new Date("2026-10-09T10:20:30.456Z");

  it("sets approval {by, at as ISO 8601} and the hash of the brief", () => {
    const d = mixed({ scopePaths: ["/app"], account: "a" });
    const out = approveDraft(d, "self", at);
    expect(out.brief.approval).toEqual({ by: "self", at: "2026-10-09T10:20:30.456Z" });
    expect(out.brief.approval!.at).toMatch(ISO);
    expect(out.hash).toMatch(HEX64);
    expect(out.hash).toBe(briefHash(out.brief));
    expect(out.hash).toBe(briefHash(d.brief));
  });

  it("uses the approver it is given", () => {
    expect(approveDraft(mixed(), "policy:3", at).brief.approval?.by).toBe("policy:3");
  });

  it("leaves everything else of the draft as it was", () => {
    const d = mixed({ feature: "Tasks" }, { questions: [question("q1", "scope", { settled: true, answer: "/app" })], warnings: ["w"] });
    const out = approveDraft(d, "self", at);
    expect(out.id).toBe(d.id);
    expect(out.questions).toEqual(d.questions);
    expect(out.warnings).toEqual(d.warnings);
    expect(out.brief).toEqual({ ...d.brief, approval: { by: "self", at: at.toISOString() } });
  });

  it("does not change the draft it was given", () => {
    const d = mixed();
    const snapshot = structuredClone(d);
    approveDraft(d, "self", at);
    expect(d).toEqual(snapshot);
  });

  it("gives the same hash whenever the same brief is approved, and a new one after an edit", () => {
    const first = approveDraft(mixed(), "self", at);
    const later = approveDraft(mixed(), "self", new Date("2027-01-01T00:00:00Z"));
    expect(later.hash).toBe(first.hash);
    const changed = approveDraft(edited(first, { goal: "A different goal" }), "self", at);
    expect(changed.hash).not.toBe(first.hash);
  });
});

/** Sorts keys at every level, as the contract describes; arrays keep their order. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return value;
}

/** The same value with the keys of every object in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
  return value;
}

describe("briefHash", () => {
  const rich = () =>
    brief({
      feature: "Tasks",
      ticketContext: "- A saved task appears",
      scopePaths: ["/app", "/settings"],
      expectations: [
        { text: "A saved task appears", source: "supplied" },
        { text: "The count updates", source: "inferred" },
      ],
      account: "a",
      testData: { "task title": "Buy milk {canary}", "due date": "2027-01-31" },
    });

  it("is 64 lowercase hex characters", () => {
    expect(briefHash(rich())).toMatch(HEX64);
    expect(briefHash(brief())).toMatch(HEX64);
  });

  it("is the SHA-256 of the brief with approval null, as JSON with the keys sorted at every level (*)", () => {
    const b = rich();
    const expected = createHash("sha256")
      .update(JSON.stringify(sorted({ ...b, approval: null })))
      .digest("hex");
    expect(briefHash(b)).toBe(expected);
  });

  it("is the same for equal briefs, whatever the order of the keys", () => {
    const b = rich();
    expect(briefHash(structuredClone(b))).toBe(briefHash(b));
    expect(briefHash(reversed(b) as TestingBrief)).toBe(briefHash(b));
    expect(briefHash(brief({ testData: { a: "1", b: "2" } }))).toBe(briefHash(brief({ testData: { b: "2", a: "1" } })));
  });

  it("ignores the approval", () => {
    const b = rich();
    const withApproval = { ...b, approval: { by: "self", at: "2026-10-09T10:00:00.000Z" } };
    expect(briefHash(withApproval)).toBe(briefHash(b));
    expect(briefHash({ ...withApproval, approval: { by: "someone", at: "2030-01-01T00:00:00.000Z" } })).toBe(briefHash(b));
  });

  it("does not change the brief it is given", () => {
    const b = { ...rich(), approval: { by: "self", at: "2026-10-09T10:00:00.000Z" } };
    const snapshot = structuredClone(b);
    briefHash(b);
    expect(b).toEqual(snapshot);
  });

  it.each<[string, (b: TestingBrief) => TestingBrief]>([
    ["the goal", (b) => ({ ...b, goal: `${b.goal}!` })],
    ["the feature", (b) => ({ ...b, feature: "Billing" })],
    ["a missing feature", (b) => ({ ...b, feature: null })],
    ["the ticket text", (b) => ({ ...b, ticketContext: "- Something else" })],
    ["the origin", (b) => ({ ...b, target: { ...b.target, origin: "http://127.0.0.1:5174" } })],
    ["the start path", (b) => ({ ...b, target: { ...b.target, startPath: "/app/other" } })],
    ["the scope", (b) => ({ ...b, scopePaths: ["/app"] })],
    ["the text of an expectation", (b) => ({ ...b, expectations: [{ ...b.expectations[0]!, text: "A saved task shows up" }, b.expectations[1]!] })],
    ["the source of an expectation", (b) => ({ ...b, expectations: [b.expectations[0]!, { ...b.expectations[1]!, source: "supplied" }] })],
    ["the order of the expectations (*)", (b) => ({ ...b, expectations: [b.expectations[1]!, b.expectations[0]!] })],
    ["an added expectation", (b) => ({ ...b, expectations: [...b.expectations, { text: "One more", source: "supplied" }] })],
    ["the account", (b) => ({ ...b, account: "b" })],
    ["no account", (b) => ({ ...b, account: null })],
    ["a test-data value", (b) => ({ ...b, testData: { ...b.testData, "task title": "Buy bread" } })],
    ["a test-data name", (b) => ({ ...b, testData: { "task name": "Buy milk {canary}", "due date": "2027-01-31" } })],
    ["the permitted actions", (b) => ({ ...b, permittedActions: [...b.permittedActions, "modification"] })],
    ["a mutation permission", (b) => ({ ...b, mutationPermissions: { ...b.mutationPermissions, modifyExisting: true } })],
    ["the permission to delete", (b) => ({ ...b, mutationPermissions: { ...b.mutationPermissions, delete: true } })],
    ["the version", (b) => ({ ...b, version: 2 as unknown as 1 })],
  ])("changes when %s changes", (_name, change) => {
    const b = rich();
    expect(briefHash(change(b))).not.toBe(briefHash(b));
  });
});
