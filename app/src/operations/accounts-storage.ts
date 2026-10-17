/**
 * Persistence for the saved test accounts: reading, patching, clearing. The declarations (defaults, field list, env
 * variable names, password rules) live in `config/accounts.ts` and `constants/accounts-constants.ts`; this module is
 * the only place that opens the file and applies a patch.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_LABELS, FIELDS, MAX_LABEL_LENGTH, accountEnvName, accountsFile } from "../config/accounts.js";
import { COMMON_PASSWORD_PROBLEM, passwordsFromEnvironment, plainTextPasswordNotice } from "../constants/accounts-constants.js";
import { isCommonPassword } from "../utils/validation/common-password.js";
import {
  ACCOUNT_IDS,
  type AccountField,
  type AccountId,
} from "../types/accounts.js";
import {
  type AccountStatus,
  type AccountsConfig,
  type AccountsPatch,
  type AccountsResolution,
  type AccountsStatus,
  type ReadResult,
  type SavedFile,
  type SavedSlot,
  type TestAccount,
} from "../interfaces/accounts.js";
import { readSecrets, secretProtection, writeSecrets } from "./secret-store.js";

/** A slot's password is saved in the encrypted store (secret-store.ts) under this name, never in the file. */
const passwordName = (id: AccountId): string => `accounts.${id}.password`;

/** A read file, with each slot's password filled in from the store (or a legacy plain-text one still in the file). */
interface Read extends ReadResult {
  /** The passwords the store holds, by slot. */
  stored: Partial<Record<AccountId, string>>;
  /** True when the file itself still holds a password in plain text. */
  plain: boolean;
}

/** The origin of an http(s) URL, or null (empty, unparsable or another scheme). */
function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

function slotFromFile(raw: unknown): SavedSlot | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  const r = raw as Record<string, unknown>;
  const out: SavedSlot = {};
  if (nonEmpty(r.label)) out.label = r.label.trim();
  if (nonEmpty(r.loginUrl)) out.loginUrl = r.loginUrl.trim();
  if (nonEmpty(r.username)) out.username = r.username.trim();
  if (typeof r.password === "string" && r.password !== "")
    out.password = r.password;
  if (nonEmpty(r.passwordOrigin)) out.passwordOrigin = r.passwordOrigin.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Keeps only well-typed values of a parsed file; null when the file isn't an object at all. */
function fromFile(raw: unknown): SavedFile | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const r = raw as Record<string, unknown>;
  const out: SavedFile = { accounts: {} };
  if (typeof r.isolated === "boolean") out.isolated = r.isolated;
  const accounts = r.accounts;
  if (
    typeof accounts === "object" &&
    accounts !== null &&
    !Array.isArray(accounts)
  ) {
    for (const id of ACCOUNT_IDS) {
      const slot = slotFromFile((accounts as Record<string, unknown>)[id]);
      if (slot) out.accounts[id] = slot;
    }
  }
  return out;
}

/** `open: false` reads the store sealed (status only): saved passwords are SEALED_SECRET and the OS keychain isn't asked. */
async function readSaved(file: string, env: NodeJS.ProcessEnv, open = true): Promise<Read> {
  const nothing = (problem: string | null): Read => ({
    saved: { accounts: {} },
    problem,
    stored: {},
    plain: false,
  });
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return nothing(null);
    return nothing(
      `${file} could not be read (${code ?? "error"}), so nothing saved in it was used.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return nothing(
      `${file} is not valid JSON, so nothing saved in it was used. Save the account again to replace it.`,
    );
  }
  const saved = fromFile(parsed);
  if (!saved)
    return nothing(
      `${file} does not hold saved accounts, so nothing in it was used. Save the account again to replace it.`,
    );
  const plain = ACCOUNT_IDS.some((id) => Boolean(saved.accounts[id]?.password));
  const store = await readSecrets(dirname(file), { env, open });
  const stored: Read["stored"] = {};
  for (const id of ACCOUNT_IDS) {
    const value = store.values[passwordName(id)];
    const slot = saved.accounts[id];
    if (value === undefined || !slot) continue; // a password whose slot is gone is not used
    stored[id] = value;
    if (!slot.password) slot.password = value;
  }
  const problem = plain && store.protection === "environment" ? plainTextPasswordNotice(file) : store.problem;
  return { saved, problem, stored, plain };
}

/**
 * Moves passwords still saved in plain text in the file (written before the encrypted store) into the store, then
 * rewrites the file without them. A store that can't be written (environment only, or locked by the desktop app's OS
 * keychain) leaves the file as it is. Runs in the file's queue.
 */
async function movePasswordsOut(file: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (secretProtection(env) === "environment") return;
  let saved: SavedFile | null;
  try {
    saved = fromFile(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return;
  }
  if (!saved) return;
  const updates: Record<string, string> = {};
  for (const id of ACCOUNT_IDS) {
    const password = saved.accounts[id]?.password;
    if (password) updates[passwordName(id)] = password;
  }
  if (Object.keys(updates).length === 0) return;
  try {
    await writeSecrets(dirname(file), updates, { env });
  } catch {
    return;
  }
  await writePrivate(file, serialise(saved, false));
}

/**
 * Writes `next`: its passwords to the encrypted store (only those that changed from `read`), the rest to the file. In
 * the Docker image nothing new is saved: a password that would be saved is refused, and a legacy plain-text one stays
 * in the file until it is removed.
 */
async function writeSaved(file: string, next: SavedFile, read: Read, env: NodeJS.ProcessEnv): Promise<void> {
  if (secretProtection(env) === "environment") {
    for (const id of ACCOUNT_IDS) {
      const password = next.accounts[id]?.password;
      if (password && password !== read.saved.accounts[id]?.password)
        throw new Error(passwordsFromEnvironment(accountEnvName(id, "password")));
    }
    await writePrivate(file, serialise(next, true));
    return;
  }
  const updates: Record<string, string | null> = {};
  for (const id of ACCOUNT_IDS) {
    const password = next.accounts[id]?.password || null;
    if (password !== (read.stored[id] ?? null)) updates[passwordName(id)] = password;
  }
  if (Object.keys(updates).length > 0) await writeSecrets(dirname(file), updates, { env });
  await writePrivate(file, serialise(next, false));
}

/** A non-empty env value (trimmed, except passwords), or undefined. */
function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
  trim: boolean,
): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") return undefined;
  return trim ? value.trim() : value;
}

function envBool(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return undefined;
}

/** Where a saved password may be sent: the origin it was saved for, else (a hand-written file) its own loginUrl's. */
function boundOrigin(slot: SavedSlot | undefined): string | null {
  return slot?.passwordOrigin ?? httpOrigin(slot?.loginUrl);
}

function resolveWith(
  env: NodeJS.ProcessEnv,
  file: string,
  read: ReadResult,
): AccountsResolution {
  const accounts = {} as Record<AccountId, TestAccount>;
  const statuses = {} as Record<AccountId, AccountStatus>;
  for (const id of ACCOUNT_IDS) {
    const saved = read.saved.accounts[id];
    const sources: AccountStatus["sources"] = {
      label: "default",
      loginUrl: "default",
      username: "default",
      password: "default",
    };
    const pick = (field: AccountField): string | undefined => {
      const fromEnv = envValue(
        env,
        accountEnvName(id, field),
        field !== "password",
      );
      if (fromEnv !== undefined) {
        sources[field] = "env";
        return fromEnv;
      }
      const fromSaved = saved?.[field];
      if (fromSaved !== undefined) sources[field] = "file";
      return fromSaved;
    };
    const label = pick("label") ?? DEFAULT_LABELS[id];
    const loginUrl = pick("loginUrl") ?? "";
    const username = pick("username") ?? "";
    let password = pick("password") ?? null;

    const problems: string[] = [];
    if (read.problem) problems.push(read.problem);
    // A saved password only goes to the origin it was saved for. An env password is never bound (as an env API key
    // isn't): it goes to the effective login URL, from env or the saved file; sign-in keeps it on that page's origin.
    if (sources.password === "file" && password !== null && loginUrl !== "") {
      const savedFor = boundOrigin(saved);
      const effective = httpOrigin(loginUrl);
      if (savedFor !== effective) {
        password = null;
        sources.password = "default";
        problems.push(
          savedFor
            ? `The saved password was for ${savedFor}, so it was not used for ${effective ?? "this sign-in page"}. Enter the password again.`
            : "The saved password has no sign-in page saved with it, so it was not used. Enter the password again.",
        );
      }
    }
    if (password && isCommonPassword(password))
      problems.push(COMMON_PASSWORD_PROBLEM);
    if (loginUrl !== "" && httpOrigin(loginUrl) === null) {
      const where =
        sources.loginUrl === "env"
          ? accountEnvName(id, "loginUrl")
          : "The sign-in page";
      problems.push(`${where} is not an http:// or https:// URL.`);
    }

    const account: TestAccount = { id, label, loginUrl, username, password };
    accounts[id] = account;
    statuses[id] = {
      id,
      label,
      loginUrl,
      username,
      hasPassword: password !== null && password !== "",
      ready: isReady(account),
      sources,
      problem: problems.length > 0 ? problems.join(" ") : null,
    };
  }

  let isolated = true;
  let isolatedSource: "file" | "env" | "default" = "default";
  const fromEnv = envBool(env.RUNHOUND_ACCOUNTS_ISOLATED);
  if (fromEnv !== undefined) {
    isolated = fromEnv;
    isolatedSource = "env";
  } else if (read.saved.isolated !== undefined) {
    isolated = read.saved.isolated;
    isolatedSource = "file";
  }
  return {
    config: { isolated, accounts },
    status: { isolated, isolatedSource, accounts: statuses, file, secretProtection: secretProtection(env) },
  };
}

/**
 * Reads the file (missing or unreadable = nothing saved) and applies the env overrides. Never throws on a bad file: a
 * malformed file reads as nothing saved, with a problem on each slot.
 */
export async function resolveAccounts(
  options: { env?: NodeJS.ProcessEnv; home?: string; sealed?: boolean } = {},
): Promise<{ config: AccountsConfig; status: AccountsStatus }> {
  const env = options.env ?? process.env;
  const file = accountsFile(env, options.home);
  // sealed (status only, D10): passwords resolve to SEALED_SECRET without the OS keychain being asked, and the move
  // out of plain text (which writes the store) waits for a read that opens it. signIn refuses a sealed password.
  const sealed = options.sealed === true;
  const read = await readSaved(file, env, !sealed);
  if (read.plain && !sealed) await oneAtATime(file, () => movePasswordsOut(file, env));
  return resolveWith(env, file, read);
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
  const temp = join(
    dir,
    `.accounts.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
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

/**
 * The file's text: version 1, `isolated` when set, the slots with their non-empty fields. A password is written only
 * `withPasswords` (the Docker image's legacy plain text); its passwordOrigin always, as the binding stays in the file.
 */
function serialise(saved: SavedFile, withPasswords: boolean): string {
  const accounts: Partial<Record<AccountId, SavedSlot>> = {};
  for (const id of ACCOUNT_IDS) {
    const slot = saved.accounts[id];
    if (!slot) continue;
    const out: SavedSlot = {};
    if (slot.label) out.label = slot.label;
    if (slot.loginUrl) out.loginUrl = slot.loginUrl;
    if (slot.username) out.username = slot.username;
    if (slot.password) {
      if (withPasswords) out.password = slot.password;
      if (slot.passwordOrigin) out.passwordOrigin = slot.passwordOrigin;
    }
    if (Object.keys(out).length > 0) accounts[id] = out;
  }
  return `${JSON.stringify({ version: 1, ...(saved.isolated !== undefined ? { isolated: saved.isolated } : {}), accounts }, null, 2)}\n`;
}

/** Saves and clears of one file run one at a time in this process, so two at once can't lose each other's changes. */
const queues = new Map<string, Promise<void>>();
function oneAtATime<T>(file: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).then(work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(file, settled);
  void settled.then(() => {
    if (queues.get(file) === settled) queues.delete(file);
  });
  return next;
}

/** Throws a plain Error unless the value is "" or an http(s) URL without a user name or password in it. */
function checkLoginUrl(value: string, label: string): string {
  const url = value.trim();
  if (url === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${label}'s sign-in page is not a URL. Enter the full address, like http://localhost:5173/login.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(
      `${label}'s sign-in page must start with http:// or https://.`,
    );
  if (parsed.username || parsed.password) {
    throw new Error(
      `${label}'s sign-in page must not have a user name or password in it; enter them as the username and password instead.`,
    );
  }
  return url;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Throws a plain Error (never naming a value) unless `patch` is an AccountsPatch: an object; `isolated` a boolean;
 * `accounts` an object whose keys are "a"/"b" and whose label/loginUrl/username/password are strings (other keys
 * are ignored); labels at most MAX_LABEL_LENGTH characters. The server answers 400 with the message.
 */
export function checkAccountsPatch(
  patch: unknown,
): asserts patch is AccountsPatch {
  if (!isObject(patch))
    throw new Error("Send the test accounts as a JSON object.");
  if (patch.isolated !== undefined && typeof patch.isolated !== "boolean")
    throw new Error("isolated must be true or false.");
  if (patch.accounts === undefined) return;
  if (!isObject(patch.accounts))
    throw new Error(
      'accounts must be an object like {"a": {"loginUrl": "…", "username": "…"}}.',
    );
  for (const [id, slot] of Object.entries(patch.accounts)) {
    if (!(ACCOUNT_IDS as readonly string[]).includes(id))
      throw new Error(
        "There are two test accounts, a and b; accounts can only name those.",
      );
    if (slot === undefined) continue;
    if (!isObject(slot)) throw new Error(`accounts.${id} must be an object.`);
    for (const field of FIELDS) {
      const value = slot[field];
      if (value !== undefined && typeof value !== "string")
        throw new Error(`accounts.${id}.${field} must be a string.`);
    }
    if (
      typeof slot.label === "string" &&
      slot.label.trim().length > MAX_LABEL_LENGTH
    )
      throw new Error(`A label can be at most ${MAX_LABEL_LENGTH} characters.`);
  }
}

/**
 * Applies a patch to the saved file (not to env overrides, which keep winning) and returns the new status. Rejects
 * with a plain message when a loginUrl is not an http(s) URL. The caller checks loginUrl against the safety gate.
 *
 * Omitted fields are kept; "" removes a field (the label goes back to the default). A new password is stored with
 * `passwordOrigin`, the origin of the slot's effective login URL after the patch (env included); a new password with
 * no login URL anywhere is refused, as it would be bound to nothing. A patch that moves the slot's effective login URL
 * to another origin without a new password removes a saved password bound elsewhere; a kept password that applied
 * before is (re)bound to its origin; one that didn't apply (env moved the login URL) keeps its binding.
 */
export async function saveAccounts(
  patch: AccountsPatch,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<AccountsStatus> {
  checkAccountsPatch(patch);
  const env = options.env ?? process.env;
  const file = accountsFile(env, options.home);
  return oneAtATime(file, async () => {
    const read = await readSaved(file, env);
    const before = resolveWith(env, file, read);
    const next: SavedFile = {
      ...read.saved,
      accounts: { ...read.saved.accounts },
    };
    if (patch.isolated !== undefined) next.isolated = patch.isolated;

    const changed: { id: AccountId; newPassword: boolean }[] = [];
    for (const id of ACCOUNT_IDS) {
      const slotPatch = patch.accounts?.[id];
      if (!slotPatch) continue;
      const label = slotPatch.label?.trim() || before.config.accounts[id].label;
      const slot: SavedSlot = { ...next.accounts[id] };
      if (slotPatch.label !== undefined)
        slot.label =
          slotPatch.label.trim() === DEFAULT_LABELS[id]
            ? ""
            : slotPatch.label.trim();
      if (slotPatch.loginUrl !== undefined)
        slot.loginUrl = checkLoginUrl(slotPatch.loginUrl, label);
      if (slotPatch.username !== undefined)
        slot.username = slotPatch.username.trim();
      let newPassword = false;
      if (slotPatch.password === "") {
        delete slot.password;
        delete slot.passwordOrigin;
      } else if (slotPatch.password !== undefined) {
        slot.password = slotPatch.password;
        newPassword = true;
      }
      next.accounts[id] = slot;
      changed.push({ id, newPassword });
    }

    // Where each changed slot's password would be sent after the patch, env overrides applied.
    const after = resolveWith(env, file, { saved: next, problem: null });
    for (const { id, newPassword } of changed) {
      const slot = next.accounts[id]!;
      const origin = httpOrigin(after.config.accounts[id].loginUrl);
      if (newPassword) {
        if (origin === null) {
          throw new Error(
            `Enter ${after.config.accounts[id].label}'s sign-in page (an http:// or https:// URL) with the password: a saved password is only ever sent to the sign-in page it was saved for.`,
          );
        }
        slot.passwordOrigin = origin;
        continue;
      }
      if (!slot.password) continue;
      const wasOrigin = httpOrigin(before.config.accounts[id].loginUrl);
      // Bound as read, not as patched: a hand-written slot falls back to its loginUrl, which the patch may have moved.
      if (
        wasOrigin !== origin &&
        boundOrigin(read.saved.accounts[id]) !== origin
      ) {
        // A new sign-in origin without a new password: the saved one is not sent there.
        delete slot.password;
        delete slot.passwordOrigin;
      } else if (
        before.status.accounts[id].sources.password === "file" &&
        origin !== null
      ) {
        slot.passwordOrigin = origin;
      }
    }

    await writeSaved(file, next, read, env);
    return resolveWith(env, file, await readSaved(file, env)).status;
  });
}

/** Removes one slot from the saved file (`accounts clear a`). */
export async function clearAccount(
  id: AccountId,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<AccountsStatus> {
  if (!(ACCOUNT_IDS as readonly string[]).includes(id))
    throw new Error("There are two test accounts, a and b.");
  const env = options.env ?? process.env;
  const file = accountsFile(env, options.home);
  return oneAtATime(file, async () => {
    const read = await readSaved(file, env);
    if (read.saved.accounts[id]) {
      const next: SavedFile = {
        ...read.saved,
        accounts: { ...read.saved.accounts },
      };
      delete next.accounts[id];
      await writeSaved(file, next, read, env);
    }
    return resolveWith(env, file, await readSaved(file, env)).status;
  });
}

/** True when the slot has a loginUrl, a username and a usable password. */
export function isReady(account: TestAccount): boolean {
  return (
    account.loginUrl !== "" &&
    account.username !== "" &&
    account.password !== null &&
    account.password !== ""
  );
}