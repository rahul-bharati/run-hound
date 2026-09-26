import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccountsPatch, MAX_LABEL_LENGTH, notReadyMessage, resolveAccounts, saveAccounts } from "./config.js";

/**
 * Rules of the saved accounts that config.test.ts leaves open (docs/v2-spec.md "Test accounts"):
 * - a password is only saved together with a sign-in page to bind it to;
 * - a save that doesn't move the effective sign-in page never drops the password (an env override is temporary);
 * - a login URL may not carry a user name or password of its own;
 * - notReadyMessage names the account by label and what is missing, never the username or the password;
 * - saves in one process don't lose each other's changes.
 */

let tmp: string;
let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "runhound-accounts-rules-"));
  dir = join(tmp, "config");
  env = { RUNHOUND_CONFIG_DIR: dir };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const LOGIN = "http://127.0.0.1:5173/login";
const LOGIN_OTHER_ORIGIN = "http://127.0.0.1:5174/login";
const PASSWORD = "rules-password-A1";
const USER = "alex@fernway.test";
const file = () => join(dir, "accounts.json");
const savedText = () => readFile(file(), "utf8");

describe("saving a password", () => {
  it("is refused without a sign-in page to bind it to, and nothing is written", async () => {
    const error = await saveAccounts({ accounts: { a: { username: USER, password: PASSWORD } } }, { env, home: tmp }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/sign-in page/);
    expect(error!.message).not.toContain(PASSWORD);
    await expect(stat(file())).rejects.toThrow();
  });

  it("binds to the env's sign-in page when env sets it", async () => {
    const withEnv = { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN_OTHER_ORIGIN };
    const status = await saveAccounts({ accounts: { a: { username: USER, password: PASSWORD } } }, { env: withEnv, home: tmp });
    expect(status.accounts.a.hasPassword).toBe(true);
    expect(JSON.parse(await savedText())).toMatchObject({ accounts: { a: { passwordOrigin: "http://127.0.0.1:5174" } } });
    // Without the env variable there is no sign-in page, so the password is not sent anywhere.
    expect((await resolveAccounts({ env, home: tmp })).status.accounts.a.ready).toBe(false);
  });

  it("is kept by a save that doesn't move the sign-in page while env overrides it", async () => {
    await saveAccounts({ accounts: { a: { loginUrl: LOGIN, username: USER, password: PASSWORD } } }, { env, home: tmp });
    const withEnv = { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN_OTHER_ORIGIN };
    const during = await saveAccounts({ accounts: { a: { label: "Owner" } } }, { env: withEnv, home: tmp });
    expect(during.accounts.a.hasPassword).toBe(false);
    expect(during.accounts.a.problem).toContain("http://127.0.0.1:5173");
    expect(await savedText()).toContain(PASSWORD);
    // Once the env variable is gone, the saved password applies again.
    const after = await resolveAccounts({ env, home: tmp });
    expect(after.config.accounts.a).toMatchObject({ label: "Owner", password: PASSWORD });
  });

  it("comes back after a hand edit to another origin is saved back to the original one", async () => {
    await saveAccounts({ accounts: { a: { loginUrl: LOGIN, username: USER, password: PASSWORD } } }, { env, home: tmp });
    const edited = JSON.parse(await savedText()) as { accounts: { a: { loginUrl: string } } };
    edited.accounts.a.loginUrl = LOGIN_OTHER_ORIGIN;
    await writeFile(file(), JSON.stringify(edited));
    expect((await resolveAccounts({ env, home: tmp })).status.accounts.a.hasPassword).toBe(false);
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN } } }, { env, home: tmp });
    expect(status.accounts.a.hasPassword).toBe(true);
  });

  it("of a hand-written file with no sign-in page is not sent to the env's", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(), JSON.stringify({ version: 1, accounts: { a: { username: USER, password: PASSWORD } } }));
    const { config, status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_A_LOGIN_URL: LOGIN }, home: tmp });
    expect(config.accounts.a.password).toBeNull();
    expect(status.accounts.a.problem).toMatch(/password/);
  });
});

describe("login URLs", () => {
  it("may not carry a user name or password, and the message doesn't repeat them", async () => {
    const error = await saveAccounts({ accounts: { a: { loginUrl: "http://alex:hunter2-secret@127.0.0.1:5173/login" } } }, { env, home: tmp }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain("hunter2-secret");
    await expect(stat(file())).rejects.toThrow();
  });

  it("from env that aren't http(s) are named in the problem", async () => {
    const { status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNT_B_LOGIN_URL: "ftp://127.0.0.1/login" }, home: tmp });
    expect(status.accounts.b.problem).toContain("RUNHOUND_ACCOUNT_B_LOGIN_URL");
  });
});

describe("checkAccountsPatch", () => {
  it.each([
    ["null", null],
    ["a string", "a"],
    ["isolated as a string", { isolated: "true" }],
    ["accounts as an array", { accounts: [] }],
    ["slot c", { accounts: { c: {} } }],
    ["a slot that isn't an object", { accounts: { a: "x" } }],
    ["a username that isn't a string", { accounts: { a: { username: 5 } } }],
    ["a label that is too long", { accounts: { a: { label: "x".repeat(MAX_LABEL_LENGTH + 1) } } }],
  ])("refuses %s", (_what, patch) => {
    expect(() => checkAccountsPatch(patch)).toThrow();
  });

  it("ignores fields it doesn't know (a client may send the status back)", () => {
    expect(() => checkAccountsPatch({ accounts: { a: { label: "Owner", hasPassword: true, sources: {} } } })).not.toThrow();
  });

  it("never names the value it refused", () => {
    try {
      checkAccountsPatch({ accounts: { a: { password: 12345678 } } });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("12345678");
    }
  });
});

describe("notReadyMessage", () => {
  it("names the label and what is missing, never the username", async () => {
    await saveAccounts({ accounts: { b: { loginUrl: LOGIN, username: USER, label: "Tester" } } }, { env, home: tmp });
    const { status } = await resolveAccounts({ env, home: tmp });
    const message = notReadyMessage(status.accounts.b)!;
    expect(message).toContain("Tester isn't set up");
    expect(message).toContain("password");
    expect(message).not.toMatch(/sign-in page,|username/);
    expect(message).not.toContain(USER);
    expect(notReadyMessage(status.accounts.a)).toContain("sign-in page, username or password");
  });

  it("is null for a ready slot", async () => {
    const status = await saveAccounts({ accounts: { a: { loginUrl: LOGIN, username: USER, password: PASSWORD } } }, { env, home: tmp });
    expect(notReadyMessage(status.accounts.a)).toBeNull();
  });
});

describe("concurrent saves", () => {
  it("keep every change", async () => {
    await Promise.all([
      saveAccounts({ accounts: { a: { loginUrl: LOGIN, username: USER, password: PASSWORD } } }, { env, home: tmp }),
      saveAccounts({ accounts: { b: { loginUrl: LOGIN, username: "sam@fernway.test" } } }, { env, home: tmp }),
      saveAccounts({ isolated: false }, { env, home: tmp }),
    ]);
    const { config } = await resolveAccounts({ env, home: tmp });
    expect(config.isolated).toBe(false);
    expect(config.accounts.a).toMatchObject({ username: USER, password: PASSWORD });
    expect(config.accounts.b.username).toBe("sam@fernway.test");
  });
});

describe("RUNHOUND_ACCOUNTS_ISOLATED", () => {
  it("ignores a value that isn't true or false", async () => {
    const { status } = await resolveAccounts({ env: { ...env, RUNHOUND_ACCOUNTS_ISOLATED: "maybe" }, home: tmp });
    expect(status.isolated).toBe(true);
    expect(status.isolatedSource).toBe("default");
  });
});
