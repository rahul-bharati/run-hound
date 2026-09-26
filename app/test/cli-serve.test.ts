/**
 * `run-hound serve` start-up: a port that is already taken is one plain line and exit 2 (like every other CLI error),
 * never Node's unhandled 'error' stack trace.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

function runCli(args: string[], timeoutMs = 60_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("pnpm", ["exec", "tsx", "src/cli.ts", ...args], { cwd: appDir, timeout: timeoutMs }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

let busy: Server;
let port: number;
let runsDir: string;

beforeAll(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "rh-cli-serve-"));
  busy = createServer();
  port = await new Promise<number>((resolve) => busy.listen(0, "127.0.0.1", () => resolve((busy.address() as AddressInfo).port)));
});

afterAll(async () => {
  await new Promise((r) => busy?.close(r));
  if (runsDir) await rm(runsDir, { recursive: true, force: true });
});

describe("run-hound serve", () => {
  it("exits 2 with one plain line when the port is already in use", async () => {
    const res = await runCli(["serve", "--port", String(port), "--runs-dir", runsDir]);
    expect(res.code, res.stderr).toBe(2);
    expect(res.stderr).toMatch(new RegExp(`^run-hound: port ${port} on 127\\.0\\.0\\.1 is already in use`));
    expect(res.stderr).toMatch(/--port/);
    expect(res.stderr).not.toMatch(/node:events|Unhandled|EADDRINUSE|\n\s+at /);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
    expect(res.stdout).not.toMatch(/listening/i);
  }, 90_000);
});
