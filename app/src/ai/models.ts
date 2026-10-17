import type { AiConfig, AiModelInfo, AiModelList, AiProvider } from "./types.js";
import { FIXED_ENDPOINT_PROVIDERS, PROVIDER_LABELS } from "../constants/ai-constants.js";
import { ANTHROPIC_VERSION } from "./anthropic.js";
import { endpointHost, isRemote } from "./config.js";
import { GEMINI_INVALID_KEY } from "./gemini.js";
import { ollamaRoot } from "./ollama.js";

const TIMEOUT_MS = 5_000;

/** Most pages of a paged model list (Anthropic, Gemini) followed; each page holds up to 1000 models. */
const MAX_PAGES = 10;

type Fetched = { ok: true; status: number; body: any } | { ok: false; error: string };

/** How a listing names the server in its messages. */
interface Peer {
  origin: string;
  /** Subject of "<who> refused the API key": "The server", "OpenAI". */
  who: string;
  /** Said when nothing answers. */
  unreachable: string;
  /** A 400 whose body matches this is a refused key (Google's answer to an invalid key). */
  refusedOn400?: RegExp;
}

async function getJson(url: string, headers: Record<string, string>, peer: Peer): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, error: `${peer.origin} did not answer within ${TIMEOUT_MS / 1000} s` };
    }
    return { ok: false, error: peer.unreachable };
  }
  const refused = { ok: false, error: `${peer.who} refused the API key` } as const;
  if (response.status === 401 || response.status === 403) return refused;
  if (response.status === 400 && peer.refusedOn400 && peer.refusedOn400.test(await response.text().catch(() => ""))) return refused;
  if (response.status === 404) return { ok: true, status: 404, body: null };
  if (!response.ok) return { ok: false, error: `${peer.origin} answered HTTP ${response.status} when asked for its models` };
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    return { ok: false, error: `${peer.origin} did not answer the model list with JSON` };
  }
}

const embedding = (id: string) => /embed/i.test(id);

/** OpenAI's list holds every model it serves; these ids are not for chat. */
const NOT_CHAT_OPENAI = /embed|tts|transcribe|realtime|image|dall-e|whisper|moderation|audio|search/i;

/** Gemini models that take generateContent but don't answer in JSON text (images, speech, live audio, video). */
const NOT_TEXT_GEMINI = /embed|tts|image|audio|live|imagen|veo|aqa|robotics/i;

function fromOpenAi(body: any): AiModelInfo[] {
  const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
  return data
    .map((m: any) => (typeof m?.id === "string" ? m.id : null))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id, details: null, suitable: embedding(id) ? false : null }));
}

/** The chat models of OpenAI's own list. */
function fromOpenAiOfficial(body: any): AiModelInfo[] {
  return fromOpenAi(body).filter((m) => !NOT_CHAT_OPENAI.test(m.id));
}

/** One page of Anthropic's list: id, display name as details, suitable false where structured outputs are unsupported. */
function fromAnthropic(body: any): AiModelInfo[] {
  const data: unknown[] = Array.isArray(body?.data) ? body.data : [];
  return data.flatMap((m: any) => {
    if (typeof m?.id !== "string" || !m.id) return [];
    const supported: unknown = m.capabilities?.structured_outputs?.supported;
    return [{ id: m.id, details: typeof m.display_name === "string" && m.display_name ? m.display_name : null, suitable: typeof supported === "boolean" ? supported : null }];
  });
}

/** One page of Gemini's list: the models that take generateContent, as "gemini-…" without the "models/" prefix. */
function fromGemini(body: any): AiModelInfo[] {
  const models: unknown[] = Array.isArray(body?.models) ? body.models : [];
  return models.flatMap((m: any) => {
    if (typeof m?.name !== "string" || !Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes("generateContent")) return [];
    const id = m.name.replace(/^models\//, "");
    return [{ id, details: typeof m.displayName === "string" && m.displayName ? m.displayName : null, suitable: NOT_TEXT_GEMINI.test(id) ? false : null }];
  });
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

/** Every page of a model list, from `first`, following `nextUrl` for at most MAX_PAGES; a failure ends it with that error. */
async function getPages(
  first: string,
  headers: Record<string, string>,
  peer: Peer,
  parse: (body: any) => AiModelInfo[],
  nextUrl: (body: any) => string | null = () => null,
): Promise<{ ok: true; status: number; models: AiModelInfo[] } | { ok: false; error: string }> {
  const models: AiModelInfo[] = [];
  let url: string | null = first;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const got = await getJson(url, headers, peer);
    if (!got.ok) return got;
    if (got.status === 404) return { ok: true, status: 404, models };
    models.push(...parse(got.body));
    url = nextUrl(got.body);
  }
  return { ok: true, status: 200, models };
}

/**
 * Models for the Settings dropdown. Never throws.
 * - anthropic: GET {baseUrl}/models?limit=1000 with `x-api-key` and `anthropic-version`, following has_more/last_id with
 *   `after_id`; data[].id, details = display_name, suitable = capabilities.structured_outputs.supported (false: Run Hound
 *   needs structured outputs), null when not said.
 * - gemini: GET {baseUrl}/models?pageSize=1000 with `x-goog-api-key`, following nextPageToken; only models whose
 *   supportedGenerationMethods include generateContent, id without the "models/" prefix, details = displayName, suitable
 *   false for image, speech, live, embedding and video models.
 * - openai: GET {baseUrl}/models with the Bearer key; ids of embedding, speech, transcription, realtime, image,
 *   moderation, audio and search models left out.
 *   These three need a key: without one, {models: [], error: "Enter your <provider> API key to list its models"} and no
 *   request.
 * - ollama: GET <origin of baseUrl>/api/tags (native API; baseUrl minus a trailing /v1). details =
 *   "<parameter_size> <quantization_level>"; suitable = false when `capabilities` exists and lacks "completion"
 *   (embedding models), true when it has it; null without capabilities. Falls back to GET {baseUrl}/models if
 *   /api/tags 404s.
 * - openai-compatible: GET {baseUrl}/models with the Bearer key; data[].id, details null, suitable null (false for ids
 *   containing "embed").
 * - bedrock: {models: [], error: null} (not listed in 0.3.0; the UI shows a text field).
 * - no provider: {models: [], error: "Choose a provider"}.
 * Remote endpoint without allowRemote: {models: [], error: "Tick the consent box to list models from <host>"} and
 * no request. Unreachable: error "Nothing is answering at <origin> — is <Ollama|the server> running?" (the three
 * official APIs: "Could not reach <origin> — check the internet connection"); 401/403 (and Gemini's 400 for an invalid
 * key): "The server refused the API key" (the official APIs name themselves: "Anthropic refused the API key"); empty
 * list: error "No models found at <origin>" (+ " — run `ollama pull <model>`" for ollama). Sorted by id. Timeout 5 s
 * per request.
 */
export async function listModels(config: Pick<AiConfig, "provider" | "baseUrl" | "apiKey" | "region" | "allowRemote">): Promise<AiModelList> {
  const provider: AiProvider | null = config.provider;
  if (!provider) return { models: [], error: "Choose a provider" };
  if (provider === "bedrock") return { models: [], error: null };
  if (isRemote(config) && !config.allowRemote) return { models: [], error: `Tick the consent box to list models from ${endpointHost(config)}` };

  const base = config.baseUrl.replace(/\/+$/, "");
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return { models: [], error: `"${config.baseUrl}" is not a valid base URL` };
  }
  const official = FIXED_ENDPOINT_PROVIDERS.has(provider);
  const label = PROVIDER_LABELS[provider];
  if (official && !config.apiKey) return { models: [], error: `Enter your ${label} API key to list its models` };
  const ollama = provider === "ollama";
  const serverName = ollama ? "Ollama" : "the server";
  const peer: Peer = official
    ? { origin, who: label, unreachable: `Could not reach ${origin} — check the internet connection`, ...(provider === "gemini" ? { refusedOn400: GEMINI_INVALID_KEY } : {}) }
    : { origin, who: "The server", unreachable: `Nothing is answering at ${origin} — is ${serverName} running?` };
  const bearer: Record<string, string> = { accept: "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };

  let models: AiModelInfo[] | null = null;
  if (provider === "anthropic") {
    const headers = { accept: "application/json", "x-api-key": config.apiKey!, "anthropic-version": ANTHROPIC_VERSION };
    const list = await getPages(`${base}/models?limit=1000`, headers, peer, fromAnthropic, (body) =>
      body?.has_more === true && typeof body.last_id === "string" ? `${base}/models?limit=1000&after_id=${encodeURIComponent(body.last_id)}` : null,
    );
    if (!list.ok) return { models: [], error: list.error };
    if (list.status === 404) return { models: [], error: `${origin} has no model list at ${base}/models` };
    models = list.models;
  } else if (provider === "gemini") {
    const headers = { accept: "application/json", "x-goog-api-key": config.apiKey! };
    const list = await getPages(`${base}/models?pageSize=1000`, headers, peer, fromGemini, (body) =>
      typeof body?.nextPageToken === "string" && body.nextPageToken ? `${base}/models?pageSize=1000&pageToken=${encodeURIComponent(body.nextPageToken)}` : null,
    );
    if (!list.ok) return { models: [], error: list.error };
    if (list.status === 404) return { models: [], error: `${origin} has no model list at ${base}/models` };
    models = list.models;
  } else {
    if (ollama) {
      const tags = await getJson(`${ollamaRoot(base)}/api/tags`, bearer, peer);
      if (!tags.ok) return { models: [], error: tags.error };
      if (tags.status !== 404) models = fromOllamaTags(tags.body);
    }
    if (models === null) {
      const list = await getJson(`${base}/models`, bearer, peer);
      if (!list.ok) return { models: [], error: list.error };
      if (list.status === 404) return { models: [], error: `${origin} has no model list at ${base}/models` };
      models = provider === "openai" ? fromOpenAiOfficial(list.body) : fromOpenAi(list.body);
    }
  }

  if (models.length === 0) {
    return { models: [], error: `No models found at ${origin}${ollama ? " — run `ollama pull <model>`" : ""}` };
  }
  models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { models, error: null };
}
