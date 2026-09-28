/**
 * Serves a build of the site the way the Docker image does: the standalone server (<build>/standalone/server.js) with
 * the build's static files and public/ copied next to it, plus the search index when the build sits in another folder
 * (NEXT_DIST_DIR; scripts/pagefind.mjs writes it there). Every page keeps its per-page CSP (scripts/csp.mjs writes it
 * into the standalone copy too).
 *
 *   node scripts/lab/serve.mjs [--port 4870]          serve until Ctrl+C (prints the address and the pid)
 *   node scripts/lab/serve.mjs --stop [--port 4870]   stop the server listening on that port
 *
 * The port defaults to LAB_PORT or 4870; never 3000 (taken on the maintainer's machine). A server is always stopped by
 * the pid listening on its port, never by a process-name match. As a module: startServer() and stopPort().
 *
 * Node built-ins only.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, relative } from "node:path";
import { distDir, distName, siteDir, standaloneDir } from "../lib/build-output.mjs";
import { labOut } from "./lib/out.mjs";

export const defaultPort = Number(process.env.LAB_PORT) || 4870;

/** The pid of the process listening on a TCP port on this machine, or undefined. */
export function pidOnPort(port) {
  const attempts = [
    () => {
      const out = execFileSync("ss", ["-Hltnp", `sport = :${port}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return /pid=(\d+)/.exec(out)?.[1];
    },
    () => execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0],
  ];
  for (const attempt of attempts) {
    try {
      const pid = attempt();
      if (pid) return Number(pid);
    } catch {
      // Not installed, or nothing listening.
    }
  }
  return undefined;
}

/** Whether nothing listens on the port (on 127.0.0.1). */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stops the server listening on a port (by its pid) and waits until the port is free. */
export async function stopPort(port) {
  const pid = pidOnPort(port);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  for (let i = 0; i < 50 && !(await portIsFree(port)); i += 1) await sleep(100);
  if (!(await portIsFree(port))) {
    const still = pidOnPort(port);
    if (still) process.kill(still, "SIGKILL");
  }
  return pid;
}

/**
 * Starts the standalone server of the build on 127.0.0.1:<port>. Resolves once it answers, with its address and a
 * stop() that stops it by the pid listening on the port.
 */
export async function startServer({ port = defaultPort } = {}) {
  const server = join(standaloneDir, "server.js");
  if (!existsSync(server)) {
    throw new Error(`${relative(siteDir, server)} is missing: build first (NEXT_DIST_DIR=${distName} pnpm build).`);
  }
  if (!(await portIsFree(port))) {
    throw new Error(`port ${port} is in use (pid ${pidOnPort(port) ?? "unknown"}); pick another with --port or LAB_PORT`);
  }
  // As the Dockerfile does: static files and public/ next to server.js.
  const staticCopy = join(standaloneDir, distName, "static");
  rmSync(staticCopy, { recursive: true, force: true });
  cpSync(join(distDir, "static"), staticCopy, { recursive: true });
  const publicCopy = join(standaloneDir, "public");
  rmSync(publicCopy, { recursive: true, force: true });
  cpSync(join(siteDir, "public"), publicCopy, { recursive: true });
  // A build in another folder keeps its search index there (scripts/pagefind.mjs).
  if (distName !== ".next" && existsSync(join(distDir, "pagefind"))) {
    rmSync(join(publicCopy, "pagefind"), { recursive: true, force: true });
    cpSync(join(distDir, "pagefind"), join(publicCopy, "pagefind"), { recursive: true });
  }

  mkdirSync(labOut(), { recursive: true });
  const log = join(labOut(), `serve-${port}.log`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: standaloneDir,
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", openSync(log, "a"), openSync(log, "a")],
    detached: false,
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server.js exited with code ${child.exitCode}; see ${relative(siteDir, log)}`);
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) });
      await response.arrayBuffer();
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stopPort(port);
      throw new Error(`server.js did not answer on ${origin} within 30 s; see ${relative(siteDir, log)}`);
    }
    await sleep(200);
  }
  return {
    origin,
    port,
    pid: pidOnPort(port) ?? child.pid,
    log,
    stop: () => stopPort(port),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--port");
  const port = at >= 0 ? Number(args[at + 1]) : defaultPort;
  if (args.includes("--stop")) {
    const pid = await stopPort(port);
    console.log(pid ? `lab: stopped pid ${pid} on port ${port}` : `lab: nothing listens on port ${port}`);
  } else {
    const server = await startServer({ port });
    console.log(`lab: ${distName} served at ${server.origin} (pid ${server.pid}); log ${relative(siteDir, server.log)}. Ctrl+C stops it.`);
    const stop = async () => {
      await server.stop();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
