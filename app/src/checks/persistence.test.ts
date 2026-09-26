import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runCheck } from "../../test-support/harness.js";
import { json, startFixtureServer } from "../../test-support/server.js";
import { startBookingApp, sampleForm, type ApiOptions, type BookingServer } from "../../test/fixtures/checks/_behavior/booking-app.js";
import { expectCheckShape, expectCleanPass, expectFailure, expectPlan, findingText } from "../../test/fixtures/checks/_behavior/expectations.js";
import { CONTACT_FIELDS, SIGNUP_FIELDS, startModernApp, type ModernApp, type ModernAppOptions } from "../../test/fixtures/checks/modern-apps.js";
import { check } from "./persistence.js";

const ID = "persistence" as const;
const servers: BookingServer[] = [];

async function app(api: ApiOptions = {}) {
  // "Your bookings" is rendered from GET /api/bookings, so it survives a reload. Passwords are never shown.
  const s = await startBookingApp({}, api);
  servers.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.server.close()));
  await closeBrowser();
});

describe("persistence: contract", () => {
  it("exports a check with the right id and category", () => {
    expectCheckShape(check, ID, "broken-feature");
  });

  it("plans a golden, non-destructive scenario", () => {
    expectPlan(check, sampleForm(), "golden");
  });
});

describe("persistence: GOOD", () => {
  it("passes when every submitted canary is visible after reload, without requiring passwords to show", async () => {
    const s = await app();
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
  });

  it("submits unique canary values (run token) in every text field, including optional ones, and valid data overall", async () => {
    const s = await app();
    await runCheck(check, s.url);
    // The server validates strictly (email shape, dates, pet type), so this also proves the canaries are valid input.
    expect(s.api.bookings.length).toBeGreaterThanOrEqual(1);
    const stored = s.api.bookings[0]!;
    for (const field of ["petName", "email", "phone", "notes"]) {
      expect(stored[field], field).toBeTruthy();
    }
    expect(stored.petName).toContain("t3st");
    expect(stored.notes).toContain("t3st");
    expect(stored.email).toContain("t3st");
    // Every value is distinct, so one missing field cannot be masked by another field showing the same text.
    const texts = ["petName", "email", "phone", "notes"].map((k) => stored[k]);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

/**
 * The save request starts 400 ms after the click (async validation before fetch), so it reaches the capture
 * well after the click resolves: the check must wait for it instead of concluding "no request was sent".
 * On a busy machine even a synchronous fetch() arrives after the click resolves; this makes that case certain.
 */
const ASYNC_VALIDATION: [string, string][] = [
  ['res = await fetch("/api/bookings", {', 'await new Promise(function (r) { setTimeout(r, 400); }); res = await fetch("/api/bookings", {'],
];

describe("persistence: save request that starts after the click returns", () => {
  it("GOOD: waits for the save request and passes", async () => {
    const s = await startBookingApp({ replaceHtml: ASYNC_VALIDATION });
    servers.push(s);
    const { results } = await runCheck(check, s.url);
    expectCleanPass(results, ID);
    expect(s.api.bookings).toHaveLength(1);
  });

  it("BAD: waits for the save request and reports the dropped field", async () => {
    const s = await startBookingApp({ replaceHtml: ASYNC_VALIDATION }, { dropFields: ["notes"] });
    servers.push(s);
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["critical", "high"]);
    expect(findings.map(findingText).join("\n")).toMatch(/special instructions|notes/i);
  });
});

describe("persistence: BAD", () => {
  it('fails when "Special instructions" gets a success toast but is never saved (F03)', async () => {
    const s = await app({ dropFields: ["notes"] });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["critical", "high"]);
    const text = findings.map(findingText).join("\n");
    expect(text).toMatch(/special instructions|notes/i);
    // Only the dropped field is reported: passwords (never shown) and the saved fields are not.
    const headline = findings.map((f) => `${f.title}\n${f.location ?? ""}`).join("\n");
    expect(headline).toMatch(/special instructions|notes/i);
    expect(headline).not.toMatch(/password/i);
    expect(headline).not.toMatch(/Owner email|Pet name|Phone/i);
  });

  it("fails when an optional field (phone) is dropped", async () => {
    const s = await app({ dropFields: ["phone"] });
    const { results } = await runCheck(check, s.url);
    const findings = expectFailure(results, ID, "broken-feature", ["critical", "high", "medium"]);
    expect(findings.map(findingText).join("\n")).toMatch(/phone/i);
  });
});

describe("persistence: apps built with AI app builders", () => {
  const apps: ModernApp[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });
  async function modern(options: ModernAppOptions) {
    const a = await startModernApp(options);
    apps.push(a);
    return a;
  }
  const contact = (after: ModernAppOptions["after"], extra: Partial<ModernAppOptions> = {}) =>
    modern({ path: "/contact", heading: "Contact us", fields: CONTACT_FIELDS, submitLabel: "Send message", after, ...extra });

  it("LOV-4: a toast that thanks the user by name is not a list of saved records: skipped, not a critical finding", async () => {
    const a = await contact("toast");
    const { results } = await runCheck(check, a.formUrl);
    expect(a.records).toHaveLength(1);
    expect(results[0]!.findings.map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/doesn't show saved values/);
  });

  it("LOV-5: a sign-up that moves to /welcome (client-side) and greets by name is not evidence that the email was lost", async () => {
    const a = await modern({ path: "/signup", heading: "Create your account", fields: SIGNUP_FIELDS, submitLabel: "Create account", after: "welcome" });
    const { results } = await runCheck(check, a.formUrl);
    expect(a.records).toHaveLength(1);
    expect(results[0]!.findings.map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/\/welcome/);
  });

  it("LOV-5: a save that moves (client-side) to a page listing the records passes, naming that page", async () => {
    const a = await contact("records-page");
    const { results } = await runCheck(check, a.formUrl);
    expectCleanPass(results, ID);
    expect(results[0]!.notes).toMatch(/\/records/);
  });

  it("LOV-5: a page the app moved to that lists the records without one field reports that field, like the same list on the form's page", async () => {
    // Two or more values listed on the page the app went to make it a record view, not a greeting: the field it
    // leaves out is reported, as "still fails when the list really drops a field" reports it on the form's own page.
    const a = await contact("records-page", { unlisted: ["message"] });
    const { results } = await runCheck(check, a.formUrl);
    const findings = expectFailure(results, ID, "broken-feature", ["critical"]);
    expect(findings[0]!.title).toBe('"Message" is not saved');
    expect(JSON.stringify(findings[0]!.evidence)).toMatch(/\/records/);
  });

  it("CHK-6: a list that shows saved values in capitals (text-transform) still counts as showing them", async () => {
    const a = await contact("list", { recordCss: "text-transform: uppercase;" });
    const { results } = await runCheck(check, a.formUrl);
    expectCleanPass(results, ID);
  });

  it("CHK-6: a phone number shown in another format still counts as shown", async () => {
    const a = await modern({
      path: "/team",
      heading: "Add a member",
      fields: [
        { name: "name", label: "Full name", type: "text" },
        { name: "phone", label: "Phone", type: "tel" },
      ],
      submitLabel: "Add member",
      after: "list",
      formatPhone: true,
    });
    const { results } = await runCheck(check, a.formUrl);
    expectCleanPass(results, ID);
  });

  it("still fails when the list really drops a field", async () => {
    const a = await contact("list", { unlisted: ["message"] });
    const { results } = await runCheck(check, a.formUrl);
    const findings = expectFailure(results, ID, "broken-feature", ["critical"]);
    expect(findings[0]!.title).toBe('"Message" is not saved');
  });

  it("LOV-12: a two-step wizard whose first step saves nothing is skipped as a multi-step form, not as refused values", async () => {
    const a = await modern({
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
    const { results } = await runCheck(check, a.formUrl);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/multi-step|next step/i);
    expect(results[0]!.notes).not.toMatch(/refused/);
  });
});

describe("persistence: a classic form post that redirects to a thank-you page greeting by name", () => {
  it("is skipped naming the page, not reported as a lost email (the thank-you page lists no records)", async () => {
    const people: Record<string, string>[] = [];
    const form = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Join</title><link rel="icon" href="data:,"></head><body><main>
<h1>Join the beta</h1>
<form method="post" action="/join"><label for="name">Full name</label><input id="name" name="name" required>
<label for="email">Email</label><input id="email" name="email" type="email" required><button>Join</button></form></main></body></html>`;
    const s = await startFixtureServer({
      pages: { "/join": form },
      routes: {
        "POST /join": (req, res) => {
          people.push(Object.fromEntries(new URLSearchParams(req.body)));
          res.writeHead(303, { location: `/thanks/${people.length}` });
          res.end();
        },
      },
      fallback: (req, res) => {
        const n = Number(/^\/thanks\/(\d+)$/.exec(req.url)?.[1] ?? 0);
        const who = people[n - 1];
        res.writeHead(who ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html lang="en"><head><title>Thanks</title></head><body><main><h1>Thanks, ${who?.name ?? ""}!</h1><p>We'll be in touch.</p></main></body></html>`);
      },
    });
    try {
      const { results } = await runCheck(check, `${s.url}/join`);
      expect(people).toHaveLength(1);
      expect(results[0]!.findings.map((f) => f.title)).toEqual([]);
      expect(results[0]!.status).toBe("skipped");
      expect(results[0]!.notes).toMatch(/\/thanks\/1 shows Full name but not Email/);
    } finally {
      await s.close();
    }
  });
});

/** A fixture server for the tests below, closed after each test file. */
async function fixture(options: Parameters<typeof startFixtureServer>[0]) {
  const s = await startFixtureServer(options);
  closers.push(() => s.close());
  return s;
}
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(closers.map((c) => c()));
});

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

describe("persistence: the app moves to another page after saving", () => {
  it("a classic form post whose detail page leaves out a dropped field reports that field", async () => {
    // POST /signup → 303 /signup/thanks/<n>, a server-rendered page listing what was stored. The server drops
    // "company", so the detail page says "Not given" where the typed company should be.
    const people: Record<string, string>[] = [];
    const form = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign up</title><link rel="icon" href="data:,"></head><body><main>
<h1>Sign up for Harbor Notes</h1>
<form method="post" action="/signup">
<label for="name">Full name</label><input id="name" name="name" required>
<label for="email">Email address</label><input id="email" name="email" type="email" required>
<label for="company">Company</label><input id="company" name="company">
<label for="usage">What will you use Harbor Notes for?</label><textarea id="usage" name="usage"></textarea>
<button>Create account</button></form></main></body></html>`;
    const s = await fixture({
      pages: { "/signup": form },
      routes: {
        "POST /signup": (req, res) => {
          people.push({ ...Object.fromEntries(new URLSearchParams(req.body)), company: "" });
          res.writeHead(303, { location: `/signup/thanks/${people.length}` });
          res.end();
        },
      },
      fallback: (req, res) => {
        const who = people[Number(/^\/signup\/thanks\/(\d+)$/.exec(req.url)?.[1] ?? 0) - 1];
        res.writeHead(who ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        const row = (label: string, value = "") => `<dt>${label}</dt><dd>${esc(value || "Not given")}</dd>`;
        res.end(`<!doctype html><html lang="en"><head><title>Thank you</title></head><body><main><h1>Thanks, you're signed up</h1><p>We saved these details:</p><dl>
${row("Full name", who?.name)}${row("Email address", who?.email)}${row("Company", who?.company)}${row("What will you use Harbor Notes for?", who?.usage)}</dl></main></body></html>`);
      },
    });
    const { results } = await runCheck(check, `${s.url}/signup`);
    expect(people).toHaveLength(1);
    const findings = expectFailure(results, ID, "broken-feature", ["critical"]);
    expect(findings[0]!.title).toBe('"Company" is not saved');
  });

  it("an app that moves from /projects/new to /projects after a save the server never stored reports every field", async () => {
    // The list shows the new project from memory right after saving; loaded again, it shows what the server has:
    // nothing. The server answered 201 all the same.
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Projects</title><link rel="icon" href="data:,"></head><body><main id="app"></main>
<script>
const app = document.getElementById("app");
let projects = null;
async function show() {
  if (location.pathname === "/projects/new") {
    app.innerHTML = '<h1>New project</h1><form id="f"><label for="name">Project name</label><input id="name" name="name" required><label for="desc">Description</label><textarea id="desc" name="desc" required></textarea><button type="submit">Create project</button></form>';
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) { projects = [...(projects ?? []), data]; history.pushState({}, "", "/projects"); show(); }
    });
  } else {
    if (projects === null) projects = await (await fetch("/api/projects")).json();
    app.innerHTML = '<h1>Projects</h1><ul id="list"></ul><a href="/projects/new">New project</a>';
    for (const p of projects) { const li = document.createElement("li"); li.textContent = p.name + ": " + p.desc; document.getElementById("list").append(li); }
  }
}
show();
</script></body></html>`;
    let posts = 0;
    const s = await fixture({
      pages: { "/projects": page, "/projects/new": page },
      routes: {
        "GET /api/projects": (_req, res) => json(res, 200, []),
        "POST /api/projects": (_req, res) => {
          posts++;
          json(res, 201, { id: 7 });
        },
      },
    });
    const { results } = await runCheck(check, `${s.url}/projects/new`);
    expect(posts).toBe(1);
    const findings = expectFailure(results, ID, "broken-feature", ["critical"]);
    expect(findings[0]!.title).toBe("2 fields are not saved (Project name, Description)");
    // The evidence says where the values were shown right after saving.
    expect(JSON.stringify(findings[0]!.evidence)).toMatch(/\/projects/);
  });

  it("a header that shows who is signed in (name and email) is not a list of saved records: skipped, the company not reported", async () => {
    // Sign-up → /dashboard, whose header shows the account from GET /api/me after any load. The company is saved but
    // shown nowhere, which is normal: the dashboard is not a record view.
    const users: Record<string, string>[] = [];
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme</title><link rel="icon" href="data:,"></head><body>
<header id="top"></header><main id="app"></main>
<script>
async function show() {
  const me = await (await fetch("/api/me")).json();
  document.getElementById("top").innerHTML = me ? "<nav><a href='/dashboard'>Acme</a></nav><span>" + me.name + "</span> <span>" + me.email + "</span>" : "<nav><a href='/'>Acme</a></nav>";
  const app = document.getElementById("app");
  if (location.pathname === "/dashboard") { app.innerHTML = "<h1>Dashboard</h1><p>No projects yet.</p>"; return; }
  app.innerHTML = '<h1>Create your account</h1><form id="f"><label for="name">Full name</label><input id="name" name="name" required><label for="email">Work email</label><input id="email" name="email" type="email" required><label for="company">Company</label><input id="company" name="company" required><button type="submit">Create account</button></form>';
  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    if (r.ok) { history.pushState({}, "", "/dashboard"); show(); }
  });
}
show();
</script></body></html>`;
    const s = await fixture({
      pages: { "/signup": page, "/dashboard": page },
      routes: {
        "GET /api/me": (_req, res) => json(res, 200, users.at(-1) ?? null),
        "POST /api/signup": (req, res) => {
          users.push(JSON.parse(req.body) as Record<string, string>);
          json(res, 201, { ok: true });
        },
      },
    });
    const { results } = await runCheck(check, `${s.url}/signup`);
    expect(users).toHaveLength(1);
    expect(results[0]!.findings.map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/\/dashboard/);
  });
});

describe("persistence: live regions are not toasts", () => {
  it("a list of notes in an aria-live region, whose server never stored the note, reports every field", async () => {
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notes</title><link rel="icon" href="data:,"></head><body><main>
<h1>Notes</h1>
<form id="f"><label for="title">Title</label><input id="title" name="title" required>
<label for="body">Body</label><textarea id="body" name="body" required></textarea>
<button type="submit">Add note</button></form>
<h2>Your notes</h2>
<ul id="notes" aria-live="polite"></ul>
<script>
const list = document.getElementById("notes");
const render = (notes) => { list.innerHTML = ""; for (const n of notes) { const li = document.createElement("li"); li.textContent = n.title + " - " + n.body; list.append(li); } };
let notes = [];
fetch("/api/notes").then((r) => r.json()).then((n) => { notes = n; render(notes); });
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const r = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (r.ok) { notes = [...notes, data]; render(notes); e.target.reset(); }
});
</script></main></body></html>`;
    const s = await fixture({
      pages: { "/": page },
      routes: { "GET /api/notes": (_req, res) => json(res, 200, []), "POST /api/notes": (_req, res) => json(res, 201, { id: 1 }) },
    });
    const { results } = await runCheck(check, `${s.url}/`);
    const findings = expectFailure(results, ID, "broken-feature", ["critical"]);
    expect(findings[0]!.title).toBe("2 fields are not saved (Title, Body)");
  });

  it("a role=status line that thanks the user by name is still a message, not a list: skipped", async () => {
    const records: unknown[] = [];
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title><link rel="icon" href="data:,"></head><body><main>
<h1>Contact us</h1>
<form id="f"><label for="name">Full name</label><input id="name" name="name" required>
<label for="email">Work email</label><input id="email" name="email" type="email" required>
<label for="message">Message</label><textarea id="message" name="message" required></textarea>
<button type="submit">Send message</button></form>
<p role="status" id="status"></p>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const r = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (r.ok) { document.getElementById("status").textContent = "Thanks, " + data.name + "! We'll reply to " + data.email + " soon."; e.target.reset(); }
});
</script></main></body></html>`;
    const s = await fixture({
      pages: { "/": page },
      routes: {
        "POST /api/contact": (req, res) => {
          records.push(JSON.parse(req.body));
          json(res, 201, { ok: true });
        },
      },
    });
    const { results } = await runCheck(check, `${s.url}/`);
    expect(records).toHaveLength(1);
    expect(results[0]!.findings.map((f) => f.title)).toEqual([]);
    expect(results[0]!.status).toBe("skipped");
    expect(results[0]!.notes).toMatch(/doesn't show saved values/);
  });
});
