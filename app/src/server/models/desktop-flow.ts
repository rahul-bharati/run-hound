/**
 * Desktop flow: GET/POST /api/onboarding and POST /api/data/delete (docs/onboarding-spec.md). These routes exist only in
 * the desktop app's engine (server/desktop-app.ts), which has a settings folder of its own; the command line's `serve`
 * and the Docker image never mount them.
 */
import { aiStatus, resolveAiConfig } from "../../ai/config.js";
import type { AiStatus } from "../../ai/types.js";
import { FIXED_ENDPOINT_PROVIDERS } from "../../constants/ai-constants.js";
import { ONBOARDING_POSTED_OUTCOMES } from "../../constants/onboarding-constants.js";
import { redactSecrets } from "../../engine/redact.js";
import type { DataDeleteOutcome, OnboardingOutcome, OnboardingStatus } from "../../interfaces/onboarding.js";
import type { IDesktopFlow, PostOnboardingOutcome } from "../../interfaces/server.js";
import { deleteAllKeysAndData } from "../../operations/data-delete.js";
import { onboardingDone, readOnboarding, writeOnboarding } from "../../operations/onboarding-storage.js";
import { forgetFinishedRuns } from "./runs.js";

/** Dependencies the desktop flow needs. */
export interface DesktopFlowDeps {
  /** The desktop settings folder, read per request (the desktop app sets RUNHOUND_CONFIG_DIR before the engine loads). */
  configDir(): string;
  /** The command line's settings folder, which is never touched. */
  cliConfigDir(): string;
  /** The folder reports are written to (the app's resolved runs folder). */
  runsDir: string;
  /** Drops the secret store's data key from memory (operations/secret-store.ts). */
  forgetStoreKey(dir: string): void;
  now?: () => Date;
}

/**
 * True when the resolved AI settings can already be used: a provider is chosen and, if it needs a key, one is set.
 * Anthropic, OpenAI and Gemini and Bedrock need credentials; a local endpoint needs none; any other endpoint needs a key.
 * The model and the consent are not asked here: onboarding is for a setup that has no provider or no key yet.
 */
export function aiUsable(status: Pick<AiStatus, "provider" | "hasKey" | "remote">): boolean {
  if (!status.provider) return false;
  if (status.provider === "bedrock" || FIXED_ENDPOINT_PROVIDERS.has(status.provider)) return status.hasKey;
  return !status.remote || status.hasKey;
}

export class DesktopFlow implements IDesktopFlow {
  readonly #deps: DesktopFlowDeps;

  constructor(deps: DesktopFlowDeps) {
    this.#deps = deps;
  }

  /**
   * `{ show: true }` when the settings folder has no current marker and the AI settings are not usable yet. When the
   * settings the command line import brought are already usable, the marker is written with outcome "imported" and
   * onboarding never shows. Settings from the environment or a flag count as usable but are not recorded, as they can go.
   */
  async getOnboarding(): Promise<OnboardingStatus> {
    const dir = this.#deps.configDir();
    if (onboardingDone(await readOnboarding(dir))) return { show: false };
    const resolved = await resolveAiConfig({ sealed: true });
    if (!aiUsable(aiStatus(resolved))) return { show: true };
    if (resolved.sources.provider === "file") await writeOnboarding(dir, "imported", this.#deps.now?.());
    return { show: false };
  }

  async postOnboarding(body: unknown): Promise<PostOnboardingOutcome> {
    const outcome = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { outcome?: unknown }).outcome : undefined;
    if (typeof outcome !== "string" || !(ONBOARDING_POSTED_OUTCOMES as readonly string[]).includes(outcome)) {
      return { ok: false, status: 400, message: `Send { "outcome": "${ONBOARDING_POSTED_OUTCOMES.join('" | "')}" }.` };
    }
    try {
      const marker = await writeOnboarding(this.#deps.configDir(), outcome as OnboardingOutcome, this.#deps.now?.());
      return { ok: true, marker };
    } catch (error) {
      return { ok: false, status: 500, message: redactSecrets(`Run Hound could not save that setup was done (${error instanceof Error ? error.message : String(error)}).`) };
    }
  }

  async deleteData(body: unknown): Promise<DataDeleteOutcome> {
    const asked = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { includeRuns?: unknown }).includeRuns : undefined;
    if (asked !== undefined && typeof asked !== "boolean") return { ok: false, status: 400, message: "includeRuns must be true or false." };
    const out = await deleteAllKeysAndData({
      configDir: this.#deps.configDir(),
      cliConfigDir: this.#deps.cliConfigDir(),
      runsDir: this.#deps.runsDir,
      includeRuns: asked === true,
      forgetStoreKey: this.#deps.forgetStoreKey,
    });
    if (!out.ok) return { ...out, message: redactSecrets(out.message) };
    // The deleted keys may still be registered with the redactor, and finished runs still in memory: let both go.
    await resolveAiConfig().catch(() => undefined);
    if (asked === true) forgetFinishedRuns(this.#deps.runsDir);
    return out;
  }
}
