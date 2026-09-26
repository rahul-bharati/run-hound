/**
 * axe-states on a form in a dialog that closes itself after saving (Fernway's "Book a demo" on a slow CI runner):
 * the dialog can still be animating out when the success state is checked, and gone by the time axe runs. That
 * state is then "not on the page, not scanned", never an error (axe throws "No elements found for include").
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { createCheckContext } from "../engine/context.js";
import { discoverPage } from "../engine/discover.js";
import { check } from "./axe-states.js";

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Studio</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #111; background: #fff; }
  label { display: block; font-weight: 600; margin: 8px 0 4px; }
  input { font-size: 16px; padding: 6px; border: 1px solid #555; }
  button { font-size: 16px; padding: 8px 14px; min-height: 44px; }
  [role=dialog] { position: fixed; inset: 40px; background: #fff; border: 1px solid #333; padding: 16px; }
</style></head>
<body>
<main>
  <h1>Studio</h1>
  <form id="news" aria-label="Newsletter">
    <label for="news-email">Email address</label>
    <input id="news-email" name="email" type="email" autocomplete="email" required>
    <button type="submit">Subscribe</button>
  </form>
  <p id="news-status" role="status"></p>
  <button id="open" type="button" aria-haspopup="dialog">Book a demo</button>
</main>
<script>
  document.getElementById("news").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e.target.email.value }) });
    document.getElementById("news-status").textContent = res.ok ? "Thanks!" : "Something went wrong";
  });
  document.getElementById("open").addEventListener("click", () => {
    if (document.getElementById("demo-dialog")) return;
    const d = document.createElement("div");
    d.id = "demo-dialog";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-labelledby", "demo-title");
    d.innerHTML = '<h2 id="demo-title">Book a demo</h2>' +
      '<form id="demo" aria-label="Book a demo">' +
      '<label for="demo-name">Full name</label><input id="demo-name" name="name" autocomplete="name" required>' +
      '<label for="demo-email">Work email</label><input id="demo-email" name="email" type="email" autocomplete="email" required>' +
      '<p id="demo-error" role="alert"></p>' +
      '<button type="submit">Send request</button></form>';
    document.body.appendChild(d);
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name.value, email: f.email.value }) });
      if (!res.ok) { document.getElementById("demo-error").textContent = "Couldn't send your request. Try again."; return; }
      // A finite page animation keeps Run Hound waiting for animations to settle, and the dialog closes in the
      // middle of that wait: present when the state is checked, gone by the time axe runs.
      document.querySelector("main").animate([{ opacity: 1 }, { opacity: 0.999 }], { duration: 2800 });
      setTimeout(() => d.remove(), 1500);
    });
  });
</script>
</body>
</html>`;

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

describe("axe-states: a dialog form that closes after saving", () => {
  it("the success state is skipped with a note, not an error, when the dialog closes while the page settles", async () => {
    const server = await startFixtureServer({
      pages: { "/": PAGE },
      routes: {
        "POST /api/newsletter": (_req, res) => json(res, 201, { ok: true }),
        "POST /api/demo": (_req, res) => json(res, 201, { id: "d1" }),
      },
    });
    servers.push(server);
    const url = `${server.url}/`;

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const discovered = await discoverPage(page, { openers: true });
    await page.close();
    const dialogForm = discovered.forms.find((f) => f.opener);
    expect(dialogForm, "the dialog form is discovered behind its opener").toBeTruthy();

    const scenarios = check.plan(dialogForm!, discovered);
    expect(scenarios.length).toBeGreaterThan(0);
    const artifactsDir = await mkdtemp(join(tmpdir(), "rh-axe-dialog-"));
    const ctx = createCheckContext({ browser, form: dialogForm!, discoveredPage: discovered, targetUrl: url, artifactsDir, runToken: "t3st" });
    try {
      for (const scenario of scenarios) {
        const result = await check.run(ctx, scenario);
        expect(result.status, result.notes).not.toBe("error");
        expect(result.notes ?? "").not.toMatch(/No elements found/i);
      }
    } finally {
      await ctx.dispose();
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});
