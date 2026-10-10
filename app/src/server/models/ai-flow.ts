/**
 * AI flow: GET /api/ai, PUT /api/ai, POST /api/ai/test, GET /api/ai/models, GET /api/settings. Resolves and saves the
 * AI config, lists models, and reports whether the saved API key was used (only when the target endpoint matches the
 * saved one).
 */
import { aiStatus, resolveAiConfig, saveAiConfig, savedFixedProviderKey } from "../../ai/config.js";
import { testConnection } from "../../ai/client.js";
import { resolveModelsList } from "./ai-models.js";
import { redactSecrets } from "../../engine/redact.js";
import { AI_PROVIDERS } from "../../constants/ai-constants.js";
import type { AiConfigPatch, AiProvider } from "../../ai/types.js";
import type {
  AiModelsOutcome,
  AiModelsQuery,
  AiSettingsView,
  AiTestOutcome,
  IAiFlow,
  PutAiOutcome,
} from "../../interfaces/server.js";

/** Dependencies the AI flow needs. */
export interface AiFlowDeps {
  host: { runsDir: string; allowedHosts(): string[]; extraHosts: string[] };
  version: string;
}

/** AI flow: every /api/ai and /api/settings operation. */
export class AiFlow implements IAiFlow {
  readonly #deps: AiFlowDeps;

  constructor(deps: AiFlowDeps) {
    this.#deps = deps;
  }

  async getSettings(): Promise<AiSettingsView> {
    return {
      version: this.#deps.version,
      runsDir: this.#deps.host.runsDir,
      allowedHosts: this.#deps.host.allowedHosts(),
      serverHosts: this.#deps.host.extraHosts,
      ai: aiStatus(await resolveAiConfig({ sealed: true })),
    };
  }

  async getAi(): Promise<unknown> {
    return aiStatus(await resolveAiConfig({ sealed: true }));
  }

  async putAi(patch: unknown): Promise<PutAiOutcome> {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      return { ok: false, message: "Send the AI settings as a JSON object.", status: 400 };
    }
    const features = (patch as { features?: unknown }).features;
    if (
      features !== undefined &&
      (typeof features !== "object" ||
        features === null ||
        Array.isArray(features) ||
        Object.values(features).some((v) => typeof v !== "boolean"))
    ) {
      return {
        ok: false,
        message:
          'features must be an object like {"review": true, "suggest": true, "explain": false}.',
        status: 400,
      };
    }
    try {
      const { notice, ...resolved } = await saveAiConfig(patch as AiConfigPatch);
      return { ok: true, status: aiStatus(resolved), ...(notice ? { notice } : {}) };
    } catch (err) {
      return {
        ok: false,
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
        status: 400,
      };
    }
  }

  async postAiTest(): Promise<AiTestOutcome> {
    const { config } = await resolveAiConfig();
    const result = await testConnection({ ...config, enabled: true });
    return result.ok ? result : { ok: false, error: redactSecrets(result.error) };
  }

  async getAiModels(query: AiModelsQuery): Promise<AiModelsOutcome> {
    const { config } = await resolveAiConfig();
    const asked = query.provider;
    if (asked && !(AI_PROVIDERS as readonly string[]).includes(asked)) {
      return { ok: false, message: `Unknown provider "${redactSecrets(asked)}".`, status: 400 };
    }
    // Settings may list the models of a provider before switching to it: Anthropic, OpenAI and Gemini use their own
    // saved key (each provider keeps one), and only at their official endpoint.
    const savedKey = asked && asked !== config.provider ? await savedFixedProviderKey(asked as AiProvider) : null;
    const resolved2 = await resolveModelsList(
      config,
      {
        ...(asked !== undefined ? { provider: asked } : {}),
        ...(query.baseUrl !== undefined ? { baseUrl: query.baseUrl } : {}),
        ...(query.allowRemote !== undefined ? { allowRemote: query.allowRemote } : {}),
      },
      (provider) => (provider === asked ? savedKey : null),
    );
    if (!resolved2.ok) {
      return { ok: false, message: `Unknown provider "${redactSecrets(resolved2.raw)}".`, status: 400 };
    }
    const list = resolved2.list;
    return {
      ok: true,
      list: list.error ? { ...list, error: redactSecrets(list.error) } : list,
    };
  }
}