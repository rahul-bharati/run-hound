import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, CheckContext, CheckId, CheckResult, Finding, Plan, Report, Scenario } from "../core/types.js";
import { NoFormFoundError, TargetNotAllowedError } from "./errors.js";
import { canShowBrowser, discoverAndPlan, NothingToRunError, planWarnings, runPlan, type ProgressEvent } from "./runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Runner fixture</title></head><body>
<form id="booking">
  <h1>Book a sitter</h1>
  <label for="petName">Pet name</label><input id="petName" name="petName" required>
  <label for="email">Owner email</label><input id="email" name="email" type="email" required>
  <button type="submit">Book</button>
</form>
</body></html>`;

interface Recorder {
  ran: string[];
  contexts: CheckContext[];
}

function scenario(checkId: CheckId, id: string, extra: Partial<Scenario> = {}): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true, ...extra };
}

function finding(checkId: CheckId, n: number): Finding {
  return {
    checkId,
    id: `${checkId}#${n}`,
    title: "Fake silent failure",
    severity: "high",
    category: "broken-feature",
    confidence: "confirmed",
    meaning: "The form says nothing when the server fails.",
    impact: "Users think they booked.",
    fix: "Show an error message.",
    evidence: [{ kind: "note", label: "fake" }],
    spec: { filename: `${checkId}-${n}.spec.ts`, source: "// fake spec\n" },
  };
}

/**
 * Four fake checks, deliberately passed out of CHECK_IDS order:
 *  - persistence "pe:reload": destructive (check asks for defaultSelected, plan must turn it off)
 *  - silent-failure "sf:500": not selected by default, fails with one finding
 *  - dead-control "dc:controls": selected by default, opens a page through the context, passes
 *  - console-network-errors "cne:load": selected by default, throws
 */
function fakeChecks(rec: Recorder): Check[] {
  const make = (id: CheckId, scenarios: Scenario[], run: (ctx: CheckContext, s: Scenario) => Promise<CheckResult>): Check => ({
    id,
    title: `Fake ${id}`,
    category: "broken-feature",
    plan: () => scenarios,
    async run(ctx, s) {
      rec.ran.push(s.id);
      rec.contexts.push(ctx);
      return run(ctx, s);
    },
  });
  return [
    make("persistence", [scenario("persistence", "pe:reload", { destructive: true, defaultSelected: true })], async (_ctx, s) => ({
      checkId: "persistence",
      scenarioId: s.id,
      status: "pass",
      findings: [],
      durationMs: 1,
    })),
    make("silent-failure", [scenario("silent-failure", "sf:500", { kind: "danger", defaultSelected: false })], async (_ctx, s) => ({
      checkId: "silent-failure",
      scenarioId: s.id,
      status: "fail",
      findings: [finding("silent-failure", 1)],
      durationMs: 1,
    })),
    make("dead-control", [scenario("dead-control", "dc:controls")], async (ctx, s) => {
      const { page } = await ctx.openPage();
      const title = await page.title();
      return { checkId: "dead-control", scenarioId: s.id, status: title === "Runner fixture" ? "pass" : "fail", findings: [], durationMs: 1, notes: title };
    }),
    make("console-network-errors", [scenario("console-network-errors", "cne:load")], async () => {
      throw new Error("boom from fake check");
    }),
  ];
}

let server: FixtureServer;
let runsDir: string;
let rec: Recorder;
let checks: Check[];

beforeAll(async () => {
  server = await startFixtureServer({
    pages: { "/book": FORM_PAGE, "/login": FORM_PAGE.replace("Book a sitter", "Log in") },
    routes: {
      "GET /settings": (_req, res) => {
        res.writeHead(302, { location: "/login?next=/settings" });
        res.end();
      },
      "GET /blocked": (_req, res) => {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end('Blocked request. This host ("host.docker.internal") is not allowed.');
      },
    },
  });
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-runs-"));
  rec = { ran: [], contexts: [] };
  checks = fakeChecks(rec);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(runsDir, { recursive: true, force: true });
});

const url = () => `${server.url}/book`;
const resultFor = (report: Report, id: string) => report.results.find((r) => r.scenarioId === id);

describe("discoverAndPlan", () => {
  it("discovers the form and builds the plan from the given checks in CHECK_IDS order", async () => {
    const plan = await discoverAndPlan(url(), { checks });
    expect(plan.target).toBe(url());
    expect(plan.form.fields.map((f) => f.key).sort()).toEqual(["email", "petName"]);
    expect(plan.scenarios.map((s) => s.id)).toEqual(["cne:load", "dc:controls", "sf:500", "pe:reload"]);
    expect(plan.scenarios.find((s) => s.id === "pe:reload")!.defaultSelected).toBe(false);
    expect(rec.ran).toEqual([]);
  });

  it("explains a page without a form: the status it answered, a dev server refusing the host name", async () => {
    await expect(discoverAndPlan(`${server.url}/nope`, { checks })).rejects.toThrow(/No form found on .*\/nope: the page answered 404 \(not found\): check the path/);
    const blocked = discoverAndPlan(`${server.url}/blocked`, { checks });
    await expect(blocked).rejects.toBeInstanceOf(NoFormFoundError);
    await expect(blocked).rejects.toThrow(/dev server refused the host name "host\.docker\.internal".*answered 403/);
  });

  it("warns when the form was found on another page than the one asked for (a redirect to a sign-in page)", async () => {
    const plan = await discoverAndPlan(`${server.url}/settings`, { checks });
    const warnings = planWarnings(plan);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/\/settings redirected to .*\/login\?next=\/settings, so that page is the one being tested\. It looks like a sign-in page/);
    expect(planWarnings(await discoverAndPlan(url(), { checks }))).toEqual([]);
  });

  it("refuses a public target before opening a browser", async () => {
    const launch = vi.spyOn(chromium, "launch");
    await expect(discoverAndPlan("http://8.8.8.8/", { checks })).rejects.toBeInstanceOf(TargetNotAllowedError);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("runPlan", () => {
  let plan: Plan;

  beforeEach(async () => {
    plan = await discoverAndPlan(url(), { checks });
  });

  it("runs the default-selected scenarios when nothing is approved explicitly", async () => {
    const { report } = await runPlan(plan, { checks, runsDir });
    expect(rec.ran).toEqual(["cne:load", "dc:controls"]);
    expect([...report.approved].sort()).toEqual(["cne:load", "dc:controls"]);
    expect(resultFor(report, "dc:controls")?.status).toBe("pass");
    expect(resultFor(report, "dc:controls")?.notes).toBe("Runner fixture");
    // Unapproved scenarios are either omitted or reported as skipped, never run.
    for (const id of ["sf:500", "pe:reload"]) expect([undefined, "skipped"]).toContain(resultFor(report, id)?.status);
    expect(report.findings).toEqual([]);
  });

  it("gives every scenario the same run token, so test values from earlier scenarios can be recognised", async () => {
    await runPlan(plan, { checks, runsDir, approved: ["cne:load", "dc:controls"] });
    expect(rec.contexts).toHaveLength(2);
    expect(rec.contexts[0]!.runToken).toMatch(/^[a-z0-9]{6,}$/);
    expect(rec.contexts[1]!.runToken).toBe(rec.contexts[0]!.runToken);
    // A new run gets a new token.
    const first = rec.contexts[0]!.runToken;
    await runPlan(plan, { checks, runsDir, approved: ["dc:controls"] });
    expect(rec.contexts[2]!.runToken).not.toBe(first);
  });

  it("gives checks a real context for the target", async () => {
    await runPlan(plan, { checks, runsDir, approved: ["dc:controls"] });
    const ctx = rec.contexts[0]!;
    expect(ctx.targetUrl).toBe(url());
    expect(ctx.form.fields.length).toBe(2);
    expect(ctx.allowDestructive).toBe(false);
    expect(ctx.runToken.length).toBeGreaterThan(0);
    expect(ctx.artifactsDir.startsWith(runsDir)).toBe(true);
  });

  it("runs only explicitly approved scenarios and collects their findings", async () => {
    const { report } = await runPlan(plan, { checks, runsDir, approved: ["sf:500"] });
    expect(rec.ran).toEqual(["sf:500"]);
    expect(report.approved).toEqual(["sf:500"]);
    expect(resultFor(report, "sf:500")?.status).toBe("fail");
    expect(report.findings.map((f) => f.id)).toEqual(["silent-failure#1"]);
    expect(report.summary.high).toBe(1);
    expect(report.summary.failed).toBe(1);
  });

  it("runs approved scenarios in plan order, not approval order", async () => {
    await runPlan(plan, { checks, runsDir, approved: ["sf:500", "dc:controls"] });
    expect(rec.ran).toEqual(["dc:controls", "sf:500"]);
  });

  it("skips an approved destructive scenario without allowDestructive", async () => {
    const { report } = await runPlan(plan, { checks, runsDir, approved: ["pe:reload"] });
    expect(rec.ran).toEqual([]);
    const result = resultFor(report, "pe:reload");
    expect(result?.status).toBe("skipped");
    expect(result?.notes).toEqual(expect.any(String));
    expect(report.summary.skipped).toBeGreaterThanOrEqual(1);
  });

  it("runs an approved destructive scenario with allowDestructive", async () => {
    const { report } = await runPlan(plan, { checks, runsDir, approved: ["pe:reload"], allowDestructive: true });
    expect(rec.ran).toEqual(["pe:reload"]);
    expect(resultFor(report, "pe:reload")?.status).toBe("pass");
    expect(rec.contexts[0]!.allowDestructive).toBe(true);
  });

  it("marks a throwing check as error and keeps running", async () => {
    const { report } = await runPlan(plan, { checks, runsDir, approved: ["cne:load", "dc:controls", "sf:500"] });
    expect(rec.ran).toEqual(["cne:load", "dc:controls", "sf:500"]);
    const errored = resultFor(report, "cne:load")!;
    expect(errored.status).toBe("error");
    expect(errored.checkId).toBe("console-network-errors");
    expect(errored.findings).toEqual([]);
    expect(errored.notes).toContain("boom from fake check");
    expect(resultFor(report, "dc:controls")?.status).toBe("pass");
    expect(resultFor(report, "sf:500")?.status).toBe("fail");
    expect(report.summary).toMatchObject({ passed: 1, failed: 1, errored: 1 });
  });

  it("reports progress for every scenario it runs", async () => {
    const events: ProgressEvent[] = [];
    await runPlan(plan, { checks, runsDir, approved: ["dc:controls", "sf:500"], onProgress: (e) => events.push(e) });
    const starts = events.filter((e) => e.type === "scenario-start");
    const ends = events.filter((e) => e.type === "scenario-end");
    expect(starts.map((e) => e.scenarioId)).toEqual(["dc:controls", "sf:500"]);
    expect(starts.map((e) => (e.type === "scenario-start" ? [e.index, e.total] : null))).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(ends.map((e) => (e.type === "scenario-end" ? e.result.status : null))).toEqual(["pass", "fail"]);
  });

  it("writes the report into <runsDir>/<runId>/", async () => {
    const { report, dir } = await runPlan(plan, { checks, runsDir, approved: ["sf:500", "dc:controls"] });
    expect(dir).toBe(join(runsDir, report.runId));
    expect((await stat(dir)).isDirectory()).toBe(true);
    const entries = await readdir(dir);
    expect(entries).toEqual(expect.arrayContaining(["report.json", "report.md", "report.html"]));
    const onDisk = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Report;
    expect(onDisk.runId).toBe(report.runId);
    expect(onDisk.findings.map((f) => f.id)).toEqual(["silent-failure#1"]);
    expect(await readFile(join(dir, "specs", "silent-failure-1.spec.ts"), "utf8")).toContain("fake spec");
  });

  it("fills in report metadata", async () => {
    const { report } = await runPlan(plan, { checks, runsDir, approved: ["dc:controls"] });
    expect(report.runId).toMatch(/^[\w-]+$/);
    expect(report.target).toBe(url());
    expect(report.plan).toEqual(plan);
    expect(report.runHoundVersion).toEqual(expect.any(String));
    expect(Date.parse(report.startedAt)).not.toBeNaN();
    expect(Date.parse(report.finishedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    expect(report.notVisible.length).toBeGreaterThan(0);
  });

  it("gives each run its own id and folder", async () => {
    const a = await runPlan(plan, { checks, runsDir, approved: ["sf:500"] });
    const b = await runPlan(plan, { checks, runsDir, approved: ["sf:500"] });
    expect(a.report.runId).not.toBe(b.report.runId);
    expect(a.dir).not.toBe(b.dir);
  });

  it("refuses a plan whose target is not allowed, before launching a browser", async () => {
    const launch = vi.spyOn(chromium, "launch");
    const publicPlan: Plan = { ...plan, target: "http://8.8.8.8/book" };
    await expect(runPlan(publicPlan, { checks, runsDir, approved: ["dc:controls"] })).rejects.toBeInstanceOf(TargetNotAllowedError);
    expect(launch).not.toHaveBeenCalled();
    expect(rec.ran).toEqual([]);
    expect(await readdir(runsDir)).toEqual([]);
  });
});

describe("runner safety hardening", () => {
  let site: FixtureServer;
  const lookup = async (host: string) => (host === "pinned.test" ? ["127.0.0.1"] : ["93.184.216.34"]);
  const pinnedUrl = () => `http://pinned.test:${new URL(site.url).port}/book`;

  beforeAll(async () => {
    site = await startFixtureServer({
      pages: { "/book": FORM_PAGE },
      routes: {
        "GET /go-out": (_req, res) => {
          res.writeHead(302, { location: "http://elsewhere.test:9/landed" });
          res.end();
        },
        "GET /start-out": (_req, res) => {
          res.writeHead(302, { location: "http://elsewhere.test:9/" });
          res.end();
        },
      },
    });
  });

  afterAll(async () => {
    await site?.close();
  });

  it("pins the browser to the address the safety gate approved (no second DNS lookup to rebind)", async () => {
    // pinned.test does not exist in real DNS: the page only loads if Chromium uses the approved address.
    const plan = await discoverAndPlan(pinnedUrl(), { checks, lookup });
    expect(plan.form.fields.length).toBe(2);
    const { report } = await runPlan(plan, { checks, runsDir, lookup, approved: ["dc:controls"] });
    expect(resultFor(report, "dc:controls")?.status).toBe("pass");
    expect(resultFor(report, "dc:controls")?.notes).toBe("Runner fixture");
  });

  it("refuses to plan when the target redirects to a host the gate refuses", async () => {
    await expect(discoverAndPlan(`${site.url}/start-out`, { checks, lookup })).rejects.toBeInstanceOf(TargetNotAllowedError);
  });

  it("turns a scenario that escaped to a refused host into an error and drops its findings", async () => {
    const escaping: Check = {
      id: "silent-failure",
      title: "Fake escaping check",
      category: "broken-feature",
      plan: () => [scenario("silent-failure", "sf:escape")],
      async run(ctx, s) {
        const { page } = await ctx.openPage();
        await page.goto(`${new URL(ctx.targetUrl).origin}/go-out`).catch(() => undefined);
        return { checkId: "silent-failure", scenarioId: s.id, status: "fail", findings: [finding("silent-failure", 1)], durationMs: 1 };
      },
    };
    const plan = await discoverAndPlan(`${site.url}/book`, { checks: [escaping], lookup });
    const { report } = await runPlan(plan, { checks: [escaping], runsDir, lookup });
    const result = resultFor(report, "sf:escape")!;
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toContain("elsewhere.test");
    expect(report.findings).toEqual([]);
  });

  it("redacts secrets from check log lines", async () => {
    const lines: string[] = [];
    const chatty: Check = {
      id: "dead-control",
      title: "Fake chatty check",
      category: "broken-feature",
      plan: () => [scenario("dead-control", "dc:chatty")],
      async run(ctx, s) {
        ctx.log("server said: key=sk-proj-FAKEFAKElog1234567890abcdefGHIJ");
        return { checkId: "dead-control", scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
      },
    };
    const plan = await discoverAndPlan(`${site.url}/book`, { checks: [chatty] });
    await runPlan(plan, { checks: [chatty], runsDir, log: (line) => lines.push(line) });
    expect(lines.join("\n")).toContain("server said");
    expect(lines.join("\n")).not.toContain("sk-proj-FAKE");
    expect(lines.join("\n")).toContain("[REDACTED:openai-key]");
  });

  it("redacts secrets from a scenario error note", async () => {
    const leaky: Check = {
      id: "dead-control",
      title: "Fake leaky check",
      category: "broken-feature",
      plan: () => [scenario("dead-control", "dc:leaky")],
      async run() {
        throw new Error("upstream rejected sk-proj-FAKEFAKEerr1234567890abcdefGHIJ");
      },
    };
    const plan = await discoverAndPlan(`${site.url}/book`, { checks: [leaky] });
    const { report, dir } = await runPlan(plan, { checks: [leaky], runsDir, log: () => undefined });
    expect(resultFor(report, "dc:leaky")?.notes).not.toContain("sk-proj-FAKE");
    expect(await readFile(join(dir, "report.json"), "utf8")).not.toContain("sk-proj-FAKE");
  });
});

describe("runPlan: what gets run", () => {
  let plan: Plan;

  beforeEach(async () => {
    plan = await discoverAndPlan(url(), { checks });
  });

  it("refuses an empty approval instead of reporting a clean pass", async () => {
    const launch = vi.spyOn(chromium, "launch");
    await expect(runPlan(plan, { checks, runsDir, approved: [] })).rejects.toBeInstanceOf(NothingToRunError);
    expect(launch).not.toHaveBeenCalled();
    expect(await readdir(runsDir)).toEqual([]);
  });

  it("refuses scenario ids the plan doesn't have", async () => {
    await expect(runPlan(plan, { checks, runsDir, approved: ["nope"] })).rejects.toThrow(/nope/);
  });

  it("numbers evidence files across the whole run, not per scenario", async () => {
    const shooter = (id: CheckId, sid: string): Check => ({
      id,
      title: id,
      category: "broken-feature",
      plan: () => [scenario(id, sid)],
      async run(ctx, s) {
        const { page } = await ctx.openPage();
        await ctx.screenshot(page, "shot");
        return { checkId: id, scenarioId: s.id, status: "pass", findings: [], durationMs: 1 };
      },
    });
    const two = [shooter("dead-control", "a"), shooter("persistence", "b")];
    const p = await discoverAndPlan(url(), { checks: two });
    const { dir } = await runPlan(p, { checks: two, runsDir });
    expect((await readdir(join(dir, "artifacts"))).sort()).toEqual(["001-shot.png", "002-shot.png"]);
  });

  it("keeps finding ids and spec file names unique across scenarios of one check", async () => {
    const twice: Check = {
      id: "silent-failure",
      title: "twice",
      category: "broken-feature",
      plan: () => [scenario("silent-failure", "one"), scenario("silent-failure", "two")],
      async run(_ctx, s) {
        return { checkId: "silent-failure", scenarioId: s.id, status: "fail", findings: [finding("silent-failure", 1)], durationMs: 1 };
      },
    };
    const p = await discoverAndPlan(url(), { checks: [twice] });
    const { report, dir } = await runPlan(p, { checks: [twice], runsDir });
    expect(report.findings.map((f) => f.id)).toEqual(["silent-failure#1", "silent-failure#1-2"]);
    expect((await readdir(join(dir, "specs"))).sort()).toEqual(["silent-failure-1-2.spec.ts", "silent-failure-1.spec.ts"]);
  });
});

describe("discoverAndPlan: what people type", () => {
  it("reads a URL without a scheme as http://", async () => {
    const plan = await discoverAndPlan(url().replace(/^http:\/\//, ""), { checks });
    expect(plan.target).toBe(url());
  });

  it("explains an unreachable target in one plain sentence", async () => {
    const dead = await startFixtureServer({ pages: {} });
    const target = `${dead.url}/book`;
    await dead.close();
    const err = await discoverAndPlan(target, { checks }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/Nothing is answering at http:\/\/127\.0\.0\.1:\d+\./);
    expect(err?.message).not.toMatch(/\u001b|Call log/);
  });
});

describe("canShowBrowser", () => {
  it("is true on macOS and Windows, and on Linux only with a display server", () => {
    expect(canShowBrowser({}, "darwin")).toBe(true);
    expect(canShowBrowser({}, "win32")).toBe(true);
    expect(canShowBrowser({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(canShowBrowser({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
    expect(canShowBrowser({}, "linux")).toBe(false);
  });
});
