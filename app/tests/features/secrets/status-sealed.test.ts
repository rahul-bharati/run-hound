/**
 * Opening the app never makes the OS ask for the keychain (D10): the status the UI reads on every page load
 * (GET /api/ai, /api/settings, /api/accounts) comes from sealed reads of the secret store, so the OS key protector is
 * not asked; only what uses a secret opens the store. A sealed value can never be sent: the model client and sign-in
 * refuse it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAiConfig, resolveAiConfig } from "../../../src/ai/config.js";
import { createLlmClient } from "../../../src/ai/client.js";
import { saveAccounts, resolveAccounts } from "../../../src/operations/accounts-storage.js";
import { SEALED_SECRET, useOsKeyProtector, type KeyProtector } from "../../../src/operations/secret-store.js";
import { createApp } from "../../../src/server/app.js";
import { signIn } from "../../../src/engine/auth/sign-in.js";
import type { Browser } from "playwright";

const KEY = "sk-ant-api03-test-key-0123456789abcdefghij";
const PASSWORD = "correct-horse-battery-staple-91";

/** A working stand-in for the OS keychain that counts every time it is asked. */
function countingKeychain(): KeyProtector & { asked: number } {
  const prefix = Buffer.from("KC:");
  const keychain = {
    asked: 0,
    wrap: (key: Buffer) => {
      keychain.asked += 1;
      return Buffer.concat([prefix, key]);
    },
    unwrap: (wrapped: Buffer) => {
      keychain.asked += 1;
      return wrapped.subarray(prefix.length);
    },
  };
  return keychain;
}

let dir: string;
let saved: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rh-sealed-"));
  saved = process.env.RUNHOUND_CONFIG_DIR;
  process.env.RUNHOUND_CONFIG_DIR = dir;
  useOsKeyProtector(countingKeychain());
  await saveAiConfig({ enabled: true, provider: "anthropic", model: "claude-test", apiKey: KEY, allowRemote: true });
  await saveAccounts({ accounts: { a: { loginUrl: "http://127.0.0.1:5999/login", username: "qa@example.test", password: PASSWORD } } });
});
afterEach(async () => {
  useOsKeyProtector(null);
  if (saved === undefined) delete process.env.RUNHOUND_CONFIG_DIR;
  else process.env.RUNHOUND_CONFIG_DIR = saved;
  await rm(dir, { recursive: true, force: true });
});

describe("opening the app asks the keychain nothing", () => {
  it("GET /api/ai, /api/settings and /api/accounts report what is saved without opening the store", async () => {
    // A new process: nothing unwrapped yet.
    const keychain = countingKeychain();
    useOsKeyProtector(keychain);
    const app = createApp({ canShowBrowser: false });
    const get = (path: string) => app.request(path, { headers: { "x-run-hound": "1" } });
    const ai = (await (await get("/api/ai")).json()) as { hasKey: boolean; savedKeys?: string[] };
    const settings = (await (await get("/api/settings")).json()) as { ai: { hasKey: boolean } };
    const accounts = (await (await get("/api/accounts")).json()) as { accounts: { a: { hasPassword: boolean; ready: boolean } } };
    expect(ai.hasKey).toBe(true);
    expect(settings.ai.hasKey).toBe(true);
    expect(accounts.accounts.a).toMatchObject({ hasPassword: true, ready: true });
    expect(keychain.asked).toBe(0);
    // Nothing a status read returned holds a secret, or the sealed marker.
    for (const body of [ai, settings, accounts]) {
      const text = JSON.stringify(body);
      for (const secret of [KEY, PASSWORD, SEALED_SECRET]) expect(text).not.toContain(secret);
    }
  });

  it("what uses a secret opens the store, once", async () => {
    const keychain = countingKeychain();
    useOsKeyProtector(keychain);
    expect((await resolveAiConfig()).config.apiKey).toBe(KEY);
    expect((await resolveAccounts()).config.accounts.a?.password).toBe(PASSWORD);
    expect(keychain.asked).toBe(1);
  });
});

describe("a sealed value is never sent", () => {
  it("the model client refuses a sealed key", async () => {
    const { config } = await resolveAiConfig({ sealed: true });
    expect(config.apiKey).toBe(SEALED_SECRET);
    expect(() => createLlmClient(config)).toThrow(/wasn't opened/);
  });

  it("sign-in refuses a sealed password before opening any page", async () => {
    const { config } = await resolveAccounts({ sealed: true });
    const account = config.accounts.a!;
    expect(account.password).toBe(SEALED_SECRET);
    const browser = { newContext: () => { throw new Error("a page was opened"); } } as unknown as Browser;
    await expect(signIn(browser, account)).rejects.toThrow(/wasn't opened/);
  });
});
