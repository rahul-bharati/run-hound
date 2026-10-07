import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DAMAGED_ENTRIES,
  ENVIRONMENT_ONLY,
  KEY_FILE,
  LOCKED_BY_OS_KEYCHAIN,
  readSecrets,
  SECRETS_FILE,
  secretProtection,
  UNREADABLE_KEY,
  useOsKeyProtector,
  writeSecrets,
  type KeyProtector,
} from "../../../src/operations/secret-store.js";

/**
 * The encrypted secret store (operations/secret-store.ts): AES-256-GCM entries in secrets.json under one data key in
 * secrets.key, which is saved as is ("run-hound"), wrapped by the OS keychain ("os-keychain"), or never saved
 * (RUNHOUND_SECRETS=environment).
 */

let tmp: string;
let dir: string;
/** Neither the real environment nor a stray RUNHOUND_SECRETS decides how these tests save. */
const normal = { env: {} as NodeJS.ProcessEnv };
const environment = { env: { RUNHOUND_SECRETS: "environment" } as NodeJS.ProcessEnv };

beforeEach(async () => {
  useOsKeyProtector(null);
  tmp = await mkdtemp(join(tmpdir(), "runhound-secrets-"));
  dir = join(tmp, "config");
});

afterEach(async () => {
  useOsKeyProtector(null);
  await rm(tmp, { recursive: true, force: true });
});

/** What a store leaves in its folder: no temp files. */
const FILES = [SECRETS_FILE, KEY_FILE].sort();
const SECRET = "sk-live-PLAINTEXT-secret-4821";
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

/** A keychain whose wrap works but whose unwrap always refuses (a changed keychain, a locked login). */
function lockedProtector(): KeyProtector {
  return { wrap: fakeProtector().wrap, unwrap: () => { throw new Error("keychain is locked"); } };
}

const keyFile = async (): Promise<{ version: number; protection: string; key: string }> =>
  JSON.parse(await readFile(join(dir, KEY_FILE), "utf8")) as { version: number; protection: string; key: string };

const entries = async (): Promise<Record<string, string>> =>
  (JSON.parse(await readFile(join(dir, SECRETS_FILE), "utf8")) as { entries: Record<string, string> }).entries;

/** What a new process sees: the in-memory data key cache is dropped. */
const restart = (protector: KeyProtector | null = null): void => useOsKeyProtector(protector);

describe("secretProtection", () => {
  it("is run-hound by default, os-keychain once the desktop app hands over a protector", () => {
    expect(secretProtection({})).toBe("run-hound");
    useOsKeyProtector(fakeProtector());
    expect(secretProtection({})).toBe("os-keychain");
    useOsKeyProtector(null);
    expect(secretProtection({})).toBe("run-hound");
  });

  it("is environment with RUNHOUND_SECRETS=environment, whatever protector is set", () => {
    expect(secretProtection({ RUNHOUND_SECRETS: "environment" })).toBe("environment");
    useOsKeyProtector(fakeProtector());
    expect(secretProtection({ RUNHOUND_SECRETS: "environment" })).toBe("environment");
  });
});

describe("saving and reading (run-hound protection)", () => {
  it("reads nothing, without a problem, where nothing is saved", async () => {
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: null });
  });

  it("round-trips saved secrets by name", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET, "accounts.a.password": "päss wörd ✓ 1234" }, normal);
    expect(await readSecrets(dir, normal)).toEqual({
      values: { "ai.apiKey": SECRET, "accounts.a.password": "päss wörd ✓ 1234" },
      protection: "run-hound",
      problem: null,
    });
  });

  it("keeps the other secrets when one is changed", async () => {
    await writeSecrets(dir, { one: "first-value", two: "second-value" }, normal);
    await writeSecrets(dir, { two: "second-changed" }, normal);
    expect((await readSecrets(dir, normal)).values).toEqual({ one: "first-value", two: "second-changed" });
  });

  it("keeps the values across a restart (the data key is read back from secrets.key)", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: { "ai.apiKey": SECRET }, protection: "run-hound", problem: null });
    // A write after the restart seals with the same key: both entries still open.
    await writeSecrets(dir, { other: "other-value-1" }, normal);
    restart();
    expect((await readSecrets(dir, normal)).values).toEqual({ "ai.apiKey": SECRET, other: "other-value-1" });
  });

  it("creates the folder 0700 and secrets.json and secrets.key 0600, with no temp file left", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, SECRETS_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, KEY_FILE))).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).sort()).toEqual(FILES);
  });

  it("tightens a folder that already exists with looser permissions", async () => {
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("replaces a looser pre-existing secrets.json with a new 0600 file", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "{}", { mode: 0o644 });
    await chmod(join(dir, SECRETS_FILE), 0o644);
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    expect((await stat(join(dir, SECRETS_FILE))).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).sort()).toEqual(FILES);
  });

  it("never writes a value in plain text or as plain base64: not in secrets.json, not in secrets.key", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    for (const name of [SECRETS_FILE, KEY_FILE]) {
      const text = await readFile(join(dir, name), "utf8");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(Buffer.from(SECRET).toString("base64"));
    }
    expect(await keyFile()).toMatchObject({ version: 1, protection: "run-hound" });
    expect(Buffer.from((await keyFile()).key, "base64")).toHaveLength(32);
  });

  it("seals the same value differently each time (a fresh IV per save)", async () => {
    await writeSecrets(dir, { a: SECRET }, normal);
    const first = (await entries()).a;
    await writeSecrets(dir, { a: SECRET }, normal);
    expect((await entries()).a).not.toBe(first);
  });

  it("removes a secret saved as null or as an empty string", async () => {
    await writeSecrets(dir, { a: "value-for-a-123", b: "value-for-b-456", c: "value-for-c-789" }, normal);
    await writeSecrets(dir, { a: null, b: "" }, normal);
    expect((await readSecrets(dir, normal)).values).toEqual({ c: "value-for-c-789" });
    expect(Object.keys(await entries())).toEqual(["c"]);
    await writeSecrets(dir, { c: null }, normal);
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: null });
  });

  it("creates no files for a removal where nothing is saved", async () => {
    await writeSecrets(dir, { a: null, b: "" }, normal);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lets every one of several saves at once land", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `ai.field${i}`);
    await Promise.all(names.map((name, i) => writeSecrets(dir, { [name]: `value-${i}-${"x".repeat(i)}` }, normal)));
    const expected = Object.fromEntries(names.map((name, i) => [name, `value-${i}-${"x".repeat(i)}`]));
    expect(await readSecrets(dir, normal)).toEqual({ values: expected, protection: "run-hound", problem: null });
    restart();
    expect((await readSecrets(dir, normal)).values).toEqual(expected);
    expect((await readdir(dir)).sort()).toEqual(FILES);
  });

  it("keeps stores in different folders apart", async () => {
    const other = join(tmp, "other");
    await writeSecrets(dir, { a: "value-in-first-dir" }, normal);
    await writeSecrets(other, { a: "value-in-other-dir" }, normal);
    expect((await readSecrets(dir, normal)).values).toEqual({ a: "value-in-first-dir" });
    expect((await readSecrets(other, normal)).values).toEqual({ a: "value-in-other-dir" });
  });
});

describe("damaged entries", () => {
  it("does not open an entry copied to another name, and still reads the others", async () => {
    await writeSecrets(dir, { a: "value-for-a-123", b: "value-for-b-456" }, normal);
    const sealed = await entries();
    await writeFile(join(dir, SECRETS_FILE), JSON.stringify({ version: 1, entries: { ...sealed, copy: sealed.a } }));
    restart();
    const read = await readSecrets(dir, normal);
    expect(read.values).toEqual({ a: "value-for-a-123", b: "value-for-b-456" });
    expect(read.values).not.toHaveProperty("copy");
    expect(read.problem).toBe(DAMAGED_ENTRIES);
  });

  it("does not open an entry that was swapped with another one's", async () => {
    await writeSecrets(dir, { a: "value-for-a-123", b: "value-for-b-456" }, normal);
    const sealed = await entries();
    await writeFile(join(dir, SECRETS_FILE), JSON.stringify({ version: 1, entries: { a: sealed.b, b: sealed.a } }));
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: DAMAGED_ENTRIES });
  });

  it("does not open a tampered entry, and still reads the others", async () => {
    await writeSecrets(dir, { a: "value-for-a-123", b: "value-for-b-456" }, normal);
    const sealed = await entries();
    const bytes = Buffer.from(sealed.a!, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
    await writeFile(join(dir, SECRETS_FILE), JSON.stringify({ version: 1, entries: { ...sealed, a: bytes.toString("base64") } }));
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: { b: "value-for-b-456" }, protection: "run-hound", problem: DAMAGED_ENTRIES });
  });

  it("does not open an entry too short to hold an IV and tag,", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    const sealed = await entries();
    await writeFile(join(dir, SECRETS_FILE), JSON.stringify({ version: 1, entries: { ...sealed, short: "AAAA" } }));
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: { a: "value-for-a-123" }, protection: "run-hound", problem: DAMAGED_ENTRIES });
  });

  it("reads a secrets.json that is not JSON as holding nothing", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "{not json");
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: null });
  });
});

describe("a data key that is damaged or missing", () => {
  it("is UNREADABLE_KEY when secrets.key is garbage, and the next save starts a fresh store", async () => {
    await writeSecrets(dir, { old: "value-saved-before" }, normal);
    await writeFile(join(dir, KEY_FILE), "this is not a key file");
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: UNREADABLE_KEY });

    await writeSecrets(dir, { fresh: "value-saved-after" }, normal);
    restart();
    // What the old key sealed is lost; the new value opens and nothing is left damaged.
    expect(await readSecrets(dir, normal)).toEqual({ values: { fresh: "value-saved-after" }, protection: "run-hound", problem: null });
    expect(Object.keys(await entries())).toEqual(["fresh"]);
    expect((await stat(join(dir, KEY_FILE))).mode & 0o777).toBe(0o600);
  });

  it("is UNREADABLE_KEY when secrets.key is JSON of the wrong shape or holds a key of the wrong length", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    for (const text of [
      JSON.stringify({ version: 2, protection: "run-hound", key: "AAAA" }),
      JSON.stringify({ version: 1, protection: "elsewhere", key: "AAAA" }),
      JSON.stringify({ version: 1, protection: "run-hound" }),
      JSON.stringify({ version: 1, protection: "run-hound", key: Buffer.alloc(16).toString("base64") }),
      "[]",
    ]) {
      await writeFile(join(dir, KEY_FILE), text);
      restart();
      expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: UNREADABLE_KEY });
    }
  });

  it("is UNREADABLE_KEY when secrets.json has entries and secrets.key is missing", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    await rm(join(dir, KEY_FILE));
    restart();
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: UNREADABLE_KEY });
  });

  it("makes a new data key on the next save when secrets.key is missing, and the new value opens", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    await rm(join(dir, KEY_FILE));
    restart();
    await writeSecrets(dir, { b: "value-for-b-456" }, normal);
    restart();
    const read = await readSecrets(dir, normal);
    expect(read.values).toMatchObject({ b: "value-for-b-456" });
    expect(read.values).not.toHaveProperty("a");
    // The entry the lost key sealed can never open again: it must not be reported as damaged for ever.
    expect(read.problem).toBeNull();
    expect(Object.keys(await entries())).toEqual(["b"]);
  });

  it("notices secrets.key replaced on disk while the process runs (the cache follows the file's text)", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    expect((await readSecrets(dir, normal)).problem).toBeNull();
    await writeFile(join(dir, KEY_FILE), "garbage");
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: UNREADABLE_KEY });
  });
});

describe("RUNHOUND_SECRETS=environment", () => {
  it("reads nothing, even where secrets are saved", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    expect(await readSecrets(dir, environment)).toEqual({ values: {}, protection: "environment", problem: null });
  });

  it("refuses to save with ENVIRONMENT_ONLY and creates no files", async () => {
    await expect(writeSecrets(dir, { "ai.apiKey": SECRET }, environment)).rejects.toThrow(ENVIRONMENT_ONLY);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a removal too, and leaves existing files byte-identical", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    const before = [await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))];
    await expect(writeSecrets(dir, { "ai.apiKey": null }, environment)).rejects.toThrow(ENVIRONMENT_ONLY);
    expect([await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))]).toEqual(before);
  });
});

describe("os-keychain protection", () => {
  it("saves the data key wrapped by the protector, and the protector's own form is not the raw key", async () => {
    const protector = fakeProtector();
    useOsKeyProtector(protector);
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    const saved = await keyFile();
    expect(saved).toMatchObject({ version: 1, protection: "os-keychain" });
    const wrapped = Buffer.from(saved.key, "base64");
    expect(wrapped.subarray(0, PREFIX.length).equals(PREFIX)).toBe(true);
    expect(protector.unwrap(wrapped)).toHaveLength(32);
    expect(wrapped).toHaveLength(PREFIX.length + 32);
    expect(await readSecrets(dir, normal)).toEqual({ values: { "ai.apiKey": SECRET }, protection: "os-keychain", problem: null });
    expect(await readFile(join(dir, SECRETS_FILE), "utf8")).not.toContain(SECRET);
    expect((await stat(join(dir, KEY_FILE))).mode & 0o777).toBe(0o600);
  });

  it("opens the values again after a restart with the same keychain", async () => {
    useOsKeyProtector(fakeProtector());
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    restart(fakeProtector());
    expect(await readSecrets(dir, normal)).toEqual({ values: { "ai.apiKey": SECRET }, protection: "os-keychain", problem: null });
  });

  it("upgrades a run-hound key file to os-keychain on first read once a protector is set", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    const rawKey = Buffer.from((await keyFile()).key, "base64");
    expect((await keyFile()).protection).toBe("run-hound");

    const protector = fakeProtector();
    restart(protector);
    expect(await readSecrets(dir, normal)).toEqual({ values: { "ai.apiKey": SECRET }, protection: "os-keychain", problem: null });

    const upgraded = await keyFile();
    expect(upgraded.protection).toBe("os-keychain");
    expect(Buffer.from(upgraded.key, "base64").equals(rawKey)).toBe(false);
    expect(protector.unwrap(Buffer.from(upgraded.key, "base64")).equals(rawKey)).toBe(true);
    expect((await stat(join(dir, KEY_FILE))).mode & 0o777).toBe(0o600);

    // The entries were not touched, so they open with the same key after another restart.
    restart(fakeProtector());
    expect((await readSecrets(dir, normal)).values).toEqual({ "ai.apiKey": SECRET });
  });

  it("reads a run-hound store without upgrading its key file with { upgrade: false }, while the default read upgrades it", async () => {
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    const before = await readFile(join(dir, KEY_FILE));
    const entriesBefore = await readFile(join(dir, SECRETS_FILE));

    restart(fakeProtector());
    expect(await readSecrets(dir, { ...normal, upgrade: false })).toEqual({ values: { "ai.apiKey": SECRET }, protection: "os-keychain", problem: null });
    expect(await readFile(join(dir, KEY_FILE))).toEqual(before);
    expect((await keyFile()).protection).toBe("run-hound");

    // The default read (a new process, so no cached key) wraps the key; the entries are untouched either way.
    restart(fakeProtector());
    expect((await readSecrets(dir, normal)).values).toEqual({ "ai.apiKey": SECRET });
    expect((await keyFile()).protection).toBe("os-keychain");
    expect(await readFile(join(dir, SECRETS_FILE))).toEqual(entriesBefore);
  });

  it("upgrades a run-hound key file on the first save too", async () => {
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    restart(fakeProtector());
    await writeSecrets(dir, { b: "value-for-b-456" }, normal);
    expect((await keyFile()).protection).toBe("os-keychain");
    restart(fakeProtector());
    expect((await readSecrets(dir, normal)).values).toEqual({ a: "value-for-a-123", b: "value-for-b-456" });
  });

  it("is LOCKED_BY_OS_KEYCHAIN when read without a protector, and a save is refused leaving both files byte-identical", async () => {
    useOsKeyProtector(fakeProtector());
    await writeSecrets(dir, { "ai.apiKey": SECRET }, normal);
    const before = [await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))];

    restart(null);
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: LOCKED_BY_OS_KEYCHAIN });
    await expect(writeSecrets(dir, { other: "value-for-other-1" }, normal)).rejects.toThrow(LOCKED_BY_OS_KEYCHAIN);
    await expect(writeSecrets(dir, { "ai.apiKey": null }, normal)).rejects.toThrow(LOCKED_BY_OS_KEYCHAIN);

    expect([await readFile(join(dir, SECRETS_FILE)), await readFile(join(dir, KEY_FILE))]).toEqual(before);
    expect((await readdir(dir)).sort()).toEqual(FILES);

    // The desktop app still opens everything.
    restart(fakeProtector());
    expect((await readSecrets(dir, normal)).values).toEqual({ "ai.apiKey": SECRET });
  });

  it("is UNREADABLE_KEY when the protector refuses to unwrap, and the next save starts a fresh store", async () => {
    useOsKeyProtector(fakeProtector());
    await writeSecrets(dir, { old: "value-saved-before" }, normal);

    restart(lockedProtector());
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "os-keychain", problem: UNREADABLE_KEY });

    await writeSecrets(dir, { fresh: "value-saved-after" }, normal);
    expect((await keyFile()).protection).toBe("os-keychain");
    // The new key was wrapped by the (changed) keychain; the old entry is gone.
    expect(Object.keys(await entries())).toEqual(["fresh"]);
    restart(lockedProtector());
    // This keychain can wrap but not unwrap, so even the new key can't be reopened after a restart.
    expect((await readSecrets(dir, normal)).problem).toBe(UNREADABLE_KEY);
  });

  it("opens the fresh store after a keychain change when the new keychain can unwrap what it wrapped", async () => {
    useOsKeyProtector(fakeProtector());
    await writeSecrets(dir, { old: "value-saved-before" }, normal);
    // A different keychain: same wrapping format, but it refuses the old key.
    const changed: KeyProtector = {
      wrap: (key) => Buffer.concat([Buffer.from("OTHER:"), key]),
      unwrap: (wrapped) => {
        if (!wrapped.subarray(0, 6).equals(Buffer.from("OTHER:"))) throw new Error("not mine");
        return Buffer.from(wrapped.subarray(6));
      },
    };
    restart(changed);
    expect((await readSecrets(dir, normal)).problem).toBe(UNREADABLE_KEY);
    await writeSecrets(dir, { fresh: "value-saved-after" }, normal);
    restart(changed);
    expect(await readSecrets(dir, normal)).toEqual({ values: { fresh: "value-saved-after" }, protection: "os-keychain", problem: null });
  });

  it("is UNREADABLE_KEY when the protector unwraps to a key of the wrong length", async () => {
    useOsKeyProtector(fakeProtector());
    await writeSecrets(dir, { a: "value-for-a-123" }, normal);
    restart({ wrap: fakeProtector().wrap, unwrap: () => Buffer.alloc(8) });
    expect((await readSecrets(dir, normal)).problem).toBe(UNREADABLE_KEY);
  });

  it("lets every one of several saves at once land", async () => {
    useOsKeyProtector(fakeProtector());
    await Promise.all(Array.from({ length: 8 }, (_, i) => writeSecrets(dir, { [`n${i}`]: `value-number-${i}` }, normal)));
    restart(fakeProtector());
    expect((await readSecrets(dir, normal)).values).toEqual(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`n${i}`, `value-number-${i}`])));
  });
});
