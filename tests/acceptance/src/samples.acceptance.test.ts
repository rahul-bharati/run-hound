/**
 * Regression suite for the tester release (docs/v0-spec.md, "Tester release (0.1.0)" > "Unfamiliar apps").
 *
 * fixtures/samples/ holds four small, well-built apps Run Hound has never been tuned for: a classic HTML form that
 * posts and redirects, a vanilla-JS SPA, a login form, and a form whose API is on another origin. They are correct
 * and accessible on purpose, so ANY confirmed finding here is a false positive.
 *
 * For each sample: start it on free ports, discoverAndPlan, approve every scenario (allowDestructive false),
 * runPlan, then assert:
 *   - discovery found the form (its name and fields)
 *   - no scenario errored
 *   - zero confirmed findings
 *   - every skipped scenario says why, in plain language
 *   - report.pagesVisited is not empty
 *   - classic-post: the POST -> 303 -> thank-you flow is followed without tripping the navigation guard
 *
 * Env:
 *   ACCEPTANCE_SAMPLES=login,spa-fetch   run only these samples (default: all)
 *   KEEP_RUNS=1                          keep the runs/ directories (paths are printed)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { checks } from "../../../app/src/checks/index.js";
import { CHECK_IDS, type Report } from "../../../app/src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import { freePort, REPO_ROOT } from "./kennel.js";

const SAMPLES_DIR = join(REPO_ROOT, "fixtures/samples");

interface SampleSpec {
  name: string;
  /** Path of the form page on the sample's main port. */
  path: string;
  /** Extra ports the sample needs, by env var name (e.g. API_PORT). */
  extraPorts: string[];
  /** The discovered form's name must match this. */
  formName: RegExp;
  /** Field keys discovery must find. */
  fieldKeys: string[];
}

const SAMPLES: SampleSpec[] = [
  { name: "classic-post", path: "/signup", extraPorts: [], formName: /sign up/i, fieldKeys: ["name", "email", "company", "teamSize", "usage"] },
  { name: "spa-fetch", path: "/", extraPorts: [], formName: /contact us/i, fieldKeys: ["name", "email", "topic", "message"] },
  { name: "login", path: "/", extraPorts: [], formName: /sign in/i, fieldKeys: ["email", "password"] },
  { name: "cross-origin-api", path: "/", extraPorts: ["API_PORT"], formName: /rsvp/i, fieldKeys: ["name", "email", "attending", "guests", "dietary"] },
];

const only = process.env.ACCEPTANCE_SAMPLES?.split(",").map((s) => s.trim()).filter(Boolean);
const selected = only ? SAMPLES.filter((s) => only.includes(s.name)) : SAMPLES;
const keepRuns = process.env.KEEP_RUNS === "1";

interface SampleInstance {
  url: string;
  ports: Record<string, number>;
  output(): string;
  stop(): Promise<void>;
}

async function startSampleOnce(spec: SampleSpec, timeoutMs: number): Promise<SampleInstance> {
  const ports: Record<string, number> = { PORT: await freePort() };
  for (const key of spec.extraPorts) {
    let p = await freePort();
    while (Object.values(ports).includes(p)) p = await freePort();
    ports[key] = p;
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(ports)) env[k] = String(v);

  const child: ChildProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: join(SAMPLES_DIR, spec.name),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const exited = new Promise<void>((res) => child.once("exit", () => res()));

  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`${spec.name} did not print "listening" within ${timeoutMs} ms.\n${out}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (/listening/.test(out)) {
        clearTimeout(timer);
        res();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      rej(err);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      rej(new Error(`${spec.name} exited early (code ${code}, signal ${signal}).\n${out}`));
    });
  });

  return {
    url: `http://localhost:${ports.PORT}${spec.path}`,
    ports,
    output: () => out,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Starts a sample on free ports; retries when a port was taken in between. */
async function startSample(spec: SampleSpec): Promise<SampleInstance> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await startSampleOnce(spec, 15_000);
    } catch (err) {
      last = err;
      if (!(err instanceof Error) || !/EADDRINUSE/.test(err.message)) break;
    }
  }
  throw last;
}

/** One line per scenario and finding, printed for every sample so a failure shows the whole picture. */
function describeReport(name: string, report: Report): string {
  const lines = [`[samples] ${name}: ${report.target}`];
  for (const r of report.results) {
    lines.push(`  ${r.status.padEnd(7)} ${r.scenarioId}${r.notes ? ` - ${r.notes}` : ""}`);
    for (const f of r.findings) {
      lines.push(`           ${f.confidence} ${f.severity} "${f.title}"${f.location ? ` @ ${f.location}` : ""}`);
    }
  }
  lines.push(`  pages: ${(report.pagesVisited ?? []).map((p) => p.url).join(", ") || "(none)"}`);
  return lines.join("\n");
}

/** Notes a person can read: not empty, and not a stack trace, a raw error class or a Playwright call log. */
const TECHNICAL = /\n\s+at |\b(TypeError|ReferenceError|SyntaxError|TimeoutError)\b|Call log:|locator\(|page\.\w+:|undefined|\[object Object\]/;

let runsRoot: string;

beforeAll(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), "rh-samples-"));
});

afterAll(async () => {
  if (!runsRoot) return;
  if (keepRuns) console.log(`[samples] runs kept in ${runsRoot}`);
  else await rm(runsRoot, { recursive: true, force: true });
});

describe.concurrent("Run Hound on unfamiliar, well-built sample apps", () => {
  it.for(selected)("$name: zero confirmed findings, nothing errored", async (spec, { expect }) => {
    const sample = await startSample(spec);
    try {
      const plan = await discoverAndPlan(sample.url, { checks });
      expect(plan.form.name, "discovered form name").toMatch(spec.formName);
      const keys = plan.form.fields.map((f) => f.key);
      expect(spec.fieldKeys.filter((k) => !keys.includes(k)), `fields discovery missed (found ${keys.join(", ")})`).toEqual([]);

      // A check with nothing to test on this form (no password field, no extra buttons) may plan nothing; the report
      // lists it under "nothing to test". Printed, not asserted.
      const planned = new Set(plan.scenarios.map((s) => s.checkId));
      const unplanned = CHECK_IDS.filter((id) => !planned.has(id));

      const approved = plan.scenarios.map((s) => s.id);
      const { report } = await runPlan(plan, { checks, approved, allowDestructive: false, runsDir: join(runsRoot, spec.name), log: () => undefined });
      console.log(`${describeReport(spec.name, report)}\n  nothing to test: ${unplanned.join(", ") || "(none)"}`);

      expect.soft(
        report.results.filter((r) => r.status === "error").map((r) => `${r.scenarioId}: ${r.notes ?? "(no notes)"}`),
        "errored scenarios",
      ).toEqual([]);

      expect.soft(
        report.findings.filter((f) => f.confidence === "confirmed").map((f) => `${f.checkId}: ${f.title}`),
        "confirmed findings on a well-built app (false positives)",
      ).toEqual([]);

      expect.soft(
        report.results
          .filter((r) => r.status === "skipped")
          .filter((r) => !r.notes || r.notes.trim().length < 10 || TECHNICAL.test(r.notes))
          .map((r) => `${r.scenarioId}: ${JSON.stringify(r.notes ?? null)}`),
        "skipped scenarios without a plain-language reason",
      ).toEqual([]);

      expect.soft(report.pagesVisited ?? [], "pagesVisited").not.toEqual([]);

      if (spec.name === "classic-post") {
        // The form posts and the server answers 303 -> /signup/thanks/<id> on the same origin. That is the app working,
        // not the page leaving the target: nothing may be blocked or stopped by the navigation guard.
        expect.soft(
          report.results
            .filter((r) => /left the target|not allowed to test|navigation\(s\) off the target/i.test(r.notes ?? ""))
            .map((r) => `${r.scenarioId}: ${r.notes}`),
          "scenarios stopped by the navigation guard",
        ).toEqual([]);
        const visited = (report.pagesVisited ?? []).map((p) => new URL(p.url).pathname);
        expect.soft(visited.filter((p) => p.startsWith("/signup/thanks/")), "thank-you page reached after a valid submit").not.toEqual([]);
      }
    } finally {
      await sample.stop();
    }
  });
});
