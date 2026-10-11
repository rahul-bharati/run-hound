import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import { startFixtureServer, type FixtureServer } from "../../support/server.js";
import { saveAiConfig } from "../../../src/ai/config.js";
import { FAKE_AWS_KEY } from "../../../src/ai/test-fixtures.js";
import { MAX_BRIEFS } from "../../../src/config/agent.js";
import type { BriefDraft, BriefQuestion } from "../../../src/interfaces/agent.js";
import { clearAccount, saveAccounts } from "../../../src/operations/accounts-storage.js";
import { createApp } from "../../../src/server/app.js";

/**
 * The brief endpoints of the web server (docs/agent-spec.md "Briefs" → API, Drafting, Supplied and inferred, Questions,
 * Approval, Storage). Everything A2 adds is behind RUNHOUND_AGENT=1.
 *
 * Contract these tests pin down (interpretations marked *):
 * - Without `agent: true` (and RUNHOUND_AGENT unset) the routes don't exist: 404 for all four, even with the header.
 *   With createApp({ agent: true }) they do. * createApp({}) follows RUNHOUND_AGENT === "1" (read when the app is built),
 *   and an explicit `agent: false` wins over the variable.
 * - Every request needs X-Run-Hound: 1 (403 without it; also 403 for a cross-site request), like /api/ai and /api/accounts.
 * - POST /api/briefs {goal, url, ticketContext?, feature?, signInAs?} → 201 BriefDraft. 400 for invalid input (no goal,
 *   a goal over 2,000 characters, a ticket over 8,000, a feature over 80, a bad signInAs, a body that isn't JSON), a
 *   refused target (the safety gate: a public host) or an account that isn't ready; 409 when no model can be used.
 *   * The engine goes first: a refused target or an unready account answers 400 even when AI is off, and nothing is sent
 *     to the model then. A URL that isn't http(s) is refused too.
 * - The draft keeps the target's origin and its path as startPath (query and hash dropped), each list line of the ticket
 *   as a supplied expectation, the model's expectations as inferred (repeats skipped), scope paths that are paths, test
 *   data whose names don't look like a credential, and at most 3 questions of known kinds (open: settled false, with
 *   ids). Each drop adds a warning. The model is asked once. What the brief permits is the default (observation and
 *   test-data creation) whatever the model says; new brief: approval null, hash null.
 * - A model that fails (HTTP error, invalid JSON, a wrong shape, a timeout) still gives 201 with a warning and only the
 *   ticket's expectations. * The timeout case uses the AI config's own 5 s minimum timeout, so it is slow.
 * - The goal and ticket text are redacted before they are kept or sent. * The same for a goal edited later.
 * - The model sees the goal, ticket, feature and the start page's path (with the origin, for the local fake), and which
 *   accounts are ready; no query, no hash, no account label, username or password. No response ever holds them either.
 * - GET /api/briefs/:id → 200 BriefDraft or 404.
 * - PUT /api/briefs/:id (BriefEdit) → 200. Expectations are sent as text; an unchanged text keeps its source, any other
 *   is supplied, and the client can't set a source (* refused with 400 or ignored). Answers are applied by the kind of
 *   their question; null dismisses. A named account must be ready (400 otherwise). An invalid edit → 400 naming the
 *   problems, nothing applied. 404 for an unknown id. * A body that tries to widen the permissions (permittedActions,
 *   mutationPermissions) is refused with 400 or ignored.
 * - POST /api/briefs/:id/approve (no body) → 200 with approval {by: "self", at} and hash = SHA-256 of the brief with
 *   approval null, as JSON with keys sorted. 400 naming what is missing: no expectation, an open question (* named by
 *   its text or its id), a target the safety gate no longer allows, an account that is no longer ready. 404 for an
 *   unknown id. Any later edit or answer clears approval and hash.
 * - Drafts live in memory: at most MAX_BRIEFS (50), the oldest dropped first, none across a restart (a new app).
 */

const TASKS_PAGE = `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><main><h1>Tasks</h1></main></body></html>`;

const GOAL = "Check that adding a task saves it and that the list updates";
const TICKET = "Acceptance criteria:\n- A saved task appears in the list\n* An empty title is refused\nNotes: see the design file.";
const FEATURE = "Task list";
const SUPPLIED_1 = "A saved task appears in the list";
const SUPPLIED_2 = "An empty title is refused";
const INFERRED_1 = "The task count updates after saving";
const INFERRED_2 = "Titles are trimmed";

/** What a model might answer, with things that must be dropped: a bad path, a credential-like name, an unknown kind. */
const MODEL_ANSWER = {
  expectations: [SUPPLIED_1, INFERRED_1, INFERRED_2],
  scopePaths: ["/app/tasks", "../etc", "/app"],
  testData: [
    { name: "task title", value: "Buy milk {canary}" },
    { name: "password", value: "hunter2-hunter2" },
  ],
  questions: [
    { kind: "expectation", text: "What should happen when the title is empty?", options: null, dataName: null },
    { kind: "permission", text: "May the agent change existing tasks?", options: ["yes", "no"], dataName: null },
    { kind: "test-data", text: "What title should it type?", options: null, dataName: "task title" },
  ],
};

/** A model that has nothing to ask. */
const CLEAN_ANSWER = { expectations: [INFERRED_1], scopePaths: [], testData: [], questions: [] };
const EMPTY_ANSWER = { expectations: [], scopePaths: [], testData: [], questions: [] };

const ACCOUNT = { label: "Alice QA", loginUrl: "", username: "alice.qa@example.test", password: "Zk9-vq2!Lp4#Rw7x" };
const ACCOUNT_SECRETS = [ACCOUNT.label, ACCOUNT.username, "alice.qa", ACCOUNT.password];

const ENV_KEYS = ["RUNHOUND_CONFIG_DIR", "XDG_CONFIG_HOME", "RUNHOUND_AGENT", "RUNHOUND_ALLOWED_HOSTS"];
const envKeysToClear = () => Object.keys(process.env).filter((k) => k.startsWith("RUNHOUND_AI") || k.startsWith("RUNHOUND_ACCOUNT"));

let site: FixtureServer;
let fake: FakeLlm;
let tmp: string;
let saved: NodeJS.ProcessEnv;
let app: Hono;

beforeAll(async () => {
  site = await startFixtureServer({ pages: { "/app/tasks": TASKS_PAGE, "/login": TASKS_PAGE } });
  fake = await startFakeLlm({ models: [{ id: "fake-model:9b", parameterSize: "9.0B", quantization: "Q4_K_M", capabilities: ["completion"] }] });
  ACCOUNT.loginUrl = `${site.url}/login`;
});

afterAll(async () => {
  await site?.close();
  await fake?.close();
});

beforeEach(async () => {
  saved = {};
  for (const k of [...ENV_KEYS, ...envKeysToClear()]) saved[k] = process.env[k];
  for (const k of envKeysToClear()) delete process.env[k];
  delete process.env.RUNHOUND_AGENT;
  delete process.env.RUNHOUND_ALLOWED_HOSTS;
  tmp = await mkdtemp(join(tmpdir(), "rh-briefs-"));
  process.env.RUNHOUND_CONFIG_DIR = join(tmp, "config");
  fake.calls.length = 0;
  fake.reply(CLEAN_ANSWER);
  app = createApp({ canShowBrowser: false, maxConcurrentRuns: 10, agent: true, runsDir: join(tmp, "runs") });
});

afterEach(async () => {
  for (const k of envKeysToClear()) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

const RH = { "x-run-hound": "1" };

function send(method: string, path: string, body: unknown = {}, headers: Record<string, string> = RH, target: Hono = app) {
  return target.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

function get(path: string, headers: Record<string, string> = RH, target: Hono = app) {
  return target.request(path, { headers });
}

/** POST /api/briefs/:id/approve takes no body. */
function approve(id: string, headers: Record<string, string> = RH, target: Hono = app) {
  return target.request(`/api/briefs/${id}/approve`, { method: "POST", headers: { "content-type": "application/json", ...headers } });
}

const url = (path = "/app/tasks") => `${site.url}${path}`;
const request = () => ({ goal: GOAL, url: url(), ticketContext: TICKET, feature: FEATURE });

async function enableLocalAi(extra: Record<string, unknown> = {}) {
  await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "fake-model:9b", ...extra });
}

async function saveAccountA() {
  await saveAccounts({ accounts: { a: { ...ACCOUNT } } });
}

/** Drafts a brief with the fake model (the local AI is enabled and answers `answer`), expecting 201. */
async function create(body: Record<string, unknown> = {}, answer: unknown = CLEAN_ANSWER, target: Hono = app): Promise<BriefDraft> {
  await enableLocalAi();
  fake.reply(answer);
  const res = await send("POST", "/api/briefs", { ...request(), ...body }, RH, target);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as BriefDraft;
}

async function json<T = BriefDraft>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function reread(id: string): Promise<BriefDraft> {
  const res = await get(`/api/briefs/${id}`);
  expect(res.status).toBe(200);
  return json(res);
}

const question = (d: BriefDraft, kind: string): BriefQuestion => {
  const found = d.questions.find((q) => q.kind === kind);
  if (!found) throw new Error(`no ${kind} question in ${JSON.stringify(d.questions)}`);
  return found;
};

/** Everything the fake model was sent, as one string. */
const sentToModel = () => JSON.stringify(fake.calls.map((c) => c.body));
const messagesToModel = () => fake.calls.flatMap((c) => (c.body.messages as { content: string }[]).map((m) => m.content)).join("\n");

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
const referenceHash = (brief: object) => createHash("sha256").update(JSON.stringify(sorted({ ...brief, approval: null }))).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;
const DEFAULT_ACTIONS = ["observation", "test-data-creation"];
const sameSet = (actual: string[], expected: string[]) => expect([...actual].sort()).toEqual([...expected].sort());

describe("availability (RUNHOUND_AGENT)", () => {
  const routes: [string, string][] = [
    ["POST", "/api/briefs"],
    ["GET", "/api/briefs/some-id"],
    ["PUT", "/api/briefs/some-id"],
    ["POST", "/api/briefs/some-id/approve"],
  ];

  it.each(routes)("has no %s %s without the agent turned on", async (method, path) => {
    const off = createApp({ canShowBrowser: false });
    const res = method === "GET" ? await get(path, RH, off) : await send(method, path, { ...request() }, RH, off);
    expect(res.status).toBe(404);
  });

  it("has the routes with createApp({ agent: true })", async () => {
    const res = await send("POST", "/api/briefs", {});
    expect(res.status).toBe(400);
  });

  it("follows RUNHOUND_AGENT=1 when the option is left out (*)", async () => {
    process.env.RUNHOUND_AGENT = "1";
    const res = await send("POST", "/api/briefs", {}, RH, createApp({ canShowBrowser: false }));
    expect(res.status).toBe(400);
  });

  it("stays off for RUNHOUND_AGENT=true, which is not 1 (*)", async () => {
    process.env.RUNHOUND_AGENT = "true";
    const res = await send("POST", "/api/briefs", {}, RH, createApp({ canShowBrowser: false }));
    expect(res.status).toBe(404);
  });

  it("lets agent: false win over RUNHOUND_AGENT=1 (*)", async () => {
    process.env.RUNHOUND_AGENT = "1";
    const res = await send("POST", "/api/briefs", {}, RH, createApp({ canShowBrowser: false, agent: false }));
    expect(res.status).toBe(404);
  });
});

describe("the X-Run-Hound header", () => {
  it("is required on all four routes, and nothing is drafted or approved without it", async () => {
    const d = await create();
    const calls = fake.calls.length;
    const without: Record<string, string>[] = [{}, { "x-run-hound": "0" }];
    for (const headers of without) {
      expect((await send("POST", "/api/briefs", request(), headers)).status).toBe(403);
      expect((await get(`/api/briefs/${d.id}`, headers)).status).toBe(403);
      expect((await send("PUT", `/api/briefs/${d.id}`, { goal: "Changed" }, headers)).status).toBe(403);
      expect((await approve(d.id, headers)).status).toBe(403);
    }
    expect(fake.calls).toHaveLength(calls);
    const after = await reread(d.id);
    expect(after).toEqual(d);
  });

  it("refuses a cross-site request even with the header", async () => {
    const d = await create();
    expect((await get(`/api/briefs/${d.id}`, { ...RH, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send("PUT", `/api/briefs/${d.id}`, { goal: "Changed" }, { ...RH, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await reread(d.id)).brief.goal).toBe(GOAL);
  });
});

describe("POST /api/briefs: invalid input", () => {
  it.each<[string, () => Record<string, unknown>]>([
    ["no body fields", () => ({})],
    ["no goal", () => ({ url: url() })],
    ["a blank goal", () => ({ goal: "   ", url: url() })],
    ["a goal that is not a string", () => ({ goal: 5, url: url() })],
    ["a goal over 2,000 characters", () => ({ goal: "g".repeat(2001), url: url() })],
    ["no url", () => ({ goal: GOAL })],
    ["a blank url", () => ({ goal: GOAL, url: "  " })],
    ["a url that is not a string", () => ({ goal: GOAL, url: 5 })],
    ["a ticket over 8,000 characters", () => ({ goal: GOAL, url: url(), ticketContext: "t".repeat(8001) })],
    ["a ticket that is not a string", () => ({ goal: GOAL, url: url(), ticketContext: 5 })],
    ["a feature over 80 characters", () => ({ goal: GOAL, url: url(), feature: "f".repeat(81) })],
    ["a feature that is not a string", () => ({ goal: GOAL, url: url(), feature: 5 })],
    ["signInAs c", () => ({ goal: GOAL, url: url(), signInAs: "c" })],
    ["signInAs a number", () => ({ goal: GOAL, url: url(), signInAs: 1 })],
  ])("answers 400 for %s, without asking the model", async (_name, body) => {
    await enableLocalAi();
    const res = await send("POST", "/api/briefs", body());
    expect(res.status).toBe(400);
    expect(typeof (await json<{ error: string }>(res)).error).toBe("string");
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 400 for a body that is not JSON, and for JSON that is not an object", async () => {
    await enableLocalAi();
    const bad = await app.request("/api/briefs", { method: "POST", headers: { "content-type": "application/json", ...RH }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await send("POST", "/api/briefs", [])).status).toBe(400);
    expect((await send("POST", "/api/briefs", "text")).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it("accepts a goal of exactly 2,000 characters, a ticket of 8,000, a feature of 80 and null for the optional fields", async () => {
    await enableLocalAi();
    const long = await send("POST", "/api/briefs", { goal: "g".repeat(2000), url: url(), ticketContext: "t".repeat(8000), feature: "f".repeat(80) });
    expect(long.status).toBe(201);
    const nulls = await send("POST", "/api/briefs", { goal: GOAL, url: url(), ticketContext: null, feature: null, signInAs: null });
    expect(nulls.status).toBe(201);
    const d = await json(nulls);
    expect(d.brief.ticketContext).toBeNull();
    expect(d.brief.feature).toBeNull();
    expect(d.brief.account).toBeNull();
  });
});

describe("POST /api/briefs: the engine goes first", () => {
  it.each(["http://example.com/", "https://example.com/app", "http://8.8.8.8/app"])("refuses the public target %s with 400, sending nothing to the model", async (target) => {
    await enableLocalAi();
    const res = await send("POST", "/api/briefs", { goal: GOAL, url: target });
    expect(res.status).toBe(400);
    const body = await json<{ error: string }>(res);
    expect(body.error.trim()).not.toBe("");
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["not a url", "ftp://127.0.0.1/files", "file:///etc/passwd", "javascript:alert(1)"])("refuses the target %s (*)", async (target) => {
    await enableLocalAi();
    const res = await send("POST", "/api/briefs", { goal: GOAL, url: target });
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a public target with 400 even when AI is off, not 409 (*)", async () => {
    const res = await send("POST", "/api/briefs", { goal: GOAL, url: "http://8.8.8.8/app" });
    expect(res.status).toBe(400);
  });

  it("takes the safety gate's allowed hosts as the server has them now", async () => {
    await enableLocalAi();
    process.env.RUNHOUND_ALLOWED_HOSTS = "8.8.8.8";
    const res = await send("POST", "/api/briefs", { goal: GOAL, url: "http://8.8.8.8/app/tasks" });
    expect(res.status).toBe(201);
    expect((await json(res)).brief.target).toEqual({ origin: "http://8.8.8.8", startPath: "/app/tasks" });
  });

  it.each([
    ["a", /Account A/],
    ["b", /Account B/],
  ])("refuses account %s when it isn't set up, naming it, sending nothing to the model", async (id, name) => {
    await enableLocalAi();
    const res = await send("POST", "/api/briefs", { ...request(), signInAs: id });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(name);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an account that isn't set up even when AI is off, not 409 (*)", async () => {
    const res = await send("POST", "/api/briefs", { ...request(), signInAs: "a" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/briefs: no usable model", () => {
  it("answers 409 with the reason when AI is off", async () => {
    const res = await send("POST", "/api/briefs", request());
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toMatch(/AI is off|AI was not used|AI/);
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 409 when no model is chosen", async () => {
    await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: fake.baseUrl, model: "" });
    const res = await send("POST", "/api/briefs", request());
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toMatch(/model/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 409 for a remote endpoint without consent, sending nothing", async () => {
    await saveAiConfig({ enabled: true, provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "some-model" });
    const res = await send("POST", "/api/briefs", request());
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toContain("api.example.com");
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps no draft when it answers 409: the next one still works", async () => {
    expect((await send("POST", "/api/briefs", request())).status).toBe(409);
    const d = await create();
    expect(d.id).toBeTruthy();
  });
});

describe("POST /api/briefs: the draft", () => {
  it("answers 201 with a BriefDraft built from the request, the ticket and the model", async () => {
    await enableLocalAi();
    fake.reply(MODEL_ANSWER);
    const res = await send("POST", "/api/briefs", request());
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toMatch(/json/);
    const d = await json(res);

    expect(typeof d.id).toBe("string");
    expect(d.id).not.toBe("");
    expect(d.hash).toBeNull();
    expect(d.brief.version).toBe(1);
    expect(d.brief.goal).toBe(GOAL);
    expect(d.brief.feature).toBe(FEATURE);
    expect(d.brief.ticketContext).toBe(TICKET);
    expect(d.brief.target).toEqual({ origin: site.url, startPath: "/app/tasks" });
    expect(d.brief.account).toBeNull();
    expect(d.brief.approval).toBeNull();
    expect(d.brief.expectations).toEqual([
      { text: SUPPLIED_1, source: "supplied" },
      { text: SUPPLIED_2, source: "supplied" },
      { text: INFERRED_1, source: "inferred" },
      { text: INFERRED_2, source: "inferred" },
    ]);
    expect(d.brief.scopePaths).toEqual(["/app/tasks", "/app"]);
    expect(d.brief.testData).toEqual({ "task title": "Buy milk {canary}" });
  });

  it("opens the questions the model asked, with ids, unanswered, and drops what it may not ask", async () => {
    const d = await create({}, { ...MODEL_ANSWER, questions: [...MODEL_ANSWER.questions, { kind: "banana", text: "Fourth and odd?", options: null, dataName: null }] });
    expect(d.questions.map((q) => q.kind)).toEqual(["expectation", "permission", "test-data"]);
    expect(new Set(d.questions.map((q) => q.id)).size).toBe(3);
    for (const q of d.questions) {
      expect(typeof q.id).toBe("string");
      expect(q.id).not.toBe("");
      expect(q.settled).toBe(false);
      expect(q.answer).toBeNull();
    }
    expect(question(d, "permission").options).toEqual(["yes", "no"]);
    expect(question(d, "test-data").dataName).toBe("task title");
    expect(question(d, "expectation").text).toBe("What should happen when the title is empty?");
  });

  it("warns when it dropped something, without ever repeating a dropped value (one warning per drop and naming it are brief.test.ts's business)", async () => {
    const d = await create({}, { ...MODEL_ANSWER, questions: [...MODEL_ANSWER.questions, { kind: "banana", text: "Fourth and odd?", options: null, dataName: null }] });
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.warnings.every((w) => typeof w === "string" && w.trim() !== "")).toBe(true);
    expect(JSON.stringify(d)).not.toContain("hunter2");
  });

  it("keeps at most three questions", async () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ kind: "expectation", text: `Question number ${n}?`, options: null, dataName: null }));
    const d = await create({}, { ...EMPTY_ANSWER, questions: five });
    expect(d.questions.map((q) => q.text)).toEqual(["Question number 1?", "Question number 2?", "Question number 3?"]);
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("permits only observation and test-data creation, whatever the model says", async () => {
    const d = await create(
      {},
      {
        ...MODEL_ANSWER,
        permittedActions: ["observation", "test-data-creation", "modification", "deletion", "credential-change", "external-communication"],
        mutationPermissions: { createTestRecords: true, modifyExisting: true, delete: true, changeCredentials: true, externalWrite: true },
        account: "b",
      },
    );
    sameSet(d.brief.permittedActions, DEFAULT_ACTIONS);
    expect(d.brief.mutationPermissions).toEqual({ createTestRecords: true, modifyExisting: false, delete: false, changeCredentials: false, externalWrite: false });
    expect(d.brief.account).toBeNull();
    // The model can ask about changing records, but only the user can allow it.
    expect(question(d, "permission").settled).toBe(false);
  });

  it("asks the model once, with the goal, the ticket, the feature and the start page, and the schema of the answer", async () => {
    await create();
    expect(fake.calls).toHaveLength(1);
    const text = messagesToModel();
    expect(text).toContain(GOAL);
    expect(text).toContain(SUPPLIED_1);
    expect(text).toContain(SUPPLIED_2);
    expect(text).toContain(FEATURE);
    expect(text).toContain("/app/tasks");
    // The fake is local, so the origin goes too.
    expect(text).toContain(site.url);
    // Ollama-style endpoints take the schema as `format`; it asks for the four parts of the answer.
    const schema = fake.calls[0]!.body.format;
    expect(Object.keys(schema.properties).sort()).toEqual(["expectations", "questions", "scopePaths", "testData"]);
  });

  it("keeps only the origin and the path: the query and the hash are dropped, kept out of the model's prompt too", async () => {
    const d = await create({ url: url("/app/tasks?token=abc-secret-123&page=2#hashfrag99") });
    expect(d.brief.target).toEqual({ origin: site.url, startPath: "/app/tasks" });
    const everything = JSON.stringify(d) + sentToModel();
    expect(everything).not.toContain("abc-secret-123");
    expect(everything).not.toContain("hashfrag99");
    expect(everything).not.toContain("page=2");
  });

  it("starts at / for a URL without a path", async () => {
    const d = await create({ url: site.url });
    expect(d.brief.target).toEqual({ origin: site.url, startPath: "/" });
  });

  it("redacts the goal and the ticket text before keeping or sending them", async () => {
    const d = await create({ goal: `Check saving with the key ${FAKE_AWS_KEY} in the header`, ticketContext: `- uses ${FAKE_AWS_KEY} to sign in\n- ${SUPPLIED_1}` });
    const everything = JSON.stringify(d) + sentToModel();
    expect(everything).not.toContain(FAKE_AWS_KEY);
    expect(d.brief.goal).toContain("[REDACTED");
    expect(d.brief.ticketContext).toContain("[REDACTED");
    expect(d.brief.expectations.some((e) => e.text.includes(FAKE_AWS_KEY))).toBe(false);
  });

  it("has no expectations when the ticket has no list lines and the model offers none", async () => {
    const d = await create({ ticketContext: "Just prose, no list." }, EMPTY_ANSWER);
    expect(d.brief.expectations).toEqual([]);
    expect(d.brief.scopePaths).toEqual([]);
    expect(d.brief.testData).toEqual({});
    expect(d.questions).toEqual([]);
    expect(d.warnings).toEqual([]);
  });
});

describe("POST /api/briefs: the model fails", () => {
  it.each<[string, unknown]>([
    ["answers HTTP 500", { status: 500, body: '{"error":"boom"}' }],
    ["answers with text that is not JSON", { raw: "I am not JSON, sorry" }],
    ["answers JSON of the wrong shape", { expectations: "nope" }],
  ])("still gives a draft with a warning and only the ticket's expectations when the model %s", async (_name, reply) => {
    const d = await create({}, reply);
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.brief.expectations).toEqual([
      { text: SUPPLIED_1, source: "supplied" },
      { text: SUPPLIED_2, source: "supplied" },
    ]);
    expect(d.brief.scopePaths).toEqual([]);
    expect(d.brief.testData).toEqual({});
    expect(d.questions).toEqual([]);
    sameSet(d.brief.permittedActions, DEFAULT_ACTIONS);
    expect(d.brief.goal).toBe(GOAL);
    expect(d.brief.target).toEqual({ origin: site.url, startPath: "/app/tasks" });
  });

  it("gives a draft the user can still fill in and approve", async () => {
    const d = await create({}, { status: 500, body: "boom" });
    const edit = await send("PUT", `/api/briefs/${d.id}`, { scopePaths: ["/app"], expectations: [SUPPLIED_1, SUPPLIED_2, "The list keeps its order"] });
    expect(edit.status).toBe(200);
    const done = await approve(d.id);
    expect(done.status).toBe(200);
  });

  it("gives a draft with a warning when the model times out (slow: the AI config's minimum timeout is 5 s)", async () => {
    const slow = await startFakeLlm({ models: [{ id: "fake-model:9b", capabilities: ["completion"] }], delayMs: 6_500 });
    try {
      slow.reply(MODEL_ANSWER);
      await saveAiConfig({ enabled: true, provider: "ollama", baseUrl: slow.baseUrl, model: "fake-model:9b", timeoutMs: 5_000 });
      const res = await send("POST", "/api/briefs", request());
      expect(res.status).toBe(201);
      const d = await json(res);
      expect(d.warnings.length).toBeGreaterThan(0);
      expect(d.brief.expectations.every((e) => e.source === "supplied")).toBe(true);
      expect(d.questions).toEqual([]);
    } finally {
      await slow.close();
    }
  });
});

describe("accounts in briefs", () => {
  it("keeps the account the brief signs in as, and tells the model only whether accounts are ready, never their names", async () => {
    await saveAccountA();
    const d = await create({ signInAs: "a" }, MODEL_ANSWER);
    expect(d.brief.account).toBe("a");
    const everything = JSON.stringify(d) + sentToModel();
    for (const secret of ACCOUNT_SECRETS) expect(everything).not.toContain(secret);
  });

  it("never returns a username, a label or a password from any route", async () => {
    await saveAccountA();
    const d = await create({ signInAs: "a" }, MODEL_ANSWER);
    const texts: string[] = [JSON.stringify(d)];
    const afterGet = await get(`/api/briefs/${d.id}`);
    texts.push(await afterGet.text());
    const answers = Object.fromEntries(d.questions.map((q) => [q.id, null]));
    const put = await send("PUT", `/api/briefs/${d.id}`, { goal: "Another goal", answers });
    expect(put.status).toBe(200);
    texts.push(await put.text());
    const done = await approve(d.id);
    expect(done.status).toBe(200);
    texts.push(await done.text());
    for (const secret of ACCOUNT_SECRETS) {
      for (const text of texts) expect(text).not.toContain(secret);
      expect(sentToModel()).not.toContain(secret);
    }
  });

  it("starts without an account when signInAs is left out, even with accounts set up", async () => {
    await saveAccountA();
    const d = await create();
    expect(d.brief.account).toBeNull();
  });

  it("refuses to sign in as an account that isn't ready on an edit (400)", async () => {
    await saveAccountA();
    const d = await create();
    const res = await send("PUT", `/api/briefs/${d.id}`, { account: "b" });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/Account B/);
    expect((await reread(d.id)).brief.account).toBeNull();
    const ok = await send("PUT", `/api/briefs/${d.id}`, { account: "a" });
    expect(ok.status).toBe(200);
    expect((await json(ok)).brief.account).toBe("a");
    const out = await send("PUT", `/api/briefs/${d.id}`, { account: null });
    expect((await json(out)).brief.account).toBeNull();
  });

  it("applies an account answer only for an account that is ready", async () => {
    await saveAccountA();
    const asked = { ...EMPTY_ANSWER, expectations: [INFERRED_1], questions: [{ kind: "account", text: "Which account should it use?", options: ["a", "b", "signed-out"], dataName: null }] };
    const d = await create({}, asked);
    const q = question(d, "account");
    const bad = await send("PUT", `/api/briefs/${d.id}`, { answers: { [q.id]: "b" } });
    expect(bad.status).toBe(400);
    expect((await reread(d.id)).questions[0]!.settled).toBe(false);
    const a = await send("PUT", `/api/briefs/${d.id}`, { answers: { [q.id]: "a" } });
    expect(a.status).toBe(200);
    expect((await json(a)).brief.account).toBe("a");
    const out = await send("PUT", `/api/briefs/${d.id}`, { answers: { [q.id]: "signed-out" } });
    expect(out.status).toBe(200);
    expect((await json(out)).brief.account).toBeNull();
  });
});

describe("GET /api/briefs/:id", () => {
  it("returns the draft that POST returned", async () => {
    const d = await create({}, MODEL_ANSWER);
    const res = await get(`/api/briefs/${d.id}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(d);
  });

  it("answers 404 for an id it doesn't know", async () => {
    const d = await create();
    expect((await get(`/api/briefs/${d.id}`)).status).toBe(200);
    for (const id of ["does-not-exist", "00000000-0000-4000-8000-000000000000", `${d.id}x`]) {
      const res = await get(`/api/briefs/${id}`);
      expect(res.status).toBe(404);
      expect(typeof (await json<{ error: string }>(res)).error).toBe("string");
    }
  });
});

describe("PUT /api/briefs/:id", () => {
  it("applies the fields that are present and leaves the rest alone", async () => {
    const d = await create({}, MODEL_ANSWER);
    const res = await send("PUT", `/api/briefs/${d.id}`, { goal: "A sharper goal", feature: null, scopePaths: ["/app"], startPath: "/app/tasks/new", testData: { "task title": "Buy bread" } });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.id).toBe(d.id);
    expect(out.brief.goal).toBe("A sharper goal");
    expect(out.brief.feature).toBeNull();
    expect(out.brief.scopePaths).toEqual(["/app"]);
    expect(out.brief.target).toEqual({ origin: site.url, startPath: "/app/tasks/new" });
    expect(out.brief.testData).toEqual({ "task title": "Buy bread" });
    expect(out.brief.expectations).toEqual(d.brief.expectations);
    expect(out.brief.ticketContext).toBe(d.brief.ticketContext);
    expect(out.questions).toEqual(d.questions);
    expect(await reread(d.id)).toEqual(out);
  });

  it("keeps the source of unchanged expectations, makes new and reworded text supplied", async () => {
    const d = await create({}, MODEL_ANSWER);
    const res = await send("PUT", `/api/briefs/${d.id}`, { expectations: [SUPPLIED_1, INFERRED_1, "Titles are trimmed and capped at 80 characters", "A brand new expectation"] });
    expect(res.status).toBe(200);
    expect((await json(res)).brief.expectations).toEqual([
      { text: SUPPLIED_1, source: "supplied" },
      { text: INFERRED_1, source: "inferred" },
      { text: "Titles are trimmed and capped at 80 characters", source: "supplied" },
      { text: "A brand new expectation", source: "supplied" },
    ]);
  });

  it("does not let the client set a source (*: refused or ignored)", async () => {
    const d = await create({}, MODEL_ANSWER);
    for (const body of [{ expectations: [{ text: INFERRED_1, source: "supplied" }] }, { expectations: [INFERRED_1], expectationSources: { [INFERRED_1]: "supplied" }, source: "supplied" }]) {
      const res = await send("PUT", `/api/briefs/${d.id}`, body);
      expect([200, 400]).toContain(res.status);
      const now = await reread(d.id);
      expect(now.brief.expectations.find((e) => e.text === INFERRED_1)?.source ?? "inferred").toBe("inferred");
    }
  });

  it("applies each answer by the kind of its question, and settles it", async () => {
    const d = await create({}, MODEL_ANSWER);
    const answers = {
      [question(d, "expectation").id]: "An empty title shows an error message",
      [question(d, "permission").id]: "yes",
      [question(d, "test-data").id]: "Walk the dog {canary}",
    };
    const res = await send("PUT", `/api/briefs/${d.id}`, { answers });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.brief.expectations.at(-1)).toEqual({ text: "An empty title shows an error message", source: "supplied" });
    sameSet(out.brief.permittedActions, [...DEFAULT_ACTIONS, "modification"]);
    expect(out.brief.mutationPermissions).toMatchObject({ createTestRecords: true, modifyExisting: true, delete: false, changeCredentials: false, externalWrite: false });
    expect(out.brief.testData["task title"]).toBe("Walk the dog {canary}");
    for (const q of out.questions) expect(q.settled).toBe(true);
    expect(question(out, "permission").answer).toBe("yes");
    expect(await reread(d.id)).toEqual(out);
  });

  it("applies start-path and scope answers", async () => {
    const asked = {
      ...EMPTY_ANSWER,
      expectations: [INFERRED_1],
      questions: [
        { kind: "start-path", text: "Which page should it start on?", options: ["/app/tasks", "/app/tasks/new"], dataName: null },
        { kind: "scope", text: "Which section may it visit?", options: null, dataName: null },
      ],
    };
    const d = await create({}, asked);
    const res = await send("PUT", `/api/briefs/${d.id}`, { answers: { [question(d, "start-path").id]: "/app/tasks/new", [question(d, "scope").id]: "/app" } });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.brief.target).toEqual({ origin: site.url, startPath: "/app/tasks/new" });
    expect(out.brief.scopePaths).toEqual(["/app"]);
  });

  it("dismisses a question with null: settled, no answer, nothing applied", async () => {
    const d = await create({}, MODEL_ANSWER);
    const answers = Object.fromEntries(d.questions.map((q) => [q.id, null]));
    const res = await send("PUT", `/api/briefs/${d.id}`, { answers });
    expect(res.status).toBe(200);
    const out = await json(res);
    for (const q of out.questions) {
      expect(q.settled).toBe(true);
      expect(q.answer).toBeNull();
    }
    expect(out.brief).toEqual(d.brief);
  });

  it("allowModification toggles the permission to change existing records", async () => {
    const d = await create();
    const on = await json(await send("PUT", `/api/briefs/${d.id}`, { allowModification: true }));
    sameSet(on.brief.permittedActions, [...DEFAULT_ACTIONS, "modification"]);
    expect(on.brief.mutationPermissions.modifyExisting).toBe(true);
    const off = await json(await send("PUT", `/api/briefs/${d.id}`, { allowModification: false }));
    sameSet(off.brief.permittedActions, DEFAULT_ACTIONS);
    expect(off.brief.mutationPermissions.modifyExisting).toBe(false);
  });

  it("cannot be used to permit deletion, credential changes or external writes (*: refused or ignored)", async () => {
    const d = await create();
    const res = await send("PUT", `/api/briefs/${d.id}`, {
      allowModification: true,
      permittedActions: ["observation", "test-data-creation", "deletion", "credential-change", "external-communication"],
      mutationPermissions: { delete: true, changeCredentials: true, externalWrite: true },
      approval: { by: "self", at: "2026-10-09T10:00:00.000Z" },
      hash: "a".repeat(64),
    });
    expect([200, 400]).toContain(res.status);
    const now = await reread(d.id);
    for (const forbidden of ["deletion", "credential-change", "external-communication"]) expect(now.brief.permittedActions).not.toContain(forbidden);
    expect(now.brief.mutationPermissions).toMatchObject({ delete: false, changeCredentials: false, externalWrite: false });
    expect(now.brief.approval).toBeNull();
    expect(now.hash).toBeNull();
  });

  it("redacts a secret in an edited goal (*)", async () => {
    const d = await create();
    const res = await send("PUT", `/api/briefs/${d.id}`, { goal: `Check saving with the key ${FAKE_AWS_KEY}` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_AWS_KEY);
    expect(JSON.stringify(await reread(d.id))).not.toContain(FAKE_AWS_KEY);
  });

  it.each<[string, (d: BriefDraft) => Record<string, unknown>, RegExp | null]>([
    ["an empty goal", () => ({ goal: "" }), /goal|what to test/i],
    ["a goal over 2,000 characters", () => ({ goal: "g".repeat(2001) }), /goal|what to test|2,?000/i],
    ["a start path that isn't a path", () => ({ startPath: "https://evil.example/" }), /path/i],
    ["a scope path that isn't a path", () => ({ scopePaths: ["/app", "../etc"] }), /path|scope/i],
    ["an answer for a question that isn't there", () => ({ answers: { nope: "x" } }), null],
    ["a permission answer that is not yes or no", (d) => ({ answers: { [question(d, "permission").id]: "maybe" } }), null],
  ])("answers 400 naming the problem for %s, and applies nothing", async (_name, edit, problem) => {
    const d = await create({}, MODEL_ANSWER);
    const res = await send("PUT", `/api/briefs/${d.id}`, { goal: "A goal that must not be kept", ...edit(d) });
    expect(res.status).toBe(400);
    const { error } = await json<{ error: string }>(res);
    expect(error.trim()).not.toBe("");
    if (problem) expect(error).toMatch(problem);
    expect(await reread(d.id)).toEqual(d);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const d = await create();
    const res = await app.request(`/api/briefs/${d.id}`, { method: "PUT", headers: { "content-type": "application/json", ...RH }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await reread(d.id)).toEqual(d);
  });

  it("answers 404 for an id it doesn't know", async () => {
    const d = await create();
    const res = await send("PUT", "/api/briefs/does-not-exist", { goal: "Another goal" });
    expect(res.status).toBe(404);
    expect((await reread(d.id)).brief.goal).toBe(GOAL);
  });
});

describe("POST /api/briefs/:id/approve", () => {
  it("approves a draft that has a goal, an expectation and no open question", async () => {
    const before = Date.now();
    const d = await create();
    const res = await approve(d.id);
    expect(res.status).toBe(200);
    const done = await json(res);
    expect(done.id).toBe(d.id);
    expect(done.brief.approval?.by).toBe("self");
    const at = Date.parse(done.brief.approval!.at);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(new Date(at).toISOString()).toBe(done.brief.approval!.at);
    expect(done.hash).toMatch(HEX64);
    expect(done.hash).toBe(referenceHash(done.brief));
    expect({ ...done.brief, approval: null }).toEqual(d.brief);
    expect(await reread(d.id)).toEqual(done);
  });

  it("also works when the client sends an empty JSON object", async () => {
    const d = await create();
    const res = await send("POST", `/api/briefs/${d.id}/approve`, {});
    expect(res.status).toBe(200);
    expect((await json(res)).hash).toMatch(HEX64);
  });

  it("names the open question and approves nothing", async () => {
    const d = await create({}, MODEL_ANSWER);
    const res = await approve(d.id);
    expect(res.status).toBe(400);
    const { error } = await json<{ error: string }>(res);
    const named = d.questions.some((q) => error.includes(q.text) || error.includes(q.id));
    expect(named, error).toBe(true);
    const now = await reread(d.id);
    expect(now.brief.approval).toBeNull();
    expect(now.hash).toBeNull();
  });

  it("approves once every question is answered or dismissed", async () => {
    const d = await create({}, MODEL_ANSWER);
    const answers = {
      [question(d, "expectation").id]: "An empty title shows an error message",
      [question(d, "permission").id]: null,
      [question(d, "test-data").id]: "Walk the dog {canary}",
    };
    expect((await send("PUT", `/api/briefs/${d.id}`, { answers })).status).toBe(200);
    const res = await approve(d.id);
    expect(res.status).toBe(200);
    const done = await json(res);
    expect(done.hash).toBe(referenceHash(done.brief));
    sameSet(done.brief.permittedActions, DEFAULT_ACTIONS);
  });

  it("names the missing expectation", async () => {
    const d = await create({ ticketContext: "Just prose, no list." }, EMPTY_ANSWER);
    expect(d.brief.expectations).toEqual([]);
    const res = await approve(d.id);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/expectation/i);
    expect((await reread(d.id)).brief.approval).toBeNull();
  });

  it("names every problem at once", async () => {
    const d = await create({ ticketContext: "Just prose, no list." }, { ...EMPTY_ANSWER, questions: [{ kind: "scope", text: "Which section may it visit?", options: null, dataName: null }] });
    const res = await approve(d.id);
    expect(res.status).toBe(400);
    const { error } = await json<{ error: string }>(res);
    expect(error).toMatch(/expectation/i);
    expect(error.includes("Which section may it visit?") || error.includes(d.questions[0]!.id)).toBe(true);
  });

  it("checks the target again: one the safety gate no longer allows can't be approved", async () => {
    await enableLocalAi();
    process.env.RUNHOUND_ALLOWED_HOSTS = "8.8.8.8";
    const d = await create({ url: "http://8.8.8.8/app/tasks" });
    delete process.env.RUNHOUND_ALLOWED_HOSTS;
    const res = await approve(d.id);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/8\.8\.8\.8|address|allowed|target/i);
    expect((await reread(d.id)).brief.approval).toBeNull();
  });

  it("checks the account again: one that is no longer ready can't be approved", async () => {
    await saveAccountA();
    const d = await create({ signInAs: "a" });
    await clearAccount("a");
    const res = await approve(d.id);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/Account A/);
    const now = await reread(d.id);
    expect(now.brief.account).toBe("a");
  });

  it("answers 404 for an id it doesn't know", async () => {
    await create();
    expect((await approve("does-not-exist")).status).toBe(404);
  });
});

describe("editing after approval", () => {
  async function approvedDraft() {
    const d = await create();
    const done = await json(await approve(d.id));
    expect(done.hash).toMatch(HEX64);
    return done;
  }

  it("clears the approval and the hash on any edit, so a changed brief needs a new approval", async () => {
    const first = await approvedDraft();
    const res = await send("PUT", `/api/briefs/${first.id}`, { goal: "A different goal" });
    expect(res.status).toBe(200);
    const edited = await json(res);
    expect(edited.brief.approval).toBeNull();
    expect(edited.hash).toBeNull();
    expect(edited.brief.goal).toBe("A different goal");
    const now = await reread(first.id);
    expect(now.brief.approval).toBeNull();
    expect(now.hash).toBeNull();

    const again = await json(await approve(first.id));
    expect(again.hash).toMatch(HEX64);
    expect(again.hash).not.toBe(first.hash);
    expect(again.hash).toBe(referenceHash(again.brief));
  });

  it.each<[string, Record<string, unknown>]>([
    ["the expectations", { expectations: ["Only this one"] }],
    ["the scope", { scopePaths: ["/app"] }],
    ["the test data", { testData: { x: "1" } }],
    ["the permission to change existing records", { allowModification: true }],
  ])("clears the approval when %s changes", async (_name, edit) => {
    const first = await approvedDraft();
    const edited = await json(await send("PUT", `/api/briefs/${first.id}`, edit));
    expect(edited.brief.approval).toBeNull();
    expect(edited.hash).toBeNull();
  });

  it("clears the approval on an answer, and keeps it when the edit is invalid", async () => {
    const d = await create({}, { ...CLEAN_ANSWER, questions: [{ kind: "scope", text: "Which section may it visit?", options: null, dataName: null }] });
    expect((await approve(d.id)).status).toBe(400);
    const answered = await json(await send("PUT", `/api/briefs/${d.id}`, { answers: { [d.questions[0]!.id]: null } }));
    expect(answered.brief.approval).toBeNull();
    const done = await json(await approve(d.id));
    expect(done.hash).toMatch(HEX64);
    const refused = await send("PUT", `/api/briefs/${d.id}`, { goal: "" });
    expect(refused.status).toBe(400);
    const now = await reread(d.id);
    expect(now.hash).toBe(done.hash);
    expect(now.brief.approval).toEqual(done.brief.approval);
  });
});

describe("storage", () => {
  it("keeps at most MAX_BRIEFS drafts, dropping the oldest first", async () => {
    expect(MAX_BRIEFS).toBe(50);
    await enableLocalAi();
    fake.reply(CLEAN_ANSWER);
    const ids: string[] = [];
    for (let i = 0; i < MAX_BRIEFS + 1; i++) {
      const res = await send("POST", "/api/briefs", { ...request(), goal: `${GOAL} (${i})` });
      expect(res.status).toBe(201);
      ids.push((await json(res)).id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect((await get(`/api/briefs/${ids[0]!}`)).status).toBe(404);
    expect((await get(`/api/briefs/${ids[1]!}`)).status).toBe(200);
    expect((await get(`/api/briefs/${ids.at(-1)!}`)).status).toBe(200);
  }, 120_000);

  it("keeps nothing across a restart: a new app doesn't know the drafts of the old one", async () => {
    const d = await create();
    const restarted = createApp({ canShowBrowser: false, maxConcurrentRuns: 10, agent: true, runsDir: join(tmp, "runs") });
    expect((await get(`/api/briefs/${d.id}`, RH, restarted)).status).toBe(404);
    expect((await approve(d.id, RH, restarted)).status).toBe(404);
    expect((await get(`/api/briefs/${d.id}`)).status).toBe(200);
  });
});
