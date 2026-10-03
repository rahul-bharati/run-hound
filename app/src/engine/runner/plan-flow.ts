/** Planning and discovery orchestration: discoverAndPlan runs the safety gate, opens the target (signed in when signInAs is set), discovers the form, builds the plan and, when an AiSession is on, layers the model's review and suggestions on top. */

import { existsSync } from "node:fs";
import type { Check, Plan, PlanEnv } from "../../core/types.js";
import { reviewPlan } from "../../ai/review.js";
import { modelLabel, type AiSession } from "../../ai/session.js";
import { suggestScenarios } from "../../ai/suggest.js";
import { BROWSER_LOCALE, seedSessionStorage, type SessionStorageItems } from "../context.js";
import { discoverPage, holdSocketWrites } from "../discover.js";
import {
  containerLocalhostHint,
  explainNavigationError,
  explainNoForm,
  inContainer,
  NoFormFoundError,
  splitTargetUrl,
  TargetNotAllowedError,
  TargetUnreachableError,
} from "../errors.js";
import { guardContext, guardSummary, rememberCredentials } from "../guard.js";
import { ISOLATED_CONTEXT, launchChromium } from "../isolation.js";
import { buildPlan } from "../plan.js";
import { redactAccountSecrets, redactSecrets } from "../redact.js";
import { checkTarget } from "../safety.js";
import { accountLabel, signIn, SignInError, type SessionState } from "../auth.js";
import { PLAN_ADDRESS_KEYS } from "../../constants/runner-constants.js";
import { NETWORK_IDLE_TIMEOUT_MS } from "../../config/runner.js";
import { engineStep, launchOptions, resolveChecks, safetyOptions } from "./shared.js";
import { landedOnSignIn, markAccountEmail } from "./sign-in-page.js";
import { refOf, signingIn } from "./account-helpers.js";
import type { RunOptions, Signing } from "../../interfaces/runner.js";
import { stillSignedOutMessage } from "./options.js";
import { SecretRegistrations, redactError } from "./secrets.js";

/** Plan-time redaction of readable text: address-shaped fields keep their text and lose only passwords/session values. */
function redactPlanText<T>(value: T, key = "", address = false): T {
  const inAddress = address || PLAN_ADDRESS_KEYS.has(key);
  if (typeof value === "string") return (inAddress ? redactAccountSecrets(value) : redactSecrets(value)) as T;
  if (Array.isArray(value)) return value.map((v) => redactPlanText(v, "", inAddress)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactPlanText(v, k, inAddress);
    return out as T;
  }
  return value;
}

/** Safety gate, open the target, discover the form, build the plan. */
export async function discoverAndPlan(rawUrl: string, options: RunOptions = {}): Promise<Plan> {
  const { url, credentials } = splitTargetUrl(rawUrl);
  const safety = safetyOptions(options);
  const target = await checkTarget(url, safety);
  if (credentials) rememberCredentials(url, credentials);
  const checks = await resolveChecks(options);
  const signing = options.signInAs ? await signingIn(options.signInAs, options) : null;
  const secrets = new SecretRegistrations();
  if (signing) secrets.addAccounts(signing.config);
  try {
    return await discoverSignedInOrOut(url, target, checks, signing, secrets, safety, options);
  } catch (err) {
    throw redactError(err);
  } finally {
    secrets.release();
  }
}

async function discoverSignedInOrOut(
  url: string,
  target: Awaited<ReturnType<typeof checkTarget>>,
  checks: Check[],
  signing: Signing | null,
  secrets: SecretRegistrations,
  safety: import("../safety.js").SafetyOptions,
  options: RunOptions,
): Promise<Plan> {
  if (signing) engineStep(options, `Signing in as ${accountLabel(signing.account)}`, signing.account.loginUrl || url);
  else engineStep(options, "Opening the page to find its forms and controls", url);
  const browser = await launchChromium(launchOptions(target, options));
  let closed = false;
  try {
    let session: SessionState | undefined;
    let sessionItems: SessionStorageItems | undefined;
    if (signing) {
      const signed = await signIn(browser, signing.account, safety);
      secrets.add(signed.secrets);
      session = signed.state;
      sessionItems = signed.sessionStorage;
      engineStep(options, "Opening the page to find its forms and controls", url);
    }
    const env: PlanEnv = { signedIn: Boolean(signing), otherAccount: Boolean(signing?.other) };
    const context = await browser.newContext({ locale: BROWSER_LOCALE, serviceWorkers: "block", ...ISOLATED_CONTEXT, ...(session ? { storageState: session } : {}) });
    await seedSessionStorage(context, sessionItems);
    const guard = await guardContext(context, safety);
    const page = await context.newPage();
    await holdSocketWrites(page);
    let status: number | null = null;
    try {
      status = (await page.goto(url, { waitUntil: "load" }))?.status() ?? null;
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    } catch (err) {
      if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
      const explained = explainNavigationError(err, url);
      const hint = explained instanceof TargetUnreachableError && inContainer(existsSync) ? containerLocalhostHint(url) : undefined;
      throw hint ? new TargetUnreachableError(url, `${(explained as Error).message} ${hint}`) : explained;
    }
    if (guard.escaped.length > 0) throw new TargetNotAllowedError(url, guardSummary(guard)!);
    if (signing && (await landedOnSignIn(page, url, signing.account))) {
      throw new SignInError(stillSignedOutMessage(accountLabel(signing.account), url, signing.account.loginUrl));
    }
    engineStep(options, "Reading the page: forms, fields and controls", page.url());
    const found = await discoverPage(page, { openers: true });
    if (signing) await markAccountEmail(page, found, signing.account.username);
    if (found.forms.length === 0) {
      const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 400) : ''").catch(() => ""));
      const broken = (status !== null && status >= 400) || /Blocked request\. This host|Invalid Host header|Blocked cross-origin request/i.test(text);
      if (broken) throw new NoFormFoundError(url, explainNoForm({ requested: url, final: page.url(), status, text }));
    }
    const built = buildPlan(url, found, checks, env);
    const plan: Plan = signing ? { ...redactPlanText(built), account: refOf(signing.account) } : built;
    if (found.forms.length === 0 && plan.scenarios.length === 0) {
      throw new NoFormFoundError(url, "none of the page-wide checks apply to it either");
    }
    if (!options.ai) return plan;
    const pageUrl = page.url();
    closed = true;
    await browser.close();
    return await planWithAi(plan, options.ai, options, pageUrl);
  } finally {
    if (!closed) await browser.close();
  }
}

/** A plain-language reason from an AI failure. */
function aiReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message.replace(/\.+$/, ""));
}

async function planWithAi(built: Plan, ai: AiSession, options: RunOptions, url: string): Promise<Plan> {
  if (!ai.features.review && !ai.features.suggest) return built;
  const label = modelLabel(ai.client);
  const warnings: string[] = [];
  let plan = built;
  let reviewed = false;
  let suggested = 0;
  if (ai.features.review) {
    engineStep(options, `Asking ${label} to review the plan`, url);
    try {
      plan = await reviewPlan(plan, ai.client, { remote: ai.remote, signal: options.signal });
      reviewed = true;
    } catch (error) {
      warnings.push(`${label} could not review the plan (${aiReason(error)}), so the built-in plan is shown.`);
    }
  }
  if (ai.features.suggest) {
    engineStep(options, `Asking ${label} to suggest flows`, url);
    try {
      const before = plan.scenarios.length;
      const out = await suggestScenarios(plan, ai.client, { remote: ai.remote, signal: options.signal });
      plan = out.plan;
      suggested = plan.scenarios.length - before;
      for (const rejected of out.rejected) warnings.push(`Left out a flow ${label} suggested: ${redactSecrets(rejected)}`);
    } catch (error) {
      warnings.push(`${label} could not suggest flows (${aiReason(error)}), so none were added.`);
    }
  }
  return {
    ...plan,
    ai: { provider: ai.client.provider, model: ai.client.model, remote: ai.remote, warnings, reviewedAt: new Date().toISOString(), reviewed, suggested },
  };
}
