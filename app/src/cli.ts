#!/usr/bin/env tsx
/**
 * run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
 * run-hound run <url> [--approve all|default|<id,id>] [--allow-destructive] [--headed] [--runs-dir <dir>] [--json] [--plan-only]
 *   --headed opens a visible Chromium window so you can watch. Progress lines on stderr name each step and page URL.
 *   --plan-only prints the planned scenarios (with the ids --approve takes) and exits 0 without running anything.
 *   Exit code: 0 no confirmed findings (advisory findings are reported but don't fail the run), 1 at least one
 *   confirmed finding, 2 error (including a refused target, an unreachable page and an empty approval) or a run that
 *   tested nothing (every approved scenario errored or was skipped).
 * With --json, stdout carries exactly one JSON document (the report, or the plan with --plan-only); progress, the run
 * folder and errors go to stderr.
 *   AI (docs/ai-spec.md, off by default): --ai / --no-ai, --ai-provider, --ai-model, --ai-base-url, --ai-allow-remote
 *   override the saved config and RUNHOUND_AI_* env. With AI the plan is reviewed and extended with suggested flows,
 *   and findings get advisory explanations. --ai with an endpoint that can't be used (a remote one without consent,
 *   no model) is exit 2 before anything is sent; AI enabled only by the config or env falls back to no AI with a warning.
 *   Test accounts (docs/v2-spec.md, 0.4.0): --as a|b signs in as that account before discovery and runs every
 *   scenario signed in (a fresh session per run). An account that isn't set up, or a failed sign-in, is exit 2 before
 *   any scenario runs; the plan summary says "Signed in as <label>".
 * run-hound ai status [--ai-* flags]   the resolved AI settings (never the key), exit 0
 * run-hound ai test [--ai-* flags]     one tiny call to the model: exit 0 and "ok", or exit 1 with the reason
 * run-hound accounts status             both test accounts: label, sign-in page, username, whether a password is saved,
 *                                       where each value comes from (file, env, default), isolated, the file; exit 0
 * run-hound accounts test [a|b]         signs in (both slots when none is named) and prints the page it landed on or
 *                                       why it failed: exit 0 when every tested slot signed in, 2 otherwise
 * run-hound accounts set a|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]
 *                                       saves a slot (omitted values are kept); the password only ever from stdin
 * run-hound accounts clear a|b          removes a slot from accounts.json
 * Nothing the CLI prints holds a password.
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
import { testConnection } from "./ai/client.js";
import { aiStatus, resolveAiConfig, type AiFlags } from "./ai/config.js";
import { flowStepWords } from "./ai/describe.js";
import { aiSession, type AiSession } from "./ai/session.js";
import { AI_PROVIDERS, type AiProvider, type AiStatus } from "./ai/types.js";
import { formOfScenario } from "./engine/plan.js";
import { accountEnvName, clearAccount, checkAccountsPatch, notReadyMessage, resolveAccounts, saveAccounts } from "./accounts/config.js";
import { ACCOUNT_IDS, type AccountSource, type AccountStatus, type AccountsConfig, type AccountsPatch, type AccountsStatus } from "./accounts/types.js";
import type { AccountId, AccountRef } from "./core/types.js";
import { checkLoginUrls, hideInJson, isAccountId, registerPasswords, testSignIn, usernameHider } from "./server/accounts.js";

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
      --ai / --no-ai                  use the AI model to review the plan, suggest flows and explain findings
                                      (off unless turned on here, in Settings or with RUNHOUND_AI=1)
      --ai-provider <name>            ollama, openai-compatible or bedrock
      --ai-model <id>                 model id, e.g. ornith-1.5:9b
      --ai-base-url <url>             e.g. http://127.0.0.1:11434/v1
      --ai-allow-remote               consent to send redacted page structure to a non-local endpoint
      --as a|b                        sign in as test account A or B first and run every check signed in
                                      (set the accounts up with "accounts set" or in Settings → Test accounts)
  run-hound ai status | ai test [--ai-provider … --ai-model … --ai-base-url … --ai-allow-remote]
      Show the AI settings (never the key), or check that the model answers.
  run-hound accounts status | accounts test [a|b] | accounts clear a|b
  run-hound accounts set a|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]
      Two test accounts you own on your app (A and B), for signed-in runs and the access checks. The password is read
      from stdin (typed, or piped: printf '%s\n' "$PASSWORD" | run-hound accounts set a --password-stdin), never
      from a flag. "accounts test" signs in and says where it landed. RUNHOUND_ACCOUNT_A_LOGIN_URL, …_USERNAME,
      …_PASSWORD, …_LABEL (and _B_) override the saved values.
  run-hound help | --version

Exit codes for run:
  0  no confirmed findings (advisory findings, which rely on judgement, are reported but don't fail the run)
  1  at least one confirmed finding
  2  an error: a refused or unreachable target, no form found, bad arguments, --ai when AI can't be used, or --as with
     an account that isn't set up or can't sign in; or a run where nothing was tested because every approved
     scenario errored or was skipped

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

/** parseArgs options shared by `run` and `ai`: overrides of the AI config. */
const AI_OPTIONS = {
  ai: { type: "boolean" },
  "ai-provider": { type: "string" },
  "ai-model": { type: "string" },
  "ai-base-url": { type: "string" },
  "ai-allow-remote": { type: "boolean" },
} as const;

/** The --ai-* values as config flags; an unknown provider is a usage error. */
function aiFlags(values: { ai?: boolean; "ai-provider"?: string; "ai-model"?: string; "ai-base-url"?: string; "ai-allow-remote"?: boolean }): AiFlags {
  const provider = values["ai-provider"];
  if (provider !== undefined && !(AI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new UsageError(`unknown --ai-provider "${provider}" (use ${AI_PROVIDERS.join(", ")})`);
  }
  const flags: AiFlags = {};
  if (values.ai !== undefined) flags.enabled = values.ai;
  if (provider !== undefined) flags.provider = provider as AiProvider;
  if (values["ai-model"] !== undefined) flags.model = values["ai-model"];
  if (values["ai-base-url"] !== undefined) flags.baseUrl = values["ai-base-url"];
  if (values["ai-allow-remote"]) flags.allowRemote = true;
  return flags;
}

/** How to fix an AI problem from the command line, appended to its reason. */
function aiRemedy(status: AiStatus): string {
  if (status.remote && !status.allowRemote && status.problem?.includes("consent")) {
    return ` Nothing was sent. Pass --ai-allow-remote (or set RUNHOUND_AI_ALLOW_REMOTE=1) to send redacted page structure to ${status.host}, or use a local endpoint.`;
  }
  if (status.problem === "Choose a model") return " Pass --ai-model <id> or set RUNHOUND_AI_MODEL.";
  return "";
}

/**
 * The line that explains exit 2 for a run where no scenario passed or failed, e.g. "Nothing was tested: all 17
 * scenarios errored (see "Checks that errored" in the report)."
 */
function nothingTested(errored: number, skipped: number): string {
  const total = errored + skipped;
  const all = total === 1 ? "the only scenario" : total === 2 ? "both scenarios" : `all ${total} scenarios`;
  if (skipped === 0) return `Nothing was tested: ${all} errored (see "Checks that errored" in the report).`;
  if (errored === 0) return `Nothing was tested: ${all} ${total === 1 ? "was" : "were"} skipped (the report says why).`;
  return `Nothing was tested: ${count(errored, "scenario")} errored and ${skipped} ${skipped === 1 ? "was" : "were"} skipped (the report says why).`;
}

/** "ollama/ornith-1.5:9b". */
const modelOf = (s: { provider: string; model: string }): string => `${s.provider}/${s.model}`;

/**
 * Hides the test accounts' usernames in everything `run --as` prints (usernameHider): they are shown only by
 * `accounts status`. The identity until `run --as` sets it.
 */
let hideAccounts: (text: string) => string = (text) => text;

/** Reports an error (secrets redacted) and sets exit code 2; exitCode (not exit()) lets piped stdout/stderr flush first. */
function fail(message: string): void {
  process.stderr.write(`run-hound: ${hideAccounts(redactSecrets(message))}\n`);
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
      as: { type: "string" },
      ...AI_OPTIONS,
    },
    allowNegative: true,
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
  const signInAs = values.as;
  if (signInAs !== undefined && !isAccountId(signInAs)) throw new UsageError(`--as takes a or b (the test account to sign in as), not "${signInAs.slice(0, 20)}"`);

  const log = (line: string) => process.stderr.write(`${hideAccounts(redactSecrets(line))}\n`);
  const write = (text: string) => process.stdout.write(hideAccounts(text));
  const headed = values.headed;

  // The account is settled before anything is opened or sent: one that isn't set up is an error naming it. Its
  // password (and the other slot's, which the access checks may use) is hidden from everything printed from here on.
  let accounts: AccountsConfig | undefined;
  if (signInAs) {
    const { config, status } = await resolveAccounts();
    const why = notReadyMessage(status.accounts[signInAs]);
    if (why) throw new Error(why);
    registerPasswords(config);
    hideAccounts = usernameHider(config);
    accounts = config;
  }

  // AI is settled before anything is opened or sent: --ai that can't be used is an error; AI enabled only by the
  // saved config or env falls back to none, with a warning.
  let ai: AiSession | undefined;
  const flags = aiFlags(values);
  const resolved = await resolveAiConfig({ flags });
  if (resolved.config.enabled) {
    const out = aiSession(resolved);
    if ("session" in out) ai = out.session;
    else if (values.ai === true) throw new Error(`--ai: ${out.problem}.${aiRemedy(out.status)}`);
    else log(`Warning: AI is not used: ${out.problem}.${aiRemedy(out.status)}`);
  }

  // Discovery runs headless without a display; the gate still judges the target first, so a refused target is
  // reported as refused, and only then is --headed refused.
  const plan = await discoverAndPlan(url, {
    headed: headed && canShowBrowser(),
    ...(ai ? { ai } : {}),
    ...(signInAs && accounts ? { signInAs, accounts } : {}),
    onProgress: (e) => {
      if (e.type === "step" && /^Asking /.test(e.label)) log(`- ${e.label}`);
    },
  });
  if (headed && !canShowBrowser()) throw new Error(`--headed: ${NO_DISPLAY_MESSAGE}`);
  const account: AccountRef | undefined = plan.account ?? (signInAs && accounts ? { id: signInAs, label: accounts.accounts[signInAs].label } : undefined);
  const summary = planSummary(plan);
  log(account && !summary.includes("Signed in as") ? `Signed in as ${account.label}. ${summary}` : summary);
  for (const warning of planWarnings(plan)) log(`Warning: ${warning}`);
  if (plan.ai) {
    const suggested = plan.ai.suggested ? `; ${count(plan.ai.suggested, "suggested flow")} (not run unless approved)` : "";
    log(`AI: ${plan.ai.reviewed ? "plan reviewed" : "plan not reviewed"} by ${modelOf(plan.ai)}${plan.ai.remote ? " (remote)" : ""}${suggested}`);
    for (const warning of plan.ai.warnings) log(`Warning: AI: ${warning}`);
  }

  if (values["plan-only"]) {
    if (values.json) process.stdout.write(`${JSON.stringify(hideInJson(JSON.parse(redactSecrets(JSON.stringify(plan))) as unknown, hideAccounts))}\n`);
    else {
      const as = account ? `, signed in as ${redactSecrets(account.label)}` : "";
      write(`Scenarios for ${redactSecrets(plan.target)}${as} (* = run by default; pass ids to --approve):\n`);
      for (const group of plan.groups) {
        write(`\n${group.label} (${count(group.scenarioIds.length, "scenario")})\n`);
        for (const id of group.scenarioIds) {
          const s = plan.scenarios.find((x) => x.id === id);
          if (!s) continue;
          const tags = [s.kind, s.destructive ? "destructive" : ""].filter(Boolean).join(", ");
          const scope = s.scopeLabel ? ` [${redactSecrets(s.scopeLabel)}]` : "";
          const suggested = s.ai?.suggested || s.checkId === "ai-flow";
          const aiTag = suggested ? ", suggested by AI" : "";
          write(`  ${s.defaultSelected ? "*" : " "} ${s.id}  ${redactSecrets(s.title)} (${tags}${aiTag})${scope}\n`);
          // What the scenario does, including whether it creates test records in the app, before anyone approves it.
          write(`      ${redactSecrets(s.description)}\n`);
          if (suggested) {
            const form = formOfScenario(plan, s);
            for (const [i, step] of (s.flow ?? []).entries()) write(`        ${i + 1}. ${redactSecrets(flowStepWords(step, form))}\n`);
          } else if (s.ai) {
            write(`      AI: ${s.ai.recommended ? "recommended" : "not recommended"} — ${redactSecrets(s.ai.rationale)}\n`);
          }
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
    process.stdout.write(`${JSON.stringify(accounts ? hideInJson(report, hideAccounts) : report)}\n`);
    log(`Run folder: ${dir}`);
  } else {
    const s = report.summary;
    write(`${finishedIn(report) ?? "Finished"}.\n`);
    const signedInAs = report.accounts?.signedInAs;
    if (signedInAs) {
      const other = report.accounts?.other ? `; ${report.accounts.other.label} was used for the access checks` : "";
      write(`${redactSecrets(`Signed in as ${signedInAs.label}${other}`)}.\n`);
    }
    for (const g of report.groups) {
      write(
        `  ${g.label}: ${g.passed} passed, ${g.failed} failed, ${g.errored} errored, ${g.skipped} skipped; ${count(g.findings, "finding")}; ${formatDuration(g.durationMs)}\n`,
      );
    }
    write(
      `${findingCounts(report.findings)}; critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}. ` +
        `Scenarios: ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped.\n`,
    );
    for (const f of report.findings) {
      const places = f.locations && f.locations.length > 1 ? ` [${f.locations.length} places]` : "";
      write(`  [${f.severity}${f.confidence === "advisory" ? ", advisory" : ""}] ${f.title} (${f.checkId})${places}\n`);
    }
    if (report.ai) {
      write(`AI explanations (advisory) from ${modelOf(report.ai)} for ${count(report.ai.explained, "finding")}; see the report.\n`);
    }
    const testData = testDataSentence(report);
    if (testData) write(`${testData}\n`);
    write(`Report: ${dir}/report.html\n`);
  }
  for (const warning of report.ai?.warnings ?? []) log(`Warning: AI: ${warning}`);
  const { passed, failed, errored, skipped } = report.summary;
  // No scenario passed or failed (the app went down after discovery, every approved scenario was skipped): exit 0
  // would read as a clean pass in CI, like the empty approval refused above.
  if (passed + failed === 0) {
    log(nothingTested(errored, skipped));
    return 2;
  }
  if (errored > 0) {
    log(`Note: ${count(errored, "scenario")} errored and tested nothing; see "Checks that errored" in the report.`);
  }
  // Advisory findings rely on judgement: they are reported but never fail the run.
  return report.findings.some((f) => f.confidence === "confirmed") ? 1 : 0;
}

/** `run-hound ai status` and `run-hound ai test`. Returns the exit code. */
async function aiCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(() => parseArgs({
    args,
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h", default: false }, ...AI_OPTIONS },
    allowNegative: true,
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const [sub, ...extra] = positionals;
  if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]}`);
  const resolved = await resolveAiConfig({ flags: aiFlags(values) });
  const status = aiStatus(resolved);

  if (sub === "status") {
    const from = (field: keyof AiStatus["sources"]) => (status.sources[field] === "env" || status.sources[field] === "flag" ? ` (from ${status.sources[field]})` : "");
    const features = (Object.keys(status.features) as (keyof AiStatus["features"])[]).filter((f) => status.features[f]);
    const lines = [
      `AI: ${status.enabled ? "on" : "off"}${from("enabled")}`,
      `Provider: ${status.provider}${from("provider")}`,
      `Model: ${status.model || "(none)"}${from("model")}`,
      `Endpoint: ${status.baseUrl ? `${status.baseUrl}${from("baseUrl")} ` : ""}(${status.remote ? "remote" : "local"}: ${status.host})`,
      ...(status.provider === "bedrock" ? [`Region: ${status.region ?? "(none)"}${from("region")}`] : []),
      `Key: ${status.hasKey ? "set" : "not set"}${status.hasKey ? from("apiKey") : ""}`,
      ...(status.remote ? [`Consent to send to ${status.host}: ${status.allowRemote ? "yes" : "no"}${from("allowRemote")}`] : []),
      `Features: ${features.length ? features.join(", ") : "none"}${from("features")}`,
      `Timeout: ${formatDuration(status.timeoutMs)}${from("timeoutMs")}`,
      `Config file: ${status.file}`,
      status.problem ? `Problem: ${status.problem}.${aiRemedy(status)}` : "Ready.",
    ];
    process.stdout.write(`${redactSecrets(lines.join("\n"))}\n`);
    return 0;
  }
  if (sub === "test") {
    // Tests the settings even while AI is switched off, so they can be tried before turning it on.
    const result = await testConnection({ ...resolved.config, enabled: true });
    if (result.ok) {
      process.stdout.write(`ok: ${modelOf({ provider: status.provider, model: result.model })} answered in ${formatDuration(result.ms)}\n`);
      return 0;
    }
    process.stderr.write(`run-hound: AI test failed: ${redactSecrets(result.error)}${aiRemedy(status)}\n`);
    return 1;
  }
  throw new UsageError(sub ? `unknown ai command: ${sub} (use "ai status" or "ai test")` : 'ai needs a command: "ai status" or "ai test"');
}

/** " (file)", " (env: RUNHOUND_ACCOUNT_A_USERNAME)" or " (default)": where a value of an account came from. */
function sourceWords(id: AccountId, field: keyof AccountStatus["sources"], source: AccountSource): string {
  return source === "env" ? ` (env: ${accountEnvName(id, field)})` : ` (${source})`;
}

/** The lines `accounts status` prints for one slot. */
function slotLines(s: AccountStatus): string[] {
  // An empty value needs no "(default)" after it.
  const from = (field: keyof AccountStatus["sources"], empty: boolean) => (empty && s.sources[field] === "default" ? "" : sourceWords(s.id, field, s.sources[field]));
  return [
    `${s.label} (${s.id}): ${s.ready ? "ready" : "not set up"}`,
    `  Sign-in page: ${s.loginUrl || "(none)"}${from("loginUrl", !s.loginUrl)}`,
    `  Username:     ${s.username || "(none)"}${from("username", !s.username)}`,
    `  Password:     ${s.hasPassword ? "saved" : "not saved"}${from("password", !s.hasPassword)}`,
    `  Label:        ${s.label}${from("label", false)}`,
    ...(s.problem ? [`  Problem: ${s.problem}`] : []),
  ];
}

/** `accounts status`: both slots, isolated and the file. Usernames are shown here (and in Settings), never passwords. */
function accountsStatusText(status: AccountsStatus): string {
  const lines = ["Test accounts (for signed-in runs and the access checks):", ""];
  for (const id of ACCOUNT_IDS) lines.push(...slotLines(status.accounts[id]), "");
  lines.push(`A and B must not see each other's data (isolated): ${status.isolated ? "yes" : "no"} ${status.isolatedSource === "env" ? "(env: RUNHOUND_ACCOUNTS_ISOLATED)" : `(${status.isolatedSource})`}`);
  lines.push(`Accounts file: ${status.file}`);
  return lines.join("\n");
}

/** At most this much of stdin is read for --password-stdin. */
const MAX_STDIN = 64 * 1024;

/**
 * The password for --password-stdin: the first line of stdin. From a terminal it is typed without echo after a prompt
 * on stderr. Throws when there is none.
 */
async function readPassword(label: string): Promise<string> {
  const stdin = process.stdin;
  let text = "";
  if (stdin.isTTY) {
    process.stderr.write(`Password for ${label} (not shown): `);
    text = await new Promise<string>((resolvePassword, reject) => {
      let typed = "";
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      const done = (error?: Error) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stderr.write("\n");
        if (error) reject(error);
        else resolvePassword(typed);
      };
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
          if (ch === "\u0003") return done(new Error("Cancelled; nothing was saved."));
          if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
          else typed += ch;
        }
      };
      stdin.on("data", onData);
      stdin.resume();
    });
  } else {
    for await (const chunk of stdin) {
      text += String(chunk);
      if (text.length > MAX_STDIN || /\r?\n/.test(text)) break;
    }
  }
  const password = text.split(/\r?\n/)[0] ?? "";
  if (password === "") throw new Error("--password-stdin: no password was given on stdin, so nothing was saved.");
  return password;
}

/** `run-hound accounts status | test [a|b] | set a|b … | clear a|b`. Returns the exit code. */
async function accountsCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(() => parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      "login-url": { type: "string" },
      username: { type: "string" },
      label: { type: "string" },
      "password-stdin": { type: "boolean", default: false },
      // Known only to refuse it without echoing it: a password on the command line stays in the shell history.
      password: { type: "string" },
    },
  }));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (values.password !== undefined) {
    throw new UsageError("--password is not accepted: a password on the command line stays in your shell history. Use --password-stdin and type or pipe it instead; nothing was saved.");
  }
  const [sub, slot, ...extra] = positionals;
  const setOptions = values["login-url"] !== undefined || values.username !== undefined || values.label !== undefined || values["password-stdin"];
  if (sub !== "set" && setOptions) throw new UsageError("--login-url, --username, --label and --password-stdin go with \"accounts set a|b\"");
  if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]!.slice(0, 40)}`);
  const slotId = (what: string, optional = false): AccountId | undefined => {
    if (slot === undefined && optional) return undefined;
    if (isAccountId(slot)) return slot;
    throw new UsageError(slot === undefined ? `accounts ${what} needs the account: a or b` : `accounts ${what} takes a or b (the test account), not "${slot.slice(0, 20)}"`);
  };
  const safety = { allowedHosts: (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean) };

  if (sub === "status") {
    if (slot !== undefined) throw new UsageError(`unexpected argument: ${slot.slice(0, 40)}`);
    process.stdout.write(`${redactSecrets(accountsStatusText((await resolveAccounts()).status))}\n`);
    return 0;
  }

  if (sub === "test") {
    const only = slotId("test", true);
    const resolved = await resolveAccounts();
    let allOk = true;
    for (const id of only ? [only] : ACCOUNT_IDS) {
      const result = await testSignIn(id, resolved, safety);
      const label = resolved.status.accounts[id].label;
      const message = result.message.includes(label) ? result.message : `${label}: ${result.message}`;
      if (result.ok) process.stdout.write(`${redactSecrets(message)}\n`);
      else {
        allOk = false;
        process.stderr.write(`run-hound: ${redactSecrets(message)}\n`);
      }
    }
    return allOk ? 0 : 2;
  }

  if (sub === "set") {
    const id = slotId("set")!;
    if (!setOptions) throw new UsageError("accounts set needs at least one of --login-url, --username, --label or --password-stdin");
    const slotPatch: NonNullable<AccountsPatch["accounts"]>[AccountId] = {};
    if (values["login-url"] !== undefined) slotPatch.loginUrl = values["login-url"];
    if (values.username !== undefined) slotPatch.username = values.username;
    if (values.label !== undefined) slotPatch.label = values.label;
    const patch: AccountsPatch = { accounts: { [id]: slotPatch } };
    checkAccountsPatch(patch);
    const before = await resolveAccounts();
    // The login URL is judged before the password is asked for.
    await checkLoginUrls(patch, before.status, safety);
    if (values["password-stdin"]) slotPatch.password = await readPassword(slotPatch.label?.trim() || before.status.accounts[id].label);
    const unregister = slotPatch.password ? registerPasswords({ ...before.config, accounts: { ...before.config.accounts, [id]: { ...before.config.accounts[id], password: slotPatch.password } } }, [id]) : () => undefined;
    try {
      const status = await saveAccounts(patch);
      const s = status.accounts[id];
      const lines = [`Saved ${s.label} (${id}) to ${status.file}.`, ...slotLines(s).slice(1)];
      if (before.status.accounts[id].sources.password === "file" && !slotPatch.password && !s.hasPassword) {
        lines.push("The saved password was removed because the sign-in page moved to another site (origin). Save it again with --password-stdin.");
      }
      const fromEnv = (Object.keys(s.sources) as (keyof AccountStatus["sources"])[]).filter((f) => s.sources[f] === "env");
      if (fromEnv.length) lines.push(`${fromEnv.map((f) => accountEnvName(id, f)).join(", ")} ${fromEnv.length === 1 ? "is" : "are"} set, and ${fromEnv.length === 1 ? "overrides" : "override"} the saved ${fromEnv.length === 1 ? "value" : "values"}.`);
      if (s.ready) lines.push(`Check it with: run-hound accounts test ${id}`);
      process.stdout.write(`${redactSecrets(lines.join("\n"))}\n`);
      return 0;
    } finally {
      unregister();
    }
  }

  if (sub === "clear") {
    const id = slotId("clear")!;
    const label = (await resolveAccounts()).status.accounts[id].label;
    const status = await clearAccount(id);
    const lines = [`Removed ${label} (${id}) from ${status.file}.`];
    const s = status.accounts[id];
    const fromEnv = (Object.keys(s.sources) as (keyof AccountStatus["sources"])[]).filter((f) => s.sources[f] === "env");
    if (fromEnv.length) lines.push(`${fromEnv.map((f) => accountEnvName(id, f)).join(", ")} still ${fromEnv.length === 1 ? "sets" : "set"} it up from the environment.`);
    process.stdout.write(`${redactSecrets(lines.join("\n"))}\n`);
    return 0;
  }

  throw new UsageError(sub ? `unknown accounts command: ${sub.slice(0, 40)} (use "accounts status", "accounts test", "accounts set" or "accounts clear")` : 'accounts needs a command: "accounts status", "accounts test", "accounts set" or "accounts clear"');
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
  // The UI and API also answer to the address they were bound to (never to a wildcard like 0.0.0.0).
  const app = createApp({ runsDir: values["runs-dir"], boundHost: values.host });
  const server = serve({ fetch: app.fetch, port, hostname: values.host }, (info) => {
    const host = info.address.includes(":") ? `[${info.address}]` : info.address;
    process.stdout.write(`Run Hound listening on http://${host}:${info.port}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // A listen error (the port is taken) arrives as an 'error' event, after main's try/catch: one plain line, exit 2.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (server.listening) {
      process.stderr.write(`run-hound: server error: ${redactSecrets(err.message)}\n`);
      return;
    }
    const where = `port ${port} on ${values.host}`;
    if (err.code === "EADDRINUSE") fail(`${where} is already in use (another Run Hound or dev server?). Stop it or pass --port <n>.`);
    else if (err.code === "EACCES") fail(`not allowed to listen on ${where} (ports below 1024 need extra permissions). Pass --port <n>.`);
    else if (err.code === "EADDRNOTAVAIL") fail(`${values.host} is not an address of this machine. Pass --host 127.0.0.1.`);
    else fail(`could not listen on ${where}: ${err.message}`);
    // Nothing else keeps the process alive, so it ends with exit code 2 once stderr has flushed.
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  });
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  try {
    if (command === "serve") return serveCommand(rest);
    if (command === "run") {
      process.exitCode = await runCommand(rest);
      return;
    }
    if (command === "ai") {
      process.exitCode = await aiCommand(rest);
      return;
    }
    if (command === "accounts") {
      process.exitCode = await accountsCommand(rest);
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
