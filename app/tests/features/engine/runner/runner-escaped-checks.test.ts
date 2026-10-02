// Built-in checks on a form whose submit leaves the allowed targets: notes are only the guard summary.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../../../test-support/server.js";
import { checks } from "../../../../src/checks/index.js";
import { discoverAndPlan, runPlan } from "../../../../src/engine/runner.js";

const PAGE = `<!doctype html><html lang="en"><head><title>Book</title></head><body><main><h1>Book a sitter</h1>
<form method="post" action="/book" aria-label="Book a sitter">
<label for="name">Name</label><input id="name" name="name" required>
<label for="email">Email</label><input id="email" name="email" type="email" required>
<button type="submit">Book</button></form></main></body></html>`;

// Where a submitted booking goes: a host the fake lookup puts on a public address, so the gate refuses it.
const ESCAPED_TO = "http://pay.elsewhere.test:9/checkout?ref=1";
const SUMMARY = `Stopped: the page left the target and went to ${ESCAPED_TO}, which Run Hound is not allowed to test.`;
// What a person should never read in a report's notes (acceptance's TECHNICAL, plus the close reason).
const TECHNICAL = /\n\s+at |\b(TypeError|ReferenceError|SyntaxError|TimeoutError)\b|Call log:|locator\(|\b(page|locator|browserContext|frame)\.\w+:|Target page, context or browser has been closed|Run Hound stopped:/;

let site: FixtureServer;
let runsDir: string;
const lookup = async () => ["93.184.216.34"];

beforeAll(async () => {
  site = await startFixtureServer({
    pages: { "/book": PAGE },
    routes: {
      "POST /book": (_req, res) => {
        res.writeHead(302, { location: ESCAPED_TO });
        res.end();
      },
    },
  });
  runsDir = await mkdtemp(join(tmpdir(), "rh-escaped-checks-"));
});

afterAll(async () => {
  await site?.close();
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

describe("the built-in checks on a form whose submit leaves the allowed targets", () => {
  it("say only where the page went, in every scenario the escape stopped", { timeout: 240_000 }, async () => {
    const plan = await discoverAndPlan(`${site.url}/book`, { checks, lookup });
    const approved = plan.scenarios.map((s) => s.id);
    const { report } = await runPlan(plan, { checks, runsDir, lookup, approved, log: () => undefined });
    const escaped = report.results.filter((r) => (r.notes ?? "").includes("left the target"));
    // What this test is about: scenarios of several checks, among them those whose next browser call failed.
    const ids = escaped.map((r) => r.scenarioId);
    expect(ids.length, ids.join(", ")).toBeGreaterThanOrEqual(3);
    expect(escaped.map((r) => `${r.scenarioId}: ${r.status}`)).toEqual(escaped.map((r) => `${r.scenarioId}: error`));
    expect(escaped.filter((r) => r.notes !== SUMMARY).map((r) => `${r.scenarioId}: ${r.notes}`)).toEqual([]);
    expect(report.results.filter((r) => TECHNICAL.test(r.notes ?? "")).map((r) => `${r.scenarioId}: ${r.notes}`)).toEqual([]);
    expect(escaped.flatMap((r) => r.findings)).toEqual([]);
  });
});
