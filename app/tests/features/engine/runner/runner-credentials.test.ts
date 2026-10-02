/**
 * A target URL with a user name and password in it (http://user:pass@host/, a password-protected preview): they are
 * taken out of the URL before anything is planned, so no plan, report, spec file, log line or progress event carries
 * them, and the browser still answers the app's HTTP authentication with them. Fake checks only.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { Check, Scenario } from "../core/types.js";
import { discoverAndPlan, runPlan, type ProgressEvent } from "./runner.js";

const FORM_PAGE = `<!doctype html><html lang="en"><head><title>Preview fixture</title></head><body>
<form id="booking"><h1>Book a sitter</h1>
<label for="petName">Pet name</label><input id="petName" name="petName" required>
<button type="submit">Book</button></form></body></html>`;

const PASSWORD = "hunter2-Preview";
const BASIC = `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`;

let server: FixtureServer;
let runsDir: string;

beforeAll(async () => {
  server = await startFixtureServer({
    routes: {
      "GET /book": (req, res) => {
        if (req.headers.authorization !== BASIC) {
          res.writeHead(401, { "www-authenticate": 'Basic realm="preview"', "content-type": "text/plain" });
          res.end("Password required");
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(FORM_PAGE);
      },
    },
  });
});

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-creds-"));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

/** Every file under dir, as text. */
async function allText(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  return (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
}

/** One check that opens the page, reports what it saw, and writes the URLs it knows into a finding and its spec. */
function fakeChecks(): Check[] {
  const scenario: Scenario = { id: "dc:1", checkId: "dead-control", title: "Fake dc:1", description: "fake", kind: "golden", priority: "medium", destructive: false, defaultSelected: true };
  return [
    {
      id: "dead-control",
      title: "Fake dead-control",
      category: "broken-feature",
      plan: () => [scenario],
      async run(ctx, s) {
        const { page } = await ctx.openPage();
        ctx.step(`Opened ${page.url()}`, page);
        ctx.log(`target ${ctx.targetUrl}`);
        const title = await page.title();
        return {
          checkId: "dead-control",
          scenarioId: s.id,
          status: "fail",
          durationMs: 1,
          notes: `Saw "${title}"`,
          findings: [
            {
              checkId: "dead-control",
              id: "dead-control#1",
              title: "Fake finding",
              severity: "low",
              category: "broken-feature",
              confidence: "confirmed",
              meaning: `Seen on ${page.url()}`,
              impact: "none",
              fix: "none",
              evidence: [{ kind: "note", label: `Page ${page.url()} for ${ctx.targetUrl}` }],
              spec: { filename: "fake.spec.ts", source: `await page.goto(${JSON.stringify(ctx.targetUrl)});\n` },
            },
          ],
        };
      },
    },
  ];
}

describe("a target URL with a user name and password", () => {
  it("plans and runs behind the password, and never writes the password anywhere", async () => {
    const checks = fakeChecks();
    const port = new URL(server.url).port;
    const plan = await discoverAndPlan(`http://admin:${PASSWORD}@127.0.0.1:${port}/book`, { checks });

    // Discovery got past the password: it found the form.
    expect(plan.form.fields.map((f) => f.key)).toEqual(["petName"]);
    expect(plan.target).toBe(`http://127.0.0.1:${port}/book`);
    expect(JSON.stringify(plan)).not.toContain(PASSWORD);
    expect(JSON.stringify(plan)).not.toContain("admin@");

    const logs: string[] = [];
    const events: ProgressEvent[] = [];
    const { report, dir } = await runPlan(plan, { checks, runsDir, log: (line) => logs.push(line), onProgress: (e) => events.push(e) });

    // The run's browser contexts got past the password too.
    const result = report.results.find((r) => r.scenarioId === "dc:1")!;
    expect(result.notes).toBe('Saw "Preview fixture"');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.meaning).toBe(`Seen on http://127.0.0.1:${port}/book`);

    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(await readFile(join(dir, "specs", "fake.spec.ts"), "utf8")).toBe(`await page.goto("http://127.0.0.1:${port}/book");\n`);
    expect(await allText(dir)).not.toContain(PASSWORD);
    expect(logs.join("\n")).not.toContain(PASSWORD);
    expect(JSON.stringify(events.filter((e) => e.type !== "frame"))).not.toContain(PASSWORD);
  }, 60_000);

  it("remembers the password for that origin while Run Hound runs, so planning the plain target again works (a rerun)", async () => {
    const port = new URL(server.url).port;
    await discoverAndPlan(`http://admin:${PASSWORD}@127.0.0.1:${port}/book`, { checks: fakeChecks() });
    const again = await discoverAndPlan(`http://127.0.0.1:${port}/book`, { checks: fakeChecks() });
    expect(again.form.fields.map((f) => f.key)).toEqual(["petName"]);
  }, 60_000);

  it("without a password, a password-protected page is a 401, as before", async () => {
    // "localhost" is another origin than 127.0.0.1, so nothing is remembered for it.
    const port = new URL(server.url).port;
    await expect(discoverAndPlan(`http://localhost:${port}/book`, { checks: fakeChecks() })).rejects.toThrow(/answered 401/);
  }, 60_000);
});
