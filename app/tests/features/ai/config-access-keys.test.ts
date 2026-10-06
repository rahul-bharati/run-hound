/**
 * Bedrock credentials in the AI config (0.6.1, docs/launch-spec.md "Bedrock credentials"):
 * - ai.json and the environment carry an AWS access key pair (awsAccessKeyId + awsSecretAccessKey, optional
 *   awsSessionToken). The pair resolves as a unit from one source: defaults < ai.json < env (AWS_ACCESS_KEY_ID +
 *   AWS_SECRET_ACCESS_KEY + AWS_SESSION_TOKEN, Bedrock only); the token only ever comes with its own pair; half a pair
 *   counts as none.
 * - saveAiConfig: the ID and the secret are set together; "" or leaving them out keeps the saved pair; null removes the
 *   pair and its token; a new pair without a token removes the saved token; a token alone is refused; a pair set by the
 *   env is locked; errors name fields, never values; ai.json stays 0600 in a 0700 folder.
 * - aiStatus never carries the key ID, the secret or the token: hasAwsKeys, hasAwsSessionToken and sources.awsKeys say
 *   what is set and where from.
 * - ~/.aws is read only when a profile is named: no region and no credentials from a [default] profile otherwise.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAwsCredentialCache } from "../../../src/ai/aws-credentials.js";
import { aiStatus, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import { readSecrets } from "../../../src/operations/secret-store.js";

const ID = "AKIAIOSFODNN7SAVED01";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSAVEDKEY01";
const TOKEN = "FwoGZXIvYXdzESAVEDTOKEN0123456789";
const ENV_ID = "AKIAIOSFODNN7ENVKEY1";
const ENV_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYENVKEY0001";

let tmp: string;
let dir: string;
/** A home with a [default] AWS profile (keys and a region) that must never be used unless a profile is named. */
let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  clearAwsCredentialCache();
  tmp = await mkdtemp(join(tmpdir(), "runhound-ai-keys-"));
  dir = join(tmp, "config");
  home = join(tmp, "home");
  await mkdir(join(home, ".aws"), { recursive: true });
  await writeFile(join(home, ".aws", "credentials"), "[default]\naws_access_key_id = AKIADEFAULTSENTINEL1\naws_secret_access_key = default-secret\n[work]\naws_access_key_id = AKIAWORKPROFILE00001\naws_secret_access_key = work-secret\n");
  await writeFile(join(home, ".aws", "config"), "[default]\nregion = ap-southeast-2\n[profile work]\nregion = eu-central-1\n");
  env = { RUNHOUND_CONFIG_DIR: dir };
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const file = () => join(dir, "ai.json");
const savedFile = async () => JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
async function writeSaved(value: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(file(), JSON.stringify(value));
}
const bedrock = { enabled: true, provider: "bedrock", model: "anthropic.claude-test", region: "us-east-1" };

describe("resolveAiConfig: the AWS access key pair", () => {
  it("reads the pair and its token from ai.json", async () => {
    await writeSaved({ ...bedrock, awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    const r = await resolveAiConfig({ env, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    expect(r.sources.awsKeys).toBe("file");
  });

  it("takes the pair from AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY over ai.json (env beats the file), never with the file's token", async () => {
    await writeSaved({ ...bedrock, awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    const r = await resolveAiConfig({ env: { ...env, AWS_ACCESS_KEY_ID: ENV_ID, AWS_SECRET_ACCESS_KEY: ENV_SECRET }, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: ENV_ID, awsSecretAccessKey: ENV_SECRET, awsSessionToken: null });
    expect(r.sources.awsKeys).toBe("env");
    const withToken = await resolveAiConfig({ env: { ...env, AWS_ACCESS_KEY_ID: ENV_ID, AWS_SECRET_ACCESS_KEY: ENV_SECRET, AWS_SESSION_TOKEN: "env-token" }, home });
    expect(withToken.config.awsSessionToken).toBe("env-token");
  });

  it("counts half a pair as none: the file's pair stands against a lone AWS_ACCESS_KEY_ID, and a lone saved ID resolves to nothing", async () => {
    await writeSaved({ ...bedrock, awsAccessKeyId: ID, awsSecretAccessKey: SECRET });
    let r = await resolveAiConfig({ env: { ...env, AWS_ACCESS_KEY_ID: ENV_ID }, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET });
    expect(r.sources.awsKeys).toBe("file");
    // Resolving moved the saved secret into the store; a lone saved ID needs a config dir that holds none.
    await rm(join(dir, "secrets.json"));
    await rm(join(dir, "secrets.key"));
    await writeSaved({ ...bedrock, awsAccessKeyId: ID });
    r = await resolveAiConfig({ env, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: null, awsSecretAccessKey: null, awsSessionToken: null });
    expect(r.sources.awsKeys).toBe("default");
  });

  it("reads the AWS env keys for Bedrock only", async () => {
    await writeSaved({ enabled: true, provider: "ollama", model: "m" });
    const r = await resolveAiConfig({ env: { ...env, AWS_ACCESS_KEY_ID: ENV_ID, AWS_SECRET_ACCESS_KEY: ENV_SECRET }, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: null, awsSecretAccessKey: null });
    expect(r.sources.awsKeys).toBe("default");
  });

  it("takes no region from ~/.aws when no profile is named, and the named profile's region when one is", async () => {
    await writeSaved({ enabled: true, provider: "bedrock", model: "anthropic.claude-test" });
    expect((await resolveAiConfig({ env, home })).config.region).toBeNull();
    expect((await resolveAiConfig({ env: { ...env, RUNHOUND_AI_AWS_PROFILE: "work" }, home })).config.region).toBe("eu-central-1");
    expect((await resolveAiConfig({ env: { ...env, AWS_PROFILE: "default" }, home })).config.region).toBe("ap-southeast-2");
  });
});

describe("saveAiConfig: the AWS access key pair", () => {
  it("saves the pair and its token to ai.json with mode 0600 in a 0700 folder", async () => {
    const r = await saveAiConfig({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home });
    expect(r.config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    expect(r.sources.awsKeys).toBe("file");
    // The secret access key and the token are sealed in the encrypted store; only the (public) access key ID is in ai.json.
    const saved = await savedFile();
    expect(saved).toMatchObject({ awsAccessKeyId: ID });
    expect(saved).not.toHaveProperty("awsSecretAccessKey");
    expect(saved).not.toHaveProperty("awsSessionToken");
    const text = await readFile(file(), "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TOKEN);
    expect(await readFile(join(dir, "secrets.json"), "utf8")).not.toContain(SECRET);
    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.awsSecretAccessKey": SECRET, "ai.awsSessionToken": TOKEN });
    expect((await resolveAiConfig({ env, home })).config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "secrets.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("keeps the saved pair when a patch leaves it out or sends empty strings", async () => {
    await saveAiConfig({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home });
    await saveAiConfig({ model: "anthropic.other" }, { env, home });
    await saveAiConfig({ awsAccessKeyId: "", awsSecretAccessKey: "", awsSessionToken: "" }, { env, home });
    expect(await savedFile()).toMatchObject({ awsAccessKeyId: ID, model: "anthropic.other" });
    expect((await resolveAiConfig({ env, home })).config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.awsSecretAccessKey": SECRET, "ai.awsSessionToken": TOKEN });
  });

  it("removes the pair and its token on null", async () => {
    await saveAiConfig({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home });
    const r = await saveAiConfig({ awsAccessKeyId: null }, { env, home });
    expect(r.sources.awsKeys).toBe("default");
    const saved = await savedFile();
    for (const field of ["awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"]) expect(saved).not.toHaveProperty(field);
    expect((await readSecrets(dir, { env })).values).toEqual({});
  });

  it("removes a saved token when a new pair comes without one, and removes the token alone on awsSessionToken: null", async () => {
    await saveAiConfig({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home });
    await saveAiConfig({ awsAccessKeyId: "AKIAIOSFODNN7NEWKEY1", awsSecretAccessKey: "new-secret-value-0123456789" }, { env, home });
    expect(await savedFile()).not.toHaveProperty("awsSessionToken");
    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.awsSecretAccessKey": "new-secret-value-0123456789" });
    expect((await resolveAiConfig({ env, home })).config).toMatchObject({ awsAccessKeyId: "AKIAIOSFODNN7NEWKEY1", awsSecretAccessKey: "new-secret-value-0123456789", awsSessionToken: null });
    await saveAiConfig({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN }, { env, home });
    await saveAiConfig({ awsSessionToken: null }, { env, home });
    expect(await savedFile()).toMatchObject({ awsAccessKeyId: ID });
    expect(await savedFile()).not.toHaveProperty("awsSessionToken");
    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.awsSecretAccessKey": SECRET });
    expect((await resolveAiConfig({ env, home })).config).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: null });
  });

  it("refuses half a pair and a token without a new pair, writing nothing, and never names a value in the error", async () => {
    await saveAiConfig({ provider: "bedrock", region: "us-east-1" }, { env, home });
    const before = await readFile(file(), "utf8");
    for (const patch of [{ awsAccessKeyId: ID }, { awsSecretAccessKey: SECRET }, { awsAccessKeyId: ID, awsSecretAccessKey: "" }, { awsSessionToken: TOKEN }]) {
      const error = await saveAiConfig(patch, { env, home }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error, JSON.stringify(Object.keys(patch))).toBeInstanceOf(Error);
      expect(error!.message).not.toMatch(/not implemented/);
      for (const value of [ID, SECRET, TOKEN]) expect(error!.message).not.toContain(value);
    }
    expect(await readFile(file(), "utf8")).toBe(before);
  });

  it("refuses an access key ID that isn't 16 to 128 letters, digits or underscores, without echoing the ID or the secret", async () => {
    const error = await saveAiConfig({ provider: "bedrock", awsAccessKeyId: "not a key id!", awsSecretAccessKey: SECRET }, { env, home }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/access key ID/i);
    expect(error!.message).not.toContain("not a key id!");
    expect(error!.message).not.toContain(SECRET);
  });

  it("refuses to change a pair set by the environment, naming AWS_ACCESS_KEY_ID", async () => {
    const locked = { ...env, AWS_ACCESS_KEY_ID: ENV_ID, AWS_SECRET_ACCESS_KEY: ENV_SECRET };
    await saveAiConfig({ provider: "bedrock", region: "us-east-1" }, { env: locked, home });
    for (const patch of [{ awsAccessKeyId: ID, awsSecretAccessKey: SECRET }, { awsAccessKeyId: null }]) {
      await expect(saveAiConfig(patch, { env: locked, home })).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
    }
    for (const value of [ENV_ID, ENV_SECRET]) expect(await readFile(file(), "utf8")).not.toContain(value);
  });
});

describe("aiStatus and the AWS access key pair", () => {
  it("says a pair and a token are set, and where from, without carrying any of them", async () => {
    await writeSaved({ ...bedrock, awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    const status = aiStatus(await resolveAiConfig({ env, home }), env, home);
    expect(status.hasAwsKeys).toBe(true);
    expect(status.hasAwsSessionToken).toBe(true);
    expect(status.sources.awsKeys).toBe("file");
    expect(status.hasKey).toBe(true);
    expect(status.problem).toBe("Sending page structure to bedrock-runtime.us-east-1.amazonaws.com needs your consent");
    const text = JSON.stringify(status);
    for (const value of [ID, SECRET, TOKEN]) expect(text).not.toContain(value);
    for (const field of ["awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"]) expect(status).not.toHaveProperty(field);
  });

  it("reports hasAwsKeys false, hasAwsSessionToken false and sources.awsKeys 'default' when no pair is set", async () => {
    await writeSaved({ ...bedrock });
    const status = aiStatus(await resolveAiConfig({ env, home }), env, home);
    expect(status).toMatchObject({ hasAwsKeys: false, hasAwsSessionToken: false });
    expect(status.sources.awsKeys).toBe("default");
  });

  it("does not count a [default] profile in ~/.aws as credentials when no profile is named", async () => {
    await writeSaved({ ...bedrock });
    const status = aiStatus(await resolveAiConfig({ env, home }), env, home);
    expect(status.hasKey).toBe(false);
    expect(status.problem).toBe("Bedrock needs credentials: an API key, AWS access keys or an AWS profile");
    const named = aiStatus(await resolveAiConfig({ env: { ...env, RUNHOUND_AI_AWS_PROFILE: "work" }, home }), env, home);
    expect(named.hasKey).toBe(true);
  });
});
