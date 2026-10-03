/**
 * Bedrock credentials without ~/.aws (0.6.1, docs/launch-spec.md "Bedrock credentials"), the credential chain:
 * - resolveAwsCredentials: the AWS env keys, then the pair saved in ai.json (`saved`, source "saved"), then a named
 *   profile. With no profile named nothing under ~/.aws is read: the sentinel home below holds a [default] profile with
 *   keys and a region that must never be used, and every readFileSync/existsSync under it is recorded.
 * - awsProfileName is null when no profile is named (no implicit "default"); awsProfileRegion and
 *   awsCredentialsAvailable read nothing then.
 * - a credential_process helper (only reachable through a named profile) is started with credentialProcessEnv(env):
 *   the caller's env without RUNHOUND_* and without AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN and
 *   AWS_BEARER_TOKEN_BEDROCK; everything else (PATH, HOME, the helper's own variables) is kept.
 * - converseJson signs with the saved pair and takes no region from ~/.aws when no profile is named.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../support/fake-llm.js";
import {
  awsCredentialsAvailable,
  awsProfileName,
  awsProfileRegion,
  clearAwsCredentialCache,
  credentialProcessEnv,
  resolveAwsCredentials,
} from "../../../src/ai/aws-credentials.js";
import { converseJson } from "../../../src/ai/bedrock.js";
import type { ChatMessage } from "../../../src/ai/openai-compatible.js";
import { AiError } from "../../../src/ai/types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), existsSync: vi.fn(actual.existsSync) };
});

/** The pair a user typed into Settings (AWS's documented example shapes; not real). */
const SAVED = { accessKeyId: "AKIAIOSFODNN7SAVED01", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSAVEDKEY01", sessionToken: "FwoGZXIvYXdzESAVEDTOKEN" };
const ENV_KEYS = { AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7ENVKEY1", AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYENVKEY0001" };
/** In the sentinel home's [default] profile: seeing any of these means ~/.aws was read without a profile named. */
const DEFAULT_KEY_ID = "AKIADEFAULTSENTINEL1";
const DEFAULT_REGION = "ap-southeast-2";

let home: string;
beforeEach(async () => {
  clearAwsCredentialCache();
  home = await mkdtemp(join(tmpdir(), "runhound-aws-keys-"));
  await mkdir(join(home, ".aws", "sso", "cache"), { recursive: true });
  await writeFile(
    join(home, ".aws", "credentials"),
    `[default]\naws_access_key_id = ${DEFAULT_KEY_ID}\naws_secret_access_key = default-sentinel-secret\n[work]\naws_access_key_id = AKIAWORKPROFILE00001\naws_secret_access_key = work-secret\n`,
  );
  await writeFile(join(home, ".aws", "config"), `[default]\nregion = ${DEFAULT_REGION}\n[profile work]\nregion = eu-central-1\n`);
  vi.mocked(readFileSync).mockClear();
  vi.mocked(existsSync).mockClear();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Every path under the sentinel home that was read or checked since the test began. */
function readsUnderHome(): string[] {
  return [...vi.mocked(readFileSync).mock.calls, ...vi.mocked(existsSync).mock.calls].map(([path]) => String(path)).filter((path) => path.startsWith(home));
}

async function caught(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe("resolveAwsCredentials with no profile named", () => {
  it("resolves the saved pair with source 'saved', reading no file", async () => {
    const r = await resolveAwsCredentials({ env: {}, home, saved: SAVED });
    expect(r).toEqual({ credentials: SAVED, expiration: null, source: "saved" });
    expect(readsUnderHome()).toEqual([]);
  });

  it("prefers the AWS env keys to the saved pair (env beats ai.json) and never adds the saved session token to them", async () => {
    const r = await resolveAwsCredentials({ env: ENV_KEYS, home, saved: SAVED });
    expect(r.source).toBe("env");
    expect(r.credentials).toEqual({ accessKeyId: ENV_KEYS.AWS_ACCESS_KEY_ID, secretAccessKey: ENV_KEYS.AWS_SECRET_ACCESS_KEY });
    expect(readsUnderHome()).toEqual([]);
  });

  it("reads nothing under ~/.aws and rejects with auth when there is no key, even with a [default] profile there", async () => {
    const error = await caught(resolveAwsCredentials({ env: {}, home }));
    expect(error.code).toBe("auth");
    expect(error.message).toBe("Bedrock needs credentials: an API key, AWS access keys or an AWS profile");
    expect(readsUnderHome()).toEqual([]);
  });

  it("does not read AWS_SHARED_CREDENTIALS_FILE or AWS_CONFIG_FILE either until a profile is named", async () => {
    const env = { AWS_SHARED_CREDENTIALS_FILE: join(home, ".aws", "credentials"), AWS_CONFIG_FILE: join(home, ".aws", "config") };
    const error = await caught(resolveAwsCredentials({ env, home }));
    expect(error.code).toBe("auth");
    expect(readsUnderHome()).toEqual([]);
  });

  it("ignores a half pair (a key ID without its secret)", async () => {
    const error = await caught(resolveAwsCredentials({ env: {}, home, saved: { accessKeyId: SAVED.accessKeyId, secretAccessKey: "" } }));
    expect(error.code).toBe("auth");
    expect(readsUnderHome()).toEqual([]);
  });
});

describe("resolveAwsCredentials with a profile named", () => {
  it("prefers the saved pair to the named profile", async () => {
    const r = await resolveAwsCredentials({ env: {}, home, profile: "work", saved: SAVED });
    expect(r.source).toBe("saved");
    expect(r.credentials).toEqual(SAVED);
  });

  it("reads the named profile: the configured one, else AWS_PROFILE; a profile explicitly named 'default' is read too", async () => {
    expect((await resolveAwsCredentials({ env: {}, home, profile: "work" })).credentials.accessKeyId).toBe("AKIAWORKPROFILE00001");
    expect((await resolveAwsCredentials({ env: { AWS_PROFILE: "work" }, home })).credentials.accessKeyId).toBe("AKIAWORKPROFILE00001");
    const r = await resolveAwsCredentials({ env: {}, home, profile: "default" });
    expect(r.credentials.accessKeyId).toBe(DEFAULT_KEY_ID);
    expect(r.source).toBe("profile");
  });
});

describe("awsProfileName, awsProfileRegion and awsCredentialsAvailable", () => {
  it("names no profile when neither the config nor AWS_PROFILE does (no implicit 'default')", () => {
    expect(awsProfileName({}, undefined)).toBeNull();
    expect(awsProfileName({}, null)).toBeNull();
    expect(awsProfileName({ AWS_PROFILE: "" }, "")).toBeNull();
    expect(awsProfileName({ AWS_PROFILE: "env" }, null)).toBe("env");
    expect(awsProfileName({ AWS_PROFILE: "env" }, "configured")).toBe("configured");
  });

  it("awsProfileRegion is null and reads nothing with no profile named; a named profile's region is read", () => {
    expect(awsProfileRegion({ env: {}, home })).toBeNull();
    expect(readsUnderHome()).toEqual([]);
    expect(awsProfileRegion({ env: {}, home, profile: "work" })).toBe("eu-central-1");
    expect(awsProfileRegion({ env: { AWS_PROFILE: "default" }, home })).toBe(DEFAULT_REGION);
  });

  it("awsCredentialsAvailable counts the saved pair and reads nothing with no profile named", () => {
    expect(awsCredentialsAvailable({ env: {}, home })).toBe(false);
    expect(awsCredentialsAvailable({ env: {}, home, saved: SAVED })).toBe(true);
    expect(readsUnderHome()).toEqual([]);
    expect(awsCredentialsAvailable({ env: {}, home, profile: "work" })).toBe(true);
  });
});

describe("credential_process gets credentialProcessEnv(env)", () => {
  it("drops Run Hound's own variables and the AWS credential variables, in any letter case, and keeps the rest", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      LANG: "en_GB.UTF-8",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      OP_SESSION_my: "op-session",
      AWS_VAULT_BACKEND: "secret-service",
      AWS_CONFIG_FILE: "/home/me/.aws/config",
      AWS_PROFILE: "work",
      AWS_REGION: "eu-west-1",
      RUNHOUND_AI_API_KEY: "rh-ai-key",
      RUNHOUND_ACCOUNT_A_PASSWORD: "rh-password",
      RUNHOUND_CONFIG_DIR: "/home/me/.config/run-hound",
      runhound_ai_api_key: "rh-lower",
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7ENVKEY1",
      AWS_SECRET_ACCESS_KEY: "env-secret",
      AWS_SESSION_TOKEN: "env-token",
      AWS_BEARER_TOKEN_BEDROCK: "env-bearer",
      aws_secret_access_key: "lower-secret",
    };
    expect(credentialProcessEnv(env)).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      LANG: "en_GB.UTF-8",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      OP_SESSION_my: "op-session",
      AWS_VAULT_BACKEND: "secret-service",
      AWS_CONFIG_FILE: "/home/me/.aws/config",
      AWS_PROFILE: "work",
      AWS_REGION: "eu-west-1",
    });
  });

  it("starts the helper with that environment, built from the env the chain was given (not process.env)", async () => {
    const MARK = "rh-planted-cp-7d2e";
    const dump = join(home, "helper-env.json");
    const script = join(home, "helper.mjs");
    await writeFile(
      script,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));\nprocess.stdout.write(JSON.stringify({ Version: 1, AccessKeyId: "AKIAHELPER0000000001", SecretAccessKey: "helper-secret" }));\n`,
    );
    await writeFile(join(home, ".aws", "config"), `[profile proc]\ncredential_process = "${process.execPath}" "${script}"\n`);
    const previous = process.env.RUNHOUND_AI_API_KEY;
    process.env.RUNHOUND_AI_API_KEY = `${MARK}-in-process-env`;
    try {
      const env = {
        PATH: process.env.PATH,
        KEEP_ME: "kept",
        RUNHOUND_AI_API_KEY: `${MARK}-ai`,
        RUNHOUND_ACCOUNT_A_PASSWORD: `${MARK}-password`,
        // Without AWS_ACCESS_KEY_ID the env keys don't apply, so the chain reaches the profile's helper.
        AWS_SECRET_ACCESS_KEY: `${MARK}-secret`,
        AWS_SESSION_TOKEN: `${MARK}-token`,
        AWS_BEARER_TOKEN_BEDROCK: `${MARK}-bearer`,
      };
      const r = await resolveAwsCredentials({ env, home, profile: "proc" });
      expect(r.source).toBe("process");
    } finally {
      if (previous === undefined) delete process.env.RUNHOUND_AI_API_KEY;
      else process.env.RUNHOUND_AI_API_KEY = previous;
    }
    const seen = JSON.parse(await readFile(dump, "utf8")) as Record<string, string>;
    expect(seen.KEEP_ME).toBe("kept");
    expect(JSON.stringify(seen)).not.toContain(MARK);
    expect(Object.keys(seen).filter((name) => /^runhound_/i.test(name))).toEqual([]);
  });
});

describe("converseJson with the saved pair", () => {
  let fake: FakeLlm;
  beforeEach(async () => {
    fake = await startFakeLlm();
  });
  afterEach(async () => {
    await fake.close();
  });
  const MESSAGES: ChatMessage[] = [
    { role: "system", content: "You review test plans." },
    { role: "user", content: "Review this plan." },
  ];
  const SCHEMA = { name: "plan_review", schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"], additionalProperties: false } };

  it("signs with the saved pair and its session token when there is no API key, reading no file", async () => {
    fake.reply({ answer: 1 });
    const config = {
      baseUrl: fake.url,
      model: "anthropic.claude-test-v1:0",
      apiKey: null,
      region: "us-east-1",
      timeoutMs: 10_000,
      awsProfile: null,
      awsAccessKeyId: SAVED.accessKeyId,
      awsSecretAccessKey: SAVED.secretAccessKey,
      awsSessionToken: SAVED.sessionToken,
    };
    await converseJson(config, MESSAGES, SCHEMA, undefined, {}, { home });
    const headers = fake.calls[0]!.headers;
    expect(headers.authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${SAVED.accessKeyId}/\\d{8}/us-east-1/bedrock/aws4_request`));
    expect(headers["x-amz-security-token"]).toBe(SAVED.sessionToken);
    expect(readsUnderHome()).toEqual([]);
  });

  it("takes no region from ~/.aws when no profile is named: 'Choose a Bedrock region', nothing sent", async () => {
    fake.reply({ answer: 1 });
    // An endpoint override (the fake), so nothing could ever reach AWS: SigV4 still needs a region to sign.
    const config = { baseUrl: fake.url, model: "anthropic.claude-test-v1:0", apiKey: null, region: null, timeoutMs: 10_000, awsProfile: null, awsAccessKeyId: SAVED.accessKeyId, awsSecretAccessKey: SAVED.secretAccessKey };
    const error = await caught(converseJson(config, MESSAGES, SCHEMA, undefined, {}, { home }));
    expect(error.code).toBe("not-configured");
    expect(error.message).toBe("Choose a Bedrock region");
    expect(fake.calls).toHaveLength(0);
    expect(readsUnderHome()).toEqual([]);
  });
});
