import type { AiConfig, AiModelInfo, AiModelList } from "./types.js";
import { endpointHost, isRemote } from "./config.js";
import { ollamaRoot } from "./ollama.js";

const TIMEOUT_MS = 5_000;

type Fetched = { ok: true; status: number; body: any } | { ok: false; error: string };

async function getJson(url: string, apiKey: string | null, origin: string, serverName: string): Promise<Fetched> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: `${origin} did not answer within ${TIMEOUT_MS / 1000} s` };
    }
    return { ok: false, error: `Nothing is answering at ${origin} — is ${serverName} running?` };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: "The server refused the API key" };
  if (response.status === 404) return { ok: true, status: 404, body: null };
  if (!response.ok) return { ok: false, error: `${origin} answered HTTP ${response.status} when asked for its models` };
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    return { ok: false, error: `${origin} did not answer the model list with JSON` };
  }
}

const embedding = (id: string) => /embed/i.test(id);

function fromOpenAi(body: any): AiModelInfo[] {
  const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
  return data
    .map((m: any) => (typeof m?.id === "string" ? m.id : null))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id, details: null, suitable: embedding(id) ? false : null }));
}

function fromOllamaTags(body: any): AiModelInfo[] {
  const models: unknown[] = Array.isArray(body?.models) ? body.models : [];
  return models.flatMap((m: any) => {
    const id = typeof m?.name === "string" ? m.name : typeof m?.model === "string" ? m.model : null;
    if (!id) return [];
    const details = [m.details?.parameter_size, m.details?.quantization_level].filter((s) => typeof s === "string" && s).join(" ");
    const suitable = Array.isArray(m.capabilities) ? m.capabilities.includes("completion") : null;
    return [{ id, details: details || null, suitable }];
  });
}

/**
 * Models for the Settings dropdown. Never throws.
 * - ollama: GET <origin of baseUrl>/api/tags (native API; baseUrl minus a trailing /v1). details =
 *   "<parameter_size> <quantization_level>"; suitable = false when `capabilities` exists and lacks "completion"
 *   (embedding models), true when it has it; null without capabilities. Falls back to GET {baseUrl}/models if
 *   /api/tags 404s.
 * - openai-compatible: GET {baseUrl}/models with the Bearer key; data[].id, details null, suitable null (false for ids
 *   containing "embed").
 * - bedrock: {models: [], error: null} (not listed in 0.3.0; the UI shows a text field).
 * Remote endpoint without allowRemote: {models: [], error: "Tick the consent box to list models from <host>"} and
 * no request. Unreachable: error "Nothing is answering at <origin> — is <Ollama|the server> running?"; 401/403:
 * "The server refused the API key"; empty list: error "No models found at <origin>" (+ " — run `ollama pull <model>`"
 * for ollama). Sorted by id. Timeout 5 s.
 */
export async function listModels(config: Pick<AiConfig, "provider" | "baseUrl" | "apiKey" | "region" | "allowRemote">): Promise<AiModelList> {
  if (config.provider === "bedrock") return { models: [], error: null };
  if (isRemote(config) && !config.allowRemote) return { models: [], error: `Tick the consent box to list models from ${endpointHost(config)}` };

  const base = config.baseUrl.replace(/\/+$/, "");
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return { models: [], error: `"${config.baseUrl}" is not a valid base URL` };
  }
  const ollama = config.provider === "ollama";
  const serverName = ollama ? "Ollama" : "the server";

  let models: AiModelInfo[] | null = null;
  if (ollama) {
    const tags = await getJson(`${ollamaRoot(base)}/api/tags`, config.apiKey, origin, serverName);
    if (!tags.ok) return { models: [], error: tags.error };
    if (tags.status !== 404) models = fromOllamaTags(tags.body);
  }
  if (models === null) {
    const list = await getJson(`${base}/models`, config.apiKey, origin, serverName);
    if (!list.ok) return { models: [], error: list.error };
    if (list.status === 404) return { models: [], error: `${origin} has no model list at ${base}/models` };
    models = fromOpenAi(list.body);
  }

  if (models.length === 0) {
    return { models: [], error: `No models found at ${origin}${ollama ? " — run `ollama pull <model>`" : ""}` };
  }
  models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { models, error: null };
}
