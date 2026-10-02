/**
 * AI hooks of the runner (docs/ai-spec.md "Surfaces" → Runner).
 *
 * Option shape the integrator implements (on RunOptions, used by both discoverAndPlan and runPlan):
 *
 *   ai?: { client: LlmClient; remote: boolean; features: AiFeatures }
 *
 * - discoverAndPlan(url, {ai}): after buildPlan, reviewPlan when features.review, then suggestScenarios when
 *   features.suggest; sets Plan.ai = {provider, model, remote, warnings, reviewedAt, reviewed, suggested}. A failed call
 *   leaves the built-in plan and adds a warning. Engine step "Asking <provider>/<model> to review the plan".
 * - runPlan(plan, {ai}): when features.explain, explainFindings before writeReport; Report.ai = {…, explained}.
 *   report.json carries Finding.ai; report.md labels it "AI explanation" and "advisory".
 * - Without `ai`, nothing AI-related appears and the client is never called.
 *
 * The fake client below answers whatever the request's own validator accepts (review, suggest or explain answer),
 * so the tests don't depend on schema names or call order.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { AiError, type AiFeatures, type JsonRequest, type LlmClient } from "../ai/types.js";
import type { Check, CheckId, Finding, Report, Scenario } from "../core/types.js";
import { discoverAndPlan, runPlan, type ProgressEvent, type RunOptions } from "./runner.js";

/** The option the integrator adds to RunOptions. Typed separately so this file compiles before it exists. */
interface AiRunOptions {
  client: LlmClient;
  remote: boolean;
  features: AiFeatures;
}
type Options = RunOptions & { ai?: AiRunOptions };

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Runner AI fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

function finding(checkId: CheckId): Finding {
  return {
    checkId,
    id: `${checkId}#1`,
    title: "Fake silent failure",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "The form says nothing when the server fails.",
    impact: "Users think they booked.",
    fix: "Show an error message.",
    evidence: [{ kind: "note", label: "fake", facts: [{ label: "Status", value: "500" }] }],
  };
}

const checks: Check[] = [
  {
    id: "silent-failure",
    title: "Fake silent-failure",
    category: "broken-feature",
    plan: () => [scenario("silent-failure", "sf:500")],
    async run(_ctx, s) {
      return { checkId: "silent-failure", scenarioId: s.id, status: "fail", findings: [finding("silent-failure")], durationMs: 1 };
    },
  },
  {
    id: "dead-control",
    title: "Fake dead-control",
    category: "broken-feature",
    plan: () => [scenario("dead-control", "dc:controls")],
    async run(_ctx, s) {
      return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
    },
  },
];

const REVIEW = {
  scenarios: [
    { id: "sf:500", recommended: true, priority: "high", rationale: "A booking that silently fails loses customers." },
    { id: "dc:controls", recommended: false, priority: "low", rationale: "There is only one button." },
  ],
};
const SUGGEST = {
  suggestions: [
    {
      title: "Book Rex",
      rationale: "The main job of the page.",
      form: 0,
      steps: [
        { action: "fill", field: "petName", value: "Rex" },
        { action: "click", control: 0 },
        { action: "expect", expect: "request-ok", text: null },
      ],
    },
  ],
};
const EXPLAIN = {
  summary: "When the server fails, the page shows nothing, so people believe the booking went through.",
  askYourAi: "Show a visible error message when POST /api/bookings fails.",
};

interface FakeClient extends LlmClient {
  calls: string[];
}

/** Answers the first canned answer the request's validator accepts; `fail` makes every call reject. */
function fakeClient(options: { fail?: boolean } = {}): FakeClient {
  const calls: string[] = [];
  return {
    provider: "ollama",
    model: "fake-model",
    calls,
    async generateJson<T>(request: JsonRequest<T>): Promise<T> {
      calls.push(request.name);
      if (options.fail) throw new AiError("bad-output", "The model's answer was not valid JSON.");
      for (const candidate of [REVIEW, SUGGEST, EXPLAIN]) {
        try {
          return request.validate(candidate);
        } catch {
          // not this one
        }
      }
      throw new AiError("bad-output", `no canned answer fits ${request.name}`);
    },
  };
}

const ALL: AiFeatures = { review: true, suggest: true, explain: true };

let server: FixtureServer;
let runsDir: string;

beforeAll(async () => {
  server = await startFixtureServer({ pages: { "/book": FORM_PAGE } });
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runs-ai-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

const url = () => `${server.url}/book`;

describe("discoverAndPlan with AI", () => {
  it("reviews and suggests after building the plan, and reports the step", async () => {
    const client = fakeClient();
    const steps: string[] = [];
    const options: Options = {
      checks,
      ai: { client, remote: false, features: { review: true, suggest: true, explain: false } },
      onProgress: (e: ProgressEvent) => {
        if (e.type === "step") steps.push(e.label);
      },
    };
    const plan = await discoverAndPlan(url(), options);
    expect(client.calls.length).toBe(2);
    expect(plan.ai).toMatchObject({ provider: "ollama", model: "fake-model", remote: false, reviewed: true, suggested: 1, warnings: [] });
    expect(typeof plan.ai!.reviewedAt).toBe("string");
    const sf = plan.scenarios.find((s) => s.id === "sf:500")!;
    expect(sf.ai).toEqual({ rationale: "A booking that silently fails loses customers.", recommended: true });
    expect(sf.priority).toBe("high");
    // The review can tick a scenario but never untick a default one (docs/ai-spec.md, "Review"): advice only.
    expect(plan.scenarios.find((s) => s.id === "dc:controls")!.defaultSelected).toBe(true);
    const flow = plan.scenarios.find((s) => s.id === "ai-flow:1")!;
    expect(flow.checkId).toBe("ai-flow");
    expect(flow.defaultSelected).toBe(false);
    expect(steps.some((l) => /Asking ollama\/fake-model to review the plan/.test(l))).toBe(true);
  });

  it("only reviews when suggest is off", async () => {
    const client = fakeClient();
    const options: Options = { checks, ai: { client, remote: false, features: { review: true, suggest: false, explain: false } } };
    const plan = await discoverAndPlan(url(), options);
    expect(client.calls.length).toBe(1);
    expect(plan.ai?.reviewed).toBe(true);
    expect(plan.ai?.suggested).toBe(0);
    expect(plan.scenarios.some((s) => s.checkId === "ai-flow")).toBe(false);
  });

  it("keeps the built-in plan with warnings when the model fails", async () => {
    const client = fakeClient({ fail: true });
    const options: Options = { checks, ai: { client, remote: false, features: ALL } };
    const plan = await discoverAndPlan(url(), options);
    expect(plan.ai?.reviewed).toBe(false);
    expect(plan.ai?.warnings.length).toBeGreaterThan(0);
    expect(plan.scenarios.map((s) => s.id).sort()).toEqual(["dc:controls", "sf:500"]);
    expect(plan.scenarios.every((s) => s.ai === undefined && s.defaultSelected)).toBe(true);
  });

  it("without ai: no AI fields", async () => {
    const plan = await discoverAndPlan(url(), { checks });
    expect(plan.ai).toBeUndefined();
    expect(plan.scenarios.every((s) => s.ai === undefined)).toBe(true);
  });
});

describe("runPlan with AI explanations", () => {
  it("explains findings into report.json and report.md, labelled advisory", async () => {
    const plan = await discoverAndPlan(url(), { checks });
    const client = fakeClient();
    const options: Options = { checks, runsDir, ai: { client, remote: false, features: { review: false, suggest: false, explain: true } } };
    const { report, dir } = await runPlan(plan, options);
    expect(client.calls.length).toBe(1);
    expect(report.ai).toMatchObject({ provider: "ollama", model: "fake-model", remote: false, explained: 1, warnings: [] });
    const f = report.findings[0]!;
    expect(f.ai).toEqual({ summary: EXPLAIN.summary, askYourAi: EXPLAIN.askYourAi, model: "ollama/fake-model" });
    // Built-in texts are untouched.
    expect(f.meaning).toBe("The form says nothing when the server fails.");
    expect(f.severity).toBe("high");

    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.ai?.explained).toBe(1);
    expect(onDisk.findings[0]!.ai?.summary).toBe(EXPLAIN.summary);

    const md = await readFile(join(dir, "report.md"), "utf8");
    expect(md).toContain("AI explanation");
    expect(md).toMatch(/advisory/i);
    expect(md).toContain(EXPLAIN.summary);
    expect(md).toContain(EXPLAIN.askYourAi);
  });

  it("a failed explanation leaves the finding without one and a warning", async () => {
    const plan = await discoverAndPlan(url(), { checks });
    const client = fakeClient({ fail: true });
    const options: Options = { checks, runsDir, ai: { client, remote: false, features: { review: false, suggest: false, explain: true } } };
    const { report } = await runPlan(plan, options);
    expect(report.findings[0]!.ai).toBeUndefined();
    expect(report.ai?.explained).toBe(0);
    expect(report.ai?.warnings.length).toBeGreaterThan(0);
    expect(report.summary.failed).toBe(1);
  });

  it("does not explain when the explain feature is off", async () => {
    const plan = await discoverAndPlan(url(), { checks });
    const client = fakeClient();
    const options: Options = { checks, runsDir, ai: { client, remote: false, features: { review: true, suggest: true, explain: false } } };
    const { report } = await runPlan(plan, options);
    expect(client.calls).toHaveLength(0);
    expect(report.findings[0]!.ai).toBeUndefined();
  });

  it("without ai: no AI fields and nothing in the Markdown", async () => {
    const client = fakeClient();
    const plan = await discoverAndPlan(url(), { checks });
    const { report, dir } = await runPlan(plan, { checks, runsDir });
    expect(client.calls).toHaveLength(0);
    expect(report.ai).toBeUndefined();
    expect(report.findings.every((f) => f.ai === undefined)).toBe(true);
    const md = await readFile(join(dir, "report.md"), "utf8");
    expect(md).not.toContain("AI explanation");
    const json = await readFile(join(dir, "report.json"), "utf8");
    expect(json).not.toMatch(/"ai"\s*:/);
  });
});
