import { parseArgs } from "node:util";
import { USAGE } from "../../constants/cli-constants.js";
import { UsageError } from "../../errors/usage-error.js";
import { parseArgsWithError } from "../../utils/parse-args-with-errors.js";
import { RUN_OPTIONS } from "../../config/cli.js";
import {
  NO_DISPLAY_MESSAGE,
  RUN_HOUND_VERSION,
} from "../../engine/runner.js";
import { planWarnings } from "../../engine/runner.js";
import { planSummary } from "../../engine/plan.js";
import type { AiSession } from "../../ai/session.js";
import { notReadyMessage } from "../../config/accounts.js";
import { isAccountId, usernameHider, hideInJson } from "../../server/accounts.js";
import { printVersion } from "../adapters/terminal.js";
import { aiFlagsFrom } from "../flags.js";
import { aiRemedy } from "../presenters/ai.js";
import { modelOf, planAsJson, nothingTested, planOnlyLines, reportLines } from "../presenters/run.js";
import { count } from "../../utils/count.js";
import { formatDuration } from "../../core/format.js";
import { redactSecrets } from "../../engine/redact.js";
import type { ICliContext, IRunCommandDeps } from "../../interfaces/cli.js";
import type { AccountRef } from "../../core/types.js";
import type { AccountsConfig } from "../../interfaces/accounts.js";

export async function runCommand(args: string[], deps: IRunCommandDeps): Promise<number> {
  const { values, positionals } = parseArgsWithError(() =>
    parseArgs({ args, allowPositionals: true, options: RUN_OPTIONS, allowNegative: true }),
  );
  const v = values;
  if (v.help) {
    deps.context.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (v.version) {
    printVersion(deps.context.stdout, RUN_HOUND_VERSION);
    return 0;
  }
  const url = positionals[0];
  if (!url || positionals.length > 1) throw new UsageError("run needs exactly one URL");
  const signInAs = v.as;
  if (signInAs !== undefined && !isAccountId(signInAs))
    throw new UsageError(`--as takes a or b (the test account to sign in as), not "${signInAs.slice(0, 20)}"`);

  // log: stderr, redactSecrets + hider. write: stdout, hider only.
  const log = (line: string) => deps.context.stderr.write(`${hide(deps, line)}\n`);
  const write = (text: string) => deps.context.stdout.write(deps.context.accountHider(text));
  const headed = v.headed;

  // Account settled before anything is opened or sent.
  let accounts: AccountsConfig | undefined;
  if (signInAs) {
    const { config, status } = await deps.services.resolveAccounts();
    const why = notReadyMessage(status.accounts[signInAs]);
    if (why) throw new Error(why);
    deps.services.registerPasswords(config);
    deps.context.setAccountHider(usernameHider(config));
    accounts = config;
  }

  // AI settled before anything is opened or sent.
  let ai: AiSession | undefined;
  const flags = aiFlagsFrom(values);
  const resolved = await deps.services.resolveAiConfig({ flags });
  if (resolved.config.enabled) {
    const out = deps.services.aiSession(resolved);
    if ("session" in out) ai = out.session;
    else if (v.ai === true)
      throw new Error(`--ai: ${out.problem}.${aiRemedy(out.status)}`);
    else log(`Warning: AI is not used: ${out.problem}.${aiRemedy(out.status)}`);
  }

  const plan = await deps.services.discoverAndPlan(url, {
    headed: headed && deps.services.canShowBrowser(),
    ...(ai ? { ai } : {}),
    ...(signInAs && accounts ? { signInAs, accounts } : {}),
    onProgress: (e) => {
      if (e.type === "step" && e.label.startsWith("Asking ")) log(`- ${e.label}`);
    },
  });
  if (headed && !deps.services.canShowBrowser()) throw new Error(`--headed: ${NO_DISPLAY_MESSAGE}`);
  const account: AccountRef | undefined =
    plan.account ??
    (signInAs && accounts ? { id: signInAs, label: accounts.accounts[signInAs].label } : undefined);
  const summary = planSummary(plan);
  log(
    account && !summary.includes("Signed in as")
      ? `Signed in as ${account.label}. ${summary}`
      : summary,
  );
  for (const warning of planWarnings(plan)) log(`Warning: ${warning}`);
  if (plan.ai) {
    const suggested = plan.ai.suggested
      ? `; ${count(plan.ai.suggested, "suggested flow")} (not run unless approved)`
      : "";
    log(
      `AI: ${plan.ai.reviewed ? "plan reviewed" : "plan not reviewed"} by ${modelOf(plan.ai)}${plan.ai.remote ? " (remote)" : ""}${suggested}`,
    );
    for (const warning of plan.ai.warnings) log(`Warning: AI: ${warning}`);
  }

  if (v["plan-only"]) {
    if (v.json) deps.context.stdout.write(planAsJson(plan, deps.context.accountHider));
    else for (const line of planOnlyLines({ plan, account })) write(line);
    return 0;
  }

  let approved: string[] | undefined;
  if (v.approve === "all") approved = plan.scenarios.map((s) => s.id);
  else if (v.approve !== undefined && v.approve !== "default") {
    approved = v.approve.split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = approved.filter((id) => !plan.scenarios.some((s) => s.id === id));
    if (unknown.length)
      throw new UsageError(`unknown scenario id(s): ${unknown.join(", ")} (see them with --plan-only)`);
    if (approved.length === 0)
      throw new UsageError("--approve names no scenarios; nothing would run (see the ids with --plan-only)");
  }

  let lastPage = "";
  const { report, dir } = await deps.services.runPlan(plan, {
    approved,
    allowDestructive: v["allow-destructive"],
    runsDir: v["runs-dir"],
    headed,
    ...(ai ? { ai } : {}),
    ...(accounts ? { accounts } : {}),
    onProgress: (e) => {
      if (e.type === "group-start") {
        log(`== ${e.label} (${count(e.scenarios, "scenario")}; group ${e.index + 1} of ${e.total}) ==`);
      } else if (e.type === "scenario-start") {
        lastPage = "";
        log(`[${e.index + 1}/${e.total}] ${e.scenarioId}`);
      } else if (e.type === "scenario-end") {
        const n = e.result.findings.length;
        const why =
          e.result.status === "skipped" && e.result.notes
            ? `: ${e.result.notes.replace(/^Skipped:\s*/i, "")}`
            : "";
        log(
          `  ${e.result.status}${n ? ` (${count(n, "finding")})` : ""}${why} · ${formatDuration(Math.max(0, e.result.durationMs || 0))}`,
        );
      } else if (e.type === "step") {
        log(`  ${e.scenarioId ? "·" : "-"} ${e.label}  ${e.url}`);
      } else if (e.type === "page" && e.url !== lastPage) {
        lastPage = e.url;
        log(`  > page ${e.url}`);
      }
    },
  });

  if (v.json) {
    deps.context.stdout.write(
      `${JSON.stringify(accounts ? hideInJson(report, deps.context.accountHider) : report)}\n`,
    );
    log(`Run folder: ${dir}`);
  } else {
    for (const line of reportLines(report, dir)) write(line);
  }
  for (const warning of report.ai?.warnings ?? []) log(`Warning: AI: ${warning}`);
  const { passed, failed, errored, skipped } = report.summary;
  if (passed + failed === 0) {
    log(nothingTested(errored, skipped));
    return 2;
  }
  if (errored > 0) {
    log(`Note: ${count(errored, "scenario")} errored and tested nothing; see "Checks that errored" in the report.`);
  }
  return report.findings.some((f) => f.confidence === "confirmed") ? 1 : 0;
}

function hide(deps: { context: ICliContext }, text: string): string {
  return deps.context.accountHider(redactSecrets(text));
}
