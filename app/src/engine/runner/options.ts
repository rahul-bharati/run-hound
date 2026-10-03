/** Public helpers the runner exposes that don't carry orchestration state: canShowBrowser, RUN_HOUND_VERSION, newRunId, scenarioLimitMs, scenarioTimeoutNote, stillSignedOutMessage, planWarnings. Re-exports the types, the small constants and the NothingToRunError from their canonical homes. */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { NO_DISPLAY_MESSAGE, STOPPED_NOTE, ENGINE_STEP } from "../../constants/runner-constants.js";
import { SCENARIO_TIMEOUT_MS, NETWORK_IDLE_TIMEOUT_MS } from "../../config/runner.js";
import { NothingToRunError } from "../../errors/nothing-to-run-error.js";
import type { Check, DiscoveredForm, DiscoveredPage, Plan, Scenario } from "../../core/types.js";
import type { RunOptions } from "../../interfaces/runner.js";
import { redactSecrets } from "../redact.js";

export { NO_DISPLAY_MESSAGE, STOPPED_NOTE, ENGINE_STEP, SCENARIO_TIMEOUT_MS, NETWORK_IDLE_TIMEOUT_MS, NothingToRunError };
export type { RunOptions } from "../../interfaces/runner.js";
export type { ProgressEvent } from "../../types/runner.js";

/** Whether a visible browser window (headed mode) can open here: always on macOS and Windows, and on Linux only with a display server (DISPLAY or WAYLAND_DISPLAY). A container has none, and Chromium then fails with a long banner. */
export function canShowBrowser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** Run Hound's version, from app/package.json: printed by --version, stored in every report, shown in the web UI. */
export const RUN_HOUND_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Sortable, filesystem-safe run id, e.g. "20260922-101500-3f9a1c". */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/** "3 minutes", "1 minute", "90 seconds", "1 second". */
function limitWords(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return ms >= 60_000 && ms % 60_000 === 0 ? plural(ms / 60_000, "minute") : plural(Math.round(ms / 100) / 10, "second");
}

/** True for a scenario that needs the other account signed in (access-control and write-access other-account scenarios). */
export function needsOtherAccount(scenario: Scenario): boolean {
  return (scenario.checkId === "access-control" || scenario.checkId === "write-access") && /(?:^|:)other-account(?:@form-\d+)?(?:#\d+)?$/.test(scenario.id);
}

/** How long a scenario may take: RunOptions.scenarioTimeoutMs when given, else SCENARIO_TIMEOUT_MS or, for a check whose work grows with the page (Check.timeLimitMs), what it asks for when that is more. */
export function scenarioLimitMs(check: Check, scenario: Scenario, form: DiscoveredForm, page?: DiscoveredPage, options: Pick<RunOptions, "scenarioTimeoutMs"> = {}): number {
  if (options.scenarioTimeoutMs !== undefined) return options.scenarioTimeoutMs;
  return Math.max(SCENARIO_TIMEOUT_MS, check.timeLimitMs?.(scenario, form, page) ?? 0);
}

/** Notes of a scenario abandoned at its time limit. */
export function scenarioTimeoutNote(limitMs: number): string {
  return `The scenario took longer than ${limitWords(limitMs)} and was stopped, so it has no result. Something it waited for never finished, often a request the app never answered.`;
}

/** "Signed in as Account A, but <target> still shows the sign-in page. …" (docs/v2-spec.md "Signed-in runs"). */
export function stillSignedOutMessage(label: string, target: string, loginUrl?: string): string {
  return `Signed in as ${label}, but ${redactSecrets(target)} still shows the sign-in page. Check the account in Settings → Test accounts.${hostHint(target, loginUrl)}`;
}

/** Why a session may not reach the target: the sign-in page is on another host name. "" when the hosts are the same. */
function hostHint(target: string, loginUrl: string | undefined): string {
  if (!loginUrl) return "";
  let a: URL;
  let b: URL;
  try {
    a = new URL(target);
    b = new URL(loginUrl);
  } catch {
    return "";
  }
  if (a.hostname === b.hostname) return "";
  return ` The sign-in page is on ${b.hostname} and the page on ${a.hostname}: a browser keeps their cookies apart, so the session doesn't carry over. Use the same host name in both.`;
}

/** Things a person should know before approving the plan. */
export function planWarnings(plan: Plan): string[] {
  const warnings: string[] = [];
  try {
    const asked = new URL(plan.target);
    const found = new URL(plan.form.url);
    if (asked.origin !== found.origin || asked.pathname !== found.pathname) {
      const signInPage = /log-?in|sign-?in|auth/i.test(found.pathname);
      const login = !signInPage
        ? ""
        : plan.account
          ? " It looks like a sign-in page."
          : " It looks like a sign-in page. Sign in as a test account (Settings → Test accounts, or --as a) to test the pages behind it.";
      warnings.push(`${plan.target} redirected to ${plan.form.url}, so that page is the one being tested.${login}`);
    }
  } catch {
    // An unparseable URL can't be compared; the safety gate has already judged it.
  }
  if (plan.page && plan.page.forms.length === 0) {
    warnings.push("No form was found on this page, so only the page-wide checks are planned (buttons outside forms, headers, cookies, CORS, source maps, scripts and layout).");
  }
  if (plan.signInHint && !plan.account) {
    warnings.push("Sign in as a test account to run the access checks (another account or a signed-out visitor reading your data).");
  }
  return warnings;
}
