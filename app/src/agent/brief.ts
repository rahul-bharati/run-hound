/**
 * Testing briefs (A2, docs/agent-spec.md "Briefs"): pure functions from what the user typed and what the model drafted
 * to an editable, approvable TestingBrief. The engine, never the model or the client, decides which expectations are
 * supplied and which inferred, and what the brief permits.
 */

import { createHash } from "node:crypto";
import { oneLine } from "../ai/schema.js";
import { AGENT_INPUT_LIMITS, BRIEF_LIMITS, DEFAULT_BRIEF_ACTIONS } from "../config/agent.js";
import { redactSecrets } from "../engine/redact.js";
import type { BriefDraft, BriefDraftAnswer, BriefEdit, BriefExpectation, BriefQuestion, TestingBrief } from "../interfaces/agent.js";
import type { MutationPermissions } from "../interfaces/grant.js";
import type { AccountId } from "../core/types.js";
import type { BriefQuestionKind } from "../types/agent.js";
import type { ActionClass } from "../types/grant.js";

/** The parts of a brief request the engine has already checked: the target through the safety gate, the account's readiness. */
export interface CheckedBriefRequest {
  goal: string;
  ticketContext: string | null;
  feature: string | null;
  account: AccountId | null;
  target: { origin: string; startPath: string };
}

const QUESTION_KINDS: readonly BriefQuestionKind[] = ["expectation", "start-path", "scope", "test-data", "account", "permission"];
/** The answers an account or permission question can take, whatever the model offered. */
const FIXED_OPTIONS: Partial<Record<BriefQuestionKind, string[]>> = { account: ["a", "b", "signed-out"], permission: ["yes", "no"] };
/** The classes a brief can permit, in the order a brief lists them. Deletion, credential changes and external writes aren't offered. */
const OFFERED_ACTIONS: readonly ActionClass[] = ["observation", "test-data-creation", "modification"];
/** A credential word, whole: "user_password", "api key" and "pin" match; "passenger", "compass" and "keyboard" don't. */
const CREDENTIAL_WORD = /(?<![a-z])(?:pass(?:word|phrase|code)?|secret|token|api[\s_-]?key|key|credential|otp|pin)s?(?![a-z])/i;
/** Whether a test-data name would hold a credential (camelCase split first, so accessToken counts). Those stay in the accounts store. */
const looksLikeCredential = (name: string): boolean => CREDENTIAL_WORD.test(name.replace(/([a-z\d])([A-Z])/g, "$1 $2"));
/** A list line in ticket text: "- ", "* ", "• ", "1. " or "1) ", optionally a checkbox, then the text. */
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/;

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** A path a brief may hold: starts with "/", at most 2,048 characters, no scheme, no "//", no "..", no query or hash. */
export function isBriefPath(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > AGENT_INPUT_LIMITS.pathChars) return false;
  if (value.includes("//") || /[?#\\\s]/.test(value) || [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false;
  return !value.split("/").some((segment) => segment === ".." || segment === ".");
}

/**
 * The supplied expectations in ticket text: each list line ("- ", "* ", "• ", "1. ", "- [ ] "), without its marker,
 * collapsed to one line, cut to BRIEF_LIMITS.expectationChars, duplicates dropped, at most BRIEF_LIMITS.ticketExpectations.
 */
export function ticketExpectations(ticket: string | null): string[] {
  const out: string[] = [];
  for (const line of (ticket ?? "").split(/\r?\n/)) {
    const match = LIST_LINE.exec(line);
    const text = match ? oneLine(match[1] ?? "", BRIEF_LIMITS.expectationChars) : "";
    if (text === "" || out.some((seen) => same(seen, text))) continue;
    out.push(text);
    if (out.length === BRIEF_LIMITS.ticketExpectations) break;
  }
  return out;
}

function permissionsFor(actions: readonly ActionClass[]): MutationPermissions {
  return {
    createTestRecords: actions.includes("test-data-creation"),
    modifyExisting: actions.includes("modification"),
    delete: false,
    changeCredentials: false,
    externalWrite: false,
  };
}

/** The brief with modification allowed or not; observation and test-data creation stay as they are. */
function withModification(brief: TestingBrief, allow: boolean): void {
  const wanted = new Set<ActionClass>(brief.permittedActions.filter((a) => a !== "modification"));
  if (allow) wanted.add("modification");
  brief.permittedActions = OFFERED_ACTIONS.filter((a) => wanted.has(a));
  brief.mutationPermissions = permissionsFor(brief.permittedActions);
}

/** A new draft: the checked request, the ticket's supplied expectations, DEFAULT_BRIEF_ACTIONS, no questions, unapproved. */
export function newDraft(id: string, request: CheckedBriefRequest): BriefDraft {
  const permittedActions = OFFERED_ACTIONS.filter((a) => DEFAULT_BRIEF_ACTIONS.includes(a));
  const brief: TestingBrief = {
    version: 1,
    goal: request.goal,
    feature: request.feature,
    ticketContext: request.ticketContext,
    target: { ...request.target },
    scopePaths: [],
    expectations: ticketExpectations(request.ticketContext).map((text) => ({ text, source: "supplied" })),
    account: request.account,
    testData: {},
    permittedActions,
    mutationPermissions: permissionsFor(permittedActions),
    approval: null,
  };
  return { id, brief, questions: [], warnings: [], hash: null };
}

/** Model or user text as a brief keeps it: secrets redacted, one line, cut. */
const clean = (text: string, max: number): string => oneLine(redactSecrets(text), max);

/** Model text quoted in a warning: redacted, one line, short. */
const named = (text: string): string => clean(text, 60);

/** A usable test-data name, or null. */
function dataName(name: string): string | null {
  const cleaned = clean(name, BRIEF_LIMITS.dataNameChars);
  return cleaned === "" || looksLikeCredential(cleaned) ? null : cleaned;
}

/**
 * Adds the model's draft: its expectations as inferred (after the supplied ones, skipping repeats), scope paths that
 * pass isBriefPath, test data whose names don't look like a credential, and questions of known kinds, each within
 * BRIEF_LIMITS. Never changes what the brief permits. What was dropped is named in the draft's warnings.
 */
export function applyModelDraft(draft: BriefDraft, answer: BriefDraftAnswer): BriefDraft {
  const next = structuredClone(draft);
  const { brief } = next;
  const warn = (text: string) => next.warnings.push(text);

  let added = 0;
  for (const raw of answer.expectations) {
    const text = clean(raw, BRIEF_LIMITS.expectationChars);
    if (text === "" || brief.expectations.some((e) => same(e.text, text))) continue;
    if (added === BRIEF_LIMITS.modelExpectations || brief.expectations.length === BRIEF_LIMITS.expectations) {
      warn(`The model suggested more expectations than a brief keeps; the first ${added} were kept.`);
      break;
    }
    brief.expectations.push({ text, source: "inferred" });
    added += 1;
  }

  for (const path of answer.scopePaths) {
    if (!isBriefPath(path)) {
      warn(`Dropped the suggested area "${named(path)}": it isn't a path on the target.`);
      continue;
    }
    if (brief.scopePaths.includes(path)) continue;
    if (brief.scopePaths.length === BRIEF_LIMITS.scopePaths) {
      warn(`The model suggested more than ${BRIEF_LIMITS.scopePaths} areas to stay in; the first ${BRIEF_LIMITS.scopePaths} were kept.`);
      break;
    }
    brief.scopePaths.push(path);
  }
  for (const entry of answer.testData) {
    const name = dataName(entry.name);
    if (name === null) {
      // The name only: the value may be the very secret the brief refuses to hold.
      if (looksLikeCredential(entry.name)) warn(`Dropped the suggested test value "${named(entry.name)}": passwords and keys belong in saved test accounts, never in a brief.`);
      continue;
    }
    if (name in brief.testData) continue;
    if (Object.keys(brief.testData).length === BRIEF_LIMITS.testData) {
      warn(`The model suggested more than ${BRIEF_LIMITS.testData} test values; the first ${BRIEF_LIMITS.testData} were kept.`);
      break;
    }
    brief.testData[name] = clean(entry.value, BRIEF_LIMITS.dataValueChars);
  }
  for (const raw of answer.questions) {
    const question = toQuestion(raw, next.questions.length + 1);
    if (question === null) {
      const known = QUESTION_KINDS.some((k) => k === raw.kind);
      warn(known ? `Dropped the question "${named(raw.text)}": the brief can't apply its answer.` : `Dropped a question of a kind the brief can't apply ("${named(raw.kind)}").`);
      continue;
    }
    if (next.questions.length === BRIEF_LIMITS.questions) {
      warn(`Dropped the question "${named(question.text)}": a brief asks at most ${BRIEF_LIMITS.questions}.`);
      continue;
    }
    next.questions.push(question);
  }
  return next;
}

/** A model question as the brief asks it, or null when its kind is unknown or it can't be applied. */
function toQuestion(raw: BriefDraftAnswer["questions"][number], n: number): BriefQuestion | null {
  const kind = QUESTION_KINDS.find((k) => k === raw.kind);
  const text = clean(raw.text, BRIEF_LIMITS.questionChars);
  if (kind === undefined || text === "") return null;
  const name = kind === "test-data" ? dataName(raw.dataName ?? "") : null;
  if (kind === "test-data" && name === null) return null;
  let options = FIXED_OPTIONS[kind] ?? null;
  if (options === null && raw.options !== null) {
    const offered: string[] = [];
    for (const option of raw.options) {
      const value = clean(option, BRIEF_LIMITS.optionChars);
      if (value === "" || offered.includes(value) || ((kind === "start-path" || kind === "scope") && !isBriefPath(value))) continue;
      offered.push(value);
      if (offered.length === BRIEF_LIMITS.questionOptions) break;
    }
    options = offered.length > 0 ? offered : null;
  }
  return { id: `q${n}`, kind, text, options, dataName: name, answer: null, settled: false };
}

/** The brief and questions as they compare for "did anything change": everything but the approval. */
const content = (draft: BriefDraft): string => JSON.stringify([{ ...draft.brief, approval: null }, draft.questions]);

/**
 * Applies the user's edit and answers. An expectation whose text matches an existing one keeps that one's source; any
 * other is supplied. Answers are applied by their question's kind. Any change clears the approval and the hash.
 * Returns the problems instead when the edit is invalid; nothing is applied then.
 */
export function editDraft(draft: BriefDraft, edit: BriefEdit): { draft: BriefDraft } | { problems: string[] } {
  const next = structuredClone(draft);
  const { brief } = next;
  const problems: string[] = [];
  const text = (value: unknown, max: number, what: string): string | null => {
    if (typeof value !== "string") {
      problems.push(`${what} must be text.`);
      return null;
    }
    const cleaned = oneLine(redactSecrets(value), Number.MAX_SAFE_INTEGER);
    if (cleaned.length > max) {
      problems.push(`${what} is longer than ${max} characters.`);
      return null;
    }
    return cleaned;
  };
  const path = (value: unknown, what: string): string | null => {
    if (typeof value === "string" && isBriefPath(value)) return value;
    problems.push(`${what} must be a path on the target, like /app/settings.`);
    return null;
  };

  if (edit.goal !== undefined) {
    const goal = typeof edit.goal === "string" ? redactSecrets(edit.goal).trim() : null;
    if (goal === null || goal === "") problems.push("Describe what to test.");
    else if (goal.length > BRIEF_LIMITS.goalChars) problems.push(`The goal is longer than ${BRIEF_LIMITS.goalChars} characters.`);
    else brief.goal = goal;
  }
  if (edit.feature !== undefined) {
    const feature = edit.feature === null ? "" : text(edit.feature, BRIEF_LIMITS.featureChars, "The feature name");
    if (feature !== null) brief.feature = feature === "" ? null : feature;
  }
  if (edit.ticketContext !== undefined) {
    if (edit.ticketContext !== null && typeof edit.ticketContext !== "string") problems.push("The ticket text must be text.");
    else {
      const ticket = edit.ticketContext === null ? "" : redactSecrets(edit.ticketContext).trim();
      if (ticket.length > BRIEF_LIMITS.ticketChars) problems.push(`The ticket text is longer than ${BRIEF_LIMITS.ticketChars} characters.`);
      else brief.ticketContext = ticket === "" ? null : ticket;
    }
  }
  if (edit.startPath !== undefined) {
    const start = path(edit.startPath, "The start page");
    if (start !== null) brief.target.startPath = start;
  }
  if (edit.scopePaths !== undefined) {
    if (!Array.isArray(edit.scopePaths)) problems.push("The areas to stay in must be a list of paths.");
    else {
      const paths = [...new Set(edit.scopePaths.map((p) => path(p, "Each area to stay in")))];
      if (paths.length > BRIEF_LIMITS.scopePaths) problems.push(`A brief keeps at most ${BRIEF_LIMITS.scopePaths} areas to stay in.`);
      else if (!paths.includes(null)) brief.scopePaths = paths as string[];
    }
  }
  if (edit.expectations !== undefined) {
    if (!Array.isArray(edit.expectations)) problems.push("The expectations must be a list.");
    else {
      const kept: BriefExpectation[] = [];
      for (const raw of edit.expectations) {
        const value = text(raw, BRIEF_LIMITS.expectationChars, "Each expectation");
        if (value === null || value === "" || kept.some((e) => same(e.text, value))) continue;
        const existing = draft.brief.expectations.find((e) => e.text === value);
        kept.push({ text: value, source: existing?.source ?? "supplied" });
      }
      if (kept.length > BRIEF_LIMITS.expectations) problems.push(`A brief keeps at most ${BRIEF_LIMITS.expectations} expectations.`);
      else brief.expectations = kept;
    }
  }
  if (edit.account !== undefined) {
    if (edit.account !== null && edit.account !== "a" && edit.account !== "b") problems.push('The account must be "a", "b" or null (signed out).');
    else brief.account = edit.account;
  }
  if (edit.testData !== undefined) {
    if (typeof edit.testData !== "object" || edit.testData === null || Array.isArray(edit.testData)) problems.push("The test data must be names and values.");
    else {
      const data: Record<string, string> = {};
      for (const [rawName, rawValue] of Object.entries(edit.testData)) {
        const name = dataName(rawName);
        if (name === null) {
          problems.push(`"${clean(rawName, BRIEF_LIMITS.dataNameChars)}" can't name test data: passwords and keys belong in saved test accounts.`);
          continue;
        }
        const value = text(rawValue, BRIEF_LIMITS.dataValueChars, `The value of "${name}"`);
        if (value !== null) data[name] = value;
      }
      if (Object.keys(data).length > BRIEF_LIMITS.testData) problems.push(`A brief keeps at most ${BRIEF_LIMITS.testData} test values.`);
      else brief.testData = data;
    }
  }
  if (edit.allowModification !== undefined) {
    if (typeof edit.allowModification !== "boolean") problems.push("allowModification must be true or false.");
    else withModification(brief, edit.allowModification);
  }
  if (edit.answers !== undefined) {
    if (typeof edit.answers !== "object" || edit.answers === null || Array.isArray(edit.answers)) problems.push("The answers must be keyed by question id.");
    else for (const [id, answer] of Object.entries(edit.answers)) applyAnswer(next, id, answer, problems);
  }

  if (problems.length > 0) return { problems };
  if (content(next) !== content(draft)) {
    next.brief.approval = null;
    next.hash = null;
  }
  return { draft: next };
}

/** Applies one answer by its question's kind (null dismisses), or records why it can't be. */
function applyAnswer(draft: BriefDraft, id: string, answer: unknown, problems: string[]): void {
  const question = draft.questions.find((q) => q.id === id);
  if (question === undefined) {
    problems.push(`There is no question ${id}.`);
    return;
  }
  const { brief } = draft;
  if (answer === null) {
    question.answer = null;
    question.settled = true;
    return;
  }
  const value = typeof answer === "string" ? oneLine(redactSecrets(answer), Number.MAX_SAFE_INTEGER) : "";
  const fixed = FIXED_OPTIONS[question.kind];
  const refuse = (why: string) => problems.push(`"${question.text}": ${why}`);
  if (value === "") return void refuse("enter an answer, or dismiss the question.");
  if (fixed && !fixed.includes(value)) return void refuse(`answer one of ${fixed.join(", ")}.`);
  switch (question.kind) {
    case "expectation":
      if (value.length > BRIEF_LIMITS.expectationChars) return void refuse(`the answer is longer than ${BRIEF_LIMITS.expectationChars} characters.`);
      if (!brief.expectations.some((e) => same(e.text, value))) {
        if (brief.expectations.length === BRIEF_LIMITS.expectations) return void refuse(`a brief keeps at most ${BRIEF_LIMITS.expectations} expectations.`);
        brief.expectations.push({ text: value, source: "supplied" });
      }
      break;
    case "start-path":
      if (!isBriefPath(value)) return void refuse("answer with a path on the target, like /app/settings.");
      brief.target.startPath = value;
      break;
    case "scope":
      if (!isBriefPath(value)) return void refuse("answer with a path on the target, like /app/settings.");
      if (!brief.scopePaths.includes(value)) {
        if (brief.scopePaths.length === BRIEF_LIMITS.scopePaths) return void refuse(`a brief keeps at most ${BRIEF_LIMITS.scopePaths} areas to stay in.`);
        brief.scopePaths.push(value);
      }
      break;
    case "test-data":
      if (value.length > BRIEF_LIMITS.dataValueChars) return void refuse(`the answer is longer than ${BRIEF_LIMITS.dataValueChars} characters.`);
      if (question.dataName === null) return void refuse("the question names no test value.");
      if (!(question.dataName in brief.testData) && Object.keys(brief.testData).length === BRIEF_LIMITS.testData) return void refuse(`a brief keeps at most ${BRIEF_LIMITS.testData} test values.`);
      brief.testData[question.dataName] = value;
      break;
    case "account":
      brief.account = value === "signed-out" ? null : (value as AccountId);
      break;
    case "permission":
      withModification(brief, value === "yes");
      break;
  }
  question.answer = value;
  question.settled = true;
}

/** What stands in the way of approval: no goal, no expectation, an open question. (The flow checks the target and account.) */
export function approvalProblems(draft: BriefDraft): string[] {
  const problems: string[] = [];
  if (draft.brief.goal.trim() === "") problems.push("Describe what to test.");
  if (draft.brief.expectations.length === 0) problems.push("Add at least one expectation: what should be true when it works.");
  for (const q of draft.questions) if (!q.settled) problems.push(`Answer or dismiss: "${q.text}"`);
  return problems;
}

/** The approved draft: approval {by, at} and the brief's hash. */
export function approveDraft(draft: BriefDraft, by: string, at: Date): BriefDraft {
  const next = structuredClone(draft);
  next.brief.approval = { by, at: at.toISOString() };
  next.hash = briefHash(next.brief);
  return next;
}

/** JSON with object keys sorted at every level. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 (hex) of the brief with `approval: null`, serialized as JSON with object keys sorted at every level. */
export function briefHash(brief: TestingBrief): string {
  return createHash("sha256").update(canonical({ ...brief, approval: null })).digest("hex");
}
