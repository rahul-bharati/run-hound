/**
 * The container entrypoint (app/docker-entrypoint.sh) picks the user the CLI runs as. Reports and the AI settings
 * (runs/.config, which both compose files point RUNHOUND_CONFIG_DIR at) must belong to the user who owns the runs
 * folder, and nothing may be written world-writable.
 *
 * Runs the published image with this checkout's entrypoint mounted over its own, under rootless Podman (or Docker).
 * A rootful engine is simulated by pointing the script's /proc/self/uid_map at a file saying "0 0 4294967295"; the
 * container's root can still chown to any uid the rootless user namespace maps. Skipped when no engine or no Run Hound
 * image is available.
 */
import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENTRYPOINT = fileURLToPath(new URL("../docker-entrypoint.sh", import.meta.url));

function find(): { engine: string; image: string } | null {
  for (const engine of ["podman", "docker"]) {
    try {
      const out = execFileSync(engine, ["images", "--format", "{{.Repository}}:{{.Tag}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const image = out.split("\n").map((l) => l.trim()).find((l) => /^ghcr\.io\/rahul-bharati\/run-hound:\d/.test(l));
      if (image) return { engine, image };
    } catch {
      // Not installed.
    }
  }
  return null;
}

const found = find();
// Rootless Podman lets the test create folders owned by other uids (podman unshare); other engines are skipped.
const usable = found?.engine === "podman";

let work: string;

function sh(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** What the CLI does when it writes: a run folder with a report, and runs/.config/ai.json (0700 / 0600). */
const WRITE_AND_STAT = [
  "node -e '",
  'const fs = require("node:fs");',
  'fs.mkdirSync("/repo/app/runs/r1/artifacts", { recursive: true });',
  'fs.writeFileSync("/repo/app/runs/r1/report.html", "x");',
  'fs.mkdirSync("/repo/app/runs/.config", { recursive: true, mode: 0o700 });',
  'fs.writeFileSync("/repo/app/runs/.config/ai.json", "{}", { mode: 0o600 });',
  "' && id -u && stat -c '%n %a %u' /repo/app/runs /repo/app/runs/r1 /repo/app/runs/r1/report.html /repo/app/runs/.config /repo/app/runs/.config/ai.json",
].join("");

/** Runs the image with the entrypoint under test; `rootful` swaps in the fake uid_map. */
async function runEntrypoint(runs: string, command: string, rootful: boolean) {
  const script = join(work, `entrypoint-${rootful ? "rootful" : "rootless"}.sh`);
  const source = await readFile(ENTRYPOINT, "utf8");
  await writeFile(script, rootful ? source.replaceAll("/proc/self/uid_map", "/fake/uid_map") : source, { mode: 0o755 });
  return sh(found!.engine, [
    "run", "--rm",
    "-v", `${script}:/usr/local/bin/run-hound-entrypoint:ro`,
    "-v", `${join(work, "uid_map")}:/fake/uid_map:ro`,
    "-v", `${runs}:/repo/app/runs`,
    found!.image,
    "sh", "-c", command,
  ]);
}

/** "path mode uid" lines keyed by path. */
function stats(stdout: string): Record<string, { mode: string; uid: number }> {
  const out: Record<string, { mode: string; uid: number }> = {};
  for (const line of stdout.trim().split("\n")) {
    const m = /^(\/\S+) (\d+) (\d+)$/.exec(line);
    if (m) out[m[1]!] = { mode: m[2]!, uid: Number(m[3]) };
  }
  return out;
}

beforeAll(async () => {
  if (!usable) return;
  work = await mkdtemp(join(tmpdir(), "rh-entrypoint-"));
  await writeFile(join(work, "uid_map"), "         0          0 4294967295\n");
});

afterAll(async () => {
  // Files made by other uids in the user namespace: remove them from inside it.
  if (usable && work) await sh("podman", ["unshare", "rm", "-rf", work]);
});

describe.skipIf(!usable)("docker-entrypoint.sh", () => {
  it("rootful engine, runs folder created by Docker (root-owned): runs as pwuser, hands it the folder, nothing world-writable", async () => {
    const runs = await mkdtemp(join(work, "runs-root-"));
    // Owned by the host user = root inside a rootless container, 0755 as Docker makes it: the "Docker created it" case.
    await chmod(runs, 0o755);
    const res = await runEntrypoint(runs, WRITE_AND_STAT, true);
    expect(res.code, res.stderr).toBe(0);
    const [uid] = res.stdout.trim().split("\n");
    expect(uid).toBe("1001");
    const st = stats(res.stdout);
    // The folder and everything in it belong to the user the CLI runs as, including the AI settings.
    for (const path of Object.keys(st)) expect(st[path]!.uid, path).toBe(1001);
    expect(st["/repo/app/runs"]!.mode).toBe("755");
    expect(st["/repo/app/runs/r1"]!.mode).toBe("755");
    expect(st["/repo/app/runs/r1/report.html"]!.mode).toBe("644");
    expect(st["/repo/app/runs/.config"]!.mode).toBe("700");
    expect(st["/repo/app/runs/.config/ai.json"]!.mode).toBe("600");
    // One plain explanation, with the fix for next time.
    expect(res.stderr).toMatch(/owned by root/);
    expect(res.stderr).toMatch(/mkdir -p runs/);
  }, 120_000);

  it("runs folder owned by a user: runs as that user and takes back a runs/.config left by another uid", async () => {
    const runs = await mkdtemp(join(work, "runs-user-"));
    // Inside the container: runs owned by uid 1234 (you), .config and ai.json left owned by pwuser (1001).
    const setup = await sh("podman", ["unshare", "sh", "-c", `mkdir -p ${runs}/.config && echo '{}' > ${runs}/.config/ai.json && chmod 700 ${runs}/.config && chmod 600 ${runs}/.config/ai.json && chown -R 1001:1001 ${runs}/.config && chown 1234:1234 ${runs}`]);
    expect(setup.code, setup.stderr).toBe(0);
    for (const rootful of [true, false]) {
      const res = await runEntrypoint(runs, `${WRITE_AND_STAT} && echo '{"enabled":true}' > /repo/app/runs/.config/ai.json && echo saved`, rootful);
      expect(res.code, res.stderr).toBe(0);
      expect(res.stdout.trim().split("\n")[0]).toBe("1234");
      const st = stats(res.stdout);
      for (const path of Object.keys(st)) expect(st[path]!.uid, `${path} (rootful: ${rootful})`).toBe(1234);
      expect(st["/repo/app/runs/.config"]!.mode).toBe("700");
      expect(res.stdout.trim()).toMatch(/saved$/);
    }
  }, 120_000);

  it("rootless engine, root-owned folder (your own user): stays root, which is you, with ordinary file modes", async () => {
    const runs = await mkdtemp(join(work, "runs-rootless-"));
    const res = await runEntrypoint(runs, WRITE_AND_STAT, false);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout.trim().split("\n")[0]).toBe("0");
    const st = stats(res.stdout);
    for (const path of Object.keys(st)) expect(st[path]!.uid, path).toBe(0);
    expect(st["/repo/app/runs/r1/report.html"]!.mode).toBe("644");
    expect(res.stderr).not.toMatch(/owned by root/);
  }, 120_000);
});
