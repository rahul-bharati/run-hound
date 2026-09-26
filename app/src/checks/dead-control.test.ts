import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser, overallStatus, runCheck } from "../../test-support/harness.js";
import { startBookingApp, sampleForm, type BookingServer } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { allFindings } from "../../test/fixtures/checks/assert-finding.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan, findingText } from "../../test/fixtures/checks/_behavior/expectations.js";
import type { DiscoveredForm } from "../core/types.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check, isDestructiveControl } from "./dead-control.js";

const ID = "dead-control" as const;
const servers: BookingServer[] = [];
const fixtureServers: FixtureServer[] = [];

/**
 * Non-submit buttons, each proving a different kind of "it did something":
 * storage only, value + focus, focus only, request only, delayed DOM change, sessionStorage only, navigation.
 */
const BUTTONS = `
  <button type="button" id="saveDraft">Save draft</button>
  <button type="button" id="clearPetName" aria-label="Clear pet name">&#x2715;</button>
  <button type="button" id="skipToEmail">Skip to email</button>
  <button type="button" id="checkAvailability">Check availability</button>
  <button type="button" id="showTips" aria-expanded="false" aria-controls="tips">Show tips</button>
  <p id="tips" class="tips" hidden>Tip: add your vet's phone number.</p>
  <button type="button" id="rememberDevice">Remember this device</button>
  <button type="button" id="help">Help</button>
`;

function handlers(options: { deadSaveDraft?: boolean; deadClear?: boolean } = {}) {
  const lines = [
    'var $ = function (id) { return document.getElementById(id); };',
    // Storage only: no DOM change, no request, focus stays on the button itself.
    options.deadSaveDraft
      ? "/* Save draft has no handler */"
      : '$("saveDraft").addEventListener("click", function () { localStorage.setItem("kennel-draft", JSON.stringify({ petName: $("petName").value, savedAt: Date.now() })); });',
    // Clears the value (a property, not a DOM mutation) and moves focus to the input.
    options.deadClear
      ? "/* clear has no handler */"
      : '$("clearPetName").addEventListener("click", function () { $("petName").value = ""; $("petName").focus(); });',
    // Focus only.
    '$("skipToEmail").addEventListener("click", function () { $("email").focus(); });',
    // Request only, response ignored.
    '$("checkAvailability").addEventListener("click", function () { fetch("/api/availability?source=button"); });',
    // DOM change that lands a little later.
    '$("showTips").addEventListener("click", function () { setTimeout(function () { var open = $("tips").hidden; $("tips").hidden = !open; $("showTips").setAttribute("aria-expanded", String(open)); }, 300); });',
    // sessionStorage only.
    '$("rememberDevice").addEventListener("click", function () { sessionStorage.setItem("kennel-remember", "1"); });',
    // Navigation.
    '$("help").addEventListener("click", function () { location.href = "/help"; });',
  ];
  return lines.join("\n");
}

const HELP_PAGE = '<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><title>Help</title></head><body><h1>Help</h1></body></html>';

async function app(options: { deadSaveDraft?: boolean; deadClear?: boolean } = {}) {
  const s = await startBookingApp({ extraHtml: BUTTONS, extraScript: handlers(options) }, {}, { pages: { "/help": HELP_PAGE } });
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await Promise.all(fixtureServers.map((s) => s.close()));
  await closeBrowser();
});

describe("dead-control: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario when the form has non-submit controls", () => {
    expectPlan(check, sampleForm(), "golden");
  });

  it("names the buttons it will click in a readable list", () => {
    const base = sampleForm();
    const submit = base.controls.find((c) => c.isSubmit)!;
    const button = (name: string) => ({ ...submit, accessibleName: name, text: name, isSubmit: false, selector: `#${name.replace(/\W/g, "")}` });
    const one = check.plan({ ...base, controls: [submit, button("Save draft")] })[0]!.description;
    expect(one).toMatch(/^Click "Save draft" and check that it causes /);
    const two = check.plan({ ...base, controls: [submit, button("Clear pet name"), button("Save draft")] })[0]!.description;
    expect(two).toMatch(/^Click "Clear pet name" and "Save draft" one at a time and check that each causes /);
  });

  it("plans nothing when the only control is the submit button", () => {
    const form: DiscoveredForm = { ...sampleForm(), controls: sampleForm().controls.filter((c) => c.isSubmit) };
    expect(check.plan(form)).toEqual([]);
  });
});

describe("dead-control: GOOD", () => {
  it("passes when every button causes a request, DOM change, navigation, storage change or focus change", async () => {
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("never activates the submit button (no booking is created)", async () => {
    const s = await app();
    await runCheck(check, s.url);
    expect(s.createRequests()).toHaveLength(0);
  });
});

describe("dead-control: BAD", () => {
  it('fails when "Save draft" has no handler (F01), and flags only that control', async () => {
    const s = await app({ deadSaveDraft: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["high", "medium"]);
    // Focus landing on the clicked button itself is not a "focus change"; the storage-only,
    // focus-only, request-only, delayed-DOM, sessionStorage and navigation buttons are all alive.
    expect(findings).toHaveLength(1);
    expect(findingText(findings[0]!)).toMatch(/Save draft/);
    for (const alive of ["Clear pet name", "Skip to email", "Check availability", "Show tips", "Remember this device", "Help"]) {
      expect(findings[0]!.title).not.toContain(alive);
      expect(findings[0]!.location ?? "").not.toContain(alive);
    }
  });

  it("names an icon-only dead control by its accessible name", async () => {
    const s = await app({ deadSaveDraft: true, deadClear: true });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["high", "medium"]);
    const text = findings.map(findingText).join("\n");
    expect(text).toMatch(/Save draft/);
    expect(text).toMatch(/Clear pet name/);
    // One problem, two buttons: one finding listing both (docs/v0-spec.md, "Tester release").
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toMatch(/\b2\b/);
    expect(f.locations).toHaveLength(2);
    expect(f.location).toBe(f.locations![0]);
    expect(f.locations!.join("\n")).toMatch(/Save draft/);
    expect(f.locations!.join("\n")).toMatch(/Clear pet name/);
  });
});

describe("isDestructiveControl", () => {
  const control = (text: string) => ({ accessibleName: text, text, role: "button", tag: "button", selector: "#x", isSubmit: false });
  it("treats deleting, paying and session-ending controls as destructive", () => {
    for (const name of ["Delete", "Remove booking", "Pay now", "Log out", "Logout", "Sign out", "Sign-out", "Log off", "Disconnect GitHub", "Clear all", "Empty cart", "Reset all settings", "Cancel subscription", "Cancel my booking", "Close account"]) {
      expect(isDestructiveControl(control(name)), name).toBe(true);
    }
  });
  it("leaves ordinary controls alone", () => {
    for (const name of ["Save draft", "Cancel", "Reset", "Refresh", "Show password", "Sign in", "Log in", "Menu", "Clear pet name", "Close"]) {
      expect(isDestructiveControl(control(name)), name).toBe(false);
    }
  });
});

describe("dead-control: destructive controls", () => {
  const DANGER_BUTTONS = `
    <button type="button" id="deleteAll">Delete all bookings</button>
    <button type="button" id="cancelBooking">Remove booking</button>
  `;
  const DANGER_HANDLERS = [
    'document.getElementById("deleteAll").addEventListener("click", function () { fetch("/api/bookings", { method: "DELETE" }); });',
    'document.getElementById("cancelBooking").addEventListener("click", function () { fetch("/api/bookings/1", { method: "DELETE" }); });',
  ].join("\n");

  const deletes = (s: BookingServer) => s.server.requests.filter((r) => r.method === "DELETE");

  async function dangerApp() {
    const s = await startBookingApp({ extraHtml: BUTTONS + DANGER_BUTTONS, extraScript: handlers() + "\n" + DANGER_HANDLERS });
    servers.push(s);
    return s;
  }

  it("does not activate delete/remove controls without --allow-destructive, and says so", async () => {
    const s = await dangerApp();
    const { results } = await runCheck(check, s.url);
    expect(deletes(s)).toHaveLength(0);
    expect(overallStatus(results)).toBe("pass");
    expect(results[0]!.notes ?? "").toMatch(/Delete all bookings.*(skipped|destructive)/i);
  });

  it("activates them with --allow-destructive", async () => {
    const s = await dangerApp();
    await runCheck(check, s.url, { allowDestructive: true });
    expect(deletes(s).length).toBeGreaterThanOrEqual(2);
  });

  it("never reports a skipped destructive control as dead", async () => {
    const s = await dangerApp();
    const { results } = await runCheck(check, s.url);
    expect(allFindings(results)).toEqual([]);
  });
});

describe("isDestructiveControl: sending, paying, ordering and trashing (CHK-3)", () => {
  const control = (text: string, extra: Partial<{ selector: string; isSubmit: boolean; accessibleName: string | null }> = {}) => ({
    accessibleName: text || null,
    text,
    role: "button",
    tag: "button",
    selector: "#x",
    isSubmit: false,
    ...extra,
  });

  it("treats controls that send, trash, order, pay or check out as destructive", () => {
    for (const name of [
      "Send",
      "Send invoice",
      "Send reminder",
      "Resend code",
      "Trash",
      "Move to trash",
      "Place order",
      "Order now",
      "Confirm order",
      "Submit payment",
      "Payment",
      "Check out",
      "Check-out",
      "Checkout",
      "Buy now",
      "Purchase",
      "Transfer funds",
      "Upgrade to Pro",
      "Subscribe to Pro",
      "Donate",
      "Clear cart",
      "Leave team",
      "Ban user",
      "Factory reset",
      "Terminate instance",
      "Reboot",
      "Shut down server",
      "Truncate table",
      "Regenerate API key",
    ]) {
      expect(isDestructiveControl(control(name)), name).toBe(true);
    }
  });

  it("does not stop everyday controls that share a word with a destructive one", () => {
    for (const name of [
      "Sort order",
      "Order by date",
      "Payload",
      "Subscribe",
      "Leave a review",
      "Restart tour",
      "Drop files here",
      "Clear filters",
      "Block quote",
      "Checklist",
      "Sender details",
      "Reject all cookies",
      "Decline",
    ]) {
      expect(isDestructiveControl(control(name)), name).toBe(false);
    }
  });

  it("does not stop the form's own submit button just because it says send (every save check submits the form)", () => {
    expect(isDestructiveControl(control("Send message", { isSubmit: true }))).toBe(false);
    expect(isDestructiveControl(control("Send", { isSubmit: true }))).toBe(false);
    // Paying and ordering stay destructive even as the submit button.
    expect(isDestructiveControl(control("Place order", { isSubmit: true }))).toBe(true);
    expect(isDestructiveControl(control("Pay now", { isSubmit: true }))).toBe(true);
  });

  it("reads an unnamed icon button's own test id or id", () => {
    expect(isDestructiveControl(control("", { selector: '[data-testid="delete-row"]' }))).toBe(true);
    expect(isDestructiveControl(control("", { selector: "#trash-btn-3" }))).toBe(true);
    expect(isDestructiveControl(control("", { selector: '[data-testid="removeItem"]' }))).toBe(true);
    // A path anchored at an ancestor's id says nothing about the button itself.
    expect(isDestructiveControl(control("", { selector: "#delete-dialog > button:nth-of-type(1)" }))).toBe(false);
    expect(isDestructiveControl(control("", { selector: '[data-testid="menu-toggle"]' }))).toBe(false);
    // A named control is judged by its name.
    expect(isDestructiveControl(control("Edit", { selector: '[data-testid="delete-edit"]' }))).toBe(false);
  });
});

/** A page with the controls an AI-built list and form typically has, next to their handlers. */
function modernPage(options: { form?: string; outside?: string; script?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Items</title><link rel="icon" href="data:,">
<style>
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
  .card { position: relative; }
  .card label { display: flex; padding: 16px; border: 2px solid #999; cursor: pointer; }
  .banner { position: fixed; left: 0; right: 0; bottom: 0; height: 120px; background: #eee; }
</style></head>
<body><main><h1>Items</h1>
${options.outside ?? ""}
<form id="f"><h2>Choose a plan</h2>
  <label for="email">Email</label><input id="email" name="email" type="email">
  ${options.form ?? ""}
  <button type="submit">Save plan</button>
</form><p id="out"></p></main>
<script>
document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); });
${options.script ?? ""}
</script></body></html>`;
}

describe("dead-control: a control that can't be clicked (LOV-10)", () => {
  it("skips a control covered by another element with a note, and still tests the others", async () => {
    const page = modernPage({
      form: `<button type="button" id="covered" style="position:fixed;bottom:40px;left:20px">Show details</button>
        <div class="banner" id="banner">We use cookies.</div>
        <button type="button" id="recommend">Recommend a plan</button>`,
      script: 'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
    });
    const s = await startFixtureServer({ pages: { "/plan": page } });
    fixtureServers.push(s);
    const { results } = await runCheck(check, `${s.url}/plan`);
    const notes = results[0]!.notes ?? "";
    expect(results[0]!.status, notes).toBe("pass");
    expect(notes).toMatch(/"Show details": skipped \(could not be clicked/);
    expect(notes).toMatch(/"Recommend a plan": DOM change/);
  });

  it("never errors on shadcn radio cards (an sr-only radio covered by its label)", async () => {
    const card = (p: string, checked: boolean) =>
      `<div class="card"><button type="button" role="radio" aria-checked="${checked}" data-state="${checked ? "checked" : "unchecked"}" value="${p}" id="plan-${p}" class="sr-only"></button><label for="plan-${p}">${p}</label></div>`;
    const page = modernPage({
      form: `<div role="radiogroup" aria-label="Plan">${card("starter", true)}${card("team", false)}${card("studio", false)}</div>
        <button type="button" id="recommend">Recommend a plan</button>`,
      script: [
        'document.querySelectorAll("[role=radio]").forEach(function (r) { r.addEventListener("click", function () {',
        '  document.querySelectorAll("[role=radio]").forEach(function (o) { o.setAttribute("aria-checked", String(o === r)); o.dataset.state = o === r ? "checked" : "unchecked"; });',
        "}); });",
        'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
      ].join("\n"),
    });
    const s = await startFixtureServer({ pages: { "/plan": page } });
    fixtureServers.push(s);
    const { results } = await runCheck(check, `${s.url}/plan`);
    const notes = results[0]!.notes ?? "";
    expect(results[0]!.status, notes).toBe("pass");
    expect(allFindings(results)).toEqual([]);
    expect(notes).toMatch(/"Recommend a plan": DOM change/);
  });
});

describe("dead-control: a control nobody can click", () => {
  it("reports working buttons that an invisible overlay (a leftover backdrop) covers: a click lands on the overlay", async () => {
    const page = modernPage({
      form: `<button type="button" id="apply">Apply coupon</button>
        <button type="button" id="recommend">Recommend a plan</button>`,
      outside: '<div class="ghost" data-state="closed" style="position:fixed;inset:0;z-index:50;background:transparent"></div>',
      script: [
        'document.getElementById("apply").addEventListener("click", function () { document.getElementById("out").textContent = "Coupon applied"; });',
        'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
      ].join("\n"),
    });
    const s = await startFixtureServer({ pages: { "/plan": page } });
    fixtureServers.push(s);
    const { results } = await runCheck(check, `${s.url}/plan`);
    const findings = expectFailure(results, ID, "broken-feature", ["high"]);
    expect(findings.map((f) => f.title)).toEqual(['2 buttons can\'t be clicked (Apply coupon, Recommend a plan)']);
    const text = findings.map(findingText).join("\n");
    expect(text).toMatch(/invisible <div class="ghost">/);
    expect(results[0]!.notes ?? "").toMatch(/"Apply coupon": can't be clicked \(an invisible <div class="ghost"> is on top of it\)/);
  });

  it("is skipped, not passed, when no control could be clicked at all (a visible banner covers them)", async () => {
    const page = modernPage({
      form: '<button type="button" id="recommend">Recommend a plan</button>',
      outside: '<div class="consent" style="position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.5)"><p style="background:#fff">We use cookies.</p></div>',
      script: 'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
    });
    const s = await startFixtureServer({ pages: { "/plan": page } });
    fixtureServers.push(s);
    const { results } = await runCheck(check, `${s.url}/plan`);
    const notes = results[0]!.notes ?? "";
    expect(allFindings(results)).toEqual([]);
    expect(results[0]!.status, notes).toBe("skipped");
    expect(notes).toMatch(/nothing was tested/i);
    expect(notes).toMatch(/"Recommend a plan": skipped \(could not be clicked: a <div> is on top of it\)/);
  });
});

describe("dead-control: links and buttons that open a new tab (CHK-4)", () => {
  it("counts a target=_blank link and a window.open button as doing something", async () => {
    const page = modernPage({
      form: `<p><input type="checkbox" id="terms" name="terms"> <label for="terms">I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a></label></p>
        <button type="button" id="help">Open help</button>`,
      script: 'document.getElementById("help").addEventListener("click", function () { window.open("/help-center", "_blank"); });',
    });
    const s = await startFixtureServer({ pages: { "/plan": page, "/terms": "<!doctype html><title>Terms</title><h1>Terms</h1>", "/help-center": "<!doctype html><title>Help</title><h1>Help</h1>" } });
    fixtureServers.push(s);
    const { results } = await runCheck(check, `${s.url}/plan`);
    const notes = results[0]!.notes ?? "";
    expect(allFindings(results), notes).toEqual([]);
    expect(results[0]!.status, notes).toBe("pass");
    expect(notes).toMatch(/"Terms of Service": (new tab|navigation)/);
    expect(notes).toMatch(/"Open help": new tab/);
  });
});

describe("dead-control: unnamed icon buttons whose icon says delete (CHK-3)", () => {
  it("never clicks an unnamed trash-icon button or a Send button without --allow-destructive", async () => {
    const trash = '<svg class="lucide lucide-trash-2" width="16" height="16" viewBox="0 0 24 24"><path d="M3 6h18"/></svg>';
    const page = modernPage({
      form: `<ul id="rows"><li>Invoice #1001 <button type="button" class="icon">${trash}</button></li>
        <li>Invoice #1002 <button type="button" class="icon">${trash}</button> <button type="button" id="send2">Send</button></li></ul>
        <button type="button" id="recommend">Recommend a plan</button>`,
      script: [
        'document.querySelectorAll("button.icon").forEach(function (b, i) { b.addEventListener("click", function () { fetch("/api/items/" + (i + 1), { method: "DELETE" }); }); });',
        'document.getElementById("send2").addEventListener("click", function () { fetch("/api/items/2/send", { method: "POST" }); });',
        'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
      ].join("\n"),
    });
    const s = await startFixtureServer({ pages: { "/plan": page }, fallback: (_req, res) => json(res, 200, { ok: true }) });
    fixtureServers.push(s);
    const { scenarios, results } = await runCheck(check, `${s.url}/plan`);
    const writes = s.requests.filter((r) => r.method === "DELETE" || (r.method === "POST" && r.url.includes("/send")));
    expect(writes.map((r) => `${r.method} ${r.url}`)).toEqual([]);
    expect(scenarios[0]!.description).toMatch(/Left out unless you allow destructive scenarios: .*"Send"/);
    const notes = results[0]!.notes ?? "";
    expect(results[0]!.status, notes).toBe("pass");
    expect(notes).toMatch(/"unnamed button": skipped \(looks destructive/);
    expect(notes).toMatch(/"Recommend a plan": DOM change/);
  });
});

describe("dead-control: signed-in runs keep their session", () => {
  const page = modernPage({
    form: `<button type="button" id="signout">Sign out</button>
      <button type="button" id="recommend">Recommend a plan</button>`,
    script: [
      'document.getElementById("signout").addEventListener("click", function () { fetch("/api/logout", { method: "POST" }).then(function () { location.href = "/plan?signed-out"; }); });',
      'document.getElementById("recommend").addEventListener("click", function () { document.getElementById("out").textContent = "Team plan recommended"; });',
    ].join("\n"),
  });

  async function runWith(signedIn: boolean) {
    const s = await startFixtureServer({ pages: { "/plan": page }, fallback: (_req, res) => json(res, 200, {}) });
    fixtureServers.push(s);
    const url = `${s.url}/plan`;
    const browser = await getBrowser();
    const discovery = await browser.newPage();
    await discovery.goto(url, { waitUntil: "networkidle" });
    const found = await discoverPage(discovery);
    await discovery.close();
    const form = found.forms[0]!;
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-dead-session-"));
    const ctx = createCheckContext({
      browser,
      form,
      discoveredPage: found,
      targetUrl: url,
      artifactsDir,
      allowDestructive: true,
      runToken: "t3st",
      ...(signedIn ? { accounts: { self: { id: "a" as const, label: "Account A" }, other: null } } : {}),
    });
    try {
      const [scenario] = check.plan(form, found);
      return { s, result: await check.run(ctx, scenario!) };
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }

  it("never clicks Sign out on a signed-in run, even with --allow-destructive, and says why", async () => {
    const { s, result } = await runWith(true);
    const notes = result.notes ?? "";
    expect(s.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    expect(result.status, notes).toBe("pass");
    expect(notes).toMatch(/"Sign out": skipped \([^)]*session/);
    expect(notes).toMatch(/"Recommend a plan": DOM change/);
  });

  it("clicks it on a signed-out run with --allow-destructive, as before", async () => {
    const { s } = await runWith(false);
    expect(s.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/logout"]);
  });
});

describe("dead-control: a form in a dialog (LOV-8)", () => {
  it("opens the dialog on every fresh page before clicking, and the spec opens it too", async () => {
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
    fixtureServers.push(server);
    const url = `${server.url}/dialog-only.html`;
    const browser = await getBrowser();
    const discovery = await browser.newPage();
    await discovery.goto(url, { waitUntil: "networkidle" });
    const found = await discoverPage(discovery, { openers: true });
    await discovery.close();
    const form = found.forms[0]!;
    expect(form.opener?.name).toBe("Add member");

    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-dead-dialog-"));
    const ctx = createCheckContext({ browser, form, discoveredPage: found, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form, found);
      const result = await check.run(ctx, scenario!);
      expect(result.notes).toMatch(/"Cancel": DOM change/);
      expect(result.findings.map((f) => f.title)).toEqual(['"Help" button does nothing']);
      const source = result.findings[0]!.spec!.source;
      const opens = source.indexOf(`page.locator("#add")`);
      expect(opens, source).toBeGreaterThan(source.indexOf("await page.goto(TARGET)"));
      expect(opens, "the dialog opens before the form is filled").toBeLessThan(source.indexOf(`getByLabel("Name"`));
      expect(members, "nothing was saved: the submit button is never clicked").toEqual([]);
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 90_000);
});
