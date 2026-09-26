import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser, runPageCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { AccountRef, CheckResult } from "../core/types.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./page-controls.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await closeBrowser();
});

const A: AccountRef = { id: "a", label: "Account A" };

/**
 * Discovers the page at `url` and runs page-controls on it like runPageCheck, as a signed-in run unless `signedIn` is
 * false (CheckContext.accounts.self is set; these fixture pages need no real session).
 */
async function runOn(url: string, options: { allowDestructive?: boolean; signedIn?: boolean } = {}): Promise<CheckResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const discovered = await discoverPage(page);
  await page.close();
  const form = discovered.forms[0] ?? emptyForm(url);
  const [scenario] = check.plan(form, discovered);
  expect(scenario, "page-controls planned a scenario").toBeDefined();
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-page-controls-"));
  const ctx = createCheckContext({
    browser,
    form,
    discoveredPage: discovered,
    targetUrl: url,
    artifactsDir,
    allowDestructive: options.allowDestructive ?? false,
    runToken: "t3st",
    ...(options.signedIn === false ? {} : { accounts: { self: A, other: null } }),
  });
  try {
    return await check.run(ctx, scenario!);
  } finally {
    await ctx.dispose();
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

/** A signed-in header: a working menu button and a "Log out" button that ends the session on the server. */
const SIGNED_IN_HEADER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dashboard</title><link rel="icon" href="data:,"></head>
<body><header><button type="button" id="menu" aria-expanded="false">Menu</button> <button type="button" id="logout">Log out</button></header>
<main><h1>Dashboard</h1><p id="out"></p></main>
<script>
document.getElementById("menu").addEventListener("click", function () { document.getElementById("out").textContent = "Menu opened"; });
document.getElementById("logout").addEventListener("click", function () { fetch("/api/logout", { method: "POST" }).then(function () { location.href = "/login"; }); });
</script></body></html>`;

describe("page-controls: signed-in runs keep their session", () => {
  const pages = { "/": SIGNED_IN_HEADER, "/login": "<!doctype html><title>Sign in</title><h1>Sign in</h1>" };

  it("never clicks Log out on a signed-in run, even with --allow-destructive, and says the session would end", async () => {
    const s = await startFixtureServer({ pages, fallback: (_req, res) => json(res, 200, {}) });
    servers.push(s);
    const result = await runOn(`${s.url}/`, { allowDestructive: true });
    const notes = result.notes ?? "";
    expect(s.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([]);
    expect(result.status, notes).toBe("pass");
    expect(notes).toMatch(/"Log out": skipped \([^)]*session/);
    expect(notes).toMatch(/"Menu": DOM change/);
  });

  it("still clicks it on a signed-out run with --allow-destructive (as before)", async () => {
    const s = await startFixtureServer({ pages, fallback: (_req, res) => json(res, 200, {}) });
    servers.push(s);
    await runOn(`${s.url}/`, { allowDestructive: true, signedIn: false });
    expect(s.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/logout"]);
  });
});

/**
 * A task list whose checkboxes and switch save as soon as they are toggled (Fernway RH-13): Radix-style
 * button[role=checkbox] / button[role=switch] with aria-checked, each sending PATCH /api/tasks/:id { done }. The page
 * renders what the server stored, like an app that loads its tasks.
 */
function taskPage(stored: Record<string, boolean>): string {
  const row = (id: string, name: string, role: "checkbox" | "switch") =>
    `<li><button type="button" role="${role}" id="t-${id}" data-id="${id}" aria-labelledby="n-${id}" aria-checked="${stored[id]}" data-state="${stored[id] ? "checked" : "unchecked"}"></button> <span id="n-${id}">${name}</span></li>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tasks</title><link rel="icon" href="data:,"></head>
<body><main><h1>Tasks</h1><ul>
${row("1", "Approve the palette", "checkbox")}
${row("2", "Write the brief", "checkbox")}
${row("3", "Email me reminders", "switch")}
</ul></main>
<script>
document.querySelectorAll("[data-id]").forEach(function (b) {
  b.addEventListener("click", function () {
    var next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    b.dataset.state = next ? "checked" : "unchecked";
    fetch("/api/tasks/" + b.dataset.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: next }) });
  });
});
</script></body></html>`;
}

describe("page-controls: toggles that save when clicked (RH-13)", () => {
  it("sets each saving checkbox and switch back to how it was after clicking it", async () => {
    const stored: Record<string, boolean> = { "1": false, "2": true, "3": false };
    const initial = { ...stored };
    const s = await startFixtureServer({
      routes: {
        "GET /": (_req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(taskPage(stored));
        },
      },
      fallback: (req, res) => {
        const m = /^\/api\/tasks\/(\w+)$/.exec(req.url);
        if (req.method === "PATCH" && m) {
          stored[m[1]!] = (JSON.parse(req.body) as { done: boolean }).done;
          return json(res, 200, { id: m[1], done: stored[m[1]!] });
        }
        json(res, 404, {});
      },
    });
    servers.push(s);
    const result = await runOn(`${s.url}/`, { signedIn: false });
    const notes = result.notes ?? "";
    expect(result.status, notes).toBe("pass");
    expect(stored, "every toggle is back where it was").toEqual(initial);
    // Each toggle was clicked once to probe it, and once more to set it back.
    for (const id of ["1", "2", "3"]) {
      const sent = s.requests.filter((r) => r.method === "PATCH" && r.url === `/api/tasks/${id}`).map((r) => (JSON.parse(r.body) as { done: boolean }).done);
      expect(sent, `task ${id}`).toEqual([!initial[id], initial[id]]);
    }
    expect(notes).toMatch(/"Approve the palette": [^;]*set it back to/);
    expect(notes).toMatch(/"Write the brief": [^;]*set it back to/);
    expect(notes).toMatch(/"Email me reminders": [^;]*set it back to/);
  });

  it("leaves a toggle that saves nothing alone (a fresh page is loaded for every control anyway)", async () => {
    const s = await startFixtureServer({
      pages: {
        "/": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>View</title><link rel="icon" href="data:,"></head>
<body><main><h1>View</h1><button type="button" role="switch" id="compact" aria-checked="false" aria-label="Compact view"></button><ul id="list" class=""><li>One</li></ul></main>
<script>
var b = document.getElementById("compact");
b.addEventListener("click", function () { var next = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(next)); document.getElementById("list").className = next ? "compact" : ""; });
</script></body></html>`,
      },
    });
    servers.push(s);
    const result = await runOn(`${s.url}/`, { signedIn: false });
    const notes = result.notes ?? "";
    expect(result.status, notes).toBe("pass");
    expect(notes).toMatch(/"Compact view": DOM change/);
    expect(notes).not.toMatch(/set it back/);
  });
});

const TRASH = '<svg class="lucide lucide-trash-2" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/></svg>';

/** An AI-built invoice list: icon-only delete buttons, a Send button per row, and harmless header controls. */
const INVOICES = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoices</title><link rel="icon" href="data:,">
<style>.banner { position: fixed; inset: auto 0 0 0; height: 140px; background: #eee; }</style></head>
<body><header><button type="button" id="theme">Toggle theme</button><button type="button" id="docs">Open docs</button></header>
<main><h1>Invoices</h1>
<ul id="rows">
  <li>Invoice #1001 <button type="button" class="icon">${TRASH}</button> <button type="button" class="send">Send</button></li>
  <li>Invoice #1002 <button type="button" class="icon">${TRASH}</button> <button type="button" class="send">Send invoice</button></li>
</ul>
<button type="button" id="covered" style="position: fixed; bottom: 60px; left: 20px">Show archived</button>
<div class="banner">We use cookies.</div>
</main>
<script>
document.getElementById("theme").addEventListener("click", function () { document.body.classList.toggle("dark"); });
document.getElementById("docs").addEventListener("click", function () { window.open("/docs", "_blank"); });
document.querySelectorAll("button.icon").forEach(function (b, i) { b.addEventListener("click", function () { fetch("/api/items/" + (i + 1), { method: "DELETE" }); }); });
document.querySelectorAll("button.send").forEach(function (b, i) { b.addEventListener("click", function () { fetch("/api/items/" + (i + 1) + "/send", { method: "POST" }); }); });
</script></body></html>`;

describe("page-controls: risky and awkward controls outside the forms", () => {
  it("never deletes or sends without --allow-destructive, counts a new tab as a reaction, and skips a covered control (CHK-3, CHK-4, LOV-10)", async () => {
    const s = await startFixtureServer({ pages: { "/": INVOICES, "/docs": "<!doctype html><title>Docs</title><h1>Docs</h1>" }, fallback: (_req, res) => json(res, 200, { ok: true }) });
    servers.push(s);
    const { scenarios, results } = await runPageCheck(check, `${s.url}/`);
    const writes = s.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`);
    expect(writes).toEqual([]);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.description).toMatch(/Left out unless you allow destructive scenarios: .*"Send".*"Send invoice"/);
    const notes = results[0]!.notes ?? "";
    expect(results[0]!.status, notes).toBe("pass");
    expect(results[0]!.findings).toEqual([]);
    expect(notes).toMatch(/"Toggle theme": DOM change/);
    expect(notes).toMatch(/"Open docs": new tab/);
    expect(notes).toMatch(/"unnamed button": skipped \(looks destructive: its icon or id says "trash"/);
    expect(notes).toMatch(/"Show archived": skipped \(could not be clicked/);
  });

  it("clicks the icon buttons with --allow-destructive", async () => {
    const s = await startFixtureServer({ pages: { "/": INVOICES, "/docs": "<!doctype html><title>Docs</title>" }, fallback: (_req, res) => json(res, 200, { ok: true }) });
    servers.push(s);
    await runPageCheck(check, `${s.url}/`, { allowDestructive: true });
    expect(s.requests.filter((r) => r.method === "DELETE").length).toBeGreaterThanOrEqual(1);
  });
});
