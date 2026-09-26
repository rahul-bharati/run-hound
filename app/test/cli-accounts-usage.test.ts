import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `run-hound accounts …` usage and refusals that cli-accounts.test.ts leaves open. None of these contacts an app.
 * - options that only `accounts set` takes are refused elsewhere; `accounts set a` with nothing to save is refused;
 * - a password without a sign-in page is refused (exit 2) and nothing is saved or echoed;
 * - `accounts test` of a slot whose sign-in page the safety gate refuses fails naming the host, without a browser;
 * - `accounts clear` says when env variables still set the slot up.
 */

const appDir = fileURLToPath(new URL("..", import.meta.url));
let configDir: string;

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}, input = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("RUNHOUND_AI") || k.startsWith("RUNHOUND_ACCOUNT") || k.startsWith("AWS_")) delete env[k];
  delete env.RUNHOUND_ALLOWED_HOSTS;
  Object.assign(env, { RUNHOUND_CONFIG_DIR: configDir }, extraEnv);
  return new Promise((resolve) => {
    const child = execFile("pnpm", ["exec", "tsx", "src/cli.ts", ...args], { cwd: appDir, env, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

const firstErrorLine = (r: { stderr: string }) => r.stderr.split("\n").find((l) => l.trim() !== "") ?? "";
const file = () => join(configDir, "accounts.json");

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "rh-cli-accounts-usage-"));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

describe("run-hound accounts usage", () => {
  it("names the commands when none is given", async () => {
    const r = await runCli(["accounts"]);
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toMatch(/accounts status/);
  });

  it("refuses set's options on other commands", async () => {
    const r = await runCli(["accounts", "status", "--login-url", "http://127.0.0.1:5173/login"]);
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("accounts set");
  });

  it("refuses `accounts set a` with nothing to save", async () => {
    const r = await runCli(["accounts", "set", "a"]);
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("--login-url");
    await expect(stat(file())).rejects.toThrow();
  });

  it("refuses a password without a sign-in page: exit 2, nothing saved, never echoed", async () => {
    const r = await runCli(["accounts", "set", "a", "--username", "alex@fernway.test", "--password-stdin"], {}, "usage-secret-321\n");
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toMatch(/sign-in page/);
    expect(`${r.stdout}${r.stderr}`).not.toContain("usage-secret-321");
    await expect(stat(file())).rejects.toThrow();
  });

  it("refuses an empty stdin for --password-stdin", async () => {
    const r = await runCli(["accounts", "set", "a", "--login-url", "http://127.0.0.1:5173/login", "--password-stdin"], {}, "");
    expect(r.code).toBe(2);
    expect(firstErrorLine(r)).toContain("--password-stdin");
    await expect(stat(file())).rejects.toThrow();
  });

  it("`accounts test` of a sign-in page the safety gate refuses fails naming the host", async () => {
    const r = await runCli(["accounts", "test", "a"], {
      RUNHOUND_ACCOUNT_A_LOGIN_URL: "http://8.8.8.8/login",
      RUNHOUND_ACCOUNT_A_USERNAME: "alex@fernway.test",
      RUNHOUND_ACCOUNT_A_PASSWORD: "usage-secret-654",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Account A");
    expect(r.stderr).toContain("8.8.8.8");
    expect(`${r.stdout}${r.stderr}`).not.toContain("usage-secret-654");
  });

  it("`accounts clear` says when env variables still set the slot up", async () => {
    const saved = await runCli(["accounts", "set", "b", "--login-url", "http://127.0.0.1:5173/login", "--username", "sam@fernway.test"]);
    expect(saved.code, saved.stderr).toBe(0);
    const r = await runCli(["accounts", "clear", "b"], { RUNHOUND_ACCOUNT_B_USERNAME: "sam@fernway.test" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("RUNHOUND_ACCOUNT_B_USERNAME");
    expect(await readFile(file(), "utf8")).not.toContain("sam@fernway.test");
  });
});
