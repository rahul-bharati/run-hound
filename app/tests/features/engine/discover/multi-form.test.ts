/**
 * V1: a page with several forms. A problem in a secondary form is reported once, in that form's scenario, and the
 * main form's scenarios stay clean; a search form is planned without the checks that need a saved record.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { check as axeStates } from "../checks/axe-states.js";
import { check as errorAnnouncement } from "../checks/error-announcement.js";
import { check as persistence } from "../checks/persistence.js";
import { check as doubleSubmit } from "../checks/double-submit.js";
import { discoverAndPlan, runPlan } from "./runner.js";

const servers: FixtureServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Main contact form: labelled, errors announced, saved messages listed. Newsletter: its field has no label and
 *  its error is red text only. Header search: a GET form. */
const PAGE = `<!doctype html><html lang="en"><head><title>Shop</title></head><body>
<header><form role="search" action="/search" method="get"><label for="q">Search</label><input id="q" name="q" type="search"><button>Search</button></form></header>
<main><h1 id="t">Contact us</h1>
<form id="contact" aria-labelledby="t" novalidate>
  <label for="name">Name</label><input id="name" name="name" required aria-describedby="name-err"><p id="name-err"></p>
  <label for="msg">Message</label><textarea id="msg" name="message" required aria-describedby="msg-err"></textarea><p id="msg-err"></p>
  <button id="send">Send</button><p role="status" id="st"></p>
</form>
<h2>Sent</h2><ul id="list"></ul></main>
<footer><h2>Newsletter</h2><form id="news" novalidate><input id="news-email" name="email" type="email" required placeholder="you@example.com"><span id="news-err" style="color:#b91c1c"></span><button>Subscribe</button></form></footer>
<script>
const $ = (id) => document.getElementById(id);
async function load() { const r = await fetch("/api/messages"); const { messages } = await r.json(); $("list").replaceChildren(...messages.map((m) => { const li = document.createElement("li"); li.textContent = m.name + ": " + m.message; return li; })); }
$("contact").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("name").value.trim(), message = $("msg").value.trim();
  for (const [id, v, err] of [["name", name, "name-err"], ["msg", message, "msg-err"]]) { $(err).textContent = v ? "" : "Required"; if (v) $(id).removeAttribute("aria-invalid"); else $(id).setAttribute("aria-invalid", "true"); }
  if (!name || !message) { $("st").textContent = "Please fix the errors."; return; }
  $("send").disabled = true;
  const r = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, message }) });
  $("send").disabled = false;
  if (r.ok) { $("contact").reset(); $("st").textContent = "Sent."; await load(); } else $("st").textContent = "Could not send.";
});
$("news").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("news-email").value.trim();
  if (!email) { $("news-err").textContent = "Enter your email"; return; }
  await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
});
load();
</script></body></html>`;

describe("a page with several forms", () => {
  it("reports a secondary form's problems once, in that form's scenarios, and plans no save checks for search", async () => {
    const messages: unknown[] = [];
    const s = await startFixtureServer({
      pages: { "/": PAGE, "/search": "<!doctype html><title>Results</title><h1>Results</h1>" },
      routes: {
        "GET /api/messages": (_req, res) => json(res, 200, { messages }),
        "POST /api/messages": (req, res) => {
          messages.push(JSON.parse(req.body));
          json(res, 201, {});
        },
        "POST /api/subscribe": (_req, res) => json(res, 201, {}),
      },
    });
    servers.push(s);
    const checks = [axeStates, errorAnnouncement, persistence, doubleSubmit];
    const plan = await discoverAndPlan(`${s.url}/`, { checks });

    expect(plan.page!.forms.map((f) => [f.selector, f.search === true])).toEqual([
      ["#contact", false],
      ["body > header > form", true],
      ["#news", false],
    ]);
    const ids = plan.scenarios.map((s) => s.id);
    // The search form (form 2) gets the axe scan, but nothing that needs a saved record.
    expect(ids).toContain("axe-states:four-states@form-2");
    expect(ids.filter((id) => id.endsWith("@form-2"))).toEqual(["axe-states:four-states@form-2"]);
    expect(plan.scenarios.find((s) => s.id === "axe-states:four-states@form-2")!.title).toMatch(/\(Search form\)$/);

    const runsDir = await mkdtemp(join(tmpdir(), "rh-multi-"));
    dirs.push(runsDir);
    const { report } = await runPlan(plan, { checks, approved: ids, runsDir, log: () => undefined });
    const status = (id: string) => report.results.find((r) => r.scenarioId === id)?.status;

    // The newsletter's unlabelled field: one axe finding, from the newsletter's own scan only.
    const labelFindings = report.findings.filter((f) => f.checkId === "axe-states" && /label/i.test(f.title));
    expect(labelFindings, JSON.stringify(report.findings.map((f) => [f.id, f.title]))).toHaveLength(1);
    // It says which form it is about.
    expect(labelFindings[0]!.scope).toBe("Newsletter form");
    expect(status("axe-states:four-states")).toBe("pass");
    expect(status("axe-states:four-states@form-3")).toBe("fail");
    // Its error is red text only: error-announcement fails for the newsletter, not for the contact form.
    expect(status("error-announcement:empty-submit")).toBe("pass");
    expect(status("error-announcement:empty-submit@form-3")).toBe("fail");
    // The contact form lists what it saved; the newsletter never shows the address, so persistence skips there.
    expect(status("canary-reload")).toBe("pass");
    expect(status("canary-reload@form-3")).toBe("skipped");
    expect(report.results.every((r) => r.status !== "error"), JSON.stringify(report.results.filter((r) => r.status === "error"))).toBe(true);
  }, 300_000);
});
