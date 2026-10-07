import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { resolveAiConfig } from "../../../src/ai/config.js";
import { aiSession } from "../../../src/ai/session.js";
import { emptyForm } from "../../../src/engine/discover.js";
import { cliContext } from "../../support/cli.js";
import type { Plan, Report } from "../../../src/core/types.js";
import type { IRunServices } from "../../../src/interfaces/cli.js";

async function runHarness() {
  const streams = cliContext();
  const resolved = await resolveAiConfig({
    env: { RUNHOUND_CONFIG_DIR: process.env.RUNHOUND_CONFIG_DIR },
    flags: { enabled: false },
  });
  const target = "http://localhost/book";
  const plan: Plan = {
    target,
    form: emptyForm(target),
    scenarios: [],
    groups: [{ id: "features", label: "alice@example.test", scenarioIds: [] }],
  };
  const report: Report = {
    runId: "run-1", target,
    startedAt: "2026-10-02T00:00:00.000Z",
    finishedAt: "2026-10-02T00:00:01.000Z",
    durationMs: 1000,
    groups: [{ ...plan.groups[0]!, passed: 1, failed: 0, errored: 0, skipped: 0, findings: 1, durationMs: 1000 }],
    runHoundVersion: "0.6.1", plan, approved: [], results: [],
    findings: [{
      checkId: "dead-control", id: "dead-control#1", title: "Control for alice@example.test",
      severity: "low", category: "broken-feature", confidence: "advisory",
      meaning: "Test finding", impact: "Test impact", fix: "Test fix", evidence: [],
    }],
    summary: { critical: 0, high: 0, medium: 0, low: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
    notVisible: [], testRecordsCreated: 1,
  };
  const discover = vi.fn<IRunServices["discoverAndPlan"]>(async () => plan);
  const execute = vi.fn<IRunServices["runPlan"]>(async () => ({ report, dir: "runs/alice@example.test" }));
  const services: IRunServices = {
    resolveAccounts: async () => { throw new Error("Accounts must not be read for a signed-out run"); },
    resolveAiConfig: async () => resolved,
    discoverAndPlan: discover,
    runPlan: execute,
    registerPasswords: () => { throw new Error("No accounts to register"); },
    canShowBrowser: () => false,
    aiSession,
  };
  return { ...streams, services, discover, execute, resolved };
}

describe("run command boundaries", () => {
  it("masks the account username in every text report line, including the report path", async () => {
    const h = await runHarness();
    h.context.setAccountHider((text) => text.replaceAll("alice@example.test", "[account]"));
    expect(await runCommand(["http://localhost/book"], h)).toBe(0);
    expect(h.readOut()).not.toContain("alice@example.test");
    expect(h.readOut()).toContain("  [account]: 1 passed");
    expect(h.readOut()).toContain("Control for [account]");
    expect(h.readOut()).toContain("Report: runs/[account]/report.html\n");
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it("preserves the explicit-AI remedy and fails before discovery", async () => {
    const h = await runHarness();
    h.resolved.config.enabled = true;
    h.resolved.config.provider = "ollama";
    h.resolved.config.model = "";
    await expect(runCommand(["http://localhost/book", "--ai"], h)).rejects.toThrow(
      "--ai: Choose a model. Pass --ai-model <id> or set RUNHOUND_AI_MODEL.",
    );
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("keeps the implicit-AI warning and plan-only masking without running checks", async () => {
    const h = await runHarness();
    h.resolved.config.enabled = true;
    h.resolved.config.provider = "ollama";
    h.resolved.config.model = "";
    h.context.setAccountHider((text) => text.replaceAll("alice@example.test", "[account]"));
    expect(await runCommand(["http://localhost/book", "--plan-only"], h)).toBe(0);
    expect(h.readErr()).toContain("Warning: AI is not used: Choose a model. Pass --ai-model <id> or set RUNHOUND_AI_MODEL.\n");
    expect(h.readOut()).toContain("[account] (0 scenarios)");
    expect(h.readOut()).not.toContain("alice@example.test");
    expect(h.execute).not.toHaveBeenCalled();
  });
});
