import { describe, expect, it } from "vitest";
import type { AccountRef, Report, Scenario } from "../core/types.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown, signedInSentence } from "./report.js";

/**
 * The report header's "other account" line (0.6.0 close-out): Account B signs in for access-control's other-account
 * scenario (can it read Account A's data) and for write-access's (can it change it), so the line says what the run
 * used it for, from the approved scenarios:
 * - access-control:other-account only: "used to check that it can't read Account A's data" (as in 0.4.0);
 * - write-access:other-account only (on any form, under any collision suffix): "… can't change …";
 * - both: "… can't read or change …";
 * - a report that names the other account with neither approved (written before 0.6.0): "… can't read …".
 * Only the other-account scenarios that ran count (close-out round 1): one that was skipped sent nothing as Account B,
 * so it doesn't name what B was used for; when every one was skipped, the approved ones do.
 * The web UI's report view says the same (server/ui-other-account.test.ts), and so does the terminal's line after a run
 * (signedInSentence, which cli.ts prints).
 */

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

function report(approved: string[], skipped: string[] = []): Report {
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
    })),
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, passed: approved.length, failed: 0, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
    testRecordsCreated: 1,
    accounts: { signedInAs: A, other: B },
  } as unknown as Report;
}

/** The phrase both renderers use after the other account's label. */
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

describe("signedInSentence: the terminal's line after a run (cli.ts)", () => {
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

  it("is what cli.ts prints after a run", async () => {
    const { readFile } = await import("node:fs/promises");
    const cli = await readFile(new URL("../cli.ts", import.meta.url), "utf8");
    expect(cli).toMatch(/signedInSentence\(report\)/);
    expect(cli).not.toMatch(/was used for the access checks/);
  });
});
