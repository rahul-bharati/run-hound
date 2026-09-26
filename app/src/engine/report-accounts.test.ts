import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountRef, Finding, Report } from "../core/types.js";
import { registerSecretLiterals } from "./redact.js";
import { NOT_VISIBLE, renderHtml, renderMarkdown, testDataSentence, writeReport } from "./report.js";

/**
 * Reports of signed-in runs (docs/v2-spec.md "Test accounts", "Signed-in runs"; Report.accounts).
 *
 * Interpretations pinned here (marked * where the spec leaves room):
 * - HTML and Markdown say "Signed in as <label>" (* a colon, or markup around the label, is accepted) and, when a scenario used
 *   the other account, name it by label. Labels are escaped in HTML like every other value.
 * - Reports never hold a username or a password: accounts appear by label only, and the passwords and session values
 *   the engine registered with registerSecretLiterals are "[REDACTED:account-secret]" in every file writeReport writes.
 * - * The test-data note says which account the test records belong to (the "Signed-in runs" rule), by label.
 * - A report without `accounts` (0.3.0) or with nobody signed in renders exactly as before: no "Signed in as".
 */

const A: AccountRef = { id: "a", label: "Account A" };
const B: AccountRef = { id: "b", label: "Account B" };
const USERNAME = "alex@fernway.test";
const PASSWORD = "correct-horse-battery-A1";
const SESSION = "sid-4f9c2b7e1d0a6c3b8e5f";

const FORM = {
  url: "http://127.0.0.1:5173/app",
  selector: "#new-task",
  name: "New task",
  fields: [{ key: "title", accessibleName: "Title", label: "Title", placeholder: null, type: "text", role: "textbox", required: true, selector: "#title" }],
  controls: [{ accessibleName: "Add task", text: "Add task", role: "button", tag: "button", selector: "button", isSubmit: true }],
};

function finding(extra: Partial<Finding> = {}): Finding {
  return {
    checkId: "access-control",
    id: "access-control#1",
    title: "Account A's data is readable without signing in (1 endpoint)",
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: "A visitor who is not signed in received Account A's records.",
    impact: "Anyone can read other people's data.",
    fix: "Answer 401 without a session, and only return the session user's records.",
    evidence: [],
    locations: ["GET /api/tasks"],
    ...extra,
  };
}

function report(accounts?: Report["accounts"], extra: Partial<Report> = {}): Report {
  const f = finding();
  return {
    runId: "run-accounts",
    target: "http://127.0.0.1:5173/app",
    startedAt: "2026-09-26T10:00:00.000Z",
    finishedAt: "2026-09-26T10:01:00.000Z",
    durationMs: 60_000,
    groups: [{ id: "security", label: "Security", scenarioIds: ["access-control:signed-out"], passed: 0, failed: 1, errored: 0, skipped: 0, findings: 1, durationMs: 10 }],
    runHoundVersion: "0.4.0",
    plan: {
      target: "http://127.0.0.1:5173/app",
      form: FORM,
      page: { url: FORM.url, title: "App", forms: [FORM], controls: [], links: 2 },
      scenarios: [
        {
          id: "access-control:signed-out",
          checkId: "access-control",
          title: "Signed-out visitors can't read Account A's data",
          description: "d",
          kind: "danger",
          priority: "high",
          destructive: false,
          defaultSelected: true,
          scope: "page",
        },
      ],
      groups: [{ id: "security", label: "Security", scenarioIds: ["access-control:signed-out"] }],
      ...(accounts?.signedInAs ? { account: accounts.signedInAs } : {}),
    },
    approved: ["access-control:signed-out"],
    results: [{ checkId: "access-control", scenarioId: "access-control:signed-out", status: "fail", findings: [f], durationMs: 5 }],
    findings: [f],
    summary: { critical: 1, high: 0, medium: 0, low: 0, passed: 0, failed: 1, errored: 0, skipped: 0 },
    notVisible: NOT_VISIBLE,
    testRecordsCreated: 1,
    ...(accounts ? { accounts } : {}),
    ...extra,
  };
}

/** "Signed in as <label>", allowing a colon and markup around the label (HTML tags, Markdown bold). */
const SIGNED_IN_AS = (label: string) => new RegExp(`Signed in as:?\\s*(?:<[^>]+>\\s*|\\*\\*|_)*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

describe("reports of a signed-in run", () => {
  it("say who the run signed in as, in HTML and Markdown", () => {
    const r = report({ signedInAs: A, other: null });
    for (const text of [renderHtml(r), renderMarkdown(r)]) {
      expect(text).toMatch(SIGNED_IN_AS("Account A"));
      expect(text).not.toContain("Account B");
    }
  });

  it("name the other account when a scenario used it", () => {
    const r = report({ signedInAs: A, other: B });
    for (const text of [renderHtml(r), renderMarkdown(r)]) {
      expect(text).toMatch(SIGNED_IN_AS("Account A"));
      expect(text).toContain("Account B");
    }
  });

  it("use the accounts' own labels, escaped in HTML", () => {
    const owner: AccountRef = { id: "a", label: "Owner <Rivera & Co>" };
    const tester: AccountRef = { id: "b", label: "Tester <Okafor>" };
    const r = report({ signedInAs: owner, other: tester });
    const html = renderHtml(r);
    expect(html).toMatch(SIGNED_IN_AS("Owner &lt;Rivera &amp; Co&gt;"));
    expect(html).toContain("Tester &lt;Okafor&gt;");
    expect(html).not.toContain("<Rivera");
    expect(html).not.toContain("<Okafor>");
    const md = renderMarkdown(r);
    expect(md).toMatch(SIGNED_IN_AS("Owner <Rivera & Co>"));
    expect(md).toContain("Tester <Okafor>");
  });

  it("say which account the test records belong to", () => {
    const r = report({ signedInAs: { id: "a", label: "Owner" }, other: null }, { testRecordsCreated: 2 });
    expect(testDataSentence(r)).toContain("Owner");
    expect(renderMarkdown(r)).toMatch(/## Test data[\s\S]*Owner/);
  });

  it("never hold a username or a password: registered account secrets are redacted in every file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-report-accounts-"));
    const unregister = registerSecretLiterals([PASSWORD, SESSION]);
    try {
      const f = finding({
        meaning: `The response echoed the password ${PASSWORD} back.`,
        evidence: [{ kind: "note", label: `Cookie sid=${SESSION}`, data: { authorization: `Bearer ${SESSION}` }, step: `Fill Password with ${PASSWORD}` }],
      });
      const r = report({ signedInAs: A, other: B });
      r.findings = [f];
      r.results = [{ ...r.results[0]!, findings: [f], notes: `Signed in with ${PASSWORD}`, steps: [{ label: `Fill Password with ${PASSWORD}`, url: FORM.url, at: r.startedAt }] }];
      await writeReport(r, dir);
      const files = await readdir(dir);
      expect(files).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html"]));
      for (const name of ["report.json", "report.md", "report.html"]) {
        const text = await readFile(join(dir, name), "utf8");
        expect(text, name).not.toContain(PASSWORD);
        expect(text, name).not.toContain(SESSION);
        expect(text, name).not.toContain(USERNAME);
        expect(text, name).toContain("[REDACTED:account-secret]");
      }
      expect(await readFile(join(dir, "report.md"), "utf8")).toMatch(SIGNED_IN_AS("Account A"));
      expect(await readFile(join(dir, "report.html"), "utf8")).toMatch(SIGNED_IN_AS("Account A"));
    } finally {
      unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("reports without accounts (0.3.0, or signed out)", () => {
  it("render as before and read as signed out", () => {
    const old = report(undefined, { runHoundVersion: "0.3.0" });
    delete old.accounts;
    delete old.plan.account;
    const signedOut = report({ signedInAs: null, other: null });
    for (const r of [old, signedOut]) {
      const html = renderHtml(r);
      const md = renderMarkdown(r);
      for (const text of [html, md]) {
        expect(text).toContain("http://127.0.0.1:5173/app");
        expect(text).not.toContain("Signed in as");
      }
      expect(testDataSentence(r)).toBe(testDataSentence(old));
    }
  });

  it("follow the run's own record over the plan: a run recorded as signed out names no account anywhere", () => {
    const r = report({ signedInAs: null, other: null });
    r.plan.account = { id: "a", label: "Owner" };
    expect(testDataSentence(r)).not.toContain("Owner");
    for (const text of [renderHtml(r), renderMarkdown(r)]) expect(text).not.toContain("Signed in as");
  });
});

describe("checks that need a test account (added with the V2 checks)", () => {
  /** The report's "Checks with nothing to test on this page" list, from the Markdown. */
  const unplanned = (r: Report) => /## Checks with nothing to test on this page\n\n((?:- .*\n)*)/.exec(renderMarkdown(r))?.[1] ?? "";

  it("are not listed as having nothing to test on a signed-out run: they need an account, not a different page", () => {
    for (const r of [report(undefined), report({ signedInAs: null, other: null })]) {
      const list = unplanned(r);
      expect(list).toContain("- pii-leak");
      expect(list).toContain("- deep-links");
      expect(list).not.toContain("access-control");
      expect(list).not.toContain("mass-assignment");
      expect(renderHtml(r)).not.toMatch(/nothing to test on this page[\s\S]*<li>mass-assignment<\/li>/);
    }
  });

  it("are listed when the run was signed in and they planned nothing", () => {
    const r = report({ signedInAs: A, other: null });
    expect(unplanned(r)).toContain("- mass-assignment");
    expect(renderHtml(r)).toMatch(/nothing to test on this page[\s\S]*<li>mass-assignment<\/li>/);
  });

  it("are not listed at all in a report written before 0.4.0, which didn't have them", () => {
    const old = report(undefined, { runHoundVersion: "0.3.0" });
    const list = unplanned(old);
    expect(list).toContain("- pii-leak");
    for (const id of ["access-control", "mass-assignment", "deep-links"]) expect(list).not.toContain(id);
    expect(unplanned(report(undefined, { runHoundVersion: "0.4.0-rc.1" }))).toContain("- deep-links");
  });
});
