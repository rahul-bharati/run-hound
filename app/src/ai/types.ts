/**
 * Contract for Run Hound's optional AI layer (0.3.0). A model reviews the plan, suggests flows and explains findings;
 * it never decides pass or fail. Everything here is off unless the user turns it on. See docs/ai-spec.md.
 */

/** Wire protocol. "ollama" is the OpenAI-compatible protocol with Ollama's defaults and its native model list. */
export type AiProvider = "ollama" | "openai-compatible" | "bedrock";

export const AI_PROVIDERS: readonly AiProvider[] = ["ollama", "openai-compatible", "bedrock"];

export interface AiFeatures {
  /** Review the built-in plan: recommend, rank and give a reason per scenario. */
  review: boolean;
  /** Suggest up to 5 extra flows (checkId "ai-flow"), unticked by default. */
  suggest: boolean;
  /** Explain each finding after the run. */
  explain: boolean;
}

export interface AiConfig {
  /** Master switch. False by default. */
  enabled: boolean;
  provider: AiProvider;
  /**
   * OpenAI-compatible base URL including the version path, no trailing slash: "http://127.0.0.1:11434/v1" (Ollama),
   * "http://127.0.0.1:1234/v1" (LM Studio), "https://api.openai.com/v1". For bedrock: empty, or an endpoint override
   * (default https://bedrock-runtime.<region>.amazonaws.com).
   */
  baseUrl: string;
  /** Model id as the server names it ("ornith-1.5:9b", "gpt-5-mini", "anthropic.claude-…"). Empty = not configured. */
  model: string;
  /** Bearer key (OpenAI-compatible) or Bedrock API key. Never sent to the browser or written to reports. */
  apiKey: string | null;
  /** Bedrock region, e.g. "us-east-1". */
  region: string | null;
  /**
   * Consent to send redacted page structure to a remote endpoint. Local endpoints don't need it. In a resolved config
   * this is the effective value: consent saved from the Settings page counts only for the host it was given for.
   */
  allowRemote: boolean;
  /**
   * The endpoint host (endpointHost) the consent was given for, when it came from the saved file. null or absent:
   * consent from RUNHOUND_AI_ALLOW_REMOTE / --ai-allow-remote, which applies to whatever endpoint that invocation uses.
   * createLlmClient refuses when it is set and differs from the endpoint's host.
   */
  allowRemoteHost?: string | null;
  features: AiFeatures;
  /** Per request. Default 120 000 (small local models are slow). */
  timeoutMs: number;
}

/** Where a config value came from; later sources win: default < file < env < flag. */
export type ConfigSource = "default" | "file" | "env" | "flag";

/** What the UI and `run-hound ai status` see: the config without the key. */
export interface AiStatus {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  region: string | null;
  allowRemote: boolean;
  features: AiFeatures;
  timeoutMs: number;
  /** True when a key is set (from the file, the env or AWS credentials for bedrock). */
  hasKey: boolean;
  /** True when the endpoint is not loopback / private network (always true for bedrock). */
  remote: boolean;
  /** The endpoint host as shown in the consent text, e.g. "api.openai.com" or "bedrock-runtime.us-east-1.amazonaws.com". */
  host: string;
  /** Set when the config can't be used as is: "Choose a model", "Sending to api.openai.com needs your consent". */
  problem: string | null;
  /** Per field. Env and flag values can't be changed from the UI (it shows them locked). */
  sources: Record<"enabled" | "provider" | "baseUrl" | "model" | "apiKey" | "region" | "allowRemote" | "features" | "timeoutMs", ConfigSource>;
  /** Absolute path of the saved config file. */
  file: string;
}

/** A change from the Settings page or CLI. `apiKey`: undefined or "" = keep the saved key, null = remove it. */
export type AiConfigPatch = Partial<Omit<AiConfig, "features" | "allowRemoteHost">> & { features?: Partial<AiFeatures> };

/** A JSON Schema in the portable subset: every property required, nullable not optional, additionalProperties false, no numeric or length limits. */
export type JsonSchema = Record<string, unknown>;

export interface JsonRequest<T> {
  /** Short schema name for response_format / the forced tool, e.g. "plan_review". [a-z_]+ */
  name: string;
  system: string;
  user: string;
  schema: JsonSchema;
  /** Returns the typed value, or throws an Error whose message says what is wrong (fed back to the model once). */
  validate(value: unknown): T;
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly provider: AiProvider;
  readonly model: string;
  /**
   * One structured call: sends system + user with the schema enforced, parses and validates the answer. On invalid
   * JSON or a validation error it retries once, adding the error to the conversation. Rejects with AiError.
   */
  generateJson<T>(request: JsonRequest<T>): Promise<T>;
}

export type AiErrorCode =
  | "not-configured" // disabled, or no model
  | "remote-not-allowed" // remote endpoint without consent; nothing was sent
  | "unreachable" // connection refused, DNS, TLS
  | "timeout"
  | "auth" // 401/403
  | "http" // other non-2xx
  | "bad-output"; // not JSON, or failed validation twice

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** One model offered in the Settings dropdown. */
export interface AiModelInfo {
  id: string;
  /** "9.0B Q4_K_M" for Ollama; null when the server doesn't say. */
  details: string | null;
  /**
   * False when the server says the model can't do what Run Hound needs (Ollama capabilities without "completion",
   * or an embedding model); null when unknown.
   */
  suitable: boolean | null;
}

export interface AiModelList {
  models: AiModelInfo[];
  /** Plain-language reason when the list is empty or failed: "Nothing is answering at http://127.0.0.1:11434 — is Ollama running?". */
  error: string | null;
}
