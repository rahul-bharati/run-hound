import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Finding } from "../core/types.js";
import { closeBrowser, getBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { bookingApp, type BookingVariant } from "../../test/fixtures/checks/booking-page.js";
import {
  allFindings,
  bug,
  expectPlanShape,
  expectUniqueIds,
  expectWellFormedFinding,
  findingText,
} from "../../test/fixtures/checks/assert-finding.js";
import * as fixtures from "../../test/fixtures/checks/axe-states/variants.js";
import { startSchemaFormApp } from "../../test/fixtures/checks/schema-form.js";
import { startWidgetApp, wizardForm } from "../../test/fixtures/widgets/widget-app.js";
import { check } from "./axe-states.js";

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

async function run(variant: BookingVariant) {
  const app = bookingApp(variant);
  const server = await startFixtureServer(app.options);
  servers.push(server);
  const { scenarios, results } = await runCheck(check, `${server.url}/book`);
  return { scenarios, results, findings: allFindings(results), server, created: app.created };
}

/**
 * Contract: each axe finding carries an evidence item of kind "axe" whose data has the axe rule id
 * (`ruleId`) and the affected nodes (`nodes`, each with the axe `target` selector list).
 */
function axeRuleIds(finding: Finding): string[] {
  return finding.evidence
    .filter((e) => e.kind === "axe")
    .map((e) => (e.data as { ruleId?: unknown } | undefined)?.ruleId)
    .filter((id): id is string => typeof id === "string");
}

function expectAxeFinding(finding: Finding, rule: string, bugId: string) {
  const b = bug(bugId);
  expectWellFormedFinding(finding, { checkId: "axe-states", category: "accessibility", severity: b.severity, confidence: "confirmed" });
  expect(axeRuleIds(finding)).toContain(rule);
  const axeEvidence = finding.evidence.find((e) => e.kind === "axe")!;
  const nodes = (axeEvidence.data as { nodes?: unknown }).nodes;
  expect(Array.isArray(nodes) && nodes.length > 0, "axe evidence lists the violating nodes").toBe(true);
}

describe("axe-states check", () => {
  it("is registered under its id as an accessibility check", () => {
    expect(check.id).toBe("axe-states");
    expect(check.category).toBe("accessibility");
    expect(check.title.trim().length).toBeGreaterThan(0);
  });

  it("GOOD: clean form passes in every state with zero findings", async () => {
    const { scenarios, results, findings, created } = await run(fixtures.good);
    expectPlanShape(scenarios, "axe-states");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.checkId).toBe("axe-states");
    expect(overallStatus(results)).toBe("pass");
    expect(findings).toEqual([]);
    // Reaching the success state means the check submitted valid data and the booking was created.
    expect(created.length).toBeGreaterThan(0);
  });

  it("BAD (A01): input labelled only by a placeholder is one finding pointing at that input", async () => {
    const { results, findings } = await run(fixtures.bad.missingLabel.variant);
    expect(overallStatus(results)).toBe("fail");
    // The violation exists in all four states but is reported once.
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    // axe 4.13's `label` rule accepts a non-empty placeholder, so the check must treat
    // placeholder-only labelling as a violation itself (reconfigured `label` rule or an extra rule).
    expectWellFormedFinding(f, { checkId: "axe-states", category: "accessibility", severity: bug("A01").severity, confidence: "confirmed" });
    expect(findingText(f)).toContain("#phone");
  });

  it("BAD (A02): icon-only button with no accessible name -> one button-name finding", async () => {
    const { results, findings } = await run(fixtures.bad.namelessIconButton.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "button-name", "A02");
    expect(findingText(findings[0]!)).toContain("#clear");
  });

  it("BAD (A06): low-contrast helper text -> one color-contrast finding", async () => {
    const { results, findings } = await run(fixtures.bad.lowContrastHelper.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "color-contrast", "A06");
    expect(findingText(findings[0]!)).toContain("#petName-hint");
  });

  it("BAD (A08): 16px packed icon buttons -> one target-size finding (WCAG 2.2 AA tags are on)", async () => {
    const { results, findings } = await run(fixtures.bad.smallTargets.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, "target-size", "A08");
    expect(findingText(findings[0]!)).toContain("Remove booking for");
  });

  it("BAD: a violation that only appears after an invalid submit is caught", async () => {
    const { results, findings } = await run(fixtures.invalidStateOnly.variant);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(1);
    expectAxeFinding(findings[0]!, fixtures.invalidStateOnly.rule, fixtures.invalidStateOnly.bug);
    // The low-contrast inline error messages are hidden until validation fails.
    expect(findingText(findings[0]!)).toMatch(/#(petName|petType|ownerEmail)-error/);
    expect(findingText(findings[0]!)).toMatch(/invalid/i);
  });

  it("BAD: several violated rules -> exactly one finding per rule with unique ids", async () => {
    const { results, findings } = await run(fixtures.allRules);
    expect(overallStatus(results)).toBe("fail");
    expect(findings).toHaveLength(4);
    expectUniqueIds(findings);
    const rules = findings.flatMap(axeRuleIds);
    for (const rule of ["button-name", "color-contrast", "target-size"]) {
      expect(rules.filter((r) => r === rule), `findings for ${rule}`).toHaveLength(1);
    }
    expect(findings.filter((f) => findingText(f).includes("#phone"))).toHaveLength(1);
  });
});

describe("axe-states: text that is fading in is not measured mid-fade (LOV-9)", () => {
  const contrast = (findings: Finding[]) => findings.filter((f) => axeRuleIds(f).includes("color-contrast"));

  it("GOOD: a hero paragraph with an entrance fade (Web Animations) passes once it has faded in", async () => {
    const { results, findings } = await run(fixtures.fadeInWaapi);
    expect(contrast(findings), JSON.stringify(findings.map((f) => f.evidence.find((e) => e.kind === "axe")?.data))).toEqual([]);
    expect(overallStatus(results)).toBe("pass");
  });

  it("GOOD: the same fade driven by script frame by frame passes too", async () => {
    const { findings } = await run(fixtures.fadeInScript);
    expect(contrast(findings), JSON.stringify(findings.map((f) => f.evidence.find((e) => e.kind === "axe")?.data))).toEqual([]);
  });

  it("BAD: text that stays too faint after its fade-in is still one color-contrast finding", async () => {
    const { findings } = await run(fixtures.fadeInLowContrast);
    const found = contrast(findings);
    expect(found).toHaveLength(1);
    expect(findingText(found[0]!)).toContain("#hero");
  });
});

describe("axe-states: a form in a dialog that closes after saving (LOV-8)", () => {
  it("opens the dialog again for the second submission", async () => {
    const members: unknown[] = [];
    const server = await startFixtureServer({
      root: fileURLToPath(new URL("../../test/fixtures/discover/", import.meta.url)),
      routes: {
        "GET /api/members": (_req, res) => json(res, 200, members),
        "POST /api/members": (req, res) => {
          members.push(JSON.parse(req.body));
          json(res, 201, {});
        },
      },
    });
    servers.push(server);
    const url = `${server.url}/dialog-only.html`;
    const browser = await getBrowser();
    const discovery = await browser.newPage();
    await discovery.goto(url, { waitUntil: "networkidle" });
    const found = await discoverPage(discovery, { openers: true });
    await discovery.close();
    const form = found.forms[0]!;
    expect(form.opener?.name).toBe("Add member");

    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-axe-dialog-"));
    const ctx = createCheckContext({ browser, form, discoveredPage: found, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form, found);
      const result = await check.run(ctx, scenario!);
      expect(result.status, result.notes).not.toBe("error");
      expect(members, "both submissions of the success state were saved").toHaveLength(2);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("axe-states: states it reached, and why it didn't reach the others (RH-09, RH-10)", () => {
  it("fills every text field (LOV-6), so a schema-validated form reaches all four states", async () => {
    const a = await startSchemaFormApp({});
    servers.push(a);
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.notes).toMatch(/^Scanned states: initial, invalid submit, server error, success(;|$)/);
    expect(a.tasks, "both submissions of the success state were saved").toHaveLength(2);
  });

  it("lists only the states it reached and names the field that stopped the submit", async () => {
    const a = await startSchemaFormApp({ taskMinLength: 80 });
    servers.push(a);
    const { results } = await runCheck(check, a.formUrl);
    const notes = results[0]!.notes ?? "";
    expect(results[0]!.status, notes).not.toBe("error");
    expect(notes).toMatch(/^Scanned states: initial, invalid submit;/);
    expect(notes).toMatch(/server error state not reached/);
    expect(notes).toMatch(/success state not reached/);
    expect(notes).toMatch(/showed an error on "Task"/);
    expect(notes).not.toMatch(/save responses/);
    expect(a.tasks).toEqual([]);
  });

  it("never sends an empty form to the app for the invalid submit state", async () => {
    const a = await startSchemaFormApp({ validate: false, serverChecks: false });
    servers.push(a);
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.status, results[0]!.notes).not.toBe("error");
    expect(a.posts().filter((p) => !p["title"])).toEqual([]);
  });
});

/**
 * A custom select that the page opens after a refused submit (it focuses the first invalid field and opens it), and
 * that hides the rest of the page from screen readers while open, as Radix Select does. Escape closes it.
 */
const OPEN_ON_ERROR = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invite</title><link rel="icon" href="data:,">
<style>body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #111; background: #fff; }
button { min-height: 44px; min-width: 44px; font-size: 16px; color: #111; background: #eee; border: 1px solid #555; }
.msg { color: #b00020; } [role=listbox] { border: 1px solid #555; background: #fff; } [role=option] { padding: 8px 12px; }</style></head>
<body><div id="root"><main><h1>Team</h1>
<form id="invite" novalidate aria-labelledby="t"><h2 id="t">Invite a teammate</h2>
<div><span id="role-label">Role</span>
<button type="button" id="role" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="role-label role" aria-controls="role-list">Choose a role</button>
<p id="role-msg" class="msg"></p></div>
<button type="submit">Send invite</button>
<p id="status" role="status"></p>
</form></main></div>
<script>
const root = document.getElementById("root"), trigger = document.getElementById("role");
let list = null, value = "";
function open() {
  if (list) return;
  list = document.createElement("div");
  list.id = "role-list"; list.setAttribute("role", "listbox"); list.setAttribute("aria-labelledby", "role-label");
  for (const r of ["Admin", "Member"]) {
    const o = document.createElement("div");
    o.setAttribute("role", "option"); o.setAttribute("aria-selected", "false"); o.tabIndex = -1; o.textContent = r;
    o.addEventListener("click", () => { value = r; trigger.textContent = r; close(); });
    list.append(o);
  }
  document.body.append(list);
  root.setAttribute("aria-hidden", "true");
  trigger.setAttribute("aria-expanded", "true");
  list.firstChild.focus();
}
function close() {
  if (!list) return;
  list.remove(); list = null;
  root.removeAttribute("aria-hidden");
  trigger.setAttribute("aria-expanded", "false");
  trigger.focus();
}
trigger.addEventListener("click", open);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
document.getElementById("invite").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!value) {
    document.getElementById("role-msg").textContent = "Choose a role";
    trigger.setAttribute("aria-invalid", "true"); trigger.setAttribute("aria-describedby", "role-msg");
    open();
    return;
  }
  const r = await fetch("/api/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: value }) });
  document.getElementById("status").textContent = r.ok ? "Invite sent" : "Could not send the invite";
});
</script></body></html>`;

describe("axe-states: an open list is closed before a scan (RH-15)", () => {
  it("presses Escape so a select that hides the page while open is not reported as aria-hidden-focus", async () => {
    const server = await startFixtureServer({
      pages: { "/team": OPEN_ON_ERROR },
      routes: { "POST /api/invites": (_req, res) => json(res, 201, { id: 1 }) },
    });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/team`);
    const rules = allFindings(results).flatMap(axeRuleIds);
    expect(rules, results[0]!.notes).not.toContain("aria-hidden-focus");
  });
});

/** Two icon-only buttons with no name: one opens the sidebar (aria-controls), one sits in the page header. */
const UNNAMED_BUTTONS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title><link rel="icon" href="data:,">
<style>body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #111; background: #fff; } button { min-width: 44px; min-height: 44px; }</style></head>
<body><header><button type="button" aria-controls="app-sidebar" aria-expanded="true"><svg aria-hidden="true" width="16" height="16"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor"/></svg></button>
<h1>Dashboard</h1><button type="button"><svg aria-hidden="true" width="16" height="16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg></button></header>
<nav id="app-sidebar" aria-label="Sidebar"><a href="/app">Home</a></nav>
<main><form id="f"><label for="q">Task</label><input id="q" name="title" required><button type="submit">Add</button></form></main></body></html>`;

describe("axe-states: an unnamed element is named by what and where it is (RH-16)", () => {
  it("describes icon-only buttons instead of printing a CSS selector", async () => {
    const server = await startFixtureServer({ pages: { "/app": UNNAMED_BUTTONS }, routes: { "POST /app": (_req, res) => json(res, 201, {}) } });
    servers.push(server);
    const { results } = await runCheck(check, `${server.url}/app`);
    const finding = allFindings(results).find((f) => axeRuleIds(f).includes("button-name"));
    expect(finding, JSON.stringify(allFindings(results).map((f) => f.title))).toBeDefined();
    expect(finding!.locations).toEqual(["icon-only button that controls the app sidebar", "icon-only button in the page header"]);
    // The selectors are still in the axe evidence for developers.
    expect(findingText(finding!)).toContain("aria-controls");
  });

  it("the Kennel-style clear button next to a field is named after that field", async () => {
    const { findings } = await run(fixtures.bad.namelessIconButton.variant);
    expect(findings[0]!.location).toBe('icon-only button next to the "Pet name" field');
  });
});

describe("axe-states: a wizard's first step (RH-06)", () => {
  it("stops at the step it can fill instead of filling step 1's fields on step 2, and says why", async () => {
    const app = await startWidgetApp();
    servers.push(app);
    const url = `${app.url}/wizard`;
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-axe-wizard-"));
    const form = wizardForm(url);
    const ctx = createCheckContext({ browser: await getBrowser(), form, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form);
      const started = Date.now();
      const result = await check.run(ctx, scenario!);
      expect(result.status, result.notes).not.toBe("error");
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(result.notes).toMatch(/multi-step/);
      expect(result.notes).not.toMatch(/^Scanned states: [^;]*success/);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 120_000);
});
