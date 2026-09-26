import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configFile } from "../ai/config.js";
import { accountsFile, clearAccount, isReady, resolveAccounts, saveAccounts } from "./config.js";
import type { AccountId, AccountSource, AccountStatus, TestAccount } from "./types.js";

/**
 * Saved test accounts (docs/v2-spec.md "Test accounts"; contract in accounts/config.ts and accounts/types.ts).
 *
 * Interpretations pinned here (marked * where the spec leaves room):
 * - accounts.json lives next to ai.json (same configDir rules). Its shape is the spec's
 *   `{ version: 1, isolated, accounts: { a: { loginUrl, username, password, label }, b } }`; the implementation may add
 *   its own bookkeeping keys (such as the origin a password was saved for), and a hand-written file without them binds
 *   its password to its own loginUrl.
 * - Env overrides the file per field. * An EMPTY env variable is "not set": the compose files pass every variable
 *   through empty by default, and that must not wipe the saved values.
 * - A saved password is only used while the effective loginUrl has the origin it was saved for. * A file whose
 *   loginUrl was edited by hand to another origin (config.ts: "changed in the file") also stops using the password.
 *   The problem text names the origin the password was saved for (types.ts example: "The saved password was for
 *   http://localhost:5173, so it was not used.").
 * - Env passwords are not bound: an env password follows whatever loginUrl that invocation uses.
 * - saveAccounts never rejects a field env overrides (unlike the AI config): it writes the file and env keeps winning.
 */

let tmp: string;
let dir: string;
/** Points the config dir at the temp dir, so the real ~/.config is never touched. */
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "runhound-accounts-config-"));
  dir = join(tmp, "config");
  env = { RUNHOUND_CONFIG_DIR: dir };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const LOGIN = "http://127.0.0.1:5173/login";
const LOGIN_OTHER_PATH = "http://127.0.0.1:5173/auth/sign-in";
/** Same host, another port: another origin. */
const LOGIN_OTHER_ORIGIN = "http://127.0.0.1:5174/login";
const PASSWORD_A = "correct-horse-battery-A1";
const PASSWORD_B = "staple-lemon-orbit-B2";
const USER_A = "alex@fernway.test";
const USER_B = "sam@fernway.test";

const file = () => join(dir, "accounts.json");
const savedText = () => readFile(file(), "utf8");
const saved = async () => JSON.parse(await savedText()) as { version?: unknown; isolated?: unknown; accounts?: Record<string, Record<string, unknown>> };

async function writeSaved(value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(file(), typeof value === "string" ? value : JSON.stringify(value));
}

/** A rejection for a real reason: the contract stubs also throw, which must not count. */
async function expectRejected(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/not implemented/);
  return error as Error;
}

const ALL: (s: AccountSource) => AccountStatus["sources"] = (s) => ({ label: s, loginUrl: s, username: s, password: s });

const fullA = { loginUrl: LOGIN, username: USER_A, password: PASSWORD_A };
const fullB = { loginUrl: LOGIN, username: USER_B, password: PASSWORD_B };

describe("accountsFile", () => {
  it("uses RUNHOUND_CONFIG_DIR first", () => {
    expect(accountsFile({ RUNHOUND_CONFIG_DIR: "/a/b", XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe(join("/a/b", "accounts.json"));
  });

  it("uses XDG_CONFIG_HOME/run-hound next", () => {
    expect(accountsFile({ XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe(join("/x", "run-hound", "accounts.json"));
  });

  it("falls back to ~/.config/run-hound", () => {
    expect(accountsFile({}, "/home/u")).toBe(join("/home/u", ".config", "run-hound", "accounts.json"));
  });

  it("is in the same folder as ai.json", () => {
    for (const e of [{ RUNHOUND_CONFIG_DIR: "/a/b" }, { XDG_CONFIG_HOME: "/x" }, {}]) {
      expect(dirname(accountsFile(e, "/home/u"))).toBe(dirname(configFile(e, "/home/u")));
    }
  });
});

describe("resolveAccounts", () => {
  it("returns two empty slots with the default labels, isolated on, when nothing is saved", async () => {
    const { config, status } = await resolveAccounts({ env, home: tmp });
    expect(config.isolated).toBe(true);
    expect(config.accounts.a).toEqual({ id: "a", label: "Account A", loginUrl: "", username: "", password: null });
    expect(config.accounts.b).toEqual({ id: "b", label: "Account B", loginUrl: "", username: "", password: null });
    expect(status.isolated).toBe(true);
    expect(status.isolatedSource).toBe("default");
    expect(status.file).toBe(file());
    for (const id of ["a", "b"] as const) {
      expect(status.accounts[id]).toEqual({
        id,
        label: id === "a" ? "Account A" : "Account B",
        loginUrl: "",
        username: "",
        hasPassword: false,
        ready: false,
        sources: ALL("default"),
        problem: null,
      });
    }
  });

  it("finds the file under ~/.config/run-hound when no env var names a config dir", async () => {
    await mkdir(join(tmp, ".config", "run-hound"), { recursive: true });
    await writeFile(join(tmp, ".config", "run-hound", "accounts.json"), JSON.stringify({ version: 1, accounts: { a: fullA } }));
    const { config, status } = await resolveAccounts({ env: {}, home: tmp });
    expect(config.accounts.a.username).toBe(USER_A);
    expect(status.file).toBe(join(tmp, ".config", "run-hound", "accounts.json"));
  });

  it("reads a file in the spec's shape: labels, login URLs, usernames, passwords and isolated", async () => {
    await writeSaved({ version: 1, isolated: false, accounts: { a: { ...fullA, label: "Owner" }, b: fullB } });
    const { config, status } = await resolveAccounts({ env, home: tmp });
    expect(config.isolated).toBe(false);
    expect(config.accounts.a).toEqual({ id: "a", label: "Owner", loginUrl: LOGIN, username: USER_A, password: PASSWORD_A });
    expect(config.accounts.b).toEqual({ id: "b", label: "Account B", loginUrl: LOGIN, username: USER_B, password: PASSWORD_B });
    expect(status.isolated).toBe(false);
    expect(status.isolatedSource).toBe("file");
    expect(status.accounts.a).toMatchObject({ label: "Owner", loginUrl: LOGIN, username: USER_A, hasPassword: true, ready: true, problem: null });
    expect(status.accounts.a.sources).toEqual(ALL("file"));
    expect(status.accounts.b.sources).toEqual({ label: "default", loginUrl: "file", username: "file", password: "file" });
    expect(status.accounts.b.ready).toBe(true);
  });

  it("never puts a password in the status", async () => {
    await writeSaved({ version: 1, accounts: { a: fullA, b: fullB } });
    const { status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_B_PASSWORD: "env-password-B3" }, home: tmp });
    const text = JSON.stringify(status);
    for (const secret of [PASSWORD_A, PASSWORD_B, "env-password-B3"]) expect(text).not.toContain(secret);
    expect(status.accounts.a).not.toHaveProperty("password");
    expect(status.accounts.b).not.toHaveProperty("password");
    expect(status.accounts.b.hasPassword).toBe(true);
    expect(status.accounts.b.sources.password).toBe("env");
  });

  it("lets each env variable override its own field and keeps the file's other fields", async () => {
    await writeSaved({ version: 1, accounts: { a: { ...fullA, username: "file-user@example.test", label: "File label" } } });
    const { config, status } = await resolveAccounts({
      env: { ...env, RUNHOUND_ACCOUNT_A_USERNAME: "env-user@example.test", RUNHOUND_ACCOUNT_A_LABEL: "Env label" },
      home: tmp,
    });
    expect(config.accounts.a).toEqual({ id: "a", label: "Env label", loginUrl: LOGIN, username: "env-user@example.test", password: PASSWORD_A });
    expect(status.accounts.a.sources).toEqual({ label: "env", loginUrl: "file", username: "env", password: "file" });
    expect(status.accounts.a.ready).toBe(true);
  });

  it("configures both slots from env alone", async () => {
    const { config, status } = await resolveAccounts({
      env: {
        ...env,
        RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN,
        RUNHOUND_ACCOUNT_A_USERNAME: USER_A,
        RUNHOUND_ACCOUNT_A_PASSWORD: PASSWORD_A,
        RUNHOUND_ACCOUNT_B_LOGIN_URL: LOGIN,
        RUNHOUND_ACCOUNT_B_USERNAME: USER_B,
        RUNHOUND_ACCOUNT_B_PASSWORD: PASSWORD_B,
        RUNHOUND_ACCOUNT_B_LABEL: "Tester",
      },
      home: tmp,
    });
    expect(config.accounts.a).toEqual({ id: "a", label: "Account A", ...fullA });
    expect(config.accounts.b).toEqual({ id: "b", label: "Tester", ...fullB });
    expect(status.accounts.a.sources).toEqual({ label: "default", loginUrl: "env", username: "env", password: "env" });
    expect(status.accounts.b.sources).toEqual(ALL("env"));
    expect(status.accounts.a.ready && status.accounts.b.ready).toBe(true);
  });

  it("treats empty env variables as not set (the compose files pass them through empty)", async () => {
    await writeSaved({ version: 1, isolated: false, accounts: { a: { ...fullA, label: "Owner" }, b: fullB } });
    const empty: NodeJS.ProcessEnv = { ...env, RUNHOUND_ACCOUNTS_ISOLATED: "" };
    for (const slot of ["A", "B"]) for (const field of ["LOGIN_URL", "USERNAME", "PASSWORD", "LABEL"]) empty[`RUNHOUND_ACCOUNT_${slot}_${field}`] = "";
    const { config, status } = await resolveAccounts({ env: empty, home: tmp });
    expect(config.isolated).toBe(false);
    expect(status.isolatedSource).toBe("file");
    expect(config.accounts.a).toEqual({ id: "a", label: "Owner", ...fullA });
    expect(config.accounts.b).toEqual({ id: "b", label: "Account B", ...fullB });
    expect(status.accounts.a.sources).toEqual(ALL("file"));
  });

  it.each([
    ["false", true, false],
    ["true", false, true],
  ])("reads RUNHOUND_ACCOUNTS_ISOLATED=%s over the file", async (value, inFile, expected) => {
    await writeSaved({ version: 1, isolated: inFile, accounts: {} });
    const { config, status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNTS_ISOLATED: value }, home: tmp });
    expect(config.isolated).toBe(expected);
    expect(status.isolated).toBe(expected);
    expect(status.isolatedSource).toBe("env");
  });

  it.each([
    ["not JSON", "{ this is not json"],
    ["a JSON array", "[1, 2, 3]"],
  ])("reads a malformed file (%s) as nothing saved, with a problem on each slot, without throwing", async (_what, content) => {
    await writeSaved(content);
    const { config, status } = await resolveAccounts({ env, home: tmp });
    expect(config.isolated).toBe(true);
    expect(config.accounts.a).toEqual({ id: "a", label: "Account A", loginUrl: "", username: "", password: null });
    expect(config.accounts.b).toEqual({ id: "b", label: "Account B", loginUrl: "", username: "", password: null });
    for (const id of ["a", "b"] as const) {
      expect(typeof status.accounts[id].problem).toBe("string");
      expect(status.accounts[id].problem!.length).toBeGreaterThan(0);
      expect(status.accounts[id].ready).toBe(false);
    }
  });

  it("still applies env overrides over a malformed file", async () => {
    await writeSaved("{ broken");
    const { config } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN, RUNHOUND_ACCOUNT_A_USERNAME: USER_A, RUNHOUND_ACCOUNT_A_PASSWORD: PASSWORD_A }, home: tmp });
    expect(config.accounts.a).toEqual({ id: "a", label: "Account A", ...fullA });
  });
});

describe("a saved password is bound to the origin of its login URL", () => {
  const origin = "http://127.0.0.1:5173";

  it("is not used when an env variable moves the login URL to another origin, and the problem says why", async () => {
    await writeSaved({ version: 1, accounts: { a: fullA } });
    const { config, status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN_OTHER_ORIGIN }, home: tmp });
    expect(config.accounts.a.loginUrl).toBe(LOGIN_OTHER_ORIGIN);
    expect(config.accounts.a.password).toBeNull();
    expect(status.accounts.a.hasPassword).toBe(false);
    expect(status.accounts.a.ready).toBe(false);
    expect(status.accounts.a.problem).toContain(origin);
    expect(status.accounts.a.problem).toMatch(/password/i);
    expect(JSON.stringify(status)).not.toContain(PASSWORD_A);
  });

  it("is still used for another path on the same origin", async () => {
    await writeSaved({ version: 1, accounts: { a: fullA } });
    const { config, status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN_OTHER_PATH }, home: tmp });
    expect(config.accounts.a.password).toBe(PASSWORD_A);
    expect(status.accounts.a.problem).toBeNull();
    expect(status.accounts.a.ready).toBe(true);
  });

  it("is not used after the file's login URL was edited to another origin", async () => {
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const edited = await saved();
    edited.accounts!.a!.loginUrl = LOGIN_OTHER_ORIGIN;
    await writeSaved(edited);
    const { config, status } = await resolveAccounts({ env, home: tmp });
    expect(config.accounts.a.loginUrl).toBe(LOGIN_OTHER_ORIGIN);
    expect(config.accounts.a.password).toBeNull();
    expect(status.accounts.a.hasPassword).toBe(false);
    expect(status.accounts.a.problem).toContain(origin);
  });

  it("leaves env passwords alone: RUNHOUND_ACCOUNT_A_PASSWORD follows the env login URL", async () => {
    await writeSaved({ version: 1, accounts: { a: fullA } });
    const { config, status } = await resolveAccounts({
      env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN_OTHER_ORIGIN, RUNHOUND_ACCOUNT_A_PASSWORD: "env-password-A9" },
      home: tmp,
    });
    expect(config.accounts.a.password).toBe("env-password-A9");
    expect(status.accounts.a.sources.password).toBe("env");
    expect(status.accounts.a.problem).toBeNull();
    expect(status.accounts.a.ready).toBe(true);
  });
});

describe("saveAccounts", () => {
  it("tightens a folder that already existed with looser permissions to 0700", async () => {
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    await saveAccounts({ accounts: { a: { label: "Owner" } } }, { env, home: tmp });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("creates the folder (0700) and writes the file (0600) in the spec's shape", async () => {
    const status = await saveAccounts({ accounts: { a: { ...fullA, label: "Owner" } } }, { env, home: tmp });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect(await saved()).toMatchObject({ version: 1, accounts: { a: { loginUrl: LOGIN, username: USER_A, password: PASSWORD_A, label: "Owner" } } });
    expect(status.file).toBe(file());
    expect(status.accounts.a).toMatchObject({ label: "Owner", loginUrl: LOGIN, username: USER_A, hasPassword: true, ready: true, problem: null });
    expect(status.accounts.a.sources).toEqual(ALL("file"));
    expect(status.accounts.b.ready).toBe(false);
    expect(JSON.stringify(status)).not.toContain(PASSWORD_A);
    // A fresh read sees the same thing.
    expect((await resolveAccounts({ env, home: tmp })).config.accounts.a).toEqual({ id: "a", label: "Owner", ...fullA });
  });

  it("replaces a looser pre-existing file with a new 0600 file (atomic write, no temp file left)", async () => {
    await writeSaved({ version: 1, accounts: { b: fullB } });
    await chmod(file(), 0o644);
    const before = await stat(file());
    expect(before.mode & 0o777).toBe(0o644);
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const after = await stat(file());
    expect(after.mode & 0o777).toBe(0o600);
    expect(after.ino).not.toBe(before.ino);
    expect(await saved()).toMatchObject({ accounts: { a: fullA, b: fullB } });
    expect(await readdir(dir)).toEqual(["accounts.json"]);
  });

  it("keeps the fields and the slot a patch doesn't mention", async () => {
    await saveAccounts({ accounts: { a: fullA, b: fullB } }, { env, home: tmp });
    await saveAccounts({ accounts: { a: { label: "Owner" } } }, { env, home: tmp });
    const status = await saveAccounts({ isolated: false }, { env, home: tmp });
    const { config } = await resolveAccounts({ env, home: tmp });
    expect(config.accounts.a).toEqual({ id: "a", label: "Owner", ...fullA });
    expect(config.accounts.b).toEqual({ id: "b", label: "Account B", ...fullB });
    expect(config.isolated).toBe(false);
    expect(status.isolated).toBe(false);
    expect(status.isolatedSource).toBe("file");
    expect(await saved()).toMatchObject({ isolated: false });
  });

  it("removes the saved password on password: \"\"", async () => {
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const status = await saveAccounts({ accounts: { a: { password: "" } } }, { env, home: tmp });
    expect(status.accounts.a.hasPassword).toBe(false);
    expect(status.accounts.a.ready).toBe(false);
    expect(status.accounts.a.loginUrl).toBe(LOGIN);
    expect(await savedText()).not.toContain(PASSWORD_A);
    expect((await resolveAccounts({ env, home: tmp })).config.accounts.a.password).toBeNull();
  });

  it("removes the saved password when a new login origin is saved without a new password", async () => {
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN_OTHER_ORIGIN } } }, { env, home: tmp });
    expect(status.accounts.a.loginUrl).toBe(LOGIN_OTHER_ORIGIN);
    expect(status.accounts.a.hasPassword).toBe(false);
    expect(await savedText()).not.toContain(PASSWORD_A);
    // Moving back does not bring it back.
    const back = await saveAccounts({ accounts: { a: { loginUrl: LOGIN } } }, { env, home: tmp });
    expect(back.accounts.a.hasPassword).toBe(false);
  });

  it("keeps a new password sent with the new login origin", async () => {
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN_OTHER_ORIGIN, password: "new-password-A7" } } }, { env, home: tmp });
    expect(status.accounts.a.hasPassword).toBe(true);
    expect(status.accounts.a.problem).toBeNull();
    const { config } = await resolveAccounts({ env, home: tmp });
    expect(config.accounts.a).toMatchObject({ loginUrl: LOGIN_OTHER_ORIGIN, password: "new-password-A7" });
    expect(await savedText()).not.toContain(PASSWORD_A);
  });

  it("keeps the password for another path on the same origin", async () => {
    await saveAccounts({ accounts: { a: fullA } }, { env, home: tmp });
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN_OTHER_PATH } } }, { env, home: tmp });
    expect(status.accounts.a.hasPassword).toBe(true);
    expect((await resolveAccounts({ env, home: tmp })).config.accounts.a.password).toBe(PASSWORD_A);
  });

  it.each(["ftp://127.0.0.1/login", "not a url", "javascript:alert(1)"])("rejects the login URL %s with a plain message and writes nothing", async (loginUrl) => {
    await expectRejected(saveAccounts({ accounts: { a: { loginUrl, username: USER_A, password: PASSWORD_A } } }, { env, home: tmp }));
    await expect(stat(file())).rejects.toThrow();
  });

  it("never puts the password in a rejection message", async () => {
    const error = await expectRejected(saveAccounts({ accounts: { a: { loginUrl: "not a url", username: USER_A, password: PASSWORD_A } } }, { env, home: tmp }));
    expect(error.message).not.toContain(PASSWORD_A);
  });

  it("writes to the file while env overrides keep winning", async () => {
    const withEnv = { ...env, RUNHOUND_ACCOUNT_A_USERNAME: "env-user@example.test" };
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN, username: "file-user@example.test" } } }, { env: withEnv, home: tmp });
    expect(status.accounts.a.username).toBe("env-user@example.test");
    expect(status.accounts.a.sources.username).toBe("env");
    expect(status.accounts.a.sources.loginUrl).toBe("file");
    expect(await saved()).toMatchObject({ accounts: { a: { username: "file-user@example.test" } } });
    // Without the env variable the saved value shows.
    expect((await resolveAccounts({ env, home: tmp })).config.accounts.a.username).toBe("file-user@example.test");
  });
});

describe("clearAccount", () => {
  it("removes one slot from the file and leaves the other", async () => {
    await saveAccounts({ accounts: { a: { ...fullA, label: "Owner" }, b: fullB } }, { env, home: tmp });
    const status = await clearAccount("a", { env, home: tmp });
    expect(status.accounts.a).toMatchObject({ label: "Account A", loginUrl: "", username: "", hasPassword: false, ready: false });
    expect(status.accounts.a.sources).toEqual(ALL("default"));
    expect(status.accounts.b).toMatchObject({ loginUrl: LOGIN, username: USER_B, hasPassword: true, ready: true });
    const text = await savedText();
    expect(text).not.toContain(PASSWORD_A);
    expect(text).not.toContain(USER_A);
    expect(text).toContain(PASSWORD_B);
    expect((await stat(file())).mode & 0o777).toBe(0o600);
  });

  it("does nothing harmful when nothing is saved", async () => {
    const status = await clearAccount("b", { env, home: tmp });
    expect(status.accounts.b).toMatchObject({ label: "Account B", loginUrl: "", username: "", hasPassword: false, ready: false });
  });
});

describe("isReady", () => {
  const account = (extra: Partial<TestAccount> = {}, id: AccountId = "a"): TestAccount => ({ id, label: "Account A", ...fullA, ...extra });

  it("is true with a login URL, a username and a password", () => {
    expect(isReady(account())).toBe(true);
  });

  it.each([
    ["no login URL", { loginUrl: "" }],
    ["no username", { username: "" }],
    ["no password", { password: null }],
    ["an empty password", { password: "" }],
  ])("is false with %s", (_what, extra: Partial<TestAccount>) => {
    expect(isReady(account(extra))).toBe(false);
  });
});
