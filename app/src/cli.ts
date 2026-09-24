#!/usr/bin/env tsx
/**
 * run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
 * run-hound run <url> [--approve all|default|<id,id>] [--allow-destructive] [--headed] [--runs-dir <dir>] [--json] [--plan-only]
 *   --headed opens a visible Chromium window so you can watch. Progress lines on stderr name each step and page URL.
 *   --plan-only prints the planned scenarios (with the ids --approve takes) and exits 0 without running anything.
 *   Exit code: 0 no findings, 1 findings, 2 error (including a refused target, an unreachable page and an empty approval).
 * With --json, stdout carries exactly one JSON document (the report, or the plan with --plan-only); progress, the run
 * folder and errors go to stderr.
 * run-hound help | --help | -h, run-hound --version
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { redactSecrets } from "./engine/redact.js";
import { discoverAndPlan, NothingToRunError, runPlan } from "./engine/runner.js";
import { createApp } from "./server/app.js";

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

Exit codes for run: 0 no findings, 1 findings, 2 error.`;

const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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
    },
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const url = positionals[0];
  if (!url || positionals.length > 1) throw new UsageError("run needs exactly one URL");

  const log = (line: string) => process.stderr.write(`${redactSecrets(line)}\n`);
  const headed = values.headed;
  const plan = await discoverAndPlan(url, { headed });
  log(`Found ${plan.form.name ? `"${plan.form.name}"` : "a form"} with ${plan.form.fields.length} fields; ${plan.scenarios.length} scenarios planned.`);

  if (values["plan-only"]) {
    if (values.json) process.stdout.write(`${JSON.stringify(JSON.parse(redactSecrets(JSON.stringify(plan))))}\n`);
    else {
      process.stdout.write(`Scenarios for ${redactSecrets(plan.target)} (* = run by default; pass ids to --approve):\n`);
      for (const s of plan.scenarios) {
        const tags = [s.kind, s.destructive ? "destructive" : ""].filter(Boolean).join(", ");
        process.stdout.write(`  ${s.defaultSelected ? "*" : " "} ${s.id}  ${redactSecrets(s.title)} (${tags})\n`);
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
      if (e.type === "scenario-start") {
        lastPage = "";
        log(`[${e.index + 1}/${e.total}] ${e.scenarioId}`);
      } else if (e.type === "scenario-end") {
        log(`  ${e.result.status}${e.result.findings.length ? ` (${e.result.findings.length} findings)` : ""}`);
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
    process.stdout.write(
      `${report.findings.length} findings (critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}); ` +
        `${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped.\n`,
    );
    for (const f of report.findings) process.stdout.write(`  [${f.severity}] ${f.title} (${f.checkId})\n`);
    process.stdout.write(`Report: ${dir}/report.html\n`);
  }
  return report.findings.length > 0 ? 1 : 0;
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
    },
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
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

await main(process.argv.slice(2));
