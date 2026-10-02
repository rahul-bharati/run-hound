// Escaped scenarios end "error" with only the guard summary; Account-A-changing checks keep their own notes beside it.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import type { Check, CheckContext, CheckId, CheckResult, Finding, Report, Scenario } from "../../../../src/core/types.js";
import type { RunningCheckContext } from "../../../../src/engine/context.js";
import { discoverAndPlan, runPlan, scenarioTimeoutNote, STOPPED_NOTE, type ProgressEvent, type RunOptions } from "../../../../src/engine/runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Escape fixture</title></head><body>
<form id="task"><h1>New task</h1>
<label for="title">Title</label><input id="title" name="title" required>
<button type="submit">Save</button></form>
<button id="stuck" disabled>Stuck</button>
<textarea id="memo" readonly></textarea></body></html>`;

// Where /go-out sends the page: a host the fake lookup puts on a public address, so the gate refuses it.
const ESCAPED_TO = "http://elsewhere.test:9/landed";
const SUMMARY = `Stopped: the page left the target and went to ${ESCAPED_TO}, which Run Hound is not allowed to test.`;
// A write-side check's restore note, as write-access writes it.
const RESTORE_NOTE = "Could not be undone: title of Account A's test record: check Account A.";
// paywall-trust's note on a request to a payment provider the guard stopped.
const PROVIDER_NOTE = "blocked (payment provider): POST https://checkout.stripe.test/v1/sessions.";
const INTERRUPTED_NOTE = "If Run Hound had already sent a change as another account or signed out, Account A's test record may have changed or been deleted: check Account A.";

let site: FixtureServer;
let runsDir: string;
const lookup = async () => ["93.184.216.34"];

beforeAll(async () => {
  site = await startFixtureServer({
    pages: { "/tasks": FORM_PAGE },
    routes: {
      "GET /go-out": (_req, res) => {
        res.writeHead(302, { location: ESCAPED_TO });
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await site?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-escaped-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function scenario(checkId: CheckId, id: string): Scenario {
  return { id, checkId, title: `Fake ${id}`, description: "fake", kind: "danger", priority: "high", destructive: false, defaultSelected: true };
}

function finding(checkId: CheckId): Finding {
  return {
    checkId,
    id: `${checkId}#1`,
    title: "Account B can change Account A's records",
    severity: "critical",
    category: "security",
    confidence: "confirmed",
    meaning: "fake",
    impact: "fake",
    fix: "fake",
    evidence: [{ kind: "note", label: "fake" }],
  };
}

function fakeCheck(id: CheckId, sid: string, run: (ctx: CheckContext, s: Scenario) => Promise<CheckResult>): Check {
  return { id, title: `Fake ${id}`, category: "security", plan: () => [scenario(id, sid)], run };
}

// Sends the scenario's page to /go-out and waits for the guard to close it; checks read ctx.escaped.
async function escape(ctx: CheckContext): Promise<Page> {
  // A getter: read it each time.
  const escaped = () => (ctx as RunningCheckContext).escaped.length;
  const { page } = await ctx.openPage();
  await page.goto(`${new URL(ctx.targetUrl).origin}/go-out`).catch(() => undefined);
  const until = Date.now() + 10_000;
  while ((escaped() === 0 || !page.isClosed()) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  expect(escaped()).toBeGreaterThan(0);
  expect(page.isClosed()).toBe(true);
  return page;
}

// What the check's next browser call throws once the guard closed its context.
async function closedError(ctx: CheckContext, page: Page): Promise<string> {
  const err = await page.goto(ctx.targetUrl).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

// What a check's browser call threw, as a string, or a string saying it went through.
async function thrownBy(call: Promise<unknown>): Promise<string> {
  return call.then(
    () => "the call went through",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
}

// As write-access, csrf and paywall-trust build the error they throw: the caught message, then their notes.
function writeSideError(message: string, ...notes: string[]): Error {
  return new Error([message.replace(/\.?$/, "."), ...notes].join(" "));
}

async function run(
  check: Check,
  sid: string,
  options: Pick<RunOptions, "scenarioTimeoutMs" | "signal"> = {},
): Promise<{ report: Report; dir: string; result: CheckResult; ended: CheckResult }> {
  const plan = await discoverAndPlan(`${site.url}/tasks`, { checks: [check], lookup });
  const events: ProgressEvent[] = [];
  const { report, dir } = await runPlan(plan, { checks: [check], runsDir, lookup, approved: [sid], onProgress: (e) => events.push(e), log: () => undefined, ...options });
  const result = report.results.find((r) => r.scenarioId === sid)!;
  const end = events.find((e): e is Extract<ProgressEvent, { type: "scenario-end" }> => e.type === "scenario-end" && e.scenarioId === sid)!;
  return { report, dir, result, ended: end.result };
}

describe("a scenario that escaped the allowed targets", () => {
  it("keeps a write-side check's restore note beside the guard summary when the check returned its result", async () => {
    const check = fakeCheck("write-access", "wa:returned", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "write-access", scenarioId: s.id, status: "fail", findings: [finding("write-access")], durationMs: 1, notes: `Account B changed title. ${RESTORE_NOTE}` };
    });
    const { report, result, ended } = await run(check, "wa:returned");
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(result.notes).toBe(`${SUMMARY} Account B changed title. ${RESTORE_NOTE}`);
    expect(ended.notes).toBe(result.notes);
  });

  it("is never a pass, and keeps paywall-trust's provider-block note", async () => {
    const check = fakeCheck("paywall-trust", "pt:returned", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "paywall-trust", scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: `Opened /app/upgraded; Account A's plan stayed free. ${PROVIDER_NOTE}` };
    });
    const { result } = await run(check, "pt:returned");
    expect(result.status).toBe("error");
    expect(result.notes).toContain(SUMMARY);
    expect(result.notes).toContain(PROVIDER_NOTE);
  });

  it("keeps the restore note a check threw with, without repeating Playwright's closed-context message", async () => {
    const check = fakeCheck("write-access", "wa:threw", async (ctx) => {
      const page = await escape(ctx);
      const message = await closedError(ctx, page);
      // As write-access does when a browser call fails between a write and its restore.
      throw new Error([message.replace(/\.?$/, "."), RESTORE_NOTE, INTERRUPTED_NOTE].join(" "));
    });
    const { report, dir, result, ended } = await run(check, "wa:threw");
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toBe(`${SUMMARY} ${RESTORE_NOTE} ${INTERRUPTED_NOTE}`);
    expect(ended.notes).toBe(result.notes);
    expect(JSON.parse(await readFile(join(dir, "report.json"), "utf8")).results[0].notes).toBe(result.notes);
    expect(report.summary.errored).toBe(1);
  });

  it("leaves out the guard's close reason when Playwright passes it on, and keeps the restore note after it", async () => {
    const check = fakeCheck("write-access", "wa:reason", async (ctx) => {
      await escape(ctx);
      // Playwright names the close reason the guard gave (guard.ts) when a call was waiting as the context closed.
      throw new Error(`browserContext.newPage: Run Hound stopped: the page went to ${ESCAPED_TO}. ${RESTORE_NOTE}\nCall log:\n  - waiting for the page\n`);
    });
    const { result } = await run(check, "wa:reason");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`${SUMMARY} ${RESTORE_NOTE}`);
  });

  it("leaves out the guard's close reason and Playwright's call log when the check adds its restore note after them", async () => {
    const check = fakeCheck("write-access", "wa:reason-log", async (ctx) => {
      await escape(ctx);
      // Playwright ends the message of a call that was waiting as the context closed with its call log (and a newline).
      throw writeSideError(`browserContext.newPage: Run Hound stopped: the page went to ${ESCAPED_TO}\nCall log:\n  - waiting for the page\n`, RESTORE_NOTE);
    });
    const { result } = await run(check, "wa:reason-log");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`${SUMMARY} ${RESTORE_NOTE}`);
  });

  it("keeps the restore note a check added after the call log of a browser call the escape interrupted", async () => {
    let thrown = "";
    const check = fakeCheck("write-access", "wa:in-flight", async (ctx) => {
      const { page } = await ctx.openPage();
      // A click that waits (the button stays disabled) while the page leaves the target and the guard closes it.
      const click = thrownBy(page.locator("#stuck").click({ timeout: 10_000 }));
      const leave = setTimeout(() => {
        void page
          .evaluate(() => {
            location.href = "/go-out";
          })
          .catch(() => undefined);
      }, 300);
      const message = await click;
      clearTimeout(leave);
      const error = writeSideError(message, RESTORE_NOTE, INTERRUPTED_NOTE);
      thrown = error.message;
      throw error;
    });
    const { report, dir, result, ended } = await run(check, "wa:in-flight");
    // What this test is about: the guard's close reason, then Playwright's call log, then the check's notes.
    expect(thrown).toMatch(/^locator\.click: Run Hound stopped: the page went to /);
    expect(thrown).toContain("\nCall log:\n");
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toBe(`${SUMMARY} ${RESTORE_NOTE} ${INTERRUPTED_NOTE}`);
    expect(ended.notes).toBe(result.notes);
    expect(JSON.parse(await readFile(join(dir, "report.json"), "utf8")).results[0].notes).toBe(result.notes);
    expect(report.summary.errored).toBe(1);
  });

  it("keeps a returned note that quotes Playwright's closed-context message as the check wrote it", async () => {
    // paywall-trust's notes on a restore click that failed (its firstLine of the error, in parentheses).
    const cancel = `Clicking the app's "Cancel" on /app/billing failed (locator.click: Run Hound stopped: the page went to ${ESCAPED_TO}). Alex's plan is still pro: check Alex.`;
    const putBack = "Putting Alex's plan back failed (page.goto: Target page, context or browser has been closed). Alex's plan may still be pro: check Alex.";
    const check = fakeCheck("paywall-trust", "pt:quoted", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "paywall-trust", scenarioId: s.id, status: "fail", findings: [finding("paywall-trust")], durationMs: 1, notes: `${cancel} ${putBack}` };
    });
    const { result } = await run(check, "pt:quoted");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`${SUMMARY} ${cancel} ${putBack}`);
  });

  it("keeps a thrown message that quotes Playwright's closed-context message in a sentence as the check wrote it", async () => {
    const putBack = `Putting Alex's plan back failed (locator.click: Run Hound stopped: the page went to ${ESCAPED_TO}). Alex's plan may still be pro: check Alex.`;
    const check = fakeCheck("paywall-trust", "pt:quoted-thrown", async (ctx) => {
      await escape(ctx);
      throw new Error(`${putBack} ${PROVIDER_NOTE}`);
    });
    const { result } = await run(check, "pt:quoted-thrown");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`${SUMMARY} ${putBack} ${PROVIDER_NOTE}`);
  });

  it("says where the page went when the check then ran past its time limit, and keeps the interrupted note", async () => {
    const limitMs = 3_000;
    const check: Check = {
      ...fakeCheck("write-access", "wa:hung", async (ctx) => {
        await escape(ctx);
        // Stuck until well after the time limit, then ends (an abandoned check never outlives its test for long).
        await new Promise((r) => setTimeout(r, limitMs + 1_000));
        throw new Error("abandoned");
      }),
      interruptedNote: INTERRUPTED_NOTE,
    };
    const { report, result, ended } = await run(check, "wa:hung", { scenarioTimeoutMs: limitMs });
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toBe(`${SUMMARY} ${scenarioTimeoutNote(limitMs)} ${INTERRUPTED_NOTE}`);
    expect(ended.notes).toBe(result.notes);
    expect(report.summary.errored).toBe(1);
  });

  it("says where the page went when the run was then stopped, and keeps the interrupted note", async () => {
    const stop = new AbortController();
    const check: Check = {
      ...fakeCheck("write-access", "wa:stopped", async (ctx) => {
        await escape(ctx);
        stop.abort();
        await new Promise((r) => setTimeout(r, 1_000));
        throw new Error("abandoned");
      }),
      interruptedNote: INTERRUPTED_NOTE,
    };
    const { report, result, ended } = await run(check, "wa:stopped", { signal: stop.signal });
    expect(report.stopped).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.findings).toEqual([]);
    // "Stopped by you" stays first: the app counts a scenario as stopped by that prefix (client.ts, app.ts).
    expect(result.notes!.indexOf(STOPPED_NOTE)).toBe(0);
    expect(result.notes).toBe(`${STOPPED_NOTE}. ${SUMMARY} ${INTERRUPTED_NOTE}`);
    expect(ended.notes).toBe(result.notes);
  });

  it("says only where the page went when the check's own error is Playwright's closed-context message", async () => {
    const check = fakeCheck("write-access", "wa:closed", async (ctx) => {
      const page = await escape(ctx);
      await page.goto(ctx.targetUrl);
      throw new Error("unreachable");
    });
    const { result } = await run(check, "wa:closed");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(SUMMARY);
  });

  it("says only where the page went when the check returned no notes", async () => {
    const check = fakeCheck("write-access", "wa:quiet", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "write-access", scenarioId: s.id, status: "fail", findings: [finding("write-access")], durationMs: 1 };
    });
    const { result } = await run(check, "wa:quiet");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(SUMMARY);
  });

  it("still redacts secrets from the message a check threw", async () => {
    const key = "sk-proj-FAKEFAKEesc1234567890abcdefGHIJ";
    const check = fakeCheck("write-access", "wa:leaky", async (ctx) => {
      await escape(ctx);
      throw new Error(`The app answered ${key}. ${RESTORE_NOTE}`);
    });
    const { dir, result, ended } = await run(check, "wa:leaky");
    expect(result.notes).toContain(SUMMARY);
    expect(result.notes).toContain(RESTORE_NOTE);
    expect(result.notes).not.toContain("sk-proj-FAKE");
    expect(ended.notes).not.toContain("sk-proj-FAKE");
    expect(await readFile(join(dir, "report.json"), "utf8")).not.toContain("sk-proj-FAKE");
  });
});

describe("a scenario that escaped, of a check that does not change the target", () => {
  // As on 0.5.0: only the guard summary; the post-escape check's browser call's error repeats where the page went.
  it("says only where the page went when the check returned the error its next browser call threw", async () => {
    let caught = "";
    const check = fakeCheck("axe-states", "axe:waited", async (ctx, s) => {
      const page = await escape(ctx);
      // As axe-states, keyboard-completion and pii-leak do: a wait that fails once the context is closed.
      caught = await thrownBy(page.waitForTimeout(50));
      return { checkId: "axe-states", scenarioId: s.id, status: "error", findings: [], durationMs: 1, notes: caught };
    });
    const { report, result, ended } = await run(check, "axe:waited");
    // What this test is about: Playwright's "<object.method>: " and the closed-context message, as the check's notes.
    expect(caught).toMatch(/^page\.waitForTimeout: /);
    expect(result.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.notes).toBe(SUMMARY);
    expect(ended.notes).toBe(result.notes);
    expect(report.summary.errored).toBe(1);
  });

  it("says only where the page went when the check returned Playwright's closed-context message", async () => {
    const check = fakeCheck("persistence", "persist:reload", async (ctx, s) => {
      await escape(ctx);
      // As the canary-reload scenario's notes read once the guard closed its context.
      return { checkId: "persistence", scenarioId: s.id, status: "error", findings: [], durationMs: 1, notes: "page.reload: Target page, context or browser has been closed" };
    });
    const { result } = await run(check, "persist:reload");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(SUMMARY);
  });

  it("says only where the page went, not what the check counted on a page that was not the target", async () => {
    const saves = fakeCheck("double-submit", "ds:counted", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "double-submit", scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: "1 save request(s), each to a different endpoint: POST /book." };
    });
    const checked = fakeCheck("silent-failure", "sf:checked", async (ctx, s) => {
      await escape(ctx);
      return { checkId: "silent-failure", scenarioId: s.id, status: "pass", findings: [], durationMs: 1, notes: "Checked 0 responses and the page text." };
    });
    for (const [check, sid] of [[saves, "ds:counted"], [checked, "sf:checked"]] as const) {
      const { result } = await run(check, sid);
      expect(result.status).toBe("error");
      expect(result.notes).toBe(SUMMARY);
    }
  });

  it("says only where the page went when the check threw", async () => {
    const check = fakeCheck("pii-leak", "pii:threw", async (ctx) => {
      const page = await escape(ctx);
      throw new Error(`${await thrownBy(page.waitForTimeout(50))} while typing the canary.`);
    });
    const { result } = await run(check, "pii:threw");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(SUMMARY);
  });
});

describe("a scenario that escaped, of every check that changes Account A", () => {
  // mass-assignment, csrf, write-access and paywall-trust: their restore notes must reach the report.
  it("keeps the notes each one returned, after the guard summary", async () => {
    for (const id of ["mass-assignment", "csrf", "write-access", "paywall-trust"] as const) {
      const sid = `${id}:restore`;
      const check = fakeCheck(id, sid, async (ctx, s) => {
        await escape(ctx);
        return { checkId: id, scenarioId: s.id, status: "fail", findings: [finding(id)], durationMs: 1, notes: RESTORE_NOTE };
      });
      const { result } = await run(check, sid);
      expect(result.status).toBe("error");
      expect(result.notes, id).toBe(`${SUMMARY} ${RESTORE_NOTE}`);
    }
  });
});

describe("a write-side check that threw after a browser call failed, with no escape", () => {
  it("keeps the notes it added after Playwright's call log, and leaves out the call log", async () => {
    let thrown = "";
    const check = fakeCheck("write-access", "wa:timed-out-call", async (ctx) => {
      const { page } = await ctx.openPage();
      const error = writeSideError(await thrownBy(page.locator("#stuck").click({ timeout: 300 })), RESTORE_NOTE, INTERRUPTED_NOTE);
      thrown = error.message;
      throw error;
    });
    const { dir, result, ended } = await run(check, "wa:timed-out-call");
    expect(thrown).toContain("\nCall log:\n");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`locator.click: Timeout 300ms exceeded. ${RESTORE_NOTE} ${INTERRUPTED_NOTE}`);
    expect(ended.notes).toBe(result.notes);
    expect(JSON.parse(await readFile(join(dir, "report.json"), "utf8")).results[0].notes).toBe(result.notes);
  });

  it("keeps a question mark that ended Playwright's message, without the full stop the check added after the call log", async () => {
    const check = fakeCheck("write-access", "wa:detached", async () => {
      throw writeSideError('page.goto: net::ERR_ABORTED; maybe frame was detached?\nCall log:\n\u001b[2m  - navigating to "http://127.0.0.1/", waiting until "load"\u001b[22m\n', RESTORE_NOTE);
    });
    const { result } = await run(check, "wa:detached");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`page.goto: net::ERR_ABORTED; maybe frame was detached? ${RESTORE_NOTE}`);
  });

  it("leaves out a call log whose fill value spans lines, and keeps the notes after it", async () => {
    let thrown = "";
    const check = fakeCheck("write-access", "wa:multiline", async (ctx) => {
      const { page } = await ctx.openPage();
      const error = writeSideError(await thrownBy(page.locator("#memo").fill("first line\nsecond line typed", { timeout: 300 })), RESTORE_NOTE);
      thrown = error.message;
      throw error;
    });
    const { dir, result } = await run(check, "wa:multiline");
    // Playwright logs the filled value raw, one of its lines unindented.
    expect(thrown).toContain("second line typed");
    expect(result.status).toBe("error");
    expect(result.notes).toBe(`locator.fill: Timeout 300ms exceeded. ${RESTORE_NOTE}`);
    expect(await readFile(join(dir, "report.json"), "utf8")).not.toContain("second line typed");
  });
});

describe("a check whose browser call threw, with no escape", () => {
  it("leaves out a call log whose fill value spans lines", async () => {
    let thrown = "";
    const check = fakeCheck("dead-control", "dc:multiline", async (ctx) => {
      const { page } = await ctx.openPage();
      try {
        await page.locator("#memo").fill("first line\nsecond line typed", { timeout: 300 });
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
        throw error;
      }
      throw new Error("the fill went through");
    });
    const { dir, result } = await run(check, "dc:multiline");
    expect(thrown).toContain("second line typed");
    expect(result.status).toBe("error");
    expect(result.notes).toBe("locator.fill: Timeout 300ms exceeded.");
    expect(await readFile(join(dir, "report.json"), "utf8")).not.toContain("second line typed");
  });
});
