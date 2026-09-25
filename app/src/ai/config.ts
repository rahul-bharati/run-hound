import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isPrivateAddress } from "../engine/safety.js";
import { AI_PROVIDERS, type AiConfig, type AiConfigPatch, type AiFeatures, type AiProvider, type AiStatus, type ConfigSource } from "./types.js";

/** Default endpoints per provider, used when baseUrl is empty and to prefill the Settings form. */
export const DEFAULT_BASE_URLS = {
  ollama: "http://127.0.0.1:11434/v1",
  "openai-compatible": "http://127.0.0.1:1234/v1",
  bedrock: "",
} as const;

/** AI off, provider "ollama", its default base URL, no model, all three features on (they apply once enabled), 120 s. */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: "ollama",
  baseUrl: DEFAULT_BASE_URLS.ollama,
  model: "",
  apiKey: null,
  region: null,
  allowRemote: false,
  features: { review: true, suggest: true, explain: true },
  timeoutMs: 120_000,
};

/**
 * Directory of the saved config: $RUNHOUND_CONFIG_DIR, else $XDG_CONFIG_HOME/run-hound, else ~/.config/run-hound.
 * `env` defaults to process.env; `home` to os.homedir().
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  if (env.RUNHOUND_CONFIG_DIR) return env.RUNHOUND_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "run-hound");
  return join(home ?? homedir(), ".config", "run-hound");
}

/** Path of the saved AI config: <configDir>/ai.json. */
export function configFile(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  return join(configDir(env, home), "ai.json");
}

/** CLI flag overrides (`run --ai --ai-provider … --ai-model … --ai-base-url … --ai-allow-remote`). */
export interface AiFlags {
  enabled?: boolean;
  provider?: AiConfig["provider"];
  model?: string;
  baseUrl?: string;
  allowRemote?: boolean;
}

export interface ResolvedAiConfig {
  config: AiConfig;
  sources: AiStatus["sources"];
  file: string;
}

type Field = keyof AiStatus["sources"];
type Layer = Partial<Omit<AiConfig, "features">> & { features?: Partial<AiFeatures> };

const FIELDS: readonly Field[] = ["enabled", "provider", "baseUrl", "model", "apiKey", "region", "allowRemote", "features", "timeoutMs"];
const FEATURE_NAMES: readonly (keyof AiFeatures)[] = ["review", "suggest", "explain"];

const isProvider = (v: unknown): v is AiProvider => typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
const isTimeout = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Keeps only well-typed fields of a saved file; anything else is ignored. */
function fromFile(raw: unknown): Layer {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Layer = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (isProvider(r.provider)) out.provider = r.provider;
  if (typeof r.baseUrl === "string") out.baseUrl = r.baseUrl;
  if (typeof r.model === "string") out.model = r.model;
  if (typeof r.apiKey === "string" && r.apiKey !== "") out.apiKey = r.apiKey;
  if (typeof r.region === "string" && r.region !== "") out.region = r.region;
  if (typeof r.allowRemote === "boolean") out.allowRemote = r.allowRemote;
  if (typeof r.allowRemoteHost === "string" && r.allowRemoteHost !== "") out.allowRemoteHost = r.allowRemoteHost;
  if (isTimeout(r.timeoutMs)) out.timeoutMs = r.timeoutMs;
  if (typeof r.features === "object" && r.features !== null) {
    const f = r.features as Record<string, unknown>;
    const features: Partial<AiFeatures> = {};
    for (const name of FEATURE_NAMES) if (typeof f[name] === "boolean") features[name] = f[name];
    if (Object.keys(features).length > 0) out.features = features;
  }
  return out;
}

async function readSaved(file: string): Promise<Layer> {
  try {
    return fromFile(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return {}; // missing, unreadable or corrupt: defaults
  }
}

function envBool(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return undefined;
}

/** The env layer, plus the variable each field came from (for "locked" errors). */
function fromEnv(env: NodeJS.ProcessEnv): { layer: Layer; names: Partial<Record<Field, string>> } {
  const layer: Layer = {};
  const names: Partial<Record<Field, string>> = {};
  const set = <K extends Field>(field: K, value: Layer[K] | undefined, name: string) => {
    if (value === undefined) return;
    (layer as Record<string, unknown>)[field] = value;
    names[field] = name;
  };
  const str = (name: string) => (env[name] ? env[name] : undefined);
  set("enabled", envBool(env.RUNHOUND_AI), "RUNHOUND_AI");
  set("provider", isProvider(env.RUNHOUND_AI_PROVIDER) ? env.RUNHOUND_AI_PROVIDER : undefined, "RUNHOUND_AI_PROVIDER");
  set("baseUrl", str("RUNHOUND_AI_BASE_URL"), "RUNHOUND_AI_BASE_URL");
  set("model", str("RUNHOUND_AI_MODEL"), "RUNHOUND_AI_MODEL");
  set("apiKey", str("RUNHOUND_AI_API_KEY"), "RUNHOUND_AI_API_KEY");
  set("region", str("RUNHOUND_AI_REGION"), "RUNHOUND_AI_REGION");
  set("allowRemote", envBool(env.RUNHOUND_AI_ALLOW_REMOTE), "RUNHOUND_AI_ALLOW_REMOTE");
  const timeout = env.RUNHOUND_AI_TIMEOUT_MS?.trim() ? Number(env.RUNHOUND_AI_TIMEOUT_MS) : undefined;
  set("timeoutMs", isTimeout(timeout) ? timeout : undefined, "RUNHOUND_AI_TIMEOUT_MS");
  if (env.RUNHOUND_AI_FEATURES?.trim()) {
    const list = env.RUNHOUND_AI_FEATURES.split(",").map((s) => s.trim().toLowerCase());
    set("features", { review: list.includes("review"), suggest: list.includes("suggest"), explain: list.includes("explain") }, "RUNHOUND_AI_FEATURES");
  }
  return { layer, names };
}

function fromFlags(flags: AiFlags): Layer {
  const out: Layer = {};
  if (flags.enabled !== undefined) out.enabled = flags.enabled;
  if (isProvider(flags.provider)) out.provider = flags.provider;
  if (flags.baseUrl !== undefined) out.baseUrl = flags.baseUrl;
  if (flags.model !== undefined) out.model = flags.model;
  if (flags.allowRemote !== undefined) out.allowRemote = flags.allowRemote;
  return out;
}

interface Resolution extends ResolvedAiConfig {
  /** The variable behind each env-sourced field. */
  envNames: Partial<Record<Field, string>>;
}

/** `saved` replaces the file's contents (saveAiConfig uses it to see where a patch would point before writing). */
async function resolve(env: NodeJS.ProcessEnv, flags: AiFlags, home: string | undefined, saved?: Layer): Promise<Resolution> {
  const file = configFile(env, home);
  const { layer: envLayer, names: envNames } = fromEnv(env);
  const fileLayer = saved ?? (await readSaved(file));
  const layers: [ConfigSource, Layer][] = [
    ["file", fileLayer],
    ["env", envLayer],
    ["flag", fromFlags(flags)],
  ];
  const config: AiConfig = { ...DEFAULT_AI_CONFIG, features: { ...DEFAULT_AI_CONFIG.features } };
  const sources = Object.fromEntries(FIELDS.map((f) => [f, "default"])) as AiStatus["sources"];
  const rank: Record<ConfigSource, number> = { default: 0, file: 1, env: 2, flag: 3 };

  for (const [source, layer] of layers) {
    for (const field of FIELDS) {
      const value = layer[field];
      if (value === undefined) continue;
      if (field === "features") config.features = { ...config.features, ...(value as Partial<AiFeatures>) };
      else (config as unknown as Record<string, unknown>)[field] = value;
      sources[field] = source;
    }
  }

  // A provider set with no base URL from the same or a later source gets that provider's default URL.
  if (rank[sources.baseUrl] < rank[sources.provider]) {
    config.baseUrl = DEFAULT_BASE_URLS[config.provider];
    sources.baseUrl = sources.provider;
  }

  if (config.provider === "bedrock") {
    if (config.apiKey === null && env.AWS_BEARER_TOKEN_BEDROCK) {
      config.apiKey = env.AWS_BEARER_TOKEN_BEDROCK;
      sources.apiKey = "env";
      envNames.apiKey = "AWS_BEARER_TOKEN_BEDROCK";
    }
    if (config.region === null) {
      const name = env.AWS_REGION ? "AWS_REGION" : env.AWS_DEFAULT_REGION ? "AWS_DEFAULT_REGION" : null;
      if (name) {
        config.region = env[name]!;
        sources.region = "env";
        envNames.region = name;
      }
    }
  }

  // Consent saved from the Settings page names the host it was given for, and counts for that host only. Consent from
  // env or a flag applies to whatever endpoint this invocation uses.
  if (sources.allowRemote === "file") {
    const host = fileLayer.allowRemoteHost ?? null;
    if (host !== null) config.allowRemoteHost = host;
    if (config.allowRemote && host !== endpointHost(config)) config.allowRemote = false;
  }
  return { config, sources, file, envNames };
}

/**
 * Resolves the effective config: DEFAULT_AI_CONFIG < saved file (missing or unreadable file = defaults; a corrupt
 * file or a mistyped field in it is ignored, not thrown) < env < flags. Empty env values count as unset.
 * Env: RUNHOUND_AI ("1"/"true"/"on" | "0"/"false"/"off"), RUNHOUND_AI_PROVIDER, RUNHOUND_AI_MODEL,
 * RUNHOUND_AI_BASE_URL, RUNHOUND_AI_API_KEY, RUNHOUND_AI_REGION, RUNHOUND_AI_ALLOW_REMOTE, RUNHOUND_AI_TIMEOUT_MS,
 * RUNHOUND_AI_FEATURES (comma list of review,suggest,explain). For bedrock, a missing key falls back to
 * AWS_BEARER_TOKEN_BEDROCK and a missing region to AWS_REGION, then AWS_DEFAULT_REGION (source "env").
 * Setting a provider (anywhere) with no base URL from the same or a later source uses that provider's default URL.
 * Unknown provider names and non-numeric timeouts are ignored (the lower source stands).
 * Consent from the file counts only when the file's allowRemoteHost equals endpointHost of the resolved config (then
 * config.allowRemoteHost is that host); otherwise allowRemote resolves to false. Env/flag consent names no host.
 */
export async function resolveAiConfig(options: { env?: NodeJS.ProcessEnv; flags?: AiFlags; home?: string } = {}): Promise<ResolvedAiConfig> {
  const { config, sources, file } = await resolve(options.env ?? process.env, options.flags ?? {}, options.home);
  return { config, sources, file };
}

/** Throws unless the value is empty or an http(s) URL; returns it without a trailing slash. */
function checkBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("The base URL must be a string");
  if (value === "") return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The base URL "${value}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The base URL must start with http:// or https://");
  return value.replace(/\/+$/, "");
}

/** Where a saved key may be sent: the base URL's origin, or any Bedrock region's default endpoint. */
function keyOrigin(config: Pick<AiConfig, "provider" | "baseUrl">): string {
  if (config.provider === "bedrock" && !config.baseUrl) return "bedrock";
  try {
    return new URL(config.baseUrl).origin;
  } catch {
    return config.baseUrl;
  }
}

/**
 * Writes the file atomically and private from the start: a temp file in the same directory, created with mode 0600,
 * then renamed over the target (so a pre-existing looser file never holds the new contents). The directory is created
 * with mode 0700.
 */
async function writePrivate(file: string, text: string): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.ai.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Set on saveAiConfig's result when a saved key was dropped because the endpoint changed. */
export const KEY_REMOVED_NOTICE = "The saved API key was removed because the endpoint changed.";

/**
 * Applies a patch to the saved file and writes it with mode 0600 (atomically, see writePrivate), creating the
 * directory (0700). A field whose source is
 * env is rejected with an Error naming the variable when the patch changes its value (sending the current value
 * back is allowed and not saved). `apiKey` undefined or "" keeps the saved key; null removes it. Changing the
 * provider without a baseUrl drops the saved base URL (the new provider's default applies). Validates: provider in
 * AI_PROVIDERS, baseUrl empty or an http(s) URL (trailing slash removed), timeoutMs 5 000–600 000; nothing is
 * written when validation fails. Returns the newly resolved config.
 * Consent: allowRemote true is saved with allowRemoteHost = endpointHost of the patched config; a patch that moves the
 * endpoint to another host without allowRemote: true clears the saved consent.
 * Key: a patch that changes the provider or the endpoint origin (keyOrigin) without a new apiKey removes the saved key,
 * and the result carries `notice` (KEY_REMOVED_NOTICE).
 */
export async function saveAiConfig(patch: AiConfigPatch, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<ResolvedAiConfig & { notice?: string }> {
  const env = options.env ?? process.env;
  const current = await resolve(env, {}, options.home);
  const changes: Record<string, unknown> = {};

  for (const field of FIELDS) {
    let value: unknown = patch[field];
    if (value === undefined || (field === "apiKey" && value === "")) continue;
    if (field === "provider" && !isProvider(value)) throw new Error(`Unknown provider "${String(value)}"`);
    if (field === "baseUrl") value = checkBaseUrl(value);
    if (field === "timeoutMs" && (typeof value !== "number" || !Number.isFinite(value) || value < 5_000 || value > 600_000)) {
      throw new Error("The timeout must be between 5 000 and 600 000 ms");
    }
    if ((field === "enabled" || field === "allowRemote") && typeof value !== "boolean") throw new Error(`${field} must be true or false`);
    if ((field === "model" || field === "region" || field === "apiKey") && value !== null && typeof value !== "string") throw new Error(`${field} must be a string`);
    if (field === "features") value = { ...current.config.features, ...(value as Partial<AiFeatures>) };
    if (current.sources[field] === "env") {
      if (JSON.stringify(value) === JSON.stringify(current.config[field])) continue;
      throw new Error(`${field} is set by ${current.envNames[field] ?? "an environment variable"} and can't be changed here`);
    }
    changes[field] = value;
  }

  const saved = (await readSaved(current.file)) as Record<string, unknown>;
  if (changes.provider !== undefined && changes.provider !== saved.provider && changes.baseUrl === undefined) delete saved.baseUrl;
  const next: Record<string, unknown> = { ...saved, ...changes };
  if (next.apiKey === null) delete next.apiKey;
  if (next.region === null || next.region === "") delete next.region;

  // Where requests went before this patch and where they will go after it.
  const before = current.config;
  const after = (await resolve(env, {}, options.home, fromFile(next))).config;
  let notice: string | undefined;
  if (typeof next.apiKey === "string" && changes.apiKey === undefined && (before.provider !== after.provider || keyOrigin(before) !== keyOrigin(after))) {
    delete next.apiKey;
    notice = KEY_REMOVED_NOTICE;
  }
  if (changes.allowRemote === true) next.allowRemoteHost = endpointHost(after);
  else if (changes.allowRemote === false) delete next.allowRemoteHost;
  else if (endpointHost(before) !== endpointHost(after)) {
    delete next.allowRemote;
    delete next.allowRemoteHost;
  }

  await writePrivate(current.file, `${JSON.stringify(next, null, 2)}\n`);
  const resolved = await resolveAiConfig({ env, home: options.home });
  return notice ? { ...resolved, notice } : resolved;
}

const LOCAL_NAMES = new Set(["localhost", "host.docker.internal", "host.containers.internal"]);

/**
 * True when requests would leave this machine / private network: bedrock always; otherwise when the base URL's host
 * is not "localhost", "*.localhost", "host.docker.internal", "host.containers.internal" or a literal private address
 * (engine/safety.ts isPrivateAddress). Host names are not resolved (a public name is remote); an unparsable URL is remote.
 */
export function isRemote(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): boolean {
  if (config.provider === "bedrock") return true;
  let host: string;
  try {
    host = new URL(config.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  return !(LOCAL_NAMES.has(host) || host.endsWith(".localhost") || isPrivateAddress(host));
}

/** Host shown in consent text: base URL host (with a non-default port), or bedrock-runtime.<region>.amazonaws.com. */
export function endpointHost(config: Pick<AiConfig, "provider" | "baseUrl" | "region">): string {
  if (config.provider === "bedrock" && !config.baseUrl) return `bedrock-runtime.${config.region ?? "<region>"}.amazonaws.com`;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}

/**
 * The status for the UI and CLI. `problem`, first match wins: "AI is off" (disabled), "Choose a model",
 * "Choose a Bedrock region" (bedrock without region), "Bedrock needs an API key or AWS access keys" (bedrock with no
 * apiKey and no AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in env), "Sending page structure to <host> needs your consent"
 * (remote && !allowRemote); else null.
 */
export function aiStatus(resolved: ResolvedAiConfig, env: NodeJS.ProcessEnv = process.env): AiStatus {
  const c = resolved.config;
  const awsKeys = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const hasKey = Boolean(c.apiKey) || (c.provider === "bedrock" && awsKeys);
  const remote = isRemote(c);
  const host = endpointHost(c);
  let problem: string | null = null;
  if (!c.enabled) problem = "AI is off";
  else if (!c.model) problem = "Choose a model";
  else if (c.provider === "bedrock" && !c.region) problem = "Choose a Bedrock region";
  else if (c.provider === "bedrock" && !hasKey) problem = "Bedrock needs an API key or AWS access keys";
  else if (remote && !c.allowRemote) problem = `Sending page structure to ${host} needs your consent`;
  return {
    enabled: c.enabled,
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    region: c.region,
    allowRemote: c.allowRemote,
    features: { ...c.features },
    timeoutMs: c.timeoutMs,
    hasKey,
    remote,
    host,
    problem,
    sources: { ...resolved.sources },
    file: resolved.file,
  };
}

export type { ConfigSource };
