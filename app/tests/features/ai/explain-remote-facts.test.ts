import { describe, expect, it } from "vitest";
import type { Fact } from "../../../src/core/types.js";
import { explainFindings, explainPrompt } from "../../../src/ai/explain.js";
import { FakeClient, makeFinding, makeReport } from "../../../src/ai/test-fixtures.js";

/**
 * docs/ai-spec.md rule 4: only structure is sent, never request or response bodies. A fact's label says what its
 * value is, so a remote prompt sends only facts whose labels are on an allow-list (counts, statuses, which request,
 * which rule or pattern matched). A label nobody listed, such as one a new check adds, stays out until someone decides
 * its value is structure.
 */

/** What checks/verbose-errors.ts adds as "Matched text": up to 120 characters of a response body or page text. */
const STACK_FRAME = "at OrderService.save (/srv/app/orders/service.js:88:14) in /srv/app/orders";
const SQL_ERROR = "SELECT id FROM pets WHERE owner_id = 41 AND token = 'rh_live_77'";
const BODY_FACTS: Fact[] = [
  { label: "Matched text", value: STACK_FRAME },
  { label: "Matched text", value: SQL_ERROR },
];

/** A verbose-error finding as checks/verbose-errors.ts builds it: structural facts plus the matched excerpt. */
const verboseError = () =>
  makeFinding({
    checkId: "verbose-errors",
    id: "verbose-errors#1",
    title: "The page shows a stack trace after bad input",
    meaning: "When the form gets unexpected input, the page shows the server's internal error details.",
    evidence: [
      {
        kind: "card",
        label: "error response with internals",
        facts: [
          { label: "Status", value: "500" },
          { label: "Request", value: "POST /api/pets (as a form)" },
          { label: "Matched pattern", value: "stack trace" },
          ...BODY_FACTS,
        ],
      },
    ],
  });

describe("explainPrompt: remote facts are an allow-list", () => {
  it("never sends a 'Matched text' fact: not its label, not the stack frame, the path or the SQL it quotes", () => {
    const { system, user } = explainPrompt(verboseError(), { remote: true });
    for (const leak of ["Matched text", STACK_FRAME, "OrderService", "/srv/app", "service.js", SQL_ERROR, "SELECT id", "rh_live_77"]) {
      expect(system + user).not.toContain(leak);
    }
  });

  it("keeps the structural facts of the same finding", () => {
    const { user } = explainPrompt(verboseError(), { remote: true });
    expect(user).toContain("- Status: 500");
    expect(user).toContain("- Request: POST /api/pets");
    expect(user).toContain("- Matched pattern: stack trace");
  });

  it("is the default, as remote is the stricter", () => {
    expect(explainPrompt(verboseError()).user).not.toContain("Matched text");
    expect(explainPrompt(verboseError()).user).not.toContain(STACK_FRAME);
  });

  it("drops a fact whose label nobody listed, however harmless it looks", () => {
    const finding = makeFinding({
      evidence: [{ kind: "note", label: "Note", facts: [{ label: "Brand new label", value: "tame-looking-value" }, { label: "Status", value: "404" }] }],
    });
    const { user } = explainPrompt(finding, { remote: true });
    expect(user).not.toContain("Brand new label");
    expect(user).not.toContain("tame-looking-value");
    expect(user).toContain("- Status: 404");
  });

  it.each([
    ["Visible error text", '"Invalid token rh_live_77 for owner 41"'],
    ["Live region text", '"Saved Rex Barker"'],
    ["Saved record's full text", "Name Rex Barker, notes: feed twice a day"],
    ["Failure summary", "Fix any of the following: Element has insufficient color contrast of 2.1 (foreground #aaa)"],
    ["Found in", "/assets/app.js, /assets/vendor.js"],
    ["Script", "/assets/app.4f3a.js line 12"],
    ["Widest element", "div.card > p.bio (840 px)"],
    ["Its text", "a test value Run Hound saved earlier in this run"],
    ["Control", '"Delete account" button'],
    ["Navigation", "https://shop.example.com/done?session=abc123secret"],
    ["Page", "https://shop.example.com/pets?owner=41"],
  ])("drops %s, which holds page or response text", (label, value) => {
    const finding = makeFinding({ evidence: [{ kind: "card", label: "Evidence", facts: [{ label, value }, { label: "Status", value: "500" }] }] });
    const { user } = explainPrompt(finding, { remote: true });
    expect(user).not.toContain(`- ${label}:`);
    expect(user).not.toContain(value.replace(/^"|"$/g, ""));
    expect(user).toContain("- Status: 500");
  });

  it.each([
    ["Status", "500"],
    ["Response status", "403 (forbidden)"],
    ["Submit status", "not sent"],
    ["Request", "GET /api/pets"],
    ["Save request", "POST /api/pets"],
    ["Requests sent", "2"],
    ["Requests watched", "14"],
    ["Failed requests", "3"],
    ["Console errors", "2"],
    ["Matched pattern", "SQL error"],
    ["Rule", "color-contrast"],
    ["WCAG criteria", "1.4.3"],
    ["Impact", "serious"],
    ["Dev server", "no"],
  ])("keeps %s: %s", (label, value) => {
    const finding = makeFinding({ evidence: [{ kind: "card", label: "Evidence", facts: [{ label, value }] }] });
    expect(explainPrompt(finding, { remote: true }).user).toContain(`- ${label}: ${value}`);
  });

  it("matches labels case-insensitively and ignores surrounding space", () => {
    const finding = makeFinding({ evidence: [{ kind: "card", label: "Evidence", facts: [{ label: "  status ", value: "500" }, { label: "MATCHED TEXT", value: STACK_FRAME }] }] });
    const { user } = explainPrompt(finding, { remote: true });
    expect(user).toMatch(/status\s*: 500/i);
    expect(user).not.toContain(STACK_FRAME);
  });

  it("still drops an allowed label whose value holds one of the run's test values", () => {
    const finding = makeFinding({
      evidence: [{ kind: "card", label: "Evidence", facts: [{ label: "Request", value: "POST /api/save?name=Rex" }, { label: "Observed", value: "owner.3fa9c01bpersist@example.test was saved" }] }],
    });
    const { user } = explainPrompt(finding, { remote: true, runToken: "3fa9c01b" });
    expect(user).not.toContain("3fa9c01b");
    expect(user).not.toContain("example.test");
    expect(user).toContain("- Request: POST /api/save");
    expect(user).not.toContain("?name=Rex");
  });

  it("strips quoted parts from an allowed fact's value, as it does from the finding's own prose", () => {
    const finding = makeFinding({
      evidence: [{ kind: "card", label: "Evidence", facts: [{ label: "Observed", value: 'the page shows "Zanzibar-Quokka-77" after saving' }] }],
    });
    const { user } = explainPrompt(finding, { remote: true });
    expect(user).not.toContain("Zanzibar-Quokka-77");
    expect(user).toContain("- Observed: the page shows");
  });
});

describe("explainPrompt: Locations are finding prose", () => {
  const locations = ['Field holding "Zanzibar-Quokka-77"', 'Link "Delete Rex Barker" on https://shop.example.com/pets?owner=41#tab=a'];

  it("strips quoted parts and URLs from every location for a remote model", () => {
    const { user } = explainPrompt(makeFinding({ locations }), { remote: true });
    const line = user.split("\n").find((l) => l.startsWith("Locations:"))!;
    expect(line).toBeDefined();
    for (const leak of ["Zanzibar-Quokka-77", "Rex Barker", "shop.example.com", "owner=41", "tab=a"]) expect(user).not.toContain(leak);
    expect(line).toContain("Field holding");
    expect(line).toContain("/pets");
  });

  it("keeps the quotes and the URL for a local model", () => {
    const { user } = explainPrompt(makeFinding({ locations }), { remote: false });
    expect(user).toContain("Zanzibar-Quokka-77");
    expect(user).toContain("https://shop.example.com/pets?owner=41#tab=a");
  });
});

describe("explainPrompt: a response-body excerpt is never sent, remote or local (rule 4)", () => {
  it("drops 'Matched text' for a local model too, and keeps the finding's other facts", () => {
    const { user } = explainPrompt(verboseError(), { remote: false });
    for (const leak of ["Matched text", STACK_FRAME, SQL_ERROR, "/srv/app"]) expect(user).not.toContain(leak);
    expect(user).toContain("- Status: 500");
    expect(user).toContain("- Matched pattern: stack trace");
  });
});

describe("explainFindings: the prompt a remote client receives", () => {
  it("holds no response-body excerpt", async () => {
    const client = new FakeClient([{ summary: "The page shows server internals.", askYourAi: "Hide stack traces." }]);
    await explainFindings(makeReport([verboseError()]), client, { remote: true });
    const sent = client.requests[0]!;
    expect(sent.system + sent.user).not.toContain("/srv/app");
    expect(sent.system + sent.user).not.toContain("Matched text");
    expect(sent.user).toContain("- Matched pattern: stack trace");
  });
});
