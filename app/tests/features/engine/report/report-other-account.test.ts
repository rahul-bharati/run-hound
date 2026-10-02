import { describe, expect, it } from "vitest";
import type { AccountRef, Report, Scenario } from "../../../../src/core/types.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown, signedInSentence } from "../../../../src/engine/report.js";

// The report header's "other-account" line (0.6.0 close-out): Account B was used for access-control's other-account scenario (can it read Account A's data) and write-access's (can it change or delete it). Only other-account scenarios that ran count; a skipped one sent nothing as Account B, so it doesn't name what B was used for; when every one was skipped, the approved ones do. A DELETE sent as Account B turns "change" into "change or delete" ("read, change or delete" with access-control's). The web UI's report view and signedInSentence (which the CLI prints after a run) say the same.

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };

function scenario(id: string, checkId: Scenario["checkId"], scope: Scenario["scope"]): Scenario {
  return { id, checkId, title: id, description: "d", kind: "danger", priority: "high", destructive: false, defaultSelected: false, scope } as Scenario;
}

const SCENARIOS: Scenario[] = [
  scenario("access-control:other-account", "access-control", "page"),
  scenario("access-control:signed-out", "access-control", "page"),
  scenario("write-access:other-account", "write-access", "form"),
  scenario("write-access:signed-out", "write-access", "form"),
  scenario("write-access:other-account@form-2", "write-access", "form"),
  scenario("write-access:other-account#2", "write-access", "form"),
];

function report(approved: string[], skipped: string[] = [], steps: Record<string, string[]> = {}): Report {
  const form = {
    url: "http://127.0.0.1:5173/app",
    selector: "#new-task",
    name: "New task",
    fields: [{ key: "title", accessibleName: "Title", label: "Title", placeholder: null, type: "text", role: "textbox", required: true, selector: "#title" }],
    controls: [{ accessibleName: "Add task", text: "Add task", role: "button", tag: "button", selector: "button", isSubmit: true }],
  };
  return {
    runId: "run-other",
    target: form.url,
    startedAt: "2026-09-28T10:00:00.000Z",
    finishedAt: "2026-09-28T10:01:00.000Z",
    durationMs: 60_000,
    groups: [{ id: "security", label: "Security", scenarioIds: approved, passed: approved.length, failed: 0, errored: 0, skipped: 0, findings: 0, durationMs: 10 }],
    runHoundVersion: "0.6.0",
    plan: {
      target: form.url,
      form,
      page: { url: form.url, title: "App", forms: [form], controls: [], links: 2 },
      scenarios: SCENARIOS,
      groups: [{ id: "security", label: "Security", scenarioIds: SCENARIOS.map((s) => s.id) }],
      account: A,
    },
    approved,
    results: approved.map((id) => ({
      checkId: SCENARIOS.find((s) => s.id === id)!.checkId,
      scenarioId: id,
      status: skipped.includes(id) ? ("skipped" as const) : ("pass" as const),
      findings: [],
      durationMs: 5,
      ...(steps[id] ? { steps: steps[id]!.map((label) => ({ label, url: "http://127.0.0.1:5173/app", at: "2026-09-28T10:00:30.000Z" })) } : {}),
    })),
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: approved.length, failed: 0, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
    testRecordsCreated: 1,
    accounts: { signedInAs: A, other: B },
  } as unknown as Report;
}

// The phrase both renderers use after the other account's label.
const used = (what: string) => `used to check that it can't ${what} Account A's data`;

describe("the report's other-account line", () => {
  it("says 'read' when only access-control's other-account scenario ran", () => {
    const r = report(["access-control:other-account", "access-control:signed-out"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("read"));
      expect(text).not.toContain("or change");
      expect(text).not.toContain(used("change"));
    }
  });

  it("says 'change' when only write-access's other-account scenario ran", () => {
    const r = report(["write-access:other-account", "write-access:signed-out"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("change"));
      expect(text).not.toContain(used("read"));
    }
  });

  it("says 'read or change' when both ran", () => {
    const r = report(["access-control:other-account", "write-access:other-account"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("read or change"));
  });

  it.each(["write-access:other-account@form-2", "write-access:other-account#2"])("counts write-access's other-account scenario as %s", (id) => {
    const r = report(["access-control:other-account", id]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("read or change"));
  });

  it("never counts a signed-out scenario as the other account's", () => {
    const r = report(["access-control:other-account", "write-access:signed-out"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("read"));
      expect(text).not.toContain("or change");
    }
  });

  it("keeps 'read' for a report whose approved scenarios name neither (written before 0.6.0)", () => {
    const r = report([]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("read"));
  });

  it("says 'read' when write-access's other-account scenario was skipped (it sent nothing as Account B)", () => {
    const r = report(["access-control:other-account", "write-access:other-account"], ["write-access:other-account"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("read"));
      expect(text).not.toContain("or change");
      expect(text).not.toContain(used("change"));
    }
  });

  it("says 'change' when access-control's other-account scenario was skipped and write-access's ran", () => {
    const r = report(["access-control:other-account", "write-access:other-account"], ["access-control:other-account"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("change"));
  });

  it("falls back to the approved scenarios when every other-account scenario was skipped", () => {
    const r = report(["access-control:other-account", "write-access:other-account"], ["access-control:other-account", "write-access:other-account"]);
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("read or change"));
  });
});

describe("the report's other-account line when write-access sent the app's DELETE as Account B", () => {
  const WA = "write-access:other-account";
  const UPDATE = "Sending PATCH /api/tasks/2 as Account B";
  const DELETE = "Sending DELETE /api/tasks/2 as Account B";

  it("says 'change or delete' when write-access's other-account scenario sent a DELETE as Account B", () => {
    const r = report([WA, "write-access:signed-out"], [], { [WA]: ["Opening the form", UPDATE, DELETE] });
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("change or delete"));
      expect(text).not.toContain(used("change"));
    }
  });

  it("says 'read, change or delete' when access-control's ran too", () => {
    const r = report(["access-control:other-account", "write-access:other-account@form-2"], [], { "write-access:other-account@form-2": [UPDATE, DELETE] });
    for (const text of [renderMarkdown(r), renderHtml(r)]) expect(text).toContain(used("read, change or delete"));
  });

  it("keeps 'change' when no DELETE was sent as Account B", () => {
    const r = report([WA], [], { [WA]: ["Opening the form", UPDATE] });
    for (const text of [renderMarkdown(r), renderHtml(r)]) {
      expect(text).toContain(used("change"));
      expect(text).not.toContain("delete Account A's data");
    }
    const both = report(["access-control:other-account", WA], [], { [WA]: [UPDATE] });
    for (const text of [renderMarkdown(both), renderHtml(both)]) expect(text).toContain(used("read or change"));
  });

  it("never counts a DELETE sent as a signed-out visitor, or one a skipped scenario names", () => {
    const signedOut = report([WA, "write-access:signed-out"], [], { [WA]: [UPDATE], "write-access:signed-out": ["Sending DELETE /api/tasks/2 as a signed-out visitor"] });
    for (const text of [renderMarkdown(signedOut), renderHtml(signedOut)]) expect(text).toContain(used("change"));
    const skipped = report(["access-control:other-account", WA], [WA], { [WA]: [DELETE] });
    for (const text of [renderMarkdown(skipped), renderHtml(skipped)]) {
      expect(text).toContain(used("read"));
      expect(text).not.toContain("delete Account A's data");
    }
  });

  it("signedInSentence says it too", () => {
    expect(signedInSentence(report([WA], [], { [WA]: [UPDATE, DELETE] }))).toBe(
      "Signed in as Account A; Account B was used to check that it can't change or delete Account A's data.",
    );
    expect(signedInSentence(report(["access-control:other-account", WA], [], { [WA]: [DELETE] }))).toBe(
      "Signed in as Account A; Account B was used to check that it can't read, change or delete Account A's data.",
    );
    expect(signedInSentence(report([WA], [], { [WA]: [UPDATE] }))).toBe("Signed in as Account A; Account B was used to check that it can't change Account A's data.");
  });
});

describe("signedInSentence: the terminal's line after a run", () => {
  it("names what Account B was used for, as the reports do, never 'the access checks'", () => {
    expect(signedInSentence(report(["write-access:other-account"]))).toBe("Signed in as Account A; Account B was used to check that it can't change Account A's data.");
    expect(signedInSentence(report(["access-control:other-account"]))).toBe("Signed in as Account A; Account B was used to check that it can't read Account A's data.");
    expect(signedInSentence(report(["access-control:other-account", "write-access:other-account@form-2"]))).toBe(
      "Signed in as Account A; Account B was used to check that it can't read or change Account A's data.",
    );
  });

  it("names only Account A when no other account was used, and nothing for a signed-out run", () => {
    expect(signedInSentence({ ...report(["write-access:signed-out"]), accounts: { signedInAs: A, other: null } })).toBe("Signed in as Account A.");
    expect(signedInSentence({ ...report([]), accounts: { signedInAs: null, other: null } })).toBeNull();
  });

  it("is what the CLI prints after a run", async () => {
    const { readFile } = await import("node:fs/promises");
    const presenter = await readFile(new URL("../../../../src/cli/presenters/run.ts", import.meta.url), "utf8");
    expect(presenter).toMatch(/signedInSentence\(report\)/);
    expect(presenter).not.toMatch(/was used for the access checks/);
  });
});
