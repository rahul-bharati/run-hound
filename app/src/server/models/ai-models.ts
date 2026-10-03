/**
 * AI model-list orchestration: parse the GET /api/ai/models query (provider, baseUrl, allowRemote), resolve the target
 * (provider/baseUrl/region), decide whether the saved key can travel to the requested endpoint, and call listModels.
 */
import { DEFAULT_BASE_URLS, endpointHost } from "../../ai/config.js";
import { listModels } from "../../ai/models.js";
import { AI_PROVIDERS } from "../../constants/ai-constants.js";
import type { AiConfig, AiProvider } from "../../ai/types.js";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface ModelsQuery {
  provider?: string;
  baseUrl?: string;
  allowRemote?: string;
}

export type ModelsResolution =
  | { ok: true; list: Awaited<ReturnType<typeof listModels>> }
  | { ok: false; raw: string; message: string };

/** Build a listModels response for a query against the saved AI config. The saved key only travels to the endpoint
 * it was saved for; the "allowRemote" flag opts the caller in to listing from a different endpoint. */
export async function resolveModelsList(
  config: Pick<AiConfig, "provider" | "baseUrl" | "region" | "apiKey" | "allowRemote">,
  query: ModelsQuery,
): Promise<ModelsResolution> {
  const asked = query.provider;
  if (asked && !(AI_PROVIDERS as readonly string[]).includes(asked)) {
    return { ok: false, raw: asked, message: `Unknown provider "${asked}".` };
  }
  const provider = (asked || config.provider) as AiProvider;
  const baseUrl =
    query.baseUrl ||
    (provider === config.provider ? config.baseUrl : DEFAULT_BASE_URLS[provider]);
  const target = { provider, baseUrl, region: config.region };
  const savedOrigin = originOf(config.baseUrl);
  // The saved key only ever goes to the endpoint it was saved for.
  const apiKey =
    savedOrigin !== null && originOf(baseUrl) === savedOrigin ? config.apiKey : null;
  const consent =
    /^(1|true|on)$/i.test(query.allowRemote ?? "") ||
    (config.allowRemote && endpointHost(target) === endpointHost(config));
  const list = await listModels({ ...target, apiKey, allowRemote: consent });
  return { ok: true, list };
}