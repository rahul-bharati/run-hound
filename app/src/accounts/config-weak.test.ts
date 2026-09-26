/**
 * A test-account password that is a very common word or number (round-2 review): reports hide the password wherever
 * it appears, so hiding "password" in `input[type=password]` would give it away. The slot's status (Settings and
 * `accounts status`) says so, in words that never contain the password itself; the slot stays usable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCommonPassword, resolveAccounts } from "./config.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "runhound-accounts-weak-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const envWith = (password: string): NodeJS.ProcessEnv => ({
  RUNHOUND_CONFIG_DIR: join(tmp, "config"),
  RUNHOUND_ACCOUNT_A_LOGIN_URL: "http://127.0.0.1:5173/login",
  RUNHOUND_ACCOUNT_A_USERNAME: "alex@fernway.test",
  RUNHOUND_ACCOUNT_A_PASSWORD: password,
});

describe("isCommonPassword", () => {
  it("is true for common words and plain numbers, with or without trailing digits, in any case", () => {
    for (const p of ["password", "Password123", "PASSW0RD", "admin", "admin1", "test1234", "letmein", "qwerty", "123456", "12345678", "welcome!"]) {
      expect(isCommonPassword(p), p).toBe(true);
    }
  });
  it("is false for anything else", () => {
    for (const p of ["alice-pass-1234", "correct-horse-battery", "hunter2", "fixture-pw-2468", "staple-lemon-orbit"]) {
      expect(isCommonPassword(p), p).toBe(false);
    }
  });
});

describe("the slot's status", () => {
  it("says a common password gives itself away, without naming it, and the slot is still ready", async () => {
    for (const password of ["password", "admin123", "test1234", "secret", "welcome1"]) {
      const { status } = await resolveAccounts({ env: envWith(password), home: tmp });
      const a = status.accounts.a;
      expect(a.ready).toBe(true);
      expect(a.problem, password).toMatch(/very common word or number/);
      expect(a.problem!.toLowerCase(), password).not.toContain(password.replace(/\d+$/, "").toLowerCase());
    }
  });

  it("says nothing for an unusual password", async () => {
    const { status } = await resolveAccounts({ env: envWith("correct-horse-battery-A1"), home: tmp });
    expect(status.accounts.a.problem).toBeNull();
  });
});
