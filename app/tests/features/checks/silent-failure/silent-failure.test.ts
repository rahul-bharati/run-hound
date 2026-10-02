import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { startBookingApp, sampleForm, type BookingServer, type ClientOptions } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan } from "../../test/fixtures/checks/_behavior/expectations.js";
import { startModernApp } from "../../test/fixtures/checks/modern-apps.js";
import { projectForm, startWidgetApp } from "../../test/fixtures/widgets/widget-app.js";
import type { DiscoveredForm } from "../core/types.js";
import { createCheckContext } from "../engine/context.js";
import { MULTI_STEP_NOTE } from "./lib/functional-form.js";
import { check } from "./silent-failure.js";
import { startSchemaFormApp } from "../../test/fixtures/checks/schema-form.js";

const ID = "silent-failure" as const;
const servers: BookingServer[] = [];

/**
 * The fixture server itself always accepts valid bookings (201). A finding on a BAD page therefore
 * proves the check answered the submit request with a 500 by interception, as the spec requires.
 */
async function app(client: ClientOptions) {
  const s = await startBookingApp(client);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("silent-failure: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a danger (fault-injection), non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "danger");
  });
});

describe("silent-failure: GOOD", () => {
  it('passes when the error appears in a role="alert" element and inputs are kept', async () => {
    const s = await app({ errorMode: "alert" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("passes when the error appears (after 1.5 s) in a polite live region present from page load", async () => {
    const s = await app({ errorMode: "live-region", errorDelayMs: 1500 });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("passes when focus moves to the error message instead of using a live region", async () => {
    const s = await app({ errorMode: "focus" });
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("does not create a real booking: the submit request is intercepted", async () => {
    const s = await app({ errorMode: "alert" });
    await runCheck(check, s.url);
    expect(s.api.bookings).toHaveLength(0);
  });
});

describe("silent-failure: BAD", () => {
  it("fails when a 500 leaves the form spinning with no message (F02)", async () => {
    const s = await app({ errorMode: "spinner" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "critical"]);
  });

  it("fails when the error is visible but never announced (no live region, no alert role, focus not moved)", async () => {
    const s = await app({ errorMode: "unannounced" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });

  it("fails when the error is announced but the user's input is wiped", async () => {
    const s = await app({ errorMode: "reset-form" });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });

  it("fails when the message only appears after the 5 s budget", async () => {
    const s = await app({ errorMode: "alert", errorDelayMs: 7000 });
    const { results } = await runCheck(check, s.url);
    expectFailure(results, ID, "broken-feature", ["high", "medium", "critical"]);
  });
});

/**
 * A contact form whose errors appear only as a toast, the way sonner renders them: a <section aria-live="polite">
 * that exists from page load, holding a fixed-position <ol> (zero height, since its toasts are absolutely positioned)
 * with one <li> per toast. The live region itself measures 0 px high while the toast text is plainly on screen.
 */
function toastPage(toaster: "sonner" | "none") {
  const region =
    toaster === "sonner"
      ? '<section aria-label="Notifications alt+T" tabindex="-1" aria-live="polite" aria-relevant="additions text" aria-atomic="false" id="toasts"></section>'
      : '<div id="toasts"></div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title><link rel="icon" href="data:,">
<style>
  [data-sonner-toaster] { position: fixed; bottom: 24px; right: 24px; width: 356px; list-style: none; margin: 0; padding: 0; }
  [data-sonner-toast] { position: absolute; bottom: 0; right: 0; width: 356px; padding: 16px; background: #fff; border: 1px solid #ccc; }
  .plain-toast { position: fixed; bottom: 24px; right: 24px; padding: 16px; border: 1px solid #ccc; }
</style></head>
<body><main><h1>Contact us</h1>
<form id="contact">
  <label for="name">Full name</label><input id="name" name="name">
  <label for="email">Work email</label><input id="email" name="email" type="email">
  <button type="submit">Send message</button>
</form></main>
${region}
<script>
function toast(text) {
  var host = document.getElementById("toasts");
  ${
    toaster === "sonner"
      ? 'var ol = host.querySelector("ol") || host.appendChild(Object.assign(document.createElement("ol"), { tabIndex: -1 })); ol.setAttribute("data-sonner-toaster", "true"); var li = document.createElement("li"); li.setAttribute("data-sonner-toast", ""); li.innerHTML = "<div data-content><div data-title></div></div>"; li.querySelector("[data-title]").textContent = text; ol.appendChild(li);'
      : 'var div = document.createElement("div"); div.className = "plain-toast"; div.textContent = text; host.appendChild(div);'
  }
}
document.getElementById("contact").addEventListener("submit", async function (e) {
  e.preventDefault();
  var body = JSON.stringify({ name: document.getElementById("name").value, email: document.getElementById("email").value });
  try {
    var res = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: body });
    if (!res.ok) throw new Error("status " + res.status);
    toast("Thanks! We'll get back to you soon.");
  } catch (err) {
    toast("Something went wrong. Please try again.");
  }
});
</script></body></html>`;
}

describe("silent-failure: toast libraries (LOV-3)", () => {
  const fixtureServers: FixtureServer[] = [];
  afterAll(async () => {
    await Promise.all(fixtureServers.map((s) => s.close()));
  });

  async function toastApp(toaster: "sonner" | "none") {
    const s = await startFixtureServer({ pages: { "/contact": toastPage(toaster) }, routes: { "POST /api/contact": (_req, res) => json(res, 201, { id: 1 }) } });
    fixtureServers.push(s);
    return `${s.url}/contact`;
  }

  it("GOOD: a sonner toast in its polite live region is shown and announced, though the region is 0 px high", async () => {
    const { results } = await runCheck(check, await toastApp("sonner"));
    expectCleanPass(results, ID);
    expect(results[0]!.notes ?? "").toMatch(/live region \(aria-live=polite\)/);
    expect(results[0]!.notes ?? "").toMatch(/Something went wrong/);
  });

  it("BAD: the same toast outside any live region is shown but not announced", async () => {
    const { results } = await runCheck(check, await toastApp("none"));
    const findings = expectFailure(results, ID, "broken-feature", ["medium"]);
    expect(findings[0]!.title).toBe("Save errors are shown but never announced");
  });
});

describe("silent-failure: the first step of a wizard (LOV-12)", () => {
  it("skips with the multi-step reason, not as refused test values", async () => {
    const a = await startModernApp({
      path: "/wizard",
      heading: "Set up your workspace",
      fields: [
        { name: "workspace", label: "Workspace name", type: "text" },
        { name: "email", label: "Invite a teammate", type: "email" },
      ],
      submitLabel: "Finish setup",
      after: "toast",
      wizard: true,
    });
    try {
      const { results } = await runCheck(check, a.formUrl);
      expect(results[0]!.status).toBe("skipped");
      expect(results[0]!.notes).toBe(MULTI_STEP_NOTE);
    } finally {
      await a.close();
    }
  });
});

describe("silent-failure: widgets keep their values after the error (Radix Select, Slider, cmdk combobox)", () => {
  it("does not report a slider or a select widget as wiped when the form keeps every value", async () => {
    const app = await startWidgetApp();
    const url = `${app.url}/projects`;
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-silent-"));
    const form = projectForm(url);
    const ctx = createCheckContext({ browser: await getBrowser(), form, targetUrl: url, artifactsDir, allowDestructive: false, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form);
      const result = await check.run(ctx, scenario!);
      expect(result.findings.map((f) => f.title), result.notes).toEqual([]);
      expect(result.status).toBe("pass");
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
      await app.close();
    }
  });
});

describe("silent-failure: skip notes never blame the app for what Run Hound didn't do (RH-10)", () => {
  it("names the field whose rule refused Run Hound's value", async () => {
    const a = await startSchemaFormApp({ taskMinLength: 80 });
    try {
      const { results } = await runCheck(check, a.formUrl);
      expect(results[0]!.status).toBe("skipped");
      expect(results[0]!.notes).toMatch(/^Skipped: submitting the form sent no save request/);
      expect(results[0]!.notes).toMatch(/showed an error on "Task"/);
      expect(results[0]!.notes).not.toMatch(/may have refused/);
    } finally {
      await a.close();
    }
  });
});

/**
 * A form whose fields are found by position (a widget with no id or name, as discovery reports Radix controls), and
 * whose error message is inserted at the top of the form: every position below it shifts by one.
 */
const SHIFTING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Settings</title><link rel="icon" href="data:,"></head><body><main>
<h1>Settings</h1>
<form id="f" novalidate>
  <div><label for="name">Name</label> <input id="name" name="name"></div>
  <div><button type="button" role="checkbox" aria-checked="false" aria-labelledby="t-label"></button> <span id="t-label">Email me product news</span></div>
  <div><span id="plan-label">Plan</span> <button type="button" role="combobox" aria-labelledby="plan-label">Pro</button><select aria-hidden="true" tabindex="-1"><option value=""></option><option value="pro" selected>Pro</option><option value="team">Team</option></select></div>
  <button type="submit">Save</button>
</form>
<script>
const box = document.querySelector("[role=checkbox]");
box.addEventListener("click", () => box.setAttribute("aria-checked", String(box.getAttribute("aria-checked") !== "true")));
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: document.getElementById("name").value, news: box.getAttribute("aria-checked") === "true" }) });
  if (!r.ok) {
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.textContent = "Could not save your settings. Please try again.";
    e.target.prepend(alert);
  }
});
</script></main></body></html>`;

describe("silent-failure: fields found by position after the page inserts an error above them", () => {
  it("reads back the same fields it filled, so a shifted position is not reported as a wiped field", async () => {
    const server = await startFixtureServer({ pages: { "/settings": SHIFTING }, routes: { "POST /api/settings": (_req, res) => json(res, 200, {}) } });
    const url = `${server.url}/settings`;
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-silent-shift-"));
    const form: DiscoveredForm = {
      url,
      index: 0,
      selector: "#f",
      name: "Settings",
      fields: [
        { key: "name", accessibleName: "Name", label: "Name", placeholder: null, type: "text", role: "textbox", required: true, selector: "#name" },
        {
          key: "news",
          accessibleName: "Email me product news",
          label: "Email me product news",
          placeholder: null,
          type: "checkbox",
          role: "checkbox",
          required: true,
          selector: "#f > div:nth-of-type(2) > button",
          widget: "aria-checkbox",
        },
        {
          // A Radix Select: the visible trigger, and the hidden native <select> it mirrors its value into.
          key: "plan",
          accessibleName: "Plan",
          label: "Plan",
          placeholder: null,
          type: "select",
          role: "combobox",
          required: false,
          selector: "#f > div:nth-of-type(3) > button",
          nativeSelector: "#f > div:nth-of-type(3) > select",
          widget: "aria-select",
          options: [{ label: "Pro", selector: "#f > div:nth-of-type(3) > select > option:nth-child(2)" }],
        },
      ],
      controls: [{ accessibleName: "Save", text: "Save", role: "button", tag: "button", selector: "#f > button", isSubmit: true }],
    };
    const ctx = createCheckContext({ browser: await getBrowser(), form, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      const [scenario] = check.plan(form);
      const result = await check.run(ctx, scenario!);
      expect(result.findings.map((f) => f.title), result.notes).toEqual([]);
      expect(result.status).toBe("pass");
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
