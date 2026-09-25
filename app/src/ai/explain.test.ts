import { describe, expect, it } from "vitest";
import type { Finding } from "../core/types.js";
import { EXPLAIN_SCHEMA, explainFindings, explainPrompt, validateExplain } from "./explain.js";
import { AiError } from "./types.js";
import { FAKE_AWS_KEY, FakeClient, REDACTED_AWS, makeFinding, makeReport, schemaProblems } from "./test-fixtures.js";

const answer = (n = 1) => ({ summary: `Summary ${n}.`, askYourAi: `Fix prompt ${n}.` });

function findings(n: number): Finding[] {
  return Array.from({ length: n }, (_, i) => makeFinding({ id: `double-submit#${i + 1}`, title: `Finding ${i + 1}` }));
}

describe("validateExplain", () => {
  it("accepts {summary, askYourAi}", () => {
    expect(validateExplain(answer())).toEqual(answer());
  });

  it.each([
    ["null", null],
    ["an array", [answer()]],
    ["summary missing", { askYourAi: "x" }],
    ["askYourAi missing", { summary: "x" }],
    ["summary not a string", { summary: 1, askYourAi: "x" }],
    ["askYourAi not a string", { summary: "x", askYourAi: null }],
  ])("rejects %s", (_name, value) => {
    expect(() => validateExplain(value)).toThrow(/^(?![\s\S]*not implemented)/);
  });
});

describe("EXPLAIN_SCHEMA", () => {
  it("is an object schema in the portable subset with summary and askYourAi", () => {
    expect(EXPLAIN_SCHEMA.type).toBe("object");
    expect(schemaProblems(EXPLAIN_SCHEMA)).toEqual([]);
    expect(Object.keys(EXPLAIN_SCHEMA.properties as object).sort()).toEqual(["askYourAi", "summary"]);
  });
});

describe("explainPrompt", () => {
  it("includes the title, severity, location, meaning, impact, fix and evidence facts", () => {
    const { system, user } = explainPrompt(makeFinding());
    expect(system.length).toBeGreaterThan(0);
    for (const text of ["Double click books twice", "high", "Book button", "Clicking Book twice quickly sends two bookings.", "Customers get charged twice.", "Disable the Book button", "Requests sent", "Book a sitter form"]) {
      expect(user).toContain(text);
    }
  });

  it("includes every location of a multi-location finding", () => {
    const { user } = explainPrompt(makeFinding({ locations: ["Name field", "Email field"] }));
    expect(user).toContain("Name field");
    expect(user).toContain("Email field");
  });

  it("never includes evidence paths, evidence data or specs", () => {
    const finding = makeFinding({ spec: { filename: "spec-marker.spec.ts", source: "spec-source-marker" } });
    const { system, user } = explainPrompt(finding);
    const all = system + user;
    expect(all).not.toContain("evidence-path-marker");
    expect(all).not.toContain("evidence-data-marker");
    expect(all).not.toContain("spec-source-marker");
  });

  it("redacts secrets in texts and facts", () => {
    const finding = makeFinding({
      meaning: `The bundle contains ${FAKE_AWS_KEY}.`,
      evidence: [{ kind: "card", label: "Bundle", facts: [{ label: "Key", value: FAKE_AWS_KEY }] }],
    });
    const { system, user } = explainPrompt(finding);
    expect(system + user).not.toContain(FAKE_AWS_KEY);
    expect(user).toContain(REDACTED_AWS);
  });

  it("cuts each text to 300 characters", () => {
    const finding = makeFinding({
      meaning: "m".repeat(1000),
      evidence: [{ kind: "note", label: "Note", facts: [{ label: "Long", value: "v".repeat(1000) }] }],
    });
    const { user } = explainPrompt(finding);
    expect(user).toContain("m".repeat(250));
    expect(user).not.toContain("m".repeat(301));
    expect(user).not.toContain("v".repeat(301));
  });
});

describe("explainPrompt: what a remote model never sees", () => {
  const target = "https://shop.example.com/account/settings?session=abc123secret&ref=mail#tab=billing";
  const leaky = () =>
    makeFinding({
      title: "Saving settings fails",
      meaning: `Submitting the form on ${target} answered 500 (POST /api/save?token=tok-in-path-999).`,
      impact: `People on ${target} lose their changes.`,
      fix: `Ask your AI or developer: "Run these steps on ${target}: type into Email, click Save."`,
      location: `Email field on ${target}`,
      evidence: [
        {
          kind: "frame",
          label: "After saving",
          facts: [
            { label: "Requests sent", value: "2" },
            { label: "Value sent", value: "ada.lovelace@private-mail.example" },
            { label: "Test values typed", value: "Rex Barker" },
            { label: "Now", value: "leftover-now-value" },
            { label: "Field", value: "owner.3fa9c01bpersist@example.test" },
            { label: "Matched text", value: "Name 3fa9c01bpersist" },
            { label: "Page", value: target },
            { label: "Status", value: "500" },
          ],
        },
      ],
    });

  it("replaces every absolute URL with its path and strips query strings and hashes", () => {
    const { system, user } = explainPrompt(leaky(), { remote: true });
    const all = system + user;
    for (const leak of ["shop.example.com", "https://", "abc123secret", "ref=mail", "tab=billing", "tok-in-path-999"]) expect(all).not.toContain(leak);
    expect(user).toContain("/account/settings");
    expect(user).toContain("POST /api/save");
    expect(user).toContain("answered 500");
  });

  it("drops facts that carry typed or sent values and facts holding the run's canary values", () => {
    const { user } = explainPrompt(leaky(), { remote: true, runToken: "3fa9c01b" });
    for (const leak of ["Value sent", "ada.lovelace@private-mail.example", "Test values typed", "Rex Barker", "leftover-now-value", "3fa9c01b", "example.test"]) {
      expect(user).not.toContain(leak);
    }
    expect(user).toContain("Requests sent: 2");
    expect(user).toContain("Status: 500");
  });

  it("recognises canary values without the run token too", () => {
    const { user } = explainPrompt(leaky(), { remote: true });
    expect(user).not.toContain("3fa9c01bpersist");
    expect(user).not.toContain("example.test");
  });

  it("locally keeps URLs but still drops value-bearing facts", () => {
    const { user } = explainPrompt(leaky(), { remote: false });
    expect(user).toContain("https://shop.example.com/account/settings");
    for (const leak of ["Value sent", "ada.lovelace@private-mail.example", "Rex Barker", "3fa9c01bpersist"]) expect(user).not.toContain(leak);
    expect(user).toContain("Requests sent: 2");
  });

  it("explainFindings sends the remote-redacted prompt to a remote client", async () => {
    const client = new FakeClient([answer()]);
    await explainFindings(makeReport([leaky()]), client, { remote: true });
    expect(client.requests[0]!.user).not.toContain("shop.example.com");
    expect(client.requests[0]!.user).not.toContain("ada.lovelace@private-mail.example");
  });
});

describe("explainFindings", () => {
  it("explains each finding with one call, sets Finding.ai and Report.ai", async () => {
    const report = makeReport(findings(2));
    const client = new FakeClient([answer(1), answer(2)]);
    const controller = new AbortController();
    const out = await explainFindings(report, client, { remote: false, signal: controller.signal });

    expect(client.requests).toHaveLength(2);
    for (const request of client.requests) {
      expect(request.name).toMatch(/^[a-z_]+$/);
      expect(request.schema).toEqual(EXPLAIN_SCHEMA);
      expect(request.signal).toBe(controller.signal);
    }
    expect(client.requests[0]!.user).toBe(explainPrompt(report.findings[0]!).user);
    expect(out.findings.map((f) => f.ai)).toEqual([
      { summary: "Summary 1.", askYourAi: "Fix prompt 1.", model: "ollama/ornith-1.5:9b" },
      { summary: "Summary 2.", askYourAi: "Fix prompt 2.", model: "ollama/ornith-1.5:9b" },
    ]);
    expect(out.ai).toEqual({ provider: "ollama", model: "ornith-1.5:9b", remote: false, warnings: [], explained: 2 });
  });

  it("names the provider and model of the client and records remote", async () => {
    const client = new FakeClient([answer()], { provider: "openai-compatible", model: "gpt-5-mini" });
    const out = await explainFindings(makeReport(findings(1)), client, { remote: true });
    expect(out.findings[0]!.ai!.model).toBe("openai-compatible/gpt-5-mini");
    expect(out.ai).toMatchObject({ provider: "openai-compatible", model: "gpt-5-mini", remote: true, explained: 1 });
  });

  it("calls the model one finding at a time", async () => {
    const client = new FakeClient([answer()]);
    await explainFindings(makeReport(findings(4)), client, { remote: false });
    expect(client.requests).toHaveLength(4);
    expect(client.maxInFlight).toBe(1);
  });

  it("explains at most 20 findings", async () => {
    const client = new FakeClient([answer()]);
    const out = await explainFindings(makeReport(findings(25)), client, { remote: false });
    expect(client.requests).toHaveLength(20);
    expect(out.findings.slice(0, 20).every((f) => f.ai !== undefined)).toBe(true);
    expect(out.findings.slice(20).every((f) => f.ai === undefined)).toBe(true);
    expect(out.findings).toHaveLength(25);
    expect(out.ai!.explained).toBe(20);
  });

  it("cuts the summary to 600 and askYourAi to 1000 characters", async () => {
    const client = new FakeClient([{ summary: "s".repeat(2000), askYourAi: "a".repeat(3000) }]);
    const out = await explainFindings(makeReport(findings(1)), client, { remote: false });
    const ai = out.findings[0]!.ai!;
    expect(ai.summary.length).toBeLessThanOrEqual(600);
    expect(ai.summary.length).toBeGreaterThan(500);
    expect(ai.askYourAi.length).toBeLessThanOrEqual(1000);
    expect(ai.askYourAi.length).toBeGreaterThan(900);
  });

  it("leaves a finding whose call fails without ai and warns once per distinct error", async () => {
    const client = new FakeClient([
      answer(1),
      new AiError("http", "The server answered HTTP 500"),
      new AiError("http", "The server answered HTTP 500"),
      answer(4),
      new AiError("bad-output", "The model's answer was not valid JSON"),
    ]);
    const out = await explainFindings(makeReport(findings(5)), client, { remote: false });
    expect(client.requests).toHaveLength(5);
    expect(out.findings.map((f) => f.ai !== undefined)).toEqual([true, false, false, true, false]);
    expect(out.ai!.explained).toBe(2);
    expect(out.ai!.warnings).toHaveLength(2);
    expect(out.ai!.warnings.some((w) => w.includes("HTTP 500"))).toBe(true);
    expect(out.ai!.warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
  });

  it.each([
    ["timeout", new AiError("timeout", "The model took longer than 120 s")],
    ["unreachable", new AiError("unreachable", "Nothing is answering")],
  ])("retries a call that fails with %s once", async (_code, error) => {
    const client = new FakeClient([answer(1), error, answer(2), answer(3)]);
    const out = await explainFindings(makeReport(findings(3)), client, { remote: false });
    expect(client.requests).toHaveLength(4);
    expect(client.requests[2]!.user).toBe(client.requests[1]!.user);
    expect(out.findings.map((f) => f.ai?.summary)).toEqual(["Summary 1.", "Summary 2.", "Summary 3."]);
    expect(out.ai).toMatchObject({ explained: 3, warnings: [] });
  });

  it("does not retry other errors", async () => {
    const client = new FakeClient([new AiError("bad-output", "not valid"), answer(2)]);
    const out = await explainFindings(makeReport(findings(2)), client, { remote: false });
    expect(client.requests).toHaveLength(2);
    expect(out.ai!.explained).toBe(1);
  });

  it("stops explaining after 2 timeouts in a row and says how many findings were skipped", async () => {
    const timeout = new AiError("timeout", "The model took longer than 120 s");
    const client = new FakeClient([answer(1), timeout, timeout, answer(9)]);
    const out = await explainFindings(makeReport(findings(5)), client, { remote: false });
    expect(client.requests).toHaveLength(3);
    expect(out.findings.map((f) => f.ai !== undefined)).toEqual([true, false, false, false, false]);
    expect(out.ai!.explained).toBe(1);
    expect(out.ai!.warnings.some((w) => w.includes("took longer"))).toBe(true);
    const skipped = out.ai!.warnings.filter((w) => /skipped/i.test(w));
    expect(skipped).toHaveLength(1);
    // finding 2 timed out (its own warning); findings 3-5 were never tried
    expect(skipped[0]).toMatch(/\b3 findings\b/);
  });

  it("keeps going when timeouts are not consecutive", async () => {
    const timeout = new AiError("timeout", "The model took longer than 120 s");
    // finding 1: timeout, retry ok; finding 2: timeout, retry ok; finding 3: ok
    const client = new FakeClient([timeout, answer(1), timeout, answer(2), answer(3)]);
    const out = await explainFindings(makeReport(findings(3)), client, { remote: false });
    expect(client.requests).toHaveLength(5);
    expect(out.ai).toMatchObject({ explained: 3, warnings: [] });
  });

  it("does not reject when every call fails", async () => {
    const client = new FakeClient([new AiError("unreachable", "Nothing is answering")]);
    const out = await explainFindings(makeReport(findings(3)), client, { remote: false });
    expect(out.findings.every((f) => f.ai === undefined)).toBe(true);
    expect(out.ai).toMatchObject({ explained: 0, warnings: [expect.stringContaining("Nothing is answering")] });
  });

  it("makes no calls for a report without findings", async () => {
    const client = new FakeClient([answer()]);
    const out = await explainFindings(makeReport([]), client, { remote: false });
    expect(client.requests).toHaveLength(0);
    expect(out.ai).toEqual({ provider: "ollama", model: "ornith-1.5:9b", remote: false, warnings: [], explained: 0 });
  });

  it("does not mutate the input report and keeps the built-in texts", async () => {
    const report = makeReport(findings(2));
    const before = structuredClone(report);
    const out = await explainFindings(report, new FakeClient([answer()]), { remote: false });
    expect(report).toEqual(before);
    expect(out.findings.map(({ ai: _ai, ...rest }) => rest)).toEqual(before.findings);
    expect(out.results).toEqual(before.results.map((r) => ({ ...r, findings: expect.any(Array) })));
    expect(out.plan).toEqual(before.plan);
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new FakeClient([answer()]);
    await expect(explainFindings(makeReport(findings(2)), client, { remote: false, signal: controller.signal })).rejects.toThrow(/^(?![\s\S]*not implemented)/);
  });

  it("rejects when the signal aborts during the run", async () => {
    const controller = new AbortController();
    const client = new FakeClient([
      () => {
        controller.abort();
        return new AiError("timeout", "aborted");
      },
    ]);
    await expect(explainFindings(makeReport(findings(3)), client, { remote: false, signal: controller.signal })).rejects.toThrow(/^(?![\s\S]*not implemented)/);
    expect(client.requests.length).toBeLessThan(3);
  });
});
