import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiStatus, resolveAiConfig, saveAiConfig } from "../../../src/ai/config.js";
import { passwordsFromEnvironment } from "../../../src/constants/accounts-constants.js";
import { KEYS_FROM_ENVIRONMENT } from "../../../src/constants/ai-constants.js";
import { resolveAccounts, saveAccounts } from "../../../src/operations/accounts-storage.js";
import {
  KEY_FILE,
  LOCKED_BY_OS_KEYCHAIN,
  readSecrets,
  SECRETS_FILE,
  useOsKeyProtector,
  writeSecrets,
  type KeyProtector,
} from "../../../src/operations/secret-store.js";

/**
 * Secrets saved in plain text by earlier versions (ai.json: apiKey, awsSecretAccessKey, awsSessionToken; accounts.json:
 * passwords) move into the encrypted store the first time the config is resolved. Where nothing can be saved (the
 * Docker image, or a store locked by the desktop app's OS keychain) the plain text stays and is still used.
 */

let tmp: string;
let dir: string;
let home: string;
/** Points the config dir at the temp dir, so the real ~/.config is never touched. */
let env: NodeJS.ProcessEnv;
let envOnly: NodeJS.ProcessEnv;

beforeEach(async () => {
  useOsKeyProtector(null);
  tmp = await mkdtemp(join(tmpdir(), "runhound-secrets-migration-"));
  dir = join(tmp, "config");
  home = join(tmp, "home");
  await mkdir(home, { recursive: true });
  env = { RUNHOUND_CONFIG_DIR: dir };
  envOnly = { RUNHOUND_CONFIG_DIR: dir, RUNHOUND_SECRETS: "environment" };
});

afterEach(async () => {
  useOsKeyProtector(null);
  await rm(tmp, { recursive: true, force: true });
});

const KEY = "sk-legacy-plain-text-key-7731";
const AWS_ID = "AKIAIOSFODNN7LEGACY01";
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYLEGACYKEY1";
const AWS_TOKEN = "FwoGZXIvYXdzELEGACYTOKEN0123456789";
const LOGIN = "http://127.0.0.1:5173/login";
const PASSWORD_A = "legacy-horse-battery-A1";
const PASSWORD_B = "legacy-lemon-orbit-B2";

const aiFile = () => join(dir, "ai.json");
const accountsFile = () => join(dir, "accounts.json");
const aiJson = async () => JSON.parse(await readFile(aiFile(), "utf8")) as Record<string, unknown>;
const accountsJson = async () => JSON.parse(await readFile(accountsFile(), "utf8")) as { accounts: Record<string, Record<string, unknown>> };

async function writeFileIn(name: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), typeof value === "string" ? value : JSON.stringify(value), { mode: 0o644 });
}

/** What a locked store looks like: a key file the desktop app wrapped with the OS keychain, seen from the command line. */
async function lockStore(): Promise<void> {
  const protector: KeyProtector = { wrap: (key) => Buffer.concat([Buffer.from("KC:"), key]), unwrap: (wrapped) => Buffer.from(wrapped.subarray(3)) };
  useOsKeyProtector(protector);
  await writeSecrets(dir, { unrelated: "sealed-by-the-desktop-app" }, { env: {} });
  useOsKeyProtector(null);
  expect((await readSecrets(dir, { env: {} })).problem).toBe(LOCKED_BY_OS_KEYCHAIN);
}

const openai = {
  enabled: true,
  provider: "openai-compatible",
  baseUrl: "https://api.a.example/v1",
  model: "m",
  allowRemote: true,
  allowRemoteHost: "api.a.example",
  apiKey: KEY,
  apiKeyOrigin: "https://api.a.example",
};
const bedrock = {
  enabled: true,
  provider: "bedrock",
  model: "anthropic.claude-test",
  region: "us-east-1",
  awsAccessKeyId: AWS_ID,
  awsSecretAccessKey: AWS_SECRET,
  awsSessionToken: AWS_TOKEN,
};
const legacyAccounts = {
  version: 1,
  isolated: false,
  accounts: {
    a: { loginUrl: LOGIN, username: "alex@fernway.test", password: PASSWORD_A, passwordOrigin: "http://127.0.0.1:5173" },
    b: { label: "Sam", loginUrl: LOGIN, username: "sam@fernway.test", password: PASSWORD_B, passwordOrigin: "http://127.0.0.1:5173" },
  },
};

describe("AI keys saved in plain text in ai.json", () => {
  it("moves the API key into the provider's own store slot: resolve returns it, ai.json drops it and keeps the origin in keyOrigins", async () => {
    await writeFileIn("ai.json", openai);
    const resolved = await resolveAiConfig({ env, home });
    expect(resolved.config.apiKey).toBe(KEY);
    expect(resolved.sources.apiKey).toBe("file");

    const file = await aiJson();
    expect(file).not.toHaveProperty("apiKey");
    expect(file).not.toHaveProperty("apiKeyOrigin");
    expect(file).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://api.a.example/v1",
      model: "m",
      allowRemote: true,
      keyOrigins: { "openai-compatible": "https://api.a.example" },
    });
    expect(await readFile(aiFile(), "utf8")).not.toContain(KEY);
    expect((await stat(aiFile())).mode & 0o777).toBe(0o600);

    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.key.openai-compatible": KEY });
    expect(await readFile(join(dir, SECRETS_FILE), "utf8")).not.toContain(KEY);
    expect(await readFile(join(dir, KEY_FILE), "utf8")).not.toContain(KEY);
  });

  it("keeps returning the key on every later resolve, from the store alone", async () => {
    await writeFileIn("ai.json", openai);
    await resolveAiConfig({ env, home });
    const again = await resolveAiConfig({ env, home });
    expect(again.config.apiKey).toBe(KEY);
    expect(aiStatus(again, env, home)).toMatchObject({ hasKey: true, secretProtection: "run-hound", secretNotice: null });
    expect(await aiJson()).not.toHaveProperty("apiKey");
  });

  it("moves the AWS secret access key and session token, and keeps the access key ID in the file", async () => {
    await writeFileIn("ai.json", bedrock);
    const resolved = await resolveAiConfig({ env, home });
    expect(resolved.config).toMatchObject({ awsAccessKeyId: AWS_ID, awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN });

    const file = await aiJson();
    expect(file).toMatchObject({ provider: "bedrock", region: "us-east-1", awsAccessKeyId: AWS_ID });
    expect(file).not.toHaveProperty("awsSecretAccessKey");
    expect(file).not.toHaveProperty("awsSessionToken");
    const text = await readFile(aiFile(), "utf8");
    expect(text).not.toContain(AWS_SECRET);
    expect(text).not.toContain(AWS_TOKEN);

    expect((await readSecrets(dir, { env })).values).toEqual({ "ai.awsSecretAccessKey": AWS_SECRET, "ai.awsSessionToken": AWS_TOKEN });
    const again = await resolveAiConfig({ env, home });
    expect(again.config).toMatchObject({ awsAccessKeyId: AWS_ID, awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN });
  });

  it("moves all three together", async () => {
    await writeFileIn("ai.json", { ...bedrock, apiKey: KEY, apiKeyOrigin: "bedrock" });
    await resolveAiConfig({ env, home });
    expect(Object.keys((await readSecrets(dir, { env })).values).sort()).toEqual(["ai.awsSecretAccessKey", "ai.awsSessionToken", "ai.key.bedrock"]);
    expect(Object.keys(await aiJson()).filter((k) => ["apiKey", "awsSecretAccessKey", "awsSessionToken"].includes(k))).toEqual([]);
  });

  it("changes nothing when the file holds no plain-text secret, and creates no secret files", async () => {
    await writeFileIn("ai.json", { enabled: true, provider: "ollama", model: "llama" });
    const before = await readFile(aiFile());
    await resolveAiConfig({ env, home });
    expect(await readFile(aiFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("a key saved after the move still saves to the store only, and a later save keeps the moved key", async () => {
    await writeFileIn("ai.json", openai);
    await resolveAiConfig({ env, home });
    await saveAiConfig({ model: "m2" }, { env, home });
    expect((await resolveAiConfig({ env, home })).config).toMatchObject({ apiKey: KEY, model: "m2" });
    expect(await readFile(aiFile(), "utf8")).not.toContain(KEY);
  });
});

describe("account passwords saved in plain text in accounts.json", () => {
  it("moves the passwords into the store: resolve returns them, the file drops them and keeps passwordOrigin", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    const { config, status } = await resolveAccounts({ env });
    expect(config.accounts.a.password).toBe(PASSWORD_A);
    expect(config.accounts.b.password).toBe(PASSWORD_B);
    expect(status.accounts.a).toMatchObject({ hasPassword: true, ready: true, problem: null });

    const file = await accountsJson();
    expect(file.accounts.a).toEqual({ loginUrl: LOGIN, username: "alex@fernway.test", passwordOrigin: "http://127.0.0.1:5173" });
    expect(file.accounts.b).toEqual({ label: "Sam", loginUrl: LOGIN, username: "sam@fernway.test", passwordOrigin: "http://127.0.0.1:5173" });
    expect(file).toMatchObject({ version: 1, isolated: false });
    const text = await readFile(accountsFile(), "utf8");
    expect(text).not.toContain(PASSWORD_A);
    expect(text).not.toContain(PASSWORD_B);
    expect((await stat(accountsFile())).mode & 0o777).toBe(0o600);

    expect((await readSecrets(dir, { env })).values).toEqual({ "accounts.a.password": PASSWORD_A, "accounts.b.password": PASSWORD_B });
    expect(await readFile(join(dir, SECRETS_FILE), "utf8")).not.toContain(PASSWORD_A);
  });

  it("keeps returning the passwords on every later resolve, and the password stays bound to its origin", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    await resolveAccounts({ env });
    const again = await resolveAccounts({ env });
    expect(again.config.accounts.a.password).toBe(PASSWORD_A);
    expect(again.status.secretProtection).toBe("run-hound");
    const moved = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: "http://127.0.0.1:5999/login" } });
    expect(moved.config.accounts.a.password).toBeNull();
    expect(moved.status.accounts.a.problem).toContain("http://127.0.0.1:5173");
  });

  it("changes nothing when the file holds no plain-text password", async () => {
    await writeFileIn("accounts.json", { version: 1, accounts: { a: { loginUrl: LOGIN, username: "alex@fernway.test" } } });
    const before = await readFile(accountsFile());
    await resolveAccounts({ env });
    expect(await readFile(accountsFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["accounts.json"]);
  });
});

describe("RUNHOUND_SECRETS=environment with secrets still saved in plain text", () => {
  it("AI: the plain-text key stays in the file and is reported in secretNotice", async () => {
    await writeFileIn("ai.json", openai);
    const before = await readFile(aiFile());
    const resolved = await resolveAiConfig({ env: envOnly, home });
    expect(resolved.config.apiKey).toBe(KEY);
    expect(await readFile(aiFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["ai.json"]);

    const status = aiStatus(resolved, envOnly, home);
    expect(status.secretProtection).toBe("environment");
    expect(status.secretNotice).toEqual(expect.stringContaining("plain text"));
    expect(status.secretNotice).toContain(aiFile());
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("AI: a new key is refused with KEYS_FROM_ENVIRONMENT and the file is left as it was", async () => {
    await writeFileIn("ai.json", openai);
    const before = await readFile(aiFile());
    await expect(saveAiConfig({ apiKey: "sk-brand-new-key-0001" }, { env: envOnly, home })).rejects.toThrow(KEYS_FROM_ENVIRONMENT);
    expect(await readFile(aiFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("AI: a new key is refused where no key was saved, and nothing is created", async () => {
    await expect(saveAiConfig({ provider: "ollama", apiKey: "sk-brand-new-key-0001", model: "m" }, { env: envOnly, home })).rejects.toThrow(KEYS_FROM_ENVIRONMENT);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("AI: a new AWS secret access key is refused too", async () => {
    await expect(
      saveAiConfig({ provider: "bedrock", region: "us-east-1", model: "m", awsAccessKeyId: AWS_ID, awsSecretAccessKey: AWS_SECRET }, { env: envOnly, home }),
    ).rejects.toThrow(KEYS_FROM_ENVIRONMENT);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("AI: a setting that is not a secret still saves, and the plain-text key stays in the file", async () => {
    await writeFileIn("ai.json", openai);
    const resolved = await saveAiConfig({ model: "m-new" }, { env: envOnly, home });
    expect(resolved.config).toMatchObject({ model: "m-new", apiKey: KEY });
    expect(await aiJson()).toMatchObject({ model: "m-new", apiKey: KEY, apiKeyOrigin: "https://api.a.example" });
    expect(await readdir(dir)).toEqual(["ai.json"]);
  });

  it("Accounts: the plain-text passwords stay in the file and the slot problem says so", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    const before = await readFile(accountsFile());
    const { config, status } = await resolveAccounts({ env: envOnly });
    expect(config.accounts.a.password).toBe(PASSWORD_A);
    expect(await readFile(accountsFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["accounts.json"]);
    expect(status.secretProtection).toBe("environment");
    expect(status.accounts.a.problem).toEqual(expect.stringContaining("plain text"));
    expect(status.accounts.b.problem).toEqual(expect.stringContaining("plain text"));
    expect(JSON.stringify(status)).not.toContain(PASSWORD_A);
  });

  it("Accounts: a new password is refused with the environment variable named, and the file is left as it was", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    const before = await readFile(accountsFile());
    await expect(saveAccounts({ accounts: { a: { password: "a-brand-new-password-9" } } }, { env: envOnly })).rejects.toThrow(
      passwordsFromEnvironment("RUNHOUND_ACCOUNT_A_PASSWORD"),
    );
    expect(await readFile(accountsFile())).toEqual(before);
    expect(await readdir(dir)).toEqual(["accounts.json"]);
  });

  it("Accounts: a new password is refused where none was saved, and nothing is created", async () => {
    await expect(
      saveAccounts({ accounts: { b: { loginUrl: LOGIN, username: "sam@fernway.test", password: "a-brand-new-password-9" } } }, { env: envOnly }),
    ).rejects.toThrow(passwordsFromEnvironment("RUNHOUND_ACCOUNT_B_PASSWORD"));
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("Accounts: a field that is not a password still saves, and the plain-text passwords stay in the file", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    await saveAccounts({ accounts: { a: { username: "alex.new@fernway.test" } } }, { env: envOnly });
    const file = await accountsJson();
    expect(file.accounts.a).toMatchObject({ username: "alex.new@fernway.test", password: PASSWORD_A, passwordOrigin: "http://127.0.0.1:5173" });
    expect(file.accounts.b).toMatchObject({ password: PASSWORD_B });
    expect(await readdir(dir)).toEqual(["accounts.json"]);
  });
});

describe("a store locked by the desktop app's OS keychain with secrets still saved in plain text", () => {
  it("AI: resolve still returns the plain-text key, leaves the file alone, and says the store is locked", async () => {
    await writeFileIn("ai.json", openai);
    await lockStore();
    const secrets = [await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))];
    const before = await readFile(aiFile());

    const resolved = await resolveAiConfig({ env, home });
    expect(resolved.config.apiKey).toBe(KEY);
    expect(await readFile(aiFile())).toEqual(before);
    expect([await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))]).toEqual(secrets);
    expect(aiStatus(resolved, env, home).secretNotice).toBe(LOCKED_BY_OS_KEYCHAIN);
  });

  it("AI: a new key is not saved, and the files are left as they were", async () => {
    await writeFileIn("ai.json", openai);
    await lockStore();
    const secrets = [await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))];
    const before = await readFile(aiFile());
    await expect(saveAiConfig({ apiKey: "sk-brand-new-key-0001" }, { env, home })).rejects.toThrow(LOCKED_BY_OS_KEYCHAIN);
    expect(await readFile(aiFile())).toEqual(before);
    expect([await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))]).toEqual(secrets);
  });

  it("Accounts: resolve still returns the plain-text passwords and leaves the file alone", async () => {
    await writeFileIn("accounts.json", legacyAccounts);
    await lockStore();
    const secrets = [await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))];
    const before = await readFile(accountsFile());

    const { config } = await resolveAccounts({ env });
    expect(config.accounts.a.password).toBe(PASSWORD_A);
    expect(config.accounts.b.password).toBe(PASSWORD_B);
    expect(await readFile(accountsFile())).toEqual(before);
    expect([await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))]).toEqual(secrets);
  });
});

describe("the move under a looser folder", () => {
  it("tightens the config folder to 0700 and writes the rewritten ai.json 0600", async () => {
    await writeFileIn("ai.json", openai);
    await chmod(dir, 0o755);
    await resolveAiConfig({ env, home });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(aiFile())).mode & 0o777).toBe(0o600);
  });
});
