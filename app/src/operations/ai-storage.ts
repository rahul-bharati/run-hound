/**
 * Persistence for the saved AI config: reading, applying a patch, returning the status view. The declarations
 * (defaults, validators, endpoint helpers) live in `config/ai.ts`; the fixed values (provider set, default base URLs,
 * key-removed notice) live in `constants/ai-constants.ts`; interfaces (AiFlags, ResolvedAiConfig, ConfigSource) live
 * in `interfaces/ai.ts`. This module is the only place that opens the AI config file.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { awsCredentialsAvailable, awsProfileRegion, NO_CREDENTIALS } from "../ai/aws-credentials.js";
import {
  type AiConfig,
  type AiConfigPatch,
  type AiFeatures,
  type AiProvider,
  type AiStatus,
} from "../ai/types.js";
import { looksRandom, registerSecretLiterals } from "../engine/redact.js";
import {
  DEFAULT_AI_CONFIG,
  configFile,
  endpointHost,
  isAwsRegion,
  isRemote,
  keyOriginFor,
} from "../config/ai.js";
import {
  AI_PROVIDERS,
  DEFAULT_BASE_URLS,
  FIXED_ENDPOINT_PROVIDERS,
  KEY_REMOVED_NOTICE,
  LEGACY_DEFAULT_PROVIDER,
  PROVIDER_LABELS,
  KEYS_FROM_ENVIRONMENT,
  plainTextKeyNotice,
} from "../constants/ai-constants.js";
import type { AiFlags, ConfigSource, ResolvedAiConfig } from "../interfaces/ai.js";
import { readSecrets, secretProtection, writeSecrets } from "./secret-store.js";

type Field = Exclude<keyof Required<AiStatus["sources"]>, "awsKeys">;
type Layer = Partial<Omit<AiConfig, "features">> & { features?: Partial<AiFeatures> };

const FIELDS: readonly Field[] = ["enabled", "provider", "baseUrl", "model", "apiKey", "region", "awsProfile", "allowRemote", "features", "timeoutMs"];
const FEATURE_NAMES: readonly (keyof AiFeatures)[] = ["review", "suggest", "explain"];
/** Bedrock's AWS secrets, saved in the encrypted store (secret-store.ts) as "ai.<field>", never in the file. */
const SECRET_FIELDS = ["awsSecretAccessKey", "awsSessionToken"] as const;
const secretName = (field: (typeof SECRET_FIELDS)[number]): string => `ai.${field}`;
/** Each provider keeps its own API key in the encrypted store under this name, bound to the origin in `keyOrigins`. */
const keyName = (provider: AiProvider): string => `ai.key.${provider}`;
/** The one API key saved before 0.7 (in the store, or in plain text as the file's `apiKey`), for the file's provider. */
const LEGACY_KEY = "ai.apiKey";
const nonEmptyString = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Written into every file saved since 0.7, so a file without it is known to be older (FILE_VERSION absent: before 0.7). */
const FILE_VERSION = 2;

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
  if (isAwsRegion(r.region)) out.region = r.region;
  if (typeof r.awsProfile === "string" && r.awsProfile !== "") out.awsProfile = r.awsProfile;
  // Kept as saved (even half a pair, so its secret is still registered for redaction); resolve() applies only a whole pair.
  if (typeof r.awsAccessKeyId === "string" && r.awsAccessKeyId !== "") out.awsAccessKeyId = r.awsAccessKeyId;
  if (typeof r.awsSecretAccessKey === "string" && r.awsSecretAccessKey !== "") out.awsSecretAccessKey = r.awsSecretAccessKey;
  if (typeof r.awsSessionToken === "string" && r.awsSessionToken !== "") out.awsSessionToken = r.awsSessionToken;
  if (typeof r.allowRemote === "boolean") out.allowRemote = r.allowRemote;
  if (typeof r.allowRemoteHost === "string" && r.allowRemoteHost !== "") out.allowRemoteHost = r.allowRemoteHost;
  if (typeof r.apiKeyOrigin === "string" && r.apiKeyOrigin !== "") out.apiKeyOrigin = r.apiKeyOrigin;
  if (isTimeout(r.timeoutMs)) out.timeoutMs = r.timeoutMs;
  if (typeof r.features === "object" && r.features !== null) {
    const f = r.features as Record<string, unknown>;
    const features: Partial<AiFeatures> = {};
    for (const name of FEATURE_NAMES) if (typeof f[name] === "boolean") features[name] = f[name];
    if (Object.keys(features).length > 0) out.features = features;
  }
  return out;
}

/** A provider's saved API key and the origin it was saved for (null: a key saved before 0.7 with no origin recorded). */
interface KeySlot {
  key: string;
  origin: string | null;
  /** The one key saved before 0.7, for the file's provider; it moves into that provider's own slot. */
  legacy: boolean;
}
type KeySlots = Partial<Record<AiProvider, KeySlot>>;

interface Saved {
  /** The file's settings, with Bedrock's AWS secrets filled in. API keys are in `keys`, never in the layer. */
  layer: Layer;
  /** Each provider's saved API key. */
  keys: KeySlots;
  /** The AWS secrets the store holds, by field. */
  stored: Partial<Record<(typeof SECRET_FIELDS)[number], string>>;
  /** True when the file still holds a secret in plain text, or the store holds the one key saved before 0.7. */
  legacy: boolean;
  /** True when the store holds the one key saved before 0.7 (LEGACY_KEY). */
  legacyStored: boolean;
  /** True when the file holds settings but names no provider: it was saved before 0.7, when Ollama was the default. */
  implicitProvider: boolean;
  /** A plain-text key the file still holds for a provider that has its own saved key since: unused, but redacted. */
  superseded: string[];
  notice: string | null;
}

/** What resolve() reads instead of the file when saveAiConfig previews a patch. */
type SavedView = Pick<Saved, "layer" | "keys" | "implicitProvider">;

const NOTHING_SAVED: Saved = { layer: {}, keys: {}, stored: {}, legacy: false, legacyStored: false, implicitProvider: false, superseded: [], notice: null };

async function readSaved(file: string, env: NodeJS.ProcessEnv): Promise<Saved> {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isRecord(parsed)) return { ...NOTHING_SAVED, keys: {}, superseded: [] };
    raw = parsed;
  } catch {
    return { ...NOTHING_SAVED, keys: {}, superseded: [] }; // missing, unreadable or corrupt: defaults
  }
  const plain = nonEmptyString(raw.apiKey) !== null || SECRET_FIELDS.some((field) => nonEmptyString(raw[field]) !== null);
  const store = await readSecrets(dirname(file), { env });
  const stored: Saved["stored"] = {};
  for (const field of SECRET_FIELDS) {
    const value = store.values[secretName(field)];
    if (value === undefined) continue;
    stored[field] = value;
    if (nonEmptyString(raw[field]) === null) raw[field] = value;
  }
  const layer = fromFile(raw);
  delete layer.apiKey;
  delete layer.apiKeyOrigin;
  const origins = isRecord(raw.keyOrigins) ? raw.keyOrigins : {};
  const keys: KeySlots = {};
  for (const provider of AI_PROVIDERS) {
    const key = store.values[keyName(provider)];
    if (key !== undefined) keys[provider] = { key, origin: nonEmptyString(origins[provider]), legacy: false };
  }
  const legacyStored = store.values[LEGACY_KEY] !== undefined;
  const legacyKey = nonEmptyString(raw.apiKey) ?? store.values[LEGACY_KEY] ?? null;
  const legacyProvider = layer.provider ?? LEGACY_DEFAULT_PROVIDER;
  const superseded: string[] = [];
  if (legacyKey !== null && !keys[legacyProvider]) keys[legacyProvider] = { key: legacyKey, origin: nonEmptyString(raw.apiKeyOrigin), legacy: true };
  else if (legacyKey !== null && keys[legacyProvider]!.key !== legacyKey) superseded.push(legacyKey);
  // Only a file from before 0.7 (no version) that names no provider meant Ollama; one saved since may name none.
  const implicitProvider = raw.version !== FILE_VERSION && layer.provider === undefined && (Object.keys(layer).length > 0 || legacyKey !== null);
  const notice = plain && store.protection === "environment" ? plainTextKeyNotice(file) : store.problem;
  return { layer, keys, stored, legacy: plain || legacyStored, legacyStored, implicitProvider, superseded, notice };
}

/**
 * Moves what was saved before the per-provider key store into it, then rewrites the file without it: AWS secrets and
 * the one API key in plain text in the file, and the one key the store held under LEGACY_KEY, which becomes the file's
 * provider's own key (bound to `apiKeyOrigin`, or the file's endpoint) unless that provider already has one. A file
 * that names no provider gets Ollama, what it meant then. A store that can't be written (environment only, or locked
 * by the desktop app's OS keychain) leaves everything as it is.
 */
async function moveSecretsOut(file: string, env: NodeJS.ProcessEnv, region: string | null): Promise<void> {
  if (secretProtection(env) === "environment") return;
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isRecord(parsed)) return;
    raw = parsed;
  } catch {
    return;
  }
  const store = await readSecrets(dirname(file), { env });
  const layer = fromFile(raw);
  const provider = layer.provider ?? LEGACY_DEFAULT_PROVIDER;
  const updates: Record<string, string | null> = {};
  for (const field of SECRET_FIELDS) {
    const value = nonEmptyString(raw[field]);
    if (value !== null) updates[secretName(field)] = value;
  }
  const origins: Record<string, unknown> = { ...(isRecord(raw.keyOrigins) ? raw.keyOrigins : {}) };
  const legacyKey = nonEmptyString(raw.apiKey) ?? store.values[LEGACY_KEY] ?? null;
  if (legacyKey !== null && store.values[keyName(provider)] === undefined) {
    updates[keyName(provider)] = legacyKey;
    origins[provider] = nonEmptyString(raw.apiKeyOrigin) ?? legacyKeyOrigin(layer, region);
  }
  if (store.values[LEGACY_KEY] !== undefined) updates[LEGACY_KEY] = null;
  const inFile = raw.apiKey !== undefined || raw.apiKeyOrigin !== undefined || SECRET_FIELDS.some((field) => raw[field] !== undefined);
  if (Object.keys(updates).length === 0 && !inFile) return;
  if (Object.keys(updates).length > 0) {
    try {
      await writeSecrets(dirname(file), updates, { env });
    } catch {
      return;
    }
  }
  // Everything secret is in the store now (a plain-text key whose provider already had its own is dropped).
  for (const field of SECRET_FIELDS) delete raw[field];
  delete raw.apiKey;
  delete raw.apiKeyOrigin;
  if (Object.keys(origins).length > 0) raw.keyOrigins = origins;
  if (raw.provider === undefined && raw.version !== FILE_VERSION) raw.provider = provider;
  raw.version = FILE_VERSION;
  await writePrivate(file, `${JSON.stringify(raw, null, 2)}\n`);
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
  set("region", isAwsRegion(env.RUNHOUND_AI_REGION) ? env.RUNHOUND_AI_REGION : undefined, "RUNHOUND_AI_REGION");
  set("awsProfile", str("RUNHOUND_AI_AWS_PROFILE"), "RUNHOUND_AI_AWS_PROFILE");
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
  /** The variable behind each env-sourced field (awsKeys: the AWS access key pair). */
  envNames: Partial<Record<Field | "awsKeys", string>>;
  /**
   * Every AI secret this resolution read, whether or not it applies: the file's apiKey, awsSecretAccessKey and
   * awsSessionToken; RUNHOUND_AI_API_KEY; for Bedrock AWS_BEARER_TOKEN_BEDROCK, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN.
   */
  secrets: string[];
  /** True when something saved before the per-provider key store is left (resolveAiConfig moves it). */
  legacySecrets: boolean;
}

/** `saved` replaces the file's contents (saveAiConfig uses it to see where a patch would point before writing). */
async function resolve(env: NodeJS.ProcessEnv, flags: AiFlags, home: string | undefined, saved?: SavedView): Promise<Resolution> {
  const file = configFile(env, home);
  const { layer: envLayer, names } = fromEnv(env);
  const envNames: Resolution["envNames"] = names;
  const flagLayer = fromFlags(flags);
  const read: Saved = saved ? { ...NOTHING_SAVED, ...saved } : await readSaved(file, env);
  // A file saved before 0.7 that names no provider meant Ollama, the default then; otherwise there is no default.
  const filePart: Layer = read.implicitProvider && read.layer.provider === undefined ? { ...read.layer, provider: LEGACY_DEFAULT_PROVIDER } : read.layer;
  // The saved key is the effective provider's own, bound to the origin it was saved for. A key saved since 0.7 with no
  // origin recorded (a hand-edited file) is bound to nothing, so it is never sent.
  const provider = flagLayer.provider ?? envLayer.provider ?? filePart.provider ?? null;
  const slot = provider ? read.keys[provider] : undefined;
  const slotOrigin = slot ? (slot.origin ?? (slot.legacy ? undefined : "an unknown origin")) : undefined;
  const fileLayer: Layer = slot ? { ...filePart, apiKey: slot.key, ...(slotOrigin ? { apiKeyOrigin: slotOrigin } : {}) } : filePart;
  const layers: [ConfigSource, Layer][] = [
    ["file", fileLayer],
    ["env", envLayer],
    ["flag", flagLayer],
  ];
  const config: AiConfig = { ...DEFAULT_AI_CONFIG, features: { ...DEFAULT_AI_CONFIG.features } };
  const sources = { ...Object.fromEntries(FIELDS.map((f) => [f, "default"])), awsKeys: "default" } as Required<AiStatus["sources"]>;
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
    config.baseUrl = config.provider ? DEFAULT_BASE_URLS[config.provider] : "";
    sources.baseUrl = sources.provider;
  }
  // Anthropic, OpenAI and Gemini have one official endpoint; a saved or set base URL never moves their key elsewhere.
  if (config.provider && FIXED_ENDPOINT_PROVIDERS.has(config.provider)) {
    config.baseUrl = DEFAULT_BASE_URLS[config.provider];
    sources.baseUrl = sources.provider;
  }

  if (config.provider === "bedrock") {
    if (!config.awsProfile && env.AWS_PROFILE) {
      config.awsProfile = env.AWS_PROFILE;
      sources.awsProfile = "env";
      envNames.awsProfile = "AWS_PROFILE";
    }
    if (config.region === null) {
      const name = isAwsRegion(env.AWS_REGION) ? "AWS_REGION" : isAwsRegion(env.AWS_DEFAULT_REGION) ? "AWS_DEFAULT_REGION" : null;
      if (name) {
        config.region = env[name]!;
        sources.region = "env";
        envNames.region = name;
      } else {
        // The profile's region (shared config file); source stays "default", so the Settings page can override it.
        const region = awsProfileRegion({ env, profile: config.awsProfile ?? null, ...(home ? { home } : {}) });
        config.region = isAwsRegion(region) ? region : null;
      }
    }
  }

  // A key saved from the Settings page is bound to the origin it was saved for (a legacy file without apiKeyOrigin:
  // the file's own endpoint) and is not applied when a flag or env points this invocation elsewhere (Rule 7).
  let staleKey: ResolvedAiConfig["staleKey"];
  if (sources.apiKey === "file") {
    const savedFor = fileLayer.apiKeyOrigin ?? legacyKeyOrigin(fileLayer, config.region);
    const endpoint = keyOriginFor(config);
    if (savedFor === endpoint) config.apiKeyOrigin = savedFor;
    else {
      config.apiKey = null;
      sources.apiKey = "default";
      staleKey = { savedFor, endpoint };
    }
  }

  if (config.provider === "bedrock" && config.apiKey === null && env.AWS_BEARER_TOKEN_BEDROCK) {
    config.apiKey = env.AWS_BEARER_TOKEN_BEDROCK;
    sources.apiKey = "env";
    envNames.apiKey = "AWS_BEARER_TOKEN_BEDROCK";
  }

  // The AWS access key pair resolves as a unit from one source (defaults < file < env, no flag): a layer counts only
  // with both the ID and the secret, and the session token comes only from the same layer as its pair. The env pair
  // is for Bedrock only, like AWS_BEARER_TOKEN_BEDROCK.
  if (fileLayer.awsAccessKeyId && fileLayer.awsSecretAccessKey) {
    config.awsAccessKeyId = fileLayer.awsAccessKeyId;
    config.awsSecretAccessKey = fileLayer.awsSecretAccessKey;
    config.awsSessionToken = fileLayer.awsSessionToken ?? null;
    sources.awsKeys = "file";
  }
  if (config.provider === "bedrock" && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    config.awsAccessKeyId = env.AWS_ACCESS_KEY_ID;
    config.awsSecretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    config.awsSessionToken = env.AWS_SESSION_TOKEN || null;
    sources.awsKeys = "env";
    envNames.awsKeys = "AWS_ACCESS_KEY_ID";
  }

  // fileLayer.apiKey and RUNHOUND_AI_API_KEY are registered only when they look like a real credential: an API key
  // has no fixed shape (unlike an AWS secret access key, always 40 chars), and a short, ordinary-looking placeholder
  // used with a local server ("ollama", "none", "test", "lm-studio") would otherwise be redacted as a literal
  // everywhere Run Hound writes its own output — reports, exported specs, progress and `ai status` (docs/decisions
  // 2026-09-30-ai-secrets-redacted). The AWS pair and the Bedrock bearer token are always registered unconditionally:
  // they are always long, so this never keeps a real secret out.
  const secrets = [fileLayer.awsSecretAccessKey, fileLayer.awsSessionToken];
  for (const saved of Object.values(read.keys)) if (looksLikeApiKey(saved.key)) secrets.push(saved.key);
  for (const key of read.superseded) if (looksLikeApiKey(key)) secrets.push(key);
  if (looksLikeApiKey(env.RUNHOUND_AI_API_KEY)) secrets.push(env.RUNHOUND_AI_API_KEY);
  if (config.provider === "bedrock") secrets.push(env.AWS_BEARER_TOKEN_BEDROCK, env.AWS_SECRET_ACCESS_KEY, env.AWS_SESSION_TOKEN);

  // Consent saved from the Settings page names the host it was given for, and counts for that host only. Consent from
  // env or a flag applies to whatever endpoint this invocation uses.
  if (sources.allowRemote === "file") {
    const host = fileLayer.allowRemoteHost ?? null;
    if (host !== null) config.allowRemoteHost = host;
    if (config.allowRemote && host !== endpointHost(config)) config.allowRemote = false;
  }
  return {
    config,
    sources,
    file,
    envNames,
    secrets: secrets.filter((v): v is string => typeof v === "string" && v !== ""),
    legacySecrets: read.legacy,
    savedKeys: AI_PROVIDERS.filter((p) => read.keys[p] !== undefined),
    ...(staleKey ? { staleKey } : {}),
    ...(read.notice ? { secretNotice: read.notice } : {}),
  };
}

/** Shortest an API key can be and still count as a real credential without looking random (below: looksRandom must say so). */
const MIN_API_KEY_LENGTH = 16;

/**
 * True when `value` is worth registering with registerSecretLiterals: long enough (>= 16 chars) to be a real key, or
 * shorter but random-looking (mixes digits with upper- and lower-case letters, per looksRandom). False for short,
 * ordinary-looking placeholders such as "ollama", "none", "test" or "lm-studio", which local-server users set as the
 * API key and which registering would redact everywhere they appear in Run Hound's own output.
 */
function looksLikeApiKey(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && (value.length >= MIN_API_KEY_LENGTH || looksRandom(value));
}

/** Where a legacy saved key (no apiKeyOrigin) belongs: the file's own endpoint; Bedrock without a saved region: `region`. */
function legacyKeyOrigin(file: Layer, region: string | null): string {
  const provider = file.provider ?? LEGACY_DEFAULT_PROVIDER;
  const baseUrl = file.baseUrl ?? DEFAULT_BASE_URLS[provider];
  return keyOriginFor({ provider, baseUrl, region: file.region ?? region });
}

/**
 * Resolves the effective config: DEFAULT_AI_CONFIG < saved file (missing or unreadable file = defaults; a corrupt
 * file or a mistyped field in it is ignored, not thrown) < env < flags. Empty env values count as unset.
 * Env: RUNHOUND_AI ("1"/"true"/"on" | "0"/"false"/"off"), RUNHOUND_AI_PROVIDER, RUNHOUND_AI_MODEL,
 * RUNHOUND_AI_BASE_URL, RUNHOUND_AI_API_KEY, RUNHOUND_AI_REGION, RUNHOUND_AI_ALLOW_REMOTE, RUNHOUND_AI_TIMEOUT_MS,
 * RUNHOUND_AI_FEATURES (comma list of review,suggest,explain). For bedrock, a missing key falls back to
 * AWS_BEARER_TOKEN_BEDROCK and a missing region to AWS_REGION, then AWS_DEFAULT_REGION (source "env"), then the
 * `region` of the named AWS profile (source stays "default"; with no profile named ~/.aws is not read and the region
 * stays null). awsProfile: file < RUNHOUND_AI_AWS_PROFILE; for bedrock a missing one falls back to AWS_PROFILE (source
 * "env"); there is no implicit "default" profile.
 * The AWS access key pair (awsAccessKeyId, awsSecretAccessKey, awsSessionToken; sources.awsKeys): the file's whole
 * pair, then for bedrock AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN); a half pair counts as none,
 * and the token only comes with its own pair.
 * Setting a provider (anywhere) with no base URL from the same or a later source uses that provider's default URL.
 * Unknown provider names and non-numeric timeouts are ignored (the lower source stands).
 * Consent from the file counts only when the file's allowRemoteHost equals endpointHost of the resolved config (then
 * config.allowRemoteHost is that host); otherwise allowRemote resolves to false. Env/flag consent names no host.
 * A key from the file applies only while keyOriginFor(resolved config) equals the file's apiKeyOrigin (a legacy file
 * without one: keyOriginFor of the file's own provider/baseUrl/region); then config.apiKeyOrigin is that origin.
 * Otherwise apiKey resolves to null (source "default"; for bedrock AWS_BEARER_TOKEN_BEDROCK may still apply) and
 * `staleKey` says why. Env keys are never bound.
 *
 * Redaction (docs/launch-spec.md "Redaction"): every AI secret the resolution read (Resolution.secrets), applied or not,
 * is registered with registerSecretLiterals — except an API key (file apiKey or RUNHOUND_AI_API_KEY) too short and too
 * ordinary-looking to be a real credential (looksLikeApiKey), so a placeholder such as "ollama" or "test" used with a
 * local server isn't redacted out of every report, spec and CLI line Run Hound prints. The AWS secret access key,
 * session token and Bedrock bearer token are always registered: they are always long. The module holds one such
 * registration: each call registers its set and then drops the previous call's, so there is no gap and a secret the
 * config no longer holds stops being registered.
 */
export async function resolveAiConfig(options: { env?: NodeJS.ProcessEnv; flags?: AiFlags; home?: string } = {}): Promise<ResolvedAiConfig> {
  const env = options.env ?? process.env;
  const { config, sources, file, staleKey, secrets, legacySecrets, savedKeys, secretNotice } = await resolve(env, options.flags ?? {}, options.home);
  registerAiSecrets(secrets);
  if (legacySecrets) await moveSecretsOut(file, env, config.region);
  return { config, sources, file, ...(savedKeys ? { savedKeys } : {}), ...(staleKey ? { staleKey } : {}), ...(secretNotice ? { secretNotice } : {}) };
}

/**
 * The saved key of `provider`, for listing its models while Settings shows it before it is saved: only for a provider
 * with one official endpoint (Anthropic, OpenAI, Gemini), and only when the key is bound to that endpoint; else null.
 * A provider whose endpoint the user sets never gets its key here: it is sent only once saved with that endpoint.
 */
export async function savedFixedProviderKey(provider: AiProvider, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<string | null> {
  if (!FIXED_ENDPOINT_PROVIDERS.has(provider)) return null;
  const env = options.env ?? process.env;
  const slot = (await readSaved(configFile(env, options.home), env)).keys[provider];
  if (!slot || slot.legacy) return null;
  return slot.origin === keyOriginFor({ provider, baseUrl: DEFAULT_BASE_URLS[provider], region: null }) ? slot.key : null;
}

/** The live registration of the AI secrets resolveAiConfig last read. */
let aiSecretsRegistration: (() => void) | null = null;

/**
 * Registers `values`, then drops the previous registration (in that order, so a value held by both never lapses).
 * No secrets registers nothing: only the previous registration is dropped.
 */
function registerAiSecrets(values: string[]): void {
  const unregister = values.length > 0 ? registerSecretLiterals(values) : null;
  const previous = aiSecretsRegistration;
  aiSecretsRegistration = unregister;
  previous?.();
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
  // mkdir's mode only applies to a folder it creates: tighten one that was already there with looser permissions.
  await chmod(dir, 0o700).catch(() => undefined);
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

/** What a patch does to the saved AWS access key pair. */
type PairChange = { kind: "keep" } | { kind: "remove" } | { kind: "remove-token" } | { kind: "set"; id: string; secret: string; token: string | null };

/** An access key ID as IAM issues them: 16 to 128 letters, digits or underscores. */
const ACCESS_KEY_ID = /^\w{16,128}$/;

/**
 * Reads the patch's awsAccessKeyId, awsSecretAccessKey and awsSessionToken (docs/launch-spec.md "Saving"). Throws an
 * Error naming fields, never values: a non-string, one of the ID and secret without the other, a token without a new
 * pair, an ID that isn't 16 to 128 letters, digits or underscores, a secret or token with whitespace, or any change to
 * a pair set by the environment (naming AWS_ACCESS_KEY_ID).
 */
function pairChange(patch: AiConfigPatch, current: Resolution): PairChange {
  const id = patch.awsAccessKeyId;
  const secret = patch.awsSecretAccessKey;
  const token = patch.awsSessionToken;
  for (const [field, value] of [["awsAccessKeyId", id], ["awsSecretAccessKey", secret], ["awsSessionToken", token]] as const) {
    if (value !== undefined && value !== null && typeof value !== "string") throw new Error(`${field} must be a string`);
  }
  const remove = id === null || secret === null;
  const hasId = typeof id === "string" && id !== "";
  const hasSecret = typeof secret === "string" && secret !== "";
  const hasToken = typeof token === "string" && token !== "";
  const setting = hasId || hasSecret;
  if (!remove && !setting && !hasToken && token !== null) return { kind: "keep" };
  if (current.sources.awsKeys === "env") {
    throw new Error(`The AWS access keys are set by ${current.envNames.awsKeys ?? "AWS_ACCESS_KEY_ID"} and AWS_SECRET_ACCESS_KEY and can't be changed here`);
  }
  if (remove) {
    if (setting || hasToken) throw new Error("Send null to remove the AWS access keys, or both the access key ID and the secret access key to set them");
    return { kind: "remove" };
  }
  if (!setting) {
    if (hasToken) throw new Error("A session token is saved only with a new access key ID and secret access key");
    return { kind: "remove-token" };
  }
  if (!hasId || !hasSecret) throw new Error("Enter both the access key ID and the secret access key");
  if (!ACCESS_KEY_ID.test(id)) throw new Error("The access key ID must be 16 to 128 letters, digits or underscores");
  if (/\s/.test(secret)) throw new Error("The secret access key must not contain spaces or line breaks");
  if (hasToken && /\s/.test(token)) throw new Error("The session token must not contain spaces or line breaks");
  return { kind: "set", id, secret, token: hasToken ? token : null };
}

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
 * Keys: each provider keeps its own key in the encrypted store (`ai.key.<provider>`, bound to its origin in the file's
 * `keyOrigins`); `apiKey` sets or (null) removes the key of the provider in effect after the patch, and is refused
 * while no provider is chosen. Switching provider keeps every key. A patch that moves the same provider to another
 * endpoint origin (keyOrigin) without a new apiKey removes that provider's key, and the result carries `notice`
 * (KEY_REMOVED_NOTICE). A key is bound to keyOriginFor of the effective endpoint after the patch (a new key, or a kept
 * key that applied before; a key that didn't apply keeps its binding). A file saved before 0.7 is rewritten in this
 * shape: its one key becomes its provider's own, and a file naming no provider gets Ollama, what it meant then.
 * AWS access keys (pairChange): awsAccessKeyId and awsSecretAccessKey are saved together; both left out or "" keep the
 * saved pair; null for either removes the pair and its token; awsSessionToken is saved only with a new pair (a new pair
 * without one removes the saved token), and null alone removes the token. A pair set by the env is locked.
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
    if ((field === "model" || field === "region" || field === "apiKey" || field === "awsProfile") && value !== null && typeof value !== "string") throw new Error(`${field} must be a string`);
    if (field === "region" && value !== null && value !== "" && !isAwsRegion(value)) throw new Error(`"${String(value)}" is not an AWS region, such as us-east-1`);
    if (field === "features") value = { ...current.config.features, ...(value as Partial<AiFeatures>) };
    if (current.sources[field] === "env") {
      if (JSON.stringify(value) === JSON.stringify(current.config[field])) continue;
      throw new Error(`${field} is set by ${current.envNames[field] ?? "an environment variable"} and can't be changed here`);
    }
    changes[field] = value;
  }
  const pair = pairChange(patch, current);

  const read = await readSaved(current.file, env);
  const saved = { ...read.layer } as Record<string, unknown>;
  // A file saved before 0.7 without a provider meant Ollama: say so, now that there is no default.
  if (read.implicitProvider && saved.provider === undefined) saved.provider = LEGACY_DEFAULT_PROVIDER;
  if (changes.provider !== undefined && changes.provider !== saved.provider && changes.baseUrl === undefined) delete saved.baseUrl;
  // The key goes to its provider's own slot below, never into the file.
  const newKey = changes.apiKey as string | null | undefined;
  delete changes.apiKey;
  const next: Record<string, unknown> = { ...saved, ...changes };
  if (next.region === null || next.region === "") delete next.region;
  if (next.awsProfile === null || next.awsProfile === "") delete next.awsProfile;
  if (pair.kind === "remove") {
    delete next.awsAccessKeyId;
    delete next.awsSecretAccessKey;
    delete next.awsSessionToken;
  } else if (pair.kind === "remove-token") {
    delete next.awsSessionToken;
  } else if (pair.kind === "set") {
    next.awsAccessKeyId = pair.id;
    next.awsSecretAccessKey = pair.secret;
    if (pair.token) next.awsSessionToken = pair.token;
    else delete next.awsSessionToken;
  }

  // Where requests went before this patch and where they will go after it.
  const before = current.config;
  const keys: KeySlots = { ...read.keys };
  const after = (await resolve(env, {}, options.home, { layer: fromFile(next), keys, implicitProvider: false })).config;
  const target = after.provider;
  let notice: string | undefined;
  if (newKey !== undefined && target === null) throw new Error("Choose a provider before saving an API key");
  if (target !== null) {
    // Each provider keeps its own key: switching provider leaves every key where it is. A new key is bound to where
    // requests go now. Moving the same provider to another origin removes its key. A kept key that applied before
    // follows a same-origin change (a Bedrock region); one that did not apply (env or a flag moved the endpoint)
    // keeps its binding.
    const slot = keys[target];
    if (typeof newKey === "string") keys[target] = { key: newKey, origin: keyOriginFor(after), legacy: false };
    else if (newKey === null) delete keys[target];
    else if (slot && before.provider === target && keyOrigin(before) !== keyOrigin(after)) {
      delete keys[target];
      notice = KEY_REMOVED_NOTICE;
    } else if (slot && before.provider === target && before.apiKeyOrigin) keys[target] = { ...slot, origin: keyOriginFor(after) };
  }
  if (changes.allowRemote === true) next.allowRemoteHost = endpointHost(after);
  else if (changes.allowRemote === false) delete next.allowRemoteHost;
  else if (endpointHost(before) !== endpointHost(after)) {
    delete next.allowRemote;
    delete next.allowRemoteHost;
  }

  // Secrets go to the encrypted store, never the file. In the Docker image nothing new is saved: a key that would be
  // saved is refused, and a key saved in plain text before stays in the file, pinned to the origin it applied to,
  // until it is removed.
  const legacyOrigin = (slot: KeySlot): string => slot.origin ?? legacyKeyOrigin(saved as Layer, current.config.region);
  if (secretProtection(env) === "environment") {
    if (typeof newKey === "string") throw new Error(KEYS_FROM_ENVIRONMENT);
    for (const field of SECRET_FIELDS) {
      const value = nonEmptyString(next[field]);
      if (value !== null && value !== nonEmptyString(saved[field])) throw new Error(KEYS_FROM_ENVIRONMENT);
    }
    const legacyProvider = (saved.provider as AiProvider | undefined) ?? LEGACY_DEFAULT_PROVIDER;
    const kept = keys[legacyProvider];
    if (kept?.legacy) {
      next.apiKey = kept.key;
      next.apiKeyOrigin = legacyOrigin(kept);
    }
  } else {
    const updates: Record<string, string | null> = {};
    for (const field of SECRET_FIELDS) {
      const value = nonEmptyString(next[field]);
      delete next[field];
      if (value !== (read.stored[field] ?? null)) updates[secretName(field)] = value;
    }
    const origins: Partial<Record<AiProvider, string>> = {};
    for (const provider of AI_PROVIDERS) {
      const slot = keys[provider];
      const was = read.keys[provider];
      if (slot) {
        origins[provider] = legacyOrigin(slot);
        if (!was || was.legacy || was.key !== slot.key) updates[keyName(provider)] = slot.key;
      } else if (was && !was.legacy) updates[keyName(provider)] = null;
    }
    if (read.legacyStored) updates[LEGACY_KEY] = null;
    if (Object.keys(updates).length > 0) await writeSecrets(dirname(current.file), updates, { env });
    if (Object.keys(origins).length > 0) next.keyOrigins = origins;
    else delete next.keyOrigins;
  }
  next.version = FILE_VERSION;
  await writePrivate(current.file, `${JSON.stringify(next, null, 2)}\n`);
  const resolved = await resolveAiConfig({ env, home: options.home });
  return notice ? { ...resolved, notice } : resolved;
}

/**
 * The status for the UI and CLI. `problem`, first match wins: "AI is off" (disabled), "Choose a provider" (none chosen;
 * there is no default), "Choose a model",
 * "Choose a Bedrock region" (bedrock without region), "Bedrock needs credentials: an API key, AWS access keys or an AWS
 * profile" (bedrock with no apiKey and nothing in the AWS chain: awsCredentialsAvailable, which checks the env keys, the
 * config's access key pair and a named profile's files without running credential_process or calling SSO, and reads
 * nothing under ~/.aws when no profile is named; when a saved key was not applied because the endpoint moved, this and
 * a remote openai-compatible endpoint without a key say "The saved API key is for <origin>; enter a key for <origin>"
 * instead), "Sending page structure to <host> needs your consent"
 * (remote && !allowRemote); else null. `home` (for ~/.aws) defaults to os.homedir().
 * hasAwsKeys / hasAwsSessionToken / sources.awsKeys say whether the config holds an access key pair (and its token)
 * and where from; the key ID, the secret and the token themselves are never copied into the status.
 */
export function aiStatus(resolved: ResolvedAiConfig, env: NodeJS.ProcessEnv = process.env, home?: string): AiStatus {
  const c = resolved.config;
  const hasAwsKeys = Boolean(c.awsAccessKeyId && c.awsSecretAccessKey);
  const saved = hasAwsKeys ? { accessKeyId: c.awsAccessKeyId!, secretAccessKey: c.awsSecretAccessKey!, ...(c.awsSessionToken ? { sessionToken: c.awsSessionToken } : {}) } : null;
  const awsKeys = c.provider === "bedrock" && !c.apiKey && awsCredentialsAvailable({ env, profile: c.awsProfile ?? null, saved, ...(home ? { home } : {}) });
  const hasKey = Boolean(c.apiKey) || (c.provider === "bedrock" && awsKeys);
  const remote = isRemote(c);
  const host = endpointHost(c);
  const stale = resolved.staleKey;
  let problem: string | null = null;
  const needsKey = c.provider !== null && FIXED_ENDPOINT_PROVIDERS.has(c.provider);
  if (!c.enabled) problem = "AI is off";
  else if (!c.provider) problem = "Choose a provider";
  else if (!c.model) problem = "Choose a model";
  else if (c.provider === "bedrock" && !c.region) problem = "Choose a Bedrock region";
  else if (stale && ((((c.provider === "openai-compatible" && remote) || needsKey) && !c.apiKey) || (c.provider === "bedrock" && !hasKey))) {
    problem = `The saved API key is for ${stale.savedFor}; enter a key for ${stale.endpoint}`;
  } else if (c.provider === "bedrock" && !hasKey) problem = NO_CREDENTIALS;
  else if (needsKey && !c.apiKey) problem = `Enter your ${PROVIDER_LABELS[c.provider!]} API key`;
  else if (remote && !c.allowRemote) problem = `Sending page structure to ${host} needs your consent`;
  return {
    enabled: c.enabled,
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    region: c.region,
    awsProfile: c.awsProfile ?? null,
    allowRemote: c.allowRemote,
    features: { ...c.features },
    timeoutMs: c.timeoutMs,
    hasKey,
    hasAwsKeys,
    hasAwsSessionToken: hasAwsKeys && Boolean(c.awsSessionToken),
    remote,
    host,
    problem,
    sources: { ...resolved.sources, awsKeys: resolved.sources.awsKeys ?? "default" },
    file: resolved.file,
    savedKeys: resolved.savedKeys ?? [],
    secretProtection: secretProtection(env),
    secretNotice: resolved.secretNotice ?? null,
  };
}