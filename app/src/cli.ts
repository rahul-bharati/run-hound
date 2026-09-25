#!/usr/bin/env tsx
/**
 * run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
 * run-hound run <url> [--approve all|default|<id,id>] [--allow-destructive] [--headed] [--runs-dir <dir>] [--json] [--plan-only]
 *   --headed opens a visible Chromium window so you can watch. Progress lines on stderr name each step and page URL.
 *   --plan-only prints the planned scenarios (with the ids --approve takes) and exits 0 without running anything.
 *   Exit code: 0 no confirmed findings (advisory findings are reported but don't fail the run), 1 at least one
 *   confirmed finding, 2 error (including a refused target, an unreachable page and an empty approval).
 * With --json, stdout carries exactly one JSON document (the report, or the plan with --plan-only); progress, the run
 * folder and errors go to stderr.
 * run-hound help | --help | -h, run-hound --version (also run --version, serve --version)
 */
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { redactSecrets } from "./engine/redact.js";
import { formatDuration } from "./core/format.js";
import { findingCounts, finishedIn, testDataSentence } from "./engine/report.js";
import { canShowBrowser, discoverAndPlan, NO_DISPLAY_MESSAGE, NothingToRunError, planWarnings, RUN_HOUND_VERSION, runPlan } from "./engine/runner.js";
import { planSummary } from "./engine/plan.js";
import { exitQuietlyOnClosedPipe } from "./engine/stdio.js";
import { createApp } from "./server/app.js";

/** "1 field", "9 fields". */
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const USAGE = `Usage:
  run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
      Web UI and API. Open the printed address, enter your form's URL, approve the plan and watch the run.
  run-hound run <url> [options]
      Plan and run the checks against a form on your local app, e.g. http://localhost:5173/signup.
      --approve all|default|<id,id>   which scenarios to run (default: the recommended ones)
      --plan-only                     list the planned scenarios and their ids, then stop
      --allow-destructive             also run scenarios that may change or delete data
      --headed                        open a visible browser window so you can watch the run
      --runs-dir <dir>                where run folders go (default: ./runs)
      --json                          print the report (or the plan) as JSON on stdout
  run-hound help | --version

Exit codes for run:
  0  no confirmed findings (advisory findings, which rely on judgement, are reported but don't fail the run)
  1  at least one confirmed finding
  2  an error: a refused or unreachable target, no form found, or bad arguments

Run Hound only tests local and private-network addresses (localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x,
fc00::/7, link-local); add other hosts you own to RUNHOUND_ALLOWED_HOSTS. Scenarios that submit the form create
test records in your app; the report says how many. Run Hound does not delete them.`;

const VERSION = RUN_HOUND_VERSION;

class UsageError extends Error {}

/** parseArgs with its errors (unknown option, missing value) turned into usage errors. */
function parse<R>(run: () => R): R {
  try {
    return run();
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code.startsWith("ERR_PARSE_ARGS")) throw new UsageError((err as Error).message);
    throw err;
  }
}

/** Reports an error (secrets redacted) and sets exit code 2; exitCode (not exit()) lets piped stdout/stderr flush first. */
function fail(message: string): void {
  process.stderr.write(`run-hound: ${redactSecrets(message)}\n`);
  process.exitCode = 2;
}

async function runCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(() => parseArgs({
    args,
    allowPositionals: true,
    options: {
      approve: { type: "string", default: "default" },
      "allow-destructive": { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      "runs-dir": { type: "string" },
      json: { type: "boolean", default: false },
      "plan-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`run-hound ${VERSION}\n`);
    return 0;
  }
  const url = positionals[0];
  if (!url || positionals.length > 1) throw new UsageError("run needs exactly one URL");

  const log = (line: string) => process.stderr.write(`${redactSecrets(line)}\n`);
  const headed = values.headed;
  // Discovery runs headless without a display; the gate still judges the target first, so a refused target is
  // reported as refused, and only then is --headed refused.
  const plan = await discoverAndPlan(url, { headed: headed && canShowBrowser() });
  if (headed && !canShowBrowser()) throw new Error(`--headed: ${NO_DISPLAY_MESSAGE}`);
  log(planSummary(plan));
  for (const warning of planWarnings(plan)) log(`Warning: ${warning}`);

  if (values["plan-only"]) {
    if (values.json) process.stdout.write(`${JSON.stringify(JSON.parse(redactSecrets(JSON.stringify(plan))))}\n`);
    else {
      process.stdout.write(`Scenarios for ${redactSecrets(plan.target)} (* = run by default; pass ids to --approve):\n`);
      for (const group of plan.groups) {
        process.stdout.write(`\n${group.label} (${count(group.scenarioIds.length, "scenario")})\n`);
        for (const id of group.scenarioIds) {
          const s = plan.scenarios.find((x) => x.id === id);
          if (!s) continue;
          const tags = [s.kind, s.destructive ? "destructive" : ""].filter(Boolean).join(", ");
          const scope = s.scopeLabel ? ` [${redactSecrets(s.scopeLabel)}]` : "";
          process.stdout.write(`  ${s.defaultSelected ? "*" : " "} ${s.id}  ${redactSecrets(s.title)} (${tags})${scope}\n`);
          // What the scenario does, including whether it creates test records in the app, before anyone approves it.
          process.stdout.write(`      ${redactSecrets(s.description)}\n`);
        }
      }
    }
    return 0;
  }

  let approved: string[] | undefined;
  if (values.approve === "all") approved = plan.scenarios.map((s) => s.id);
  else if (values.approve !== "default") {
    approved = values.approve.split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = approved.filter((id) => !plan.scenarios.some((s) => s.id === id));
    if (unknown.length) throw new UsageError(`unknown scenario id(s): ${unknown.join(", ")} (see them with --plan-only)`);
    if (approved.length === 0) throw new UsageError("--approve names no scenarios; nothing would run (see the ids with --plan-only)");
  }

  let lastPage = "";
  const { report, dir } = await runPlan(plan, {
    approved,
    allowDestructive: values["allow-destructive"],
    runsDir: values["runs-dir"],
    headed,
    onProgress: (e) => {
      if (e.type === "group-start") {
        log(`== ${e.label} (${count(e.scenarios, "scenario")}; group ${e.index + 1} of ${e.total}) ==`);
      } else if (e.type === "scenario-start") {
        lastPage = "";
        log(`[${e.index + 1}/${e.total}] ${e.scenarioId}`);
      } else if (e.type === "scenario-end") {
        const n = e.result.findings.length;
        // Skip notes start with "Skipped: " so they read on their own in the report; don't say it twice here.
        const why = e.result.status === "skipped" && e.result.notes ? `: ${e.result.notes.replace(/^Skipped:\s*/i, "")}` : "";
        log(`  ${e.result.status}${n ? ` (${count(n, "finding")})` : ""}${why} · ${formatDuration(Math.max(0, e.result.durationMs || 0))}`);
      } else if (e.type === "step") {
        log(`  ${e.scenarioId ? "·" : "-"} ${e.label}  ${e.url}`);
      } else if (e.type === "page" && e.url !== lastPage) {
        // Only when the page changes, so reloads of the same URL don't flood the terminal.
        lastPage = e.url;
        log(`  > page ${e.url}`);
      }
    },
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    log(`Run folder: ${dir}`);
  } else {
    const s = report.summary;
    process.stdout.write(`${finishedIn(report) ?? "Finished"}.\n`);
    for (const g of report.groups) {
      process.stdout.write(
        `  ${g.label}: ${g.passed} passed, ${g.failed} failed, ${g.errored} errored, ${g.skipped} skipped; ${count(g.findings, "finding")}; ${formatDuration(g.durationMs)}\n`,
      );
    }
    process.stdout.write(
      `${findingCounts(report.findings)}; critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}. ` +
        `Scenarios: ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped.\n`,
    );
    for (const f of report.findings) {
      const places = f.locations && f.locations.length > 1 ? ` [${f.locations.length} places]` : "";
      process.stdout.write(`  [${f.severity}${f.confidence === "advisory" ? ", advisory" : ""}] ${f.title} (${f.checkId})${places}\n`);
    }
    const testData = testDataSentence(report);
    if (testData) process.stdout.write(`${testData}\n`);
    process.stdout.write(`Report: ${dir}/report.html\n`);
  }
  if (report.summary.errored > 0) {
    log(`Note: ${count(report.summary.errored, "scenario")} errored and tested nothing; see "Checks that errored" in the report.`);
  }
  // Advisory findings rely on judgement: they are reported but never fail the run.
  return report.findings.some((f) => f.confidence === "confirmed") ? 1 : 0;
}

function serveCommand(args: string[]): void {
  const { values, positionals } = parse(() => parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      port: { type: "string", default: "4000" },
      host: { type: "string", default: "127.0.0.1" },
      "runs-dir": { type: "string" },
      version: { type: "boolean", short: "v", default: false },
    },
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`run-hound ${VERSION}\n`);
    return;
  }
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`invalid port: ${values.port}`);

  // Bound to a public interface, the UI and API are reachable by anyone who can route to this machine.
  if (!/^(127\.|localhost$|::1$|\[::1\]$)/.test(values.host)) {
    process.stderr.write(
      `run-hound: warning: serving on ${values.host}, not just localhost. Anyone who can reach this address can start runs.\n`,
    );
  }
  const app = createApp({ runsDir: values["runs-dir"] });
  const server = serve({ fetch: app.fetch, port, hostname: values.host }, (info) => {
    const host = info.address.includes(":") ? `[${info.address}]` : info.address;
    process.stdout.write(`Run Hound listening on http://${host}:${info.port}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  try {
    if (command === "serve") return serveCommand(rest);
    if (command === "run") {
      process.exitCode = await runCommand(rest);
      return;
    }
    if (command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      process.stdout.write(`run-hound ${VERSION}\n`);
      return;
    }
    throw new UsageError(command ? `unknown command: ${command}` : "missing command");
  } catch (err) {
    if (err instanceof UsageError) fail(`${err.message}\n${USAGE}`);
    else if (err instanceof NothingToRunError) fail(err.message);
    // Refused targets, pages without a form and other failures all exit 2 with a one-line reason.
    else fail(err instanceof Error ? err.message : String(err));
  }
}

exitQuietlyOnClosedPipe(process.stdout);
exitQuietlyOnClosedPipe(process.stderr);
await main(process.argv.slice(2));
