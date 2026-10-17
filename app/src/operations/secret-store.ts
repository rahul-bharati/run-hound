/**
 * The encrypted store for saved secrets: AI provider keys and test-account passwords. This module is the only place
 * that opens `secrets.json` and `secrets.key`.
 *
 * Each secret is sealed with AES-256-GCM under one random 32-byte data key, with its name as additional authenticated
 * data, so an entry that is edited, moved to another name or swapped in from another store fails to open. Entries live
 * in <configDir>/secrets.json; the data key lives apart from them in <configDir>/secrets.key:
 *
 * - "os-keychain": the desktop app handed over the OS credential store (useOsKeyProtector, Electron safeStorage) and
 *   the data key is saved wrapped by it.
 * - "run-hound": no OS store here (the command line, or Linux without a keyring), so the data key is saved as is,
 *   private to the user (0600). A desktop app that later gets an OS store wraps an existing key on first use.
 * - "environment": RUNHOUND_SECRETS=environment (set by the Docker image). Nothing is saved; secrets come from
 *   environment variables only.
 *
 * Limits: both saving protections keep secrets out of plain text and make secrets.json useless on its own (copied,
 * synced, backed up or shown on screen). Neither stops a program already running as the same user on the same machine.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SecretProtection } from "../types/secrets.js";

export type { SecretProtection };

/**
 * Wraps and unwraps the data key with the OS credential store. Both throw when the store refuses, and
 * KeyStoreUnavailableError when it can't be used at all. A protector touches the store only inside these calls, so
 * handing one over (useOsKeyProtector) asks the OS for nothing.
 */
export interface KeyProtector {
  wrap(key: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
}

export interface SecretsRead {
  /** The secrets that opened, by name. */
  values: Record<string, string>;
  protection: SecretProtection;
  /** Why some or all saved secrets could not be read; null when everything saved opened. */
  problem: string | null;
}

type SavingProtection = Exclude<SecretProtection, "environment">;

export const SECRETS_FILE = "secrets.json";
export const KEY_FILE = "secrets.key";

export const ENVIRONMENT_ONLY = "Secrets aren't saved here (RUNHOUND_SECRETS=environment, as in the Docker image)";
export const LOCKED_BY_OS_KEYCHAIN =
  "Saved keys and passwords are locked with the OS keychain by the Run Hound desktop app, which isn't available here. Open the desktop app, or set them with environment variables.";
export const UNREADABLE_KEY =
  "Saved keys and passwords can't be unlocked on this machine (the OS keychain changed, or secrets.key is damaged). Enter them again.";
export const DAMAGED_ENTRIES = "Some saved keys or passwords were damaged and could not be read. Enter them again.";
export const KEYCHAIN_REFUSED =
  "Run Hound couldn't use your system keychain, so saved keys and passwords can't be opened right now. Allow Run Hound to use the keychain when your system asks, then quit Run Hound and open it again.";
/** secrets.json exists but could not be read (in use by another program, or no access): the read is an error, not an empty store. */
export const STORE_UNREADABLE =
  "Saved keys and passwords can't be read right now: secrets.json is in use by another program or Run Hound has no access to it. Nothing was changed. Try again in a moment.";
/** secrets.json was read but is not a secret store: saving moves it aside to a backup instead of overwriting it. */
export const STORE_DAMAGED =
  "The file that holds your saved keys and passwords (secrets.json) is damaged, so none of them can be read. Enter them again: the damaged file is kept next to it as a backup, not overwritten.";
/** The name a damaged secrets.json is moved to starts with this (then a timestamp and a random suffix). */
export const CORRUPT_BACKUP_PREFIX = `${SECRETS_FILE}.corrupt-`;

/**
 * What a sealed read (readSecrets with `open: false`) gives for every saved secret instead of its value: enough to
 * say a key or password is saved, never usable as one. The model client and sign-in refuse it (isSealed).
 */
export const SEALED_SECRET = "\u0000run-hound:sealed\u0000";

/** Whether `value` is SEALED_SECRET: a saved secret whose value was not opened. */
export const isSealed = (value: unknown): boolean => value === SEALED_SECRET;

/**
 * Thrown by a KeyProtector when the OS credential store can't be used at all (no keychain, the keyring stays locked).
 * The store then falls back to its own key for a new store, and treats a key that store wrapped as locked: it is
 * never replaced, so saying no to a keychain prompt can't wipe what was saved.
 */
export class KeyStoreUnavailableError extends Error {
  constructor(message = "The OS credential store is not available.") {
    super(message);
    this.name = "KeyStoreUnavailableError";
  }
}

/**
 * Whether `error` says the OS store can't be used. Matched by name, not class: the desktop app's protector lives in
 * another bundle (desktop/src/key-protector.ts in main.js, this module in engine.js), so its class is a different one.
 */
const storeUnavailable = (error: unknown): boolean => error instanceof Error && error.name === "KeyStoreUnavailableError";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let osProtector: KeyProtector | null = null;

/** The desktop app hands over the OS credential store (or null when it has none worth using). */
export function useOsKeyProtector(protector: KeyProtector | null): void {
  osProtector = protector;
  unwrapped.clear();
}

/** How secrets are kept in this process: environment only, the OS keychain, or Run Hound's own store. */
export function secretProtection(env: NodeJS.ProcessEnv = process.env): SecretProtection {
  if (env.RUNHOUND_SECRETS === "environment") return "environment";
  return osProtector ? "os-keychain" : "run-hound";
}

/** The data key, unwrapped, by key-file path; reused while the key file's text is unchanged. */
const unwrapped = new Map<string, { text: string; key: Buffer }>();

type KeyResult = { key: Buffer } | { problem: string; locked: boolean } | null;

interface KeyFile {
  version: 1;
  protection: SavingProtection;
  key: string;
}

function parseKeyFile(text: string): KeyFile | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw.version !== 1 || typeof raw.key !== "string") return null;
    if (raw.protection !== "os-keychain" && raw.protection !== "run-hound") return null;
    return { version: 1, protection: raw.protection, key: raw.key };
  } catch {
    return null;
  }
}

function keyFileText(protection: SavingProtection, key: Buffer): string {
  const stored = protection === "os-keychain" ? osProtector!.wrap(key) : key;
  return `${JSON.stringify({ version: 1, protection, key: stored.toString("base64") }, null, 2)}\n`;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The data key for `dir`, or null when none is saved. A Run Hound key is wrapped with the OS store once one is
 * available. A key the OS store wrapped can't be opened without it: `locked` (the desktop app's store, seen from the
 * command line) is never overwritten; a key that fails to open where it was made (a changed keychain, a damaged file)
 * is replaced on the next save, as what it sealed is lost anyway. `upgrade: false` reads another program's store (the
 * command line's, imported by the desktop app) without wrapping its key, which would lock that program out.
 */
async function loadKey(dir: string, protection: SavingProtection, upgrade = true): Promise<KeyResult> {
  const file = join(dir, KEY_FILE);
  const text = await readText(file);
  if (text === null) return null;
  const cached = unwrapped.get(file);
  if (cached && cached.text === text) return { key: cached.key };
  const parsed = parseKeyFile(text);
  if (!parsed) return { problem: UNREADABLE_KEY, locked: false };
  if (parsed.protection === "os-keychain" && protection !== "os-keychain") return { problem: LOCKED_BY_OS_KEYCHAIN, locked: true };
  let key: Buffer;
  try {
    const stored = Buffer.from(parsed.key, "base64");
    key = parsed.protection === "os-keychain" ? osProtector!.unwrap(stored) : stored;
  } catch (error) {
    if (storeUnavailable(error)) return { problem: KEYCHAIN_REFUSED, locked: true };
    return { problem: UNREADABLE_KEY, locked: false };
  }
  if (key.length !== KEY_BYTES) return { problem: UNREADABLE_KEY, locked: false };
  let upgraded: string | null = null;
  if (upgrade && parsed.protection === "run-hound" && protection === "os-keychain") {
    try {
      upgraded = keyFileText("os-keychain", key);
    } catch (error) {
      if (!storeUnavailable(error)) throw error;
      osProtector = null;
    }
  }
  if (upgraded !== null) {
    await writePrivate(file, upgraded);
    unwrapped.set(file, { text: upgraded, key });
  } else {
    unwrapped.set(file, { text, key });
  }
  return { key };
}

/** A new data key, saved only if no other process saved one first (link fails on an existing file); then that one wins. */
async function createKey(dir: string, protection: SavingProtection): Promise<Buffer> {
  const file = join(dir, KEY_FILE);
  const key = randomBytes(KEY_BYTES);
  const text = keyFileText(protection, key);
  const temp = await writeTemp(dir, KEY_FILE, text);
  try {
    await link(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await loadKey(dir, protection);
    if (existing && "key" in existing) return existing.key;
    throw new Error(existing ? existing.problem : UNREADABLE_KEY);
  } finally {
    await rm(temp, { force: true });
  }
  unwrapped.set(file, { text, key });
  return key;
}

const aad = (name: string): Buffer => Buffer.from(`run-hound secret v1:${name}`, "utf8");

function seal(key: Buffer, name: string, value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(name));
  const sealed = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64");
}

/** The value, or null when the entry doesn't open under this key and name. */
function unseal(key: Buffer, name: string, entry: unknown): string | null {
  if (typeof entry !== "string") return null;
  const bytes = Buffer.from(entry, "base64");
  if (bytes.length < IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(aad(name));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The sealed entries by name, and whether secrets.json is `damaged` (it reads, but is not a JSON object holding an
 * `entries` object). Only a file that doesn't exist (ENOENT) holds nothing and is not damaged. A file that exists but
 * can't be read (EBUSY, EACCES, EPERM: antivirus or a sync tool holding it on Windows) throws STORE_UNREADABLE with the
 * error as its cause: it must never be taken for an empty store, as a save would merge into nothing and overwrite the
 * secrets it could not see. An entry that is not text could never have opened, and is left out.
 */
async function readEntries(dir: string): Promise<{ entries: Record<string, string>; damaged: boolean }> {
  let text: string | null;
  try {
    text = await readText(join(dir, SECRETS_FILE));
  } catch (error) {
    throw new Error(STORE_UNREADABLE, { cause: error });
  }
  if (text === null) return { entries: {}, damaged: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: {}, damaged: true };
  }
  if (!isObject(raw) || !isObject(raw.entries)) return { entries: {}, damaged: true };
  const entries = Object.fromEntries(Object.entries(raw.entries).filter((e): e is [string, string] => typeof e[1] === "string"));
  return { entries, damaged: false };
}

/**
 * Moves a damaged secrets.json aside to secrets.json.corrupt-<time>-<random> in the same folder (same 0600 mode),
 * never overwriting an earlier backup, so a save can start a clean store without destroying what was there: whatever
 * is readable in it can still be recovered by hand. Fails (and the save with it) if the file can't be moved.
 */
async function setAsideDamaged(dir: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(dir, `${CORRUPT_BACKUP_PREFIX}${stamp}-${randomBytes(3).toString("hex")}`);
  try {
    await rename(join(dir, SECRETS_FILE), backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // already gone: nothing to keep
  }
}

/**
 * Every saved secret in `dir` that opens. Never throws for a missing, locked, unreadable or damaged store: `problem`
 * says what could not be read (STORE_UNREADABLE when secrets.json exists but can't be read just now, STORE_DAMAGED when
 * it isn't a secret store). Nothing is changed on disk. With RUNHOUND_SECRETS=environment nothing is read.
 *
 * `open: false` is a sealed read, for status only: every saved secret's value is SEALED_SECRET and the data key is
 * not loaded, so the OS keychain is never asked (opening the app or a settings page must not make the OS prompt).
 * It can't tell a damaged or locked store; the read that uses the secrets says so.
 */
export async function readSecrets(dir: string, options: { env?: NodeJS.ProcessEnv; upgrade?: boolean; open?: boolean } = {}): Promise<SecretsRead> {
  const protection = secretProtection(options.env);
  if (protection === "environment") return { values: {}, protection, problem: null };
  let read: Awaited<ReturnType<typeof readEntries>>;
  try {
    read = await readEntries(dir);
  } catch {
    return { values: {}, protection, problem: STORE_UNREADABLE };
  }
  if (read.damaged) return { values: {}, protection, problem: STORE_DAMAGED };
  const { entries } = read;
  const names = Object.keys(entries);
  if (names.length === 0) return { values: {}, protection, problem: null };
  if (options.open === false) return { values: Object.fromEntries(names.map((name) => [name, SEALED_SECRET])), protection, problem: null };
  let loaded: KeyResult;
  try {
    loaded = await loadKey(dir, protection, options.upgrade ?? true);
  } catch {
    loaded = { problem: UNREADABLE_KEY, locked: false };
  }
  if (loaded === null) return { values: {}, protection, problem: UNREADABLE_KEY };
  if (!("key" in loaded)) return { values: {}, protection, problem: loaded.problem };
  const values: Record<string, string> = {};
  let damaged = false;
  for (const name of names) {
    const value = unseal(loaded.key, name, entries[name]);
    if (value === null) damaged = true;
    else values[name] = value;
  }
  return { values, protection, problem: damaged ? DAMAGED_ENTRIES : null };
}

/**
 * Saves (a string) or removes (null or "") each named secret, creating the store on the first save. Throws with
 * RUNHOUND_SECRETS=environment, and when the store is locked by the desktop app's OS keychain. A store whose key no
 * longer opens here starts again empty. Saves of one store run one at a time in this process.
 *
 * A save rewrites the whole file, so it first needs to see what is saved: when secrets.json (or secrets.key) exists but
 * can't be read, the save fails (STORE_UNREADABLE) and changes nothing, rather than treat the store as empty and
 * erase every other secret. A secrets.json that reads but is damaged is moved aside to secrets.json.corrupt-* first
 * (setAsideDamaged), then a clean store is written; its secrets were unreadable already, and the backup keeps the file.
 */
export function writeSecrets(
  dir: string,
  updates: Record<string, string | null>,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const protection = secretProtection(options.env);
  if (protection === "environment") return Promise.reject(new Error(ENVIRONMENT_ONLY));
  return oneAtATime(dir, async () => {
    const saving = Object.values(updates).some((v) => typeof v === "string" && v !== "");
    const read = await readEntries(dir); // throws when the file can't be read: nothing below runs
    let entries = read.entries;
    let loaded = await loadKey(dir, protection);
    if (loaded !== null && !("key" in loaded) && loaded.locked) throw new Error(loaded.problem);
    // The save goes ahead from here: a damaged file is kept as a backup before anything replaces or removes it.
    if (read.damaged) await setAsideDamaged(dir);
    let reset = false;
    if (loaded !== null && !("key" in loaded)) {
      await rm(join(dir, KEY_FILE), { force: true });
      unwrapped.delete(join(dir, KEY_FILE));
      entries = {};
      loaded = null;
      reset = true;
    }
    if (loaded === null) {
      // No key: entries left from a store whose key is gone can never open again, so they go.
      const orphaned = Object.keys(entries).length > 0;
      entries = {};
      if (!saving) {
        if (reset || orphaned) await rm(join(dir, SECRETS_FILE), { force: true });
        return;
      }
      try {
        loaded = { key: await createKey(dir, protection) };
      } catch (error) {
        if (!storeUnavailable(error)) throw error;
        // No usable keychain after all: keep the secret in Run Hound's own store, as when there is none.
        osProtector = null;
        loaded = { key: await createKey(dir, "run-hound") };
      }
    }
    for (const [name, value] of Object.entries(updates)) {
      if (typeof value === "string" && value !== "") entries[name] = seal(loaded.key, name, value);
      else delete entries[name];
    }
    await writePrivate(join(dir, SECRETS_FILE), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  });
}

const queues = new Map<string, Promise<void>>();
function oneAtATime<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(dir) ?? Promise.resolve()).then(work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(dir, settled);
  void settled.then(() => {
    if (queues.get(dir) === settled) queues.delete(dir);
  });
  return next;
}

/** A private (0600) temp file next to `name` in `dir` (0700, created if missing), holding `text`. */
async function writeTemp(dir: string, name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode only applies to a folder it creates: tighten one that was already there with looser permissions.
  await chmod(dir, 0o700).catch(() => undefined);
  const temp = join(dir, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return temp;
}

/** Writes the file atomically and private from the start: a 0600 temp file renamed over the target. */
async function writePrivate(file: string, text: string): Promise<void> {
  const temp = await writeTemp(dirname(file), basename(file), text);
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
