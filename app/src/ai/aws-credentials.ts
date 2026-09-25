import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { httpError, parseBody, send } from "./http.js";
import type { AwsCredentials } from "./sigv4.js";
import { AiError } from "./types.js";

/**
 * The AWS credential chain for Bedrock SigV4, without the AWS SDK (docs/ai-spec.md, "Bedrock auth"):
 * 1. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN) from the env;
 * 2. the profile named by the config (awsProfile / RUNHOUND_AI_AWS_PROFILE), else AWS_PROFILE, else "default", read
 *    from the shared credentials file ([name] sections; AWS_SHARED_CREDENTIALS_FILE, default ~/.aws/credentials) and
 *    the shared config file ([default] / [profile name] sections; AWS_CONFIG_FILE, default ~/.aws/config). Settings of
 *    both files are merged; the credentials file wins. Within the profile, in order:
 *    - role_arn (assume role / source_profile chains): AiError "not-configured", not supported yet;
 *    - aws_access_key_id + aws_secret_access_key (+ aws_session_token);
 *    - credential_process: the command is run without a shell (double quotes group words) and must print the
 *      Version 1 JSON {Version: 1, AccessKeyId, SecretAccessKey, SessionToken?, Expiration? (RFC 3339)};
 *    - IAM Identity Center: sso_session (→ [sso-session name] with sso_region, sso_start_url) or the legacy
 *      sso_start_url + sso_region, with sso_account_id and sso_role_name. The access token cached by `aws sso login`
 *      (~/.aws/sso/cache/<sha1 hex of the session name, or of the start URL for legacy profiles>.json: accessToken,
 *      expiresAt) is exchanged with GET https://portal.sso.<sso_region>.amazonaws.com/federation/credentials
 *      ?role_name=…&account_id=… (header x-amz-sso_bearer_token). A missing, expired or refused token → AiError
 *      "auth" saying to run `aws sso login --profile <name>`. Tokens are never refreshed here.
 * Temporary credentials (from credential_process with an Expiration, or SSO) are cached per profile for the life of
 * the process, until 5 minutes before they expire. Static keys are read again each time.
 */

export interface AwsCredentialOptions {
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Home directory for ~/.aws; defaults to os.homedir(). Tests pass a temp dir. */
  home?: string;
  /** The configured profile (AiConfig.awsProfile). null/undefined: AWS_PROFILE, else "default". */
  profile?: string | null;
  /** For credential_process and the SSO request. Default 60 000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Current time in ms, for the cache and token expiry. Default Date.now(). */
  now?: number;
  /** Tests: the SSO portal origin instead of https://portal.sso.<sso_region>.amazonaws.com. */
  ssoPortalUrl?: string;
}

export interface ResolvedAwsCredentials {
  credentials: AwsCredentials;
  /** Epoch ms when temporary credentials expire; null for long-term keys. */
  expiration: number | null;
  source: "env" | "profile" | "process" | "sso";
}

type Section = Record<string, string>;
type Ini = Record<string, Section>;

/** Refresh temporary credentials this long before they expire. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const cache = new Map<string, ResolvedAwsCredentials>();

/** Forgets every cached temporary credential (tests; a changed profile). */
export function clearAwsCredentialCache(): void {
  cache.clear();
}

/**
 * Parses a shared config/credentials file: `[section]` headers (inner whitespace collapsed), `key = value` settings
 * (keys lower-cased, values trimmed, a ` #` or ` ;` comment after the value removed), full-line `#` / `;` comments.
 * Indented lines under a setting with an empty value are nested settings (e.g. s3 = …) and are skipped.
 */
export function parseAwsIni(text: string): Ini {
  const out: Ini = {};
  let section: Section | null = null;
  let nestedParent = false;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const header = /^\[\s*([^\]]+?)\s*\]/.exec(trimmed);
    if (header) {
      const name = header[1]!.replace(/\s+/g, " ");
      section = out[name] ??= {};
      nestedParent = false;
      continue;
    }
    if (!section) continue;
    if (/^\s/.test(raw) && nestedParent) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).replace(/\s[#;].*$/, "").trim();
    section[key] = value;
    nestedParent = value === "";
  }
  return out;
}

/** The profile to use: the configured one, else AWS_PROFILE, else "default". */
export function awsProfileName(env: NodeJS.ProcessEnv, configured?: string | null): string {
  return configured || env.AWS_PROFILE || "default";
}

function expandHome(path: string, home: string): string {
  return path.replace(/^~(?=$|[\\/])/, home);
}

function readIni(path: string): Ini {
  try {
    return parseAwsIni(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

interface Profile {
  name: string;
  settings: Section;
  /** The [sso-session x] section named by sso_session, when there is one. */
  ssoSession: Section | null;
}

function paths(env: NodeJS.ProcessEnv, home: string): { config: string; credentials: string } {
  return {
    config: env.AWS_CONFIG_FILE ? expandHome(env.AWS_CONFIG_FILE, home) : join(home, ".aws", "config"),
    credentials: env.AWS_SHARED_CREDENTIALS_FILE ? expandHome(env.AWS_SHARED_CREDENTIALS_FILE, home) : join(home, ".aws", "credentials"),
  };
}

/** The merged settings of one profile, or null when neither file has it. */
function readProfile(env: NodeJS.ProcessEnv, home: string, name: string): Profile | null {
  const files = paths(env, home);
  const config = readIni(files.config);
  const credentials = readIni(files.credentials);
  const fromConfig = config[`profile ${name}`] ?? (name === "default" ? config.default : undefined);
  const fromCredentials = credentials[name];
  if (!fromConfig && !fromCredentials) return null;
  const settings = { ...fromConfig, ...fromCredentials };
  const ssoSession = settings.sso_session ? (config[`sso-session ${settings.sso_session}`] ?? null) : null;
  return { name, settings, ssoSession };
}

const envKeys = (env: NodeJS.ProcessEnv): AwsCredentials | null =>
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) }
    : null;

interface SsoSettings {
  startUrl: string;
  region: string;
  accountId: string;
  roleName: string;
  /** What the token cache file is named after: the session name, or the start URL (legacy). */
  cacheKey: string;
}

/** The SSO settings of a profile, or null when it isn't an SSO profile. Throws when one is half configured. */
function ssoSettings(profile: Profile): SsoSettings | null {
  const s = profile.settings;
  if (!s.sso_session && !s.sso_start_url) return null;
  if (s.sso_session && !profile.ssoSession) {
    throw new AiError("not-configured", `AWS profile "${profile.name}" names sso_session "${s.sso_session}", but there is no [sso-session ${s.sso_session}] section`);
  }
  const startUrl = profile.ssoSession?.sso_start_url ?? s.sso_start_url ?? "";
  const region = profile.ssoSession?.sso_region ?? s.sso_region ?? "";
  if (!startUrl || !region || !s.sso_account_id || !s.sso_role_name) {
    throw new AiError("not-configured", `AWS profile "${profile.name}" needs sso_start_url, sso_region, sso_account_id and sso_role_name for IAM Identity Center`);
  }
  return { startUrl, region, accountId: s.sso_account_id, roleName: s.sso_role_name, cacheKey: s.sso_session ?? startUrl };
}

const tokenFile = (home: string, cacheKey: string) => join(home, ".aws", "sso", "cache", `${createHash("sha1").update(cacheKey, "utf8").digest("hex")}.json`);

const loginError = (name: string) =>
  new AiError("auth", `The AWS SSO session for profile "${name}" has expired or is missing; run \`aws sso login --profile ${name}\``);

async function fromSso(profile: Profile, sso: SsoSettings, home: string, options: AwsCredentialOptions, now: number): Promise<ResolvedAwsCredentials> {
  let token: { accessToken?: unknown; expiresAt?: unknown };
  try {
    token = JSON.parse(readFileSync(tokenFile(home, sso.cacheKey), "utf8"));
  } catch {
    throw loginError(profile.name);
  }
  const expiresAt = typeof token.expiresAt === "string" ? Date.parse(token.expiresAt) : NaN;
  if (typeof token.accessToken !== "string" || !token.accessToken || !(expiresAt > now)) throw loginError(profile.name);

  const origin = (options.ssoPortalUrl ?? `https://portal.sso.${sso.region}.amazonaws.com`).replace(/\/+$/, "");
  const query = new URLSearchParams({ role_name: sso.roleName, account_id: sso.accountId });
  const response = await send(
    `${origin}/federation/credentials?${query}`,
    { method: "GET", headers: { accept: "application/json", "x-amz-sso_bearer_token": token.accessToken } },
    options.timeoutMs ?? 60_000,
    options.signal,
  );
  if (response.status === 401 || response.status === 403) throw loginError(profile.name);
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.text, "AWS IAM Identity Center");
  const role = parseBody(response.text)?.roleCredentials;
  if (!role || typeof role.accessKeyId !== "string" || typeof role.secretAccessKey !== "string") {
    throw new AiError("bad-output", "AWS IAM Identity Center answered without role credentials");
  }
  return {
    credentials: { accessKeyId: role.accessKeyId, secretAccessKey: role.secretAccessKey, ...(typeof role.sessionToken === "string" ? { sessionToken: role.sessionToken } : {}) },
    expiration: typeof role.expiration === "number" ? role.expiration : null,
    source: "sso",
  };
}

/** Splits a credential_process command into argv: whitespace separates, double quotes group (and are removed). */
function splitCommand(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (const ch of command.trim()) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (started) out.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

function runProcess(command: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; stdout: string }> {
  const [file, ...args] = splitCommand(command);
  return new Promise((resolve) => {
    if (!file) return resolve({ code: null, stdout: "" });
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, ...(signal ? { signal } : {}) }, (error, stdout) => {
      if (error) resolve({ code: typeof error.code === "number" ? error.code : null, stdout: "" });
      else resolve({ code: 0, stdout: String(stdout) });
    });
  });
}

async function fromProcess(profile: Profile, options: AwsCredentialOptions): Promise<ResolvedAwsCredentials> {
  const what = `credential_process of AWS profile "${profile.name}"`;
  const { code, stdout } = await runProcess(profile.settings.credential_process!, options.timeoutMs ?? 60_000, options.signal);
  if (code !== 0) throw new AiError("auth", `The ${what} failed${code === null ? "" : ` (exit code ${code})`}`);
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new AiError("auth", `The ${what} did not print JSON`);
  }
  if (out?.Version !== 1) throw new AiError("auth", `The ${what} must print JSON with "Version": 1`);
  if (typeof out.AccessKeyId !== "string" || !out.AccessKeyId || typeof out.SecretAccessKey !== "string" || !out.SecretAccessKey) {
    throw new AiError("auth", `The ${what} printed no AccessKeyId and SecretAccessKey`);
  }
  let expiration: number | null = null;
  if (out.Expiration !== undefined) {
    expiration = typeof out.Expiration === "string" ? Date.parse(out.Expiration) : NaN;
    if (Number.isNaN(expiration)) throw new AiError("auth", `The ${what} printed an Expiration that is not an RFC 3339 time`);
  }
  return {
    credentials: { accessKeyId: out.AccessKeyId, secretAccessKey: out.SecretAccessKey, ...(typeof out.SessionToken === "string" && out.SessionToken ? { sessionToken: out.SessionToken } : {}) },
    expiration,
    source: "process",
  };
}

/** Resolves credentials through the chain above; rejects with AiError ("auth", "not-configured", or from the SSO request). */
export async function resolveAwsCredentials(options: AwsCredentialOptions = {}): Promise<ResolvedAwsCredentials> {
  const env = options.env ?? process.env;
  const fromEnv = envKeys(env);
  if (fromEnv) return { credentials: fromEnv, expiration: null, source: "env" };

  const home = options.home ?? homedir();
  const now = options.now ?? Date.now();
  const name = awsProfileName(env, options.profile);
  const files = paths(env, home);
  const key = `${home}|${files.config}|${files.credentials}|${name}`;
  const cached = cache.get(key);
  if (cached && cached.expiration !== null && cached.expiration - REFRESH_MARGIN_MS > now) return cached;
  cache.delete(key);

  const profile = readProfile(env, home, name);
  if (!profile) {
    if (name === "default") throw new AiError("auth", "Bedrock needs an API key or AWS credentials (access keys, or a profile in ~/.aws)");
    throw new AiError("auth", `AWS profile "${name}" was not found in ${files.config} or ${files.credentials}`);
  }
  const s = profile.settings;
  if (s.role_arn) {
    throw new AiError(
      "not-configured",
      `AWS profile "${name}" uses role_arn (assume role), which is not supported yet; use a profile with access keys, credential_process or SSO`,
    );
  }
  if (s.aws_access_key_id && s.aws_secret_access_key) {
    return {
      credentials: { accessKeyId: s.aws_access_key_id, secretAccessKey: s.aws_secret_access_key, ...(s.aws_session_token ? { sessionToken: s.aws_session_token } : {}) },
      expiration: null,
      source: "profile",
    };
  }
  let resolved: ResolvedAwsCredentials;
  if (s.credential_process) {
    resolved = await fromProcess(profile, options);
  } else {
    const sso = ssoSettings(profile);
    if (!sso) throw new AiError("auth", `AWS profile "${name}" has no credentials (access keys, credential_process or SSO)`);
    resolved = await fromSso(profile, sso, home, options, now);
  }
  if (resolved.expiration !== null) cache.set(key, resolved);
  return resolved;
}

/**
 * True when something in the chain could give credentials, checked without running anything or calling SSO: env keys,
 * or a profile with access keys, credential_process, or an SSO configuration whose token cache file exists.
 */
export function awsCredentialsAvailable(options: Omit<AwsCredentialOptions, "signal" | "timeoutMs" | "ssoPortalUrl"> = {}): boolean {
  const env = options.env ?? process.env;
  if (envKeys(env)) return true;
  const home = options.home ?? homedir();
  const profile = readProfile(env, home, awsProfileName(env, options.profile));
  if (!profile) return false;
  const s = profile.settings;
  if (s.role_arn) return false;
  if ((s.aws_access_key_id && s.aws_secret_access_key) || s.credential_process) return true;
  try {
    const sso = ssoSettings(profile);
    return sso !== null && existsSync(tokenFile(home, sso.cacheKey));
  } catch {
    return false;
  }
}

/** The `region` of the profile (config file), or null. */
export function awsProfileRegion(options: Pick<AwsCredentialOptions, "env" | "home" | "profile"> = {}): string | null {
  const env = options.env ?? process.env;
  const profile = readProfile(env, options.home ?? homedir(), awsProfileName(env, options.profile));
  return profile?.settings.region || null;
}
