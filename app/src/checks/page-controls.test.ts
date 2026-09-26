import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runPageCheck } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { check } from "./page-controls.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await closeBrowser();
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
