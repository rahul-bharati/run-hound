import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORRUPT_BACKUP_PREFIX,
  KEY_FILE,
  LOCKED_BY_OS_KEYCHAIN,
  readSecrets,
  SECRETS_FILE,
  STORE_DAMAGED,
  STORE_UNREADABLE,
  useOsKeyProtector,
  writeSecrets,
  type KeyProtector,
} from "../../../src/operations/secret-store.js";

/**
 * A secrets.json that can't be read must never be taken for "no secrets": the next save would merge into nothing and
 * overwrite the file, erasing every saved AI key and test-account password. Only a missing file (ENOENT) is empty. A
 * read that fails any other way (EBUSY, EACCES, EPERM: antivirus or a sync tool holding the file on Windows) is an
 * error that changes nothing; a file that reads but is not a secret store is damaged, and is moved aside to a backup
 * before the next save instead of being overwritten.
 */

/** The next read of a file ending in `file` fails with this errno code, until it is cleared. */
const failing = vi.hoisted(() => ({ file: "", code: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (async (...args: Parameters<typeof actual.readFile>) => {
    if (failing.code && String(args[0]).endsWith(failing.file)) {
      throw Object.assign(new Error(`${failing.code}: simulated read failure, open '${String(args[0])}'`), { code: failing.code, syscall: "open" });
    }
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile };
});

/** Runs `work` while every read of `file` fails with `code`; reads work again afterwards, even when `work` throws. */
async function whileFailing<T>(file: string, code: string, work: () => Promise<T>): Promise<T> {
  failing.file = file;
  failing.code = code;
  try {
    return await work();
  } finally {
    failing.file = "";
    failing.code = "";
  }
}

const normal = { env: {} as NodeJS.ProcessEnv };
let tmp: string;
let dir: string;

beforeEach(async () => {
  useOsKeyProtector(null);
  tmp = await mkdtemp(join(tmpdir(), "runhound-secrets-errors-"));
  dir = join(tmp, "config");
});

afterEach(async () => {
  failing.file = "";
  failing.code = "";
  useOsKeyProtector(null);
  await rm(tmp, { recursive: true, force: true });
});

const SAVED = { "ai.key.openai": "sk-live-FIRST-secret-1111", "accounts.a.password": "päss wörd ✓ 2222" };
const bytes = (name: string): Promise<string> => readFile(join(dir, name), "utf8");
const backups = async (): Promise<string[]> => (await readdir(dir)).filter((name) => name.startsWith(CORRUPT_BACKUP_PREFIX)).sort();

describe.each(["EBUSY", "EACCES", "EPERM"])("a secrets.json that fails to read with %s", (code) => {
  it("is not read as holding nothing: readSecrets says STORE_UNREADABLE and invents no secrets", async () => {
    await writeSecrets(dir, SAVED, normal);
    const read = await whileFailing(SECRETS_FILE, code, () => readSecrets(dir, normal));
    expect(read).toEqual({ values: {}, protection: "run-hound", problem: STORE_UNREADABLE });
  });

  it("is reported by a status-only (sealed) read too, without asking the keychain", async () => {
    await writeSecrets(dir, SAVED, normal);
    const read = await whileFailing(SECRETS_FILE, code, () => readSecrets(dir, { ...normal, open: false }));
    expect(read).toEqual({ values: {}, protection: "run-hound", problem: STORE_UNREADABLE });
  });

  it("makes a save fail and leaves secrets.json and secrets.key byte-identical", async () => {
    await writeSecrets(dir, SAVED, normal);
    const [secretsBefore, keyBefore] = [await bytes(SECRETS_FILE), await bytes(KEY_FILE)];
    await expect(whileFailing(SECRETS_FILE, code, () => writeSecrets(dir, { "ai.key.gemini": "AIza-second-secret-3333" }, normal))).rejects.toThrow(STORE_UNREADABLE);
    expect(await bytes(SECRETS_FILE)).toBe(secretsBefore);
    expect(await bytes(KEY_FILE)).toBe(keyBefore);
    expect(await backups()).toEqual([]);
  });

  it("keeps every saved secret: once the file reads again, a save adds to them", async () => {
    await writeSecrets(dir, SAVED, normal);
    await expect(whileFailing(SECRETS_FILE, code, () => writeSecrets(dir, { "ai.key.gemini": "AIza-second-secret-3333" }, normal))).rejects.toThrow();
    await writeSecrets(dir, { "ai.key.gemini": "AIza-second-secret-3333" }, normal);
    expect(await readSecrets(dir, normal)).toEqual({
      values: { ...SAVED, "ai.key.gemini": "AIza-second-secret-3333" },
      protection: "run-hound",
      problem: null,
    });
  });

  it("makes a removal fail too, as it rewrites the whole file", async () => {
    await writeSecrets(dir, SAVED, normal);
    await expect(whileFailing(SECRETS_FILE, code, () => writeSecrets(dir, { "ai.key.openai": null }, normal))).rejects.toThrow(STORE_UNREADABLE);
    expect((await readSecrets(dir, normal)).values).toEqual(SAVED);
  });

  it("keeps the original error as the cause", async () => {
    await writeSecrets(dir, SAVED, normal);
    const error = await whileFailing(SECRETS_FILE, code, () => writeSecrets(dir, { x: "value-1234" }, normal)).catch((e: unknown) => e);
    expect((error as Error).cause).toMatchObject({ code });
  });
});

describe("a secrets.json that can't be read for another reason", () => {
  it("is not empty when it is a folder (EISDIR): a save fails and the folder is left alone", async () => {
    await mkdir(join(dir, SECRETS_FILE), { recursive: true });
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: STORE_UNREADABLE });
    await expect(writeSecrets(dir, { x: "value-1234" }, normal)).rejects.toThrow(STORE_UNREADABLE);
    expect((await readdir(dir)).sort()).toEqual([SECRETS_FILE]);
  });

  it("is still empty, without a problem, when it does not exist (ENOENT)", async () => {
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: null });
    await writeSecrets(dir, { x: "value-1234" }, normal);
    expect((await readSecrets(dir, normal)).values).toEqual({ x: "value-1234" });
    expect(await backups()).toEqual([]);
  });
});

describe("a secrets.key that fails to read", () => {
  it("is not taken for a missing key: a save fails and the saved entries are not discarded", async () => {
    await writeSecrets(dir, SAVED, normal);
    const [secretsBefore, keyBefore] = [await bytes(SECRETS_FILE), await bytes(KEY_FILE)];
    await expect(whileFailing(KEY_FILE, "EBUSY", () => writeSecrets(dir, { x: "value-1234" }, normal))).rejects.toThrow();
    expect(await bytes(SECRETS_FILE)).toBe(secretsBefore);
    expect(await bytes(KEY_FILE)).toBe(keyBefore);
    expect((await readSecrets(dir, normal)).values).toEqual(SAVED);
  });
});

describe("a damaged secrets.json (reads, but is not a secret store)", () => {
  const DAMAGED: Array<[string, string]> = [
    ["not JSON", "{not json"],
    ["empty", ""],
    ["cut short", '{"version":1,"entries":{"ai.key.openai":"AAAA'],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["a JSON string", '"secrets"'],
    ["without entries", '{"version":1}'],
    ["with entries that are a list", '{"version":1,"entries":[]}'],
    ["with entries that are text", '{"version":1,"entries":"x"}'],
  ];

  it.each(DAMAGED)("%s: readSecrets says STORE_DAMAGED and leaves the file alone", async (_name, text) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), text);
    expect(await readSecrets(dir, normal)).toEqual({ values: {}, protection: "run-hound", problem: STORE_DAMAGED });
    expect(await readSecrets(dir, { ...normal, open: false })).toEqual({ values: {}, protection: "run-hound", problem: STORE_DAMAGED });
    expect(await bytes(SECRETS_FILE)).toBe(text);
    expect(await backups()).toEqual([]);
  });

  it.each(DAMAGED)("%s: the next save moves it aside byte-for-byte instead of overwriting it, then starts a clean store", async (_name, text) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), text);
    await writeSecrets(dir, { "ai.key.openai": "sk-live-NEW-secret-4444" }, normal);
    const [backup] = await backups();
    expect(backup).toBeDefined();
    expect(await bytes(backup!)).toBe(text);
    expect(await readSecrets(dir, normal)).toEqual({ values: { "ai.key.openai": "sk-live-NEW-secret-4444" }, protection: "run-hound", problem: null });
    expect(await backups()).toHaveLength(1);
  });

  it("keeps the backup of an earlier damaged file when the file is damaged again", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "first damage");
    await writeSecrets(dir, { one: "value-one-1111" }, normal);
    await writeFile(join(dir, SECRETS_FILE), "second damage");
    await writeSecrets(dir, { two: "value-two-2222" }, normal);
    const names = await backups();
    expect(names).toHaveLength(2);
    expect(await Promise.all(names.map(bytes))).toEqual(expect.arrayContaining(["first damage", "second damage"]));
  });

  it("is moved aside by a removal too, so a damaged file is never deleted unseen", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "{not json");
    await writeSecrets(dir, { "ai.key.openai": null }, normal);
    const [backup] = await backups();
    expect(backup).toBeDefined();
    expect(await bytes(backup!)).toBe("{not json");
  });

  it("is moved aside even when secrets.key is missing too (a new key is made for the clean store)", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "{not json");
    await writeSecrets(dir, { x: "value-1234" }, normal);
    expect(await bytes((await backups())[0]!)).toBe("{not json");
    expect((await readSecrets(dir, normal)).values).toEqual({ x: "value-1234" });
  });

  it("keeps a backup that is itself not mistaken for the store", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SECRETS_FILE), "{not json");
    await writeSecrets(dir, { x: "value-1234" }, normal);
    expect(await readSecrets(dir, normal)).toEqual({ values: { x: "value-1234" }, protection: "run-hound", problem: null });
    expect((await readdir(dir)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("is left in place when the save is refused because the OS keychain locks the key", async () => {
    const protector: KeyProtector = { wrap: (key) => Buffer.from(key.map((b) => b ^ 0x5a)), unwrap: (wrapped) => Buffer.from(wrapped.map((b) => b ^ 0x5a)) };
    useOsKeyProtector(protector);
    await writeSecrets(dir, SAVED, normal);
    await writeFile(join(dir, SECRETS_FILE), "{not json");
    useOsKeyProtector(null); // the command line, which can't open a key the desktop app's keychain wrapped
    const keyBefore = await bytes(KEY_FILE);
    await expect(writeSecrets(dir, { x: "value-1234" }, normal)).rejects.toThrow(LOCKED_BY_OS_KEYCHAIN);
    expect(await bytes(SECRETS_FILE)).toBe("{not json");
    expect(await bytes(KEY_FILE)).toBe(keyBefore);
    expect(await backups()).toEqual([]);
  });

  it("drops an entry that is not text but keeps the others (it could never have opened)", async () => {
    await writeSecrets(dir, SAVED, normal);
    const store = JSON.parse(await bytes(SECRETS_FILE)) as { version: number; entries: Record<string, unknown> };
    store.entries["accounts.b.password"] = 42;
    await writeFile(join(dir, SECRETS_FILE), JSON.stringify(store));
    expect((await readSecrets(dir, normal)).values).toEqual(SAVED);
    expect(await backups()).toEqual([]);
  });
});
