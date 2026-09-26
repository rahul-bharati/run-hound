/**
 * 0.4.0: forms behind a trigger (LOV-8). A form in a dialog, sheet or popover only exists after a click; discovery
 * tries a few controls that look like they open one, each on a freshly loaded page, and records the form with its
 * opener. CheckContext.openPage then clicks the opener after every load (openForm).
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckId, DiscoveredForm, DiscoveredPage } from "../core/types.js";
import { check as persistence } from "../checks/persistence.js";
import { isDestructiveControl } from "../checks/dead-control.js";
import { discoverPage, safeToProbe } from "./discover.js";
import { OPEN_FORM_TIMEOUT_MS, openForm } from "./open-form.js";
import { discoverAndPlan, runPlan } from "./runner.js";

const root = fileURLToPath(new URL("../../test/fixtures/discover/", import.meta.url));

const servers: FixtureServer[] = [];
const dirs: string[] = [];
afterAll(async () => {
  await closeBrowser();
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The dialog fixture with a members API; `clicked` lists the openers each page load clicked (GET beacons). */
async function team() {
  const members: { name: string; email: string }[] = [];
  const s = await startFixtureServer({
    root,
    routes: {
      "GET /api/members": (_req, res) => json(res, 200, members),
      "POST /api/members": (req, res) => {
        members.push(JSON.parse(req.body) as { name: string; email: string });
        json(res, 201, {});
      },
    },
    fallback: (_req, res) => json(res, 200, {}),
  });
  servers.push(s);
  const clicked = () => s.requests.filter((r) => r.url.startsWith("/api/clicked/")).map((r) => r.url.slice("/api/clicked/".length));
  const writes = () => s.requests.filter((r) => !["GET", "HEAD"].includes(r.method)).map((r) => `${r.method} ${r.url}`);
  return { url: `${s.url}/dialog-form.html`, server: s, members, clicked, writes };
}

async function open(url: string): Promise<Page> {
  const page = await (await getBrowser()).newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  return page;
}

describe("discoverPage with openers (LOV-8)", () => {
  let fixture: Awaited<ReturnType<typeof team>>;
  let found: DiscoveredPage;
  let plain: DiscoveredPage;
  let page: Page;

  beforeAll(async () => {
    fixture = await team();
    page = await open(fixture.url);
    plain = await discoverPage(page);
    found = await discoverPage(page, { openers: true });
  });

  afterAll(async () => {
    await page?.close();
  });

  it("keeps the old behaviour by default: only the forms on the page when it loads, nothing clicked", () => {
    expect(plain.forms.map((f) => f.selector)).toEqual(["#newsletter"]);
    expect(plain.forms[0]!.opener).toBeUndefined();
  });

  it("records forms that a trigger shows in a dialog, after the on-load forms, with their opener", async () => {
    expect(found.forms.map((f) => [f.index, f.name, f.opener?.name ?? null])).toEqual([
      [0, "Newsletter", null],
      [1, "Add a team member", "Add member"],
      [2, "New project", "New project"],
    ]);
    const member = found.forms[1]!;
    expect(member.fields.map((f) => [f.key, f.type])).toEqual([["name", "text"], ["email", "email"]]);
    expect(member.controls.filter((c) => c.isSubmit).map((c) => c.text)).toEqual(["Save member"]);
    expect(member.opener!.selector).not.toMatch(/radix-/);
    // A dialog without a <form>: the dialog is the scope, and its default button is not Cancel.
    const project = found.forms[2]!;
    expect(project.fields.map((f) => f.label)).toEqual(["Project name"]);
    expect(project.controls.filter((c) => c.isSubmit).map((c) => c.text)).toEqual(["Create"]);
    // The page's own controls are unchanged.
    expect(found.controls.map((c) => c.text)).toEqual(plain.controls.map((c) => c.text));
  });

  it("tries only non-destructive openers, lets no write through while trying, and leaves the page as loaded", async () => {
    // "Signed in as Alex" opens a popover without fields; "Delete all members" is never clicked.
    expect(fixture.clicked().sort()).toEqual(["account", "add-member", "new-project"]);
    expect(fixture.writes()).toEqual([]);
    expect(await page.locator("[role=dialog]").count()).toBe(0);
    expect(await page.locator("#newsletter").isVisible()).toBe(true);
  });

  it("gives selectors that find the dialog form's fields once it is open", async () => {
    const member = found.forms[1]!;
    const p = await open(fixture.url);
    try {
      await openForm(p, member);
      expect(await p.locator(member.selector).isVisible()).toBe(true);
      for (const f of member.fields) expect(await p.locator(f.selector).count(), f.selector).toBe(1);
    } finally {
      await p.close();
    }
  });
});

/** A page with `onLoad` forms and one opener button per name, each showing a dialog with a one-field form. */
function openersPage(onLoad: number, names: string[]): string {
  const forms = Array.from({ length: onLoad }, (_, i) => `<form id="f${i}"><label for="i${i}">Field ${i}</label><input id="i${i}" name="i${i}"><button>Go</button></form>`).join("");
  const buttons = names.map((n, i) => `<button type="button" id="b${i}">${n}</button>`).join("");
  return `<!doctype html><title>Openers</title><main>${buttons}${forms}</main><script>
    document.querySelectorAll("main > button").forEach((b, i) => b.addEventListener("click", () => {
      fetch("/api/clicked/" + i);
      const d = document.createElement("div");
      d.setAttribute("role", "dialog");
      d.innerHTML = '<h2>' + b.textContent + '</h2><form><label for="d' + i + '">Title</label><input id="d' + i + '" name="title"><button>Save</button></form>';
      document.body.appendChild(d);
    }));
  </script>`;
}

describe("discoverPage with openers: limits", () => {
  async function discover(html: string) {
    const s = await startFixtureServer({ pages: { "/": html }, fallback: (_req, res) => json(res, 200, {}) });
    servers.push(s);
    const page = await open(`${s.url}/`);
    try {
      const found = await discoverPage(page, { openers: true });
      return { found, clicked: s.requests.filter((r) => r.url.startsWith("/api/clicked/")).map((r) => r.url.slice("/api/clicked/".length)) };
    } finally {
      await page.close();
    }
  }

  it("tries at most 3 openers", async () => {
    const { found, clicked } = await discover(openersPage(0, ["Add task", "New list", "Create tag", "Edit profile"]));
    expect(found.forms.map((f) => f.name)).toEqual(["Add task", "New list", "Create tag"]);
    expect(clicked.sort()).toEqual(["0", "1", "2"]);
  });

  it("tries an \"Invite …\" control (writes are blocked while it looks), but still never a destructive one", async () => {
    const { found, clicked } = await discover(openersPage(0, ["Invite member", "Delete list", "Log out"]));
    expect(found.forms.map((f) => [f.name, f.opener?.name])).toEqual([["Invite member", "Invite member"]]);
    expect(clicked).toEqual(["0"]);
    // Checks still treat "Invite" as destructive: only discovery may click it, to look.
    const invite = found.controls.find((c) => c.text === "Invite member")!;
    expect(isDestructiveControl(invite)).toBe(true);
    expect(safeToProbe(invite)).toBe(true);
    expect(safeToProbe({ ...invite, accessibleName: "Invite and delete", text: "Invite and delete" })).toBe(false);
  });

  it("keeps the 5-form cap, on-load forms first, and stops clicking once it is reached", async () => {
    const { found, clicked } = await discover(openersPage(4, ["Add task", "New list", "Create tag"]));
    expect(found.forms).toHaveLength(5);
    expect(found.forms.slice(0, 4).every((f) => !f.opener)).toBe(true);
    expect(found.forms[4]!.opener?.name).toBe("Add task");
    expect(clicked).toEqual(["0"]);
  });
});

describe("openForm", () => {
  let fixture: Awaited<ReturnType<typeof team>>;
  let member: DiscoveredForm;

  beforeAll(async () => {
    fixture = await team();
    const page = await open(fixture.url);
    try {
      member = (await discoverPage(page, { openers: true })).forms.find((f) => f.opener?.name === "Add member")!;
    } finally {
      await page.close();
    }
  });

  const clicks = () => fixture.clicked().filter((c) => c === "add-member").length;

  it("is a no-op for a form without an opener, and for one already on screen", async () => {
    const page = await open(fixture.url);
    try {
      const before = clicks();
      await openForm(page, { ...member, opener: undefined });
      expect(clicks()).toBe(before);
      await openForm(page, member);
      await openForm(page, member);
      await expect.poll(clicks).toBe(before + 1);
      expect(await page.locator(member.selector).isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it("throws a plain message when clicking the opener doesn't show the form", async () => {
    const page = await open(fixture.url);
    try {
      const started = Date.now();
      const err = await openForm(page, { ...member, opener: { selector: "#refresh", name: "Refresh" } }).then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toBe('Clicking "Refresh" didn\'t show the Add a team member form.');
      expect(Date.now() - started).toBeLessThan(OPEN_FORM_TIMEOUT_MS * 2 + 2_000);
    } finally {
      await page.close();
    }
  }, 30_000);
});

describe("discoverAndPlan finds forms behind a trigger", () => {
  it("plans the dialog form, and persistence opens it, fills it and finds the saved member", async () => {
    const fixture = await team();
    const plan = await discoverAndPlan(fixture.url, { checks: [persistence] });
    expect(plan.page!.forms.map((f) => f.opener?.name ?? null)).toEqual([null, "Add member", "New project"]);
    expect(fixture.writes()).toEqual([]);

    const runsDir = await mkdtemp(join(tmpdir(), "rh-openers-"));
    dirs.push(runsDir);
    const id = "canary-reload@form-2";
    expect(plan.scenarios.map((s) => s.id)).toContain(id);
    const { report } = await runPlan(plan, { checks: [persistence], approved: [id], runsDir, log: () => undefined });
    const result = report.results.find((r) => r.scenarioId === id)!;
    expect(result.status, result.notes).toBe("pass");
    expect(fixture.members).toHaveLength(1);
  }, 120_000);
});

describe("openPage opens a dialog form only for the form's own scenarios", () => {
  it("page-wide scenarios see the page as it loads; the form's scenarios get the dialog open", async () => {
    const s = await startFixtureServer({ root, routes: { "GET /api/members": (_req, res) => json(res, 200, []) } });
    servers.push(s);
    // Whether a dialog was open once openPage returned, as each scenario saw it.
    const seen: Record<string, number> = {};
    const probe = (id: CheckId, scope?: "page"): Check => ({
      id,
      title: `Probe ${id}`,
      category: scope ? "security" : "broken-feature",
      ...(scope ? { scope } : {}),
      plan: () => [{ id: `${id}:probe`, checkId: id, title: "Probe", description: "Probe", kind: "golden", priority: "low", destructive: false, defaultSelected: true }],
      async run(ctx, scenario) {
        const { page } = await ctx.openPage();
        seen[scenario.id] = await page.locator("[role=dialog]").count();
        return { checkId: id, scenarioId: scenario.id, status: "pass", findings: [], durationMs: 1 };
      },
    });
    const checks = [probe("dead-control"), probe("security-headers", "page")];
    const plan = await discoverAndPlan(`${s.url}/dialog-only.html`, { checks });
    expect(plan.form.opener?.name, "the page's only form is the dialog form").toBe("Add member");
    const runsDir = await mkdtemp(join(tmpdir(), "rh-openers-scope-"));
    dirs.push(runsDir);
    const { report } = await runPlan(plan, { checks, runsDir, log: () => undefined });
    expect(report.results.map((r) => [r.scenarioId, r.status])).toEqual([
      ["dead-control:probe", "pass"],
      ["security-headers:probe", "pass"],
    ]);
    expect(seen).toEqual({ "dead-control:probe": 1, "security-headers:probe": 0 });
  }, 120_000);
});

/**
 * A LiveView-style page on a tiny server with a WebSocket: the page says "join" when the socket opens and shows its
 * form once the server answers "ready"; "Add item" sends "add" over the socket (a write, with no HTTP request). The
 * server counts the messages it gets. A "Join team" link (role=button) changes something with a GET.
 */
async function socketApp(): Promise<{ url: string; messages: string[]; gets: string[]; close(): Promise<void> }> {
  const messages: string[] = [];
  const gets: string[] = [];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Items</title><link rel="icon" href="data:,"></head><body><main>
<h1>Items</h1><div id="slot"></div>
<button type="button" id="add">Add item</button>
<a role="button" href="/join-team">Join team</a>
<script>
const ws = new WebSocket("ws://" + location.host + "/live");
ws.onopen = () => ws.send("join");
ws.onmessage = (e) => {
  if (e.data === "ready") document.getElementById("slot").innerHTML = '<form id="note"><label for="text">Note</label><input id="text" name="text"><button>Save note</button></form>';
};
document.getElementById("add").addEventListener("click", () => ws.send("add"));
</script></main></body></html>`;
  const server = createServer((req, res) => {
    gets.push(req.url ?? "/");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/join-team" ? "<!doctype html><title>Joined</title><h1>You joined the team</h1>" : html);
  });
  const sockets = new Set<Socket>();
  server.on("upgrade", (req, socket: Socket) => {
    sockets.add(socket);
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", (buf: Buffer) => {
      // One small masked text frame per chunk is all this page sends.
      if ((buf[0]! & 0x0f) === 8) return void socket.end();
      if ((buf[0]! & 0x0f) !== 1) return;
      const length = buf[1]! & 0x7f;
      const mask = buf.subarray(2, 6);
      const text = Buffer.from(buf.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4]!)).toString("utf8");
      messages.push(text);
      if (text === "join") socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from("ready")]));
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    messages,
    gets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

describe("discovery sends nothing that could write while it looks for forms behind a click", () => {
  it("drops what a click sends over a WebSocket, keeps the socket working otherwise, and never follows a link", async () => {
    const app = await socketApp();
    try {
      const plan = await discoverAndPlan(app.url, { checks: [persistence] });
      // The form only shows once the server answered over the socket: the socket works both ways.
      expect(plan.page!.forms.map((f) => f.selector)).toEqual(["#note"]);
      expect(app.messages).toContain("join");
      // "Add item" was clicked (it looks like an opener) but its write never reached the server.
      expect(app.messages.filter((m) => m !== "join")).toEqual([]);
      // A link goes to another page: it opens no dialog, and following it could change something.
      expect(app.gets).not.toContain("/join-team");
    } finally {
      await app.close();
    }
  }, 120_000);
});
