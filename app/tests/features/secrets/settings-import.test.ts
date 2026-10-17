import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPORT_MARKER, importCliSettingsOnce } from "../../../src/operations/settings-import.js";
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
 * The desktop app's one-time import of the command line's saved settings (operations/settings-import.ts): the AI and
 * test-account files are copied, the keys and passwords are re-sealed in the desktop folder's own store, the command
 * line's folder is left as it was, and a marker stops a second run.
 */

let tmp: string;
let cli: string;
let desktop: string;
const normal = { env: {} as NodeJS.ProcessEnv };
const NOW = new Date("2026-10-07T12:00:00.000Z");
const options = { ...normal, now: NOW };

/** Not valid pretty JSON on purpose: CRLF, no final newline, non-ASCII. A copy must keep every byte. */
const AI_JSON = '{\r\n  "provider": "anthropic",\r\n  "model": "claude-ünï ✓"\r\n}';
const ACCOUNTS_JSON = '{"accounts":[{"id":"a","username":"tester"}]}\n';
const SECRETS = {
  "ai.key.anthropic": "sk-ant-PLAINTEXT-key-7731",
  "ai.awsSecretAccessKey": "aws-PLAINTEXT-secret-9120",
  "accounts.a.password": "päss wörd ✓ 5512",
};
const LIVE = { "live.anthropic": "sk-live-PLAINTEXT-4821", "live.openai": "sk-live-PLAINTEXT-9033" };
const PREFIX = Buffer.from("FAKE-KEYCHAIN:");

/** A stand-in for the OS credential store: XOR with a prefix, and it refuses anything it didn't wrap. */
function fakeProtector(): KeyProtector {
  return {
    wrap: (key) => Buffer.concat([PREFIX, Buffer.from(key.map((b) => b ^ 0x5a))]),
    unwrap: (wrapped) => {
      if (!wrapped.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error("not wrapped by this keychain");
      return Buffer.from(wrapped.subarray(PREFIX.length).map((b) => b ^ 0x5a));
    },
  };
}

beforeEach(async () => {
  useOsKeyProtector(null);
  tmp = await mkdtemp(join(tmpdir(), "runhound-import-"));
  cli = join(tmp, "cli");
  desktop = join(tmp, "desktop");
});

afterEach(async () => {
  useOsKeyProtector(null);
  await chmod(tmp, 0o700).catch(() => undefined);
  await rm(tmp, { recursive: true, force: true });
});

/** Saves what the command line would have: settings files and, optionally, secrets (sealed with no OS protector set). */
async function seedCli(opts: { ai?: boolean; accounts?: boolean; secrets?: Record<string, string> } = {}): Promise<void> {
  await mkdir(cli, { recursive: true, mode: 0o700 });
  if (opts.ai) await writeFile(join(cli, "ai.json"), AI_JSON);
  if (opts.accounts) await writeFile(join(cli, "accounts.json"), ACCOUNTS_JSON);
  if (opts.secrets) await writeSecrets(cli, opts.secrets, normal);
}

const marker = async (): Promise<{ version: number; at: string; from: string | null; files: string[]; secrets: number }> =>
  JSON.parse(await readFile(join(desktop, IMPORT_MARKER), "utf8"));
const names = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();
const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;
const keyFile = async (dir: string): Promise<{ protection: string; key: string }> => JSON.parse(await readFile(join(dir, KEY_FILE), "utf8"));
const snapshot = async (dir: string): Promise<Record<string, Buffer>> =>
  Object.fromEntries(await Promise.all((await names(dir)).map(async (name) => [name, await readFile(join(dir, name))] as const)));

describe("when there is nothing to import", () => {
  it("does nothing when both folders are the same (however the path is written)", async () => {
    await seedCli({ ai: true, secrets: SECRETS });
    const before = await snapshot(cli);
    expect(await importCliSettingsOnce(cli, cli, options)).toBeNull();
    expect(await importCliSettingsOnce(cli, `${cli}/.`, options)).toBeNull();
    expect(await snapshot(cli)).toEqual(before);
    expect(await names(cli)).not.toContain(IMPORT_MARKER);
  });

  it("returns null when the marker is already there, and copies nothing", async () => {
    await seedCli({ ai: true, accounts: true, secrets: SECRETS });
    await mkdir(desktop, { recursive: true });
    await writeFile(join(desktop, IMPORT_MARKER), "earlier marker");
    expect(await importCliSettingsOnce(cli, desktop, options)).toBeNull();
    expect(await names(desktop)).toEqual([IMPORT_MARKER]);
    expect(await readFile(join(desktop, IMPORT_MARKER), "utf8")).toBe("earlier marker");
  });

  it.each(["ai.json", "accounts.json", SECRETS_FILE, KEY_FILE])("leaves the desktop's own %s alone: null, marker with from null, nothing copied", async (existing) => {
    await seedCli({ ai: true, accounts: true, secrets: SECRETS });
    await mkdir(desktop, { recursive: true });
    await writeFile(join(desktop, existing), "the desktop's own");
    expect(await importCliSettingsOnce(cli, desktop, options)).toBeNull();
    expect(await names(desktop)).toEqual([existing, IMPORT_MARKER].sort());
    expect(await readFile(join(desktop, existing), "utf8")).toBe("the desktop's own");
    expect(await marker()).toEqual({ version: 1, at: NOW.toISOString(), from: null, files: [], secrets: 0 });
  });

  it("returns null and writes the marker when the command line saved nothing (empty folder)", async () => {
    await seedCli();
    expect(await importCliSettingsOnce(cli, desktop, options)).toBeNull();
    expect(await names(desktop)).toEqual([IMPORT_MARKER]);
    expect(await marker()).toEqual({ version: 1, at: NOW.toISOString(), from: null, files: [], secrets: 0 });
    expect(await mode(join(desktop, IMPORT_MARKER))).toBe(0o600);
    expect(await mode(desktop)).toBe(0o700);
  });

  it("returns null and writes the marker when the command line's folder doesn't exist", async () => {
    expect(await importCliSettingsOnce(cli, desktop, options)).toBeNull();
    expect(await names(desktop)).toEqual([IMPORT_MARKER]);
    expect((await marker()).from).toBeNull();
  });

  it("imports nothing when the command line only has live.* secrets", async () => {
    await seedCli({ secrets: LIVE });
    expect(await importCliSettingsOnce(cli, desktop, options)).toBeNull();
    expect(await names(desktop)).toEqual([IMPORT_MARKER]);
  });
});

describe("a full import", () => {
  it("copies ai.json and accounts.json byte for byte, 0600 in a 0700 folder", async () => {
    await seedCli({ ai: true, accounts: true, secrets: SECRETS });
    await importCliSettingsOnce(cli, desktop, options);
    expect(await readFile(join(desktop, "ai.json"))).toEqual(Buffer.from(AI_JSON));
    expect(await readFile(join(desktop, "accounts.json"))).toEqual(Buffer.from(ACCOUNTS_JSON));
    for (const name of ["ai.json", "accounts.json", IMPORT_MARKER, SECRETS_FILE, KEY_FILE]) expect(await mode(join(desktop, name))).toBe(0o600);
    expect(await mode(desktop)).toBe(0o700);
    expect(await names(desktop)).toEqual(["accounts.json", "ai.json", IMPORT_MARKER, KEY_FILE, SECRETS_FILE].sort());
  });

  it("re-seals the keys and passwords in the desktop folder, and does not take the live.* ones", async () => {
    await seedCli({ ai: true, accounts: true, secrets: { ...SECRETS, ...LIVE } });
    await importCliSettingsOnce(cli, desktop, options);
    useOsKeyProtector(null); // a new process
    expect(await readSecrets(desktop, normal)).toEqual({ values: SECRETS, protection: "run-hound", problem: null });
    for (const name of Object.keys(LIVE)) expect((await readSecrets(desktop, normal)).values).not.toHaveProperty(name);
  });

  it("reports the files and the count, and records them with the source folder in the marker", async () => {
    await seedCli({ ai: true, accounts: true, secrets: { ...SECRETS, ...LIVE } });
    const result = await importCliSettingsOnce(cli, desktop, options);
    expect(result).toEqual({ from: cli, files: ["ai.json", "accounts.json"], secrets: 3, problem: null });
    expect(await marker()).toEqual({ version: 1, at: NOW.toISOString(), from: cli, files: ["ai.json", "accounts.json"], secrets: 3 });
  });

  it("never writes a key or password in plain text (or plain base64) in the desktop folder", async () => {
    await seedCli({ ai: true, accounts: true, secrets: { ...SECRETS, ...LIVE } });
    await importCliSettingsOnce(cli, desktop, options);
    for (const name of await names(desktop)) {
      const text = await readFile(join(desktop, name), "utf8");
      for (const value of [...Object.values(SECRETS), ...Object.values(LIVE)]) {
        expect(text, `${name} holds ${value}`).not.toContain(value);
        expect(text, `${name} holds base64 of ${value}`).not.toContain(Buffer.from(value).toString("base64"));
      }
    }
  });

  it("leaves the command line's folder exactly as it was", async () => {
    await seedCli({ ai: true, accounts: true, secrets: { ...SECRETS, ...LIVE } });
    const before = await snapshot(cli);
    await importCliSettingsOnce(cli, desktop, options);
    expect(await snapshot(cli)).toEqual(before);
  });

  it("imports settings files alone, without creating a secret store", async () => {
    await seedCli({ ai: true });
    const result = await importCliSettingsOnce(cli, desktop, options);
    expect(result).toEqual({ from: cli, files: ["ai.json"], secrets: 0, problem: null });
    expect(await names(desktop)).toEqual(["ai.json", IMPORT_MARKER]);
  });

  it("imports secrets alone, without settings files", async () => {
    await seedCli({ secrets: SECRETS });
    const result = await importCliSettingsOnce(cli, desktop, options);
    expect(result).toEqual({ from: cli, files: [], secrets: 3, problem: null });
    expect((await readSecrets(desktop, normal)).values).toEqual(SECRETS);
  });

  it("runs once: a second call returns null and changes nothing, even if the command line saved more since", async () => {
    await seedCli({ ai: true, secrets: SECRETS });
    expect(await importCliSettingsOnce(cli, desktop, options)).not.toBeNull();
    const after = await snapshot(desktop);
    await writeFile(join(cli, "ai.json"), '{"changed":true}');
    await writeSecrets(cli, { "ai.key.openai": "sk-openai-PLAINTEXT-1" }, normal);
    expect(await importCliSettingsOnce(cli, desktop, { ...options, now: new Date("2027-01-01T00:00:00Z") })).toBeNull();
    expect(await snapshot(desktop)).toEqual(after);
  });
});

describe("with the desktop app's OS keychain", () => {
  it("seals the desktop store under the keychain and leaves the command line's key file byte-identical (no upgrade on read)", async () => {
    await seedCli({ ai: true, accounts: true, secrets: { ...SECRETS, ...LIVE } });
    expect((await keyFile(cli)).protection).toBe("run-hound");
    const before = await snapshot(cli);

    const protector = fakeProtector();
    useOsKeyProtector(protector);
    const result = await importCliSettingsOnce(cli, desktop, options);
    expect(result).toEqual({ from: cli, files: ["ai.json", "accounts.json"], secrets: 3, problem: null });

    // The desktop's store is wrapped by the keychain and opens with it.
    const saved = await keyFile(desktop);
    expect(saved.protection).toBe("os-keychain");
    expect(protector.unwrap(Buffer.from(saved.key, "base64"))).toHaveLength(32);
    useOsKeyProtector(fakeProtector());
    expect(await readSecrets(desktop, normal)).toEqual({ values: SECRETS, protection: "os-keychain", problem: null });

    // The command line's store is untouched: still "run-hound", byte for byte.
    expect((await keyFile(cli)).protection).toBe("run-hound");
    expect(await readFile(join(cli, KEY_FILE))).toEqual(before[KEY_FILE]);
    expect(await snapshot(cli)).toEqual(before);
  });

  it("leaves the command line able to read its own secrets without the keychain", async () => {
    await seedCli({ secrets: { ...SECRETS, ...LIVE } });
    useOsKeyProtector(fakeProtector());
    await importCliSettingsOnce(cli, desktop, options);
    useOsKeyProtector(null);
    expect(await readSecrets(cli, normal)).toEqual({ values: { ...SECRETS, ...LIVE }, protection: "run-hound", problem: null });
  });
});

describe("when the command line's store is locked by an OS keychain", () => {
  it("still imports the settings files, imports no secrets, and reports LOCKED_BY_OS_KEYCHAIN", async () => {
    useOsKeyProtector(fakeProtector());
    await seedCli({ ai: true, accounts: true, secrets: SECRETS });
    expect((await keyFile(cli)).protection).toBe("os-keychain");
    useOsKeyProtector(null); // this process has no keychain
    const before = await snapshot(cli);

    const result = await importCliSettingsOnce(cli, desktop, options);
    expect(result).toEqual({ from: cli, files: ["ai.json", "accounts.json"], secrets: 0, problem: LOCKED_BY_OS_KEYCHAIN });
    expect(await readFile(join(desktop, "ai.json"))).toEqual(Buffer.from(AI_JSON));
    expect(await readFile(join(desktop, "accounts.json"))).toEqual(Buffer.from(ACCOUNTS_JSON));
    expect(await names(desktop)).toEqual(["accounts.json", "ai.json", IMPORT_MARKER]);
    expect(await marker()).toEqual({ version: 1, at: NOW.toISOString(), from: cli, files: ["ai.json", "accounts.json"], secrets: 0 });
    expect(await snapshot(cli)).toEqual(before);
  });
});

describe("when the desktop folder can't be written", () => {
  const isRoot = process.getuid?.() === 0;

  it("throws and writes no marker when a file is where the folder should be, then imports once that is fixed", async () => {
    await seedCli({ ai: true, secrets: SECRETS });
    await writeFile(desktop, "in the way");
    await expect(importCliSettingsOnce(cli, desktop, options)).rejects.toThrow();
    expect(await readFile(desktop, "utf8")).toBe("in the way");

    await rm(desktop);
    expect(await importCliSettingsOnce(cli, desktop, options)).toMatchObject({ files: ["ai.json"], secrets: 3 });
    expect((await marker()).from).toBe(cli);
  });

  it("removes what it wrote when it fails partway, so the next launch imports everything", async () => {
    await seedCli({ ai: true, secrets: SECRETS });
    await mkdir(join(cli, "accounts.json")); // reading it fails (EISDIR) after the secrets and ai.json are written
    await expect(importCliSettingsOnce(cli, desktop, options)).rejects.toThrow();
    expect(await names(desktop)).toEqual([]);

    await rm(join(cli, "accounts.json"), { recursive: true });
    await writeFile(join(cli, "accounts.json"), ACCOUNTS_JSON);
    expect(await importCliSettingsOnce(cli, desktop, options)).toMatchObject({ files: ["ai.json", "accounts.json"], secrets: 3 });
    expect(await readFile(join(desktop, "accounts.json"), "utf8")).toBe(ACCOUNTS_JSON);
  });

  it("throws on settings files alone too (no secrets to save first)", async () => {
    await seedCli({ ai: true });
    await writeFile(desktop, "in the way");
    await expect(importCliSettingsOnce(cli, desktop, options)).rejects.toThrow();
  });

  it.skipIf(isRoot)("throws and creates nothing when the parent folder is read-only (skipped as root: root ignores permissions)", async () => {
    await seedCli({ ai: true, secrets: SECRETS });
    const parent = join(tmp, "readonly");
    await mkdir(parent, { mode: 0o500 });
    await chmod(parent, 0o500);
    await expect(importCliSettingsOnce(cli, join(parent, "desktop"), options)).rejects.toThrow();
    await chmod(parent, 0o700);
    expect(await readdir(parent)).toEqual([]);
  });
});
