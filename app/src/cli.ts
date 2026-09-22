#!/usr/bin/env tsx
/**
 * run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
 * run-hound run <url> [--approve all|default|<id,id>] [--allow-destructive] [--runs-dir <dir>] [--json]
 *   Exit code: 0 no findings, 1 findings, 2 error (including a refused target).
 * With --json, stdout carries exactly one JSON document (the report); progress and errors go to stderr.
 */
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { redactSecrets } from "./engine/redact.js";
import { discoverAndPlan, runPlan } from "./engine/runner.js";
import { createApp } from "./server/app.js";

const USAGE = `Usage:
  run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
  run-hound run <url> [--approve all|default|<id,id>] [--allow-destructive] [--runs-dir <dir>] [--json]`;

class UsageError extends Error {}

/** Reports an error (secrets redacted) and sets exit code 2; exitCode (not exit()) lets piped stdout/stderr flush first. */
function fail(message: string): void {
  process.stderr.write(`run-hound: ${redactSecrets(message)}\n`);
  process.exitCode = 2;
}

async function runCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      approve: { type: "string", default: "default" },
      "allow-destructive": { type: "boolean", default: false },
      "runs-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const url = positionals[0];
  if (!url || positionals.length > 1) throw new UsageError("run needs exactly one URL");

  const log = (line: string) => process.stderr.write(`${redactSecrets(line)}\n`);
  const plan = await discoverAndPlan(url);
  log(`Found ${plan.form.name ? `"${plan.form.name}"` : "a form"} with ${plan.form.fields.length} fields; ${plan.scenarios.length} scenarios planned.`);

  let approved: string[] | undefined;
  if (values.approve === "all") approved = plan.scenarios.map((s) => s.id);
  else if (values.approve !== "default") {
    approved = values.approve.split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = approved.filter((id) => !plan.scenarios.some((s) => s.id === id));
    if (unknown.length) throw new UsageError(`unknown scenario id(s): ${unknown.join(", ")}`);
  }

  const { report, dir } = await runPlan(plan, {
    approved,
    allowDestructive: values["allow-destructive"],
    runsDir: values["runs-dir"],
    onProgress: (e) => {
      if (e.type === "scenario-start") log(`[${e.index + 1}/${e.total}] ${e.scenarioId}`);
      else log(`  ${e.result.status}${e.result.findings.length ? ` (${e.result.findings.length} findings)` : ""}`);
    },
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
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
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string", default: "4000" },
      host: { type: "string", default: "127.0.0.1" },
      "runs-dir": { type: "string" },
    },
  });
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
    if (command === "--help" || command === "-h") {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    throw new UsageError(command ? `unknown command: ${command}` : "missing command");
  } catch (err) {
    if (err instanceof UsageError) fail(`${err.message}\n${USAGE}`);
    // Refused targets, pages without a form and other failures all exit 2 with a one-line reason.
    else fail(err instanceof Error ? err.message : String(err));
  }
}

await main(process.argv.slice(2));
