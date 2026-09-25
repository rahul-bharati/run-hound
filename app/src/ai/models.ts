import type { AiConfig, AiModelList } from "./types.js";
import { notImplemented } from "./not-implemented.js";

/**
 * Models for the Settings dropdown. Never throws.
 * - ollama: GET <origin of baseUrl>/api/tags (native API; baseUrl minus a trailing /v1). details =
 *   "<parameter_size> <quantization_level>"; suitable = false when `capabilities` exists and lacks "completion"
 *   (embedding models), else true; null without capabilities. Falls back to GET {baseUrl}/models if /api/tags 404s.
 * - openai-compatible: GET {baseUrl}/models with the Bearer key; data[].id, details null, suitable null (false for ids
 *   containing "embed").
 * - bedrock: {models: [], error: null} (not listed in 0.3.0; the UI shows a text field).
 * Remote endpoint without allowRemote: {models: [], error: "Tick the consent box to list models from <host>"} and
 * no request. Unreachable: error "Nothing is answering at <origin> — is <Ollama|the server> running?"; 401/403:
 * "The server refused the API key"; empty list: error "No models found at <origin>" (+ " — run `ollama pull <model>`"
 * for ollama). Sorted by id. Timeout 5 s.
 */
export async function listModels(config: Pick<AiConfig, "provider" | "baseUrl" | "apiKey" | "region" | "allowRemote">): Promise<AiModelList> {
  return notImplemented("listModels");
}
