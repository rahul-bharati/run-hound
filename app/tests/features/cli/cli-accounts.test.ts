import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startAccountsApp, type AccountsApp } from "../test-support/accounts-app.js";
import type { Plan } from "../src/core/types.js";

/**
 * CLI surfaces of test accounts (docs/v2-spec.md "Test accounts" → CLI), against the shared accounts app.
 *
 * Interpretations pinned here (marked * where the spec leaves room):
 * - `accounts status`: exit 0; shows each slot's label, login URL, username, whether a password is saved, where the
 *   values come from (the words "file" / "env" / "default"), `isolated` and the accounts.json path. Never a password.
 * - `accounts set a|b --login-url <url> --username <name> [--label <text>] [--password-stdin]`: exit 0; the password is
 *   the first line of stdin. Without --password-stdin the saved password is kept (same origin) or dropped (new origin).
 *   * The login URL goes through the safety gate: a public address is exit 2 naming the host, and nothing is saved.
 * - `accounts test [a|b]`: exit 0 when every tested slot signed in, printing the page it landed on (its path);
 *   exit 2 otherwise, with the page's own error text ("Email or password is incorrect") or the reason. * A slot that
 *   isn't set up fails without opening its page, naming it by label ("Account B").
 * - `accounts clear a|b`: exit 0; the slot is gone from accounts.json.
 * - `run <url> --as a|b`: signs in before discovery (the plan is the signed-in page; plan.account = { id, label }).
 *   An unknown slot is a usage error (exit 2, the message names --as); * an unconfigured slot is exit 2 naming the
 *   account by label, before anything is sent to the app; a failed sign-in is exit 2 with the page's reason.
 * - * `run --as … --plan-only` (text) names the account the plan was made as ("Signed in as <label>").
 * - Nothing the CLI prints ever contains a password.
 */

const appDir = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let configDir: string;
let app: AccountsApp;

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}, options: { input?: string; timeoutMs?: number } = {}): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("RUNHOUND_AI") || k.startsWith("RUNHOUND_ACCOUNT") || k.startsWith("AWS_")) delete env[k];
  delete env.RUNHOUND_ALLOWED_HOSTS;
  Object.assign(env, { RUNHOUND_CONFIG_DIR: configDir }, extraEnv);
  return new Promise((resolve) => {
    const child = execFile(
      "pnpm",
      ["exec", "tsx", "src/cli.ts", ...args],
      { cwd: appDir, env, timeout: options.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input ?? "");
  });
}

const out = (r: CliResult) => `${r.stdout}${r.stderr}`;
/** The first line of stderr: "run-hound: <message>" (usage errors append the usage text after it). */
const firstErrorLine = (r: CliResult) => r.stderr.split("\n").find((l) => l.trim() !== "") ?? "";

const file = () => join(configDir, "accounts.json");

/** Env that configures a slot for the accounts app (alice for a, bob for b unless given). */
function slotEnv(id: "a" | "b", who: "alice" | "bob" = id === "a" ? "alice" : "bob", password?: string): NodeJS.ProcessEnv {
  const user = app.users[who];
  const up = id.toUpperCase();
  return {
    [`RUNHOUND_ACCOUNT_${up}_LOGIN_URL`]: app.loginUrl,
    [`RUNHOUND_ACCOUNT_${up}_USERNAME`]: user.email,
    [`RUNHOUND_ACCOUNT_${up}_PASSWORD`]: password ?? user.password,
  };
}

const logins = () => app.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/login")).length;

beforeAll(async () => {
  app = await startAccountsApp();
});

afterAll(async () => {
  await app?.stop();
});

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "rh-cli-accounts-"));
  app.reset();
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

describe("run-hound accounts status", () => {
  it("shows both slots, isolated and the file, with nothing set up", async () => {
    const r = await runCli(["accounts", "status"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Account A");
    expect(r.stdout).toContain("Account B");
    expect(r.stdout).toMatch(/isolated|must not see/i);
    expect(r.stdout).toContain(file());
  });

  it("prints labels, login URLs, usernames and where each value comes from, never a password", async () => {
    await writeFile(
      file(),
      JSON.stringify({ version: 1, isolated: true, accounts: { a: { loginUrl: app.loginUrl, username: app.users.alice.email, password: app.users.alice.password, label: "Owner" } } }),
    );
    const r = await runCli(["accounts", "status"], slotEnv("b"));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Owner");
    expect(r.stdout).toContain("Account B");
    expect(r.stdout).toContain(app.loginUrl);
    expect(r.stdout).toContain(app.users.alice.email);
    expect(r.stdout).toContain(app.users.bob.email);
    expect(r.stdout).toMatch(/password/i);
    expect(r.stdout).toMatch(/\bfile\b/);
    expect(r.stdout).toMatch(/\benv\b/);
    expect(out(r)).not.toContain(app.users.alice.password);
    expect(out(r)).not.toContain(app.users.bob.password);
  });

  it("names the problem when the saved password was for another origin, without printing it", async () => {
    await writeFile(file(), JSON.stringify({ version: 1, accounts: { a: { loginUrl: app.loginUrl, username: app.users.alice.email, password: app.users.alice.password } } }));
    const r = await runCli(["accounts", "status"], { RUNHOUND_ACCOUNT_A_LOGIN_URL: "http://127.0.0.1:9/login" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("http://127.0.0.1:9/login");
    // The origin the password was saved for is named in the problem.
    expect(r.stdout).toContain(app.url);
    expect(out(r)).not.toContain(app.users.alice.password);
  });
});

describe("run-hound accounts set", () => {
  it("saves a slot and reads the password from stdin, never printing it", async () => {
    const r = await runCli(
      ["accounts", "set", "a", "--login-url", app.loginUrl, "--username", app.users.alice.email, "--label", "Owner", "--password-stdin"],
      {},
      { input: `${app.users.alice.password}\n` },
    );
    expect(r.code, r.stderr).toBe(0);
    expect(out(r)).not.toContain(app.users.alice.password);
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(file(), "utf8")) as { accounts: Record<string, Record<string, unknown>> };
    expect(saved.accounts.a).toMatchObject({ loginUrl: app.loginUrl, username: app.users.alice.email, label: "Owner", password: app.users.alice.password });

    const status = await runCli(["accounts", "status"]);
    expect(status.stdout).toContain("Owner");
    expect(status.stdout).toContain(app.users.alice.email);
    expect(out(status)).not.toContain(app.users.alice.password);
  });

  it("keeps the saved password without --password-stdin, and drops it when the login origin changes", async () => {
    const setA = (loginUrl: string, stdin?: string) =>
      runCli(["accounts", "set", "a", "--login-url", loginUrl, "--username", app.users.alice.email, ...(stdin ? ["--password-stdin"] : [])], {}, stdin ? { input: stdin } : {});
    expect((await setA(app.loginUrl, `${app.users.alice.password}\n`)).code).toBe(0);
    expect((await setA(`${app.url}/sign-in`)).code).toBe(0);
    expect(await readFile(file(), "utf8")).toContain(app.users.alice.password);
    const moved = await setA("http://127.0.0.1:9/login");
    expect(moved.code, moved.stderr).toBe(0);
    expect(await readFile(file(), "utf8")).not.toContain(app.users.alice.password);
  });

  it("refuses a public login URL: exit 2, the host named, nothing saved", async () => {
    const r = await runCli(["accounts", "set", "a", "--login-url", "http://8.8.8.8/login", "--username", "someone@example.test", "--password-stdin"], {}, { input: "public-secret-123\n" });
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("8.8.8.8");
    expect(out(r)).not.toContain("public-secret-123");
    await expect(stat(file())).rejects.toThrow();
  });

  it("takes no password on the command line (only stdin): exit 2, nothing saved, the value never echoed", async () => {
    const r = await runCli(["accounts", "set", "a", "--login-url", app.loginUrl, "--username", app.users.alice.email, "--password", "flag-secret-456"]);
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).not.toMatch(/unknown command/i);
    expect(out(r)).not.toContain("flag-secret-456");
    await expect(stat(file())).rejects.toThrow();
  });

  it("refuses an unknown slot: exit 2, nothing saved", async () => {
    const r = await runCli(["accounts", "set", "c", "--login-url", app.loginUrl, "--username", app.users.alice.email]);
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).not.toMatch(/unknown command/i);
    await expect(stat(file())).rejects.toThrow();
  });
});

describe("run-hound accounts clear", () => {
  it("removes one slot and keeps the other", async () => {
    await writeFile(
      file(),
      JSON.stringify({
        version: 1,
        accounts: {
          a: { loginUrl: app.loginUrl, username: app.users.alice.email, password: app.users.alice.password },
          b: { loginUrl: app.loginUrl, username: app.users.bob.email, password: app.users.bob.password },
        },
      }),
    );
    const r = await runCli(["accounts", "clear", "a"]);
    expect(r.code, r.stderr).toBe(0);
    const text = await readFile(file(), "utf8");
    expect(text).not.toContain(app.users.alice.password);
    expect(text).not.toContain(app.users.alice.email);
    expect(text).toContain(app.users.bob.email);
    const status = await runCli(["accounts", "status"]);
    expect(status.stdout).not.toContain(app.users.alice.email);
    expect(status.stdout).toContain(app.users.bob.email);
  });
});

describe("run-hound accounts test", () => {
  it("signs in and prints the page it landed on: exit 0", async () => {
    const r = await runCli(["accounts", "test", "a"], slotEnv("a"));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("/notes");
    expect(out(r)).not.toContain(app.users.alice.password);
    expect(logins()).toBeGreaterThanOrEqual(1);
  });

  it("tests both slots when none is named", async () => {
    const r = await runCli(["accounts", "test"], { ...slotEnv("a"), ...slotEnv("b") });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Account A");
    expect(r.stdout).toContain("Account B");
    expect(logins()).toBeGreaterThanOrEqual(2);
    expect(out(r)).not.toContain(app.users.alice.password);
    expect(out(r)).not.toContain(app.users.bob.password);
  });

  it("exit 2 with the page's own reason when the password is wrong, never printing it", async () => {
    const r = await runCli(["accounts", "test", "a"], slotEnv("a", "alice", "wrong-password-999"));
    expect(r.code).toBe(2);
    expect(out(r)).toContain("Email or password is incorrect");
    expect(out(r)).not.toContain("wrong-password-999");
  });

  it("exit 2 when one of the two slots fails", async () => {
    const r = await runCli(["accounts", "test"], { ...slotEnv("a"), ...slotEnv("b", "bob", "wrong-password-998") });
    expect(r.code).toBe(2);
    expect(out(r)).toContain("/notes");
    expect(out(r)).toContain("Email or password is incorrect");
    expect(out(r)).not.toContain("wrong-password-998");
  });

  it("exit 2 for a slot that isn't set up, naming it, without opening the app", async () => {
    const r = await runCli(["accounts", "test", "b"]);
    expect(r.code).toBe(2);
    expect(out(r)).toContain("Account B");
    expect(app.requests).toHaveLength(0);
  });
});

describe("run --as", () => {
  it("--as a signs in before discovery: the plan is the signed-in page and records the account", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--as", "a", "--plan-only", "--json"], slotEnv("a"));
    expect(r.code, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as Plan;
    expect(plan.account).toEqual({ id: "a", label: "Account A" });
    expect(new URL(plan.page!.url).pathname).toBe("/notes");
    expect(plan.page!.forms.map((f) => f.name)).toContain("New note");
    expect(logins()).toBeGreaterThanOrEqual(1);
    expect(out(r)).not.toContain(app.users.alice.password);
    expect(r.stdout).not.toContain(app.users.alice.email);
  });

  it("names the account in the plan-only listing", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--as", "a", "--plan-only"], { ...slotEnv("a"), RUNHOUND_ACCOUNT_A_LABEL: "Owner" });
    expect(r.code, r.stderr).toBe(0);
    expect(out(r)).toContain("Signed in as Owner");
    expect(out(r)).not.toContain(app.users.alice.password);
  });

  it("without --as the run is signed out, as in 0.3.0", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--plan-only", "--json"], slotEnv("a"));
    expect(r.code, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as Plan;
    expect(plan.account).toBeUndefined();
    expect(new URL(plan.form.url).pathname).toBe("/login");
    expect(logins()).toBe(0);
  });

  it("an unknown slot is a usage error: exit 2, nothing sent to the app", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--as", "c", "--plan-only"], slotEnv("a"));
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("--as");
    expect(firstErrorLine(r)).not.toMatch(/unknown option/i);
    expect(app.requests).toHaveLength(0);
  });

  it("a slot that isn't set up: exit 2 naming it, before anything is sent to the app", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--as", "b", "--plan-only"], slotEnv("a"));
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("Account B");
    expect(app.requests).toHaveLength(0);
  });

  it("a failed sign-in fails the plan with the page's reason: exit 2", async () => {
    const r = await runCli(["run", `${app.url}/notes`, "--as", "a", "--plan-only", "--json"], slotEnv("a", "alice", "wrong-password-997"));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Email or password is incorrect");
    expect(out(r)).not.toContain("wrong-password-997");
  });
});
