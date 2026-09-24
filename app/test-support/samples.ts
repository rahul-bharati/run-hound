/**
 * Starts one of the well-built sample apps in fixtures/samples/ (docs/v0-spec.md, "Unfamiliar apps") on free ports,
 * for check tests that must behave on apps Run Hound was never tuned for: a classic form post that redirects, a
 * vanilla-JS SPA, a sign-in form and a form whose API is on another origin.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

export type SampleName = "classic-post" | "spa-fetch" | "login" | "cross-origin-api";

const SAMPLES_DIR = fileURLToPath(new URL("../../fixtures/samples/", import.meta.url));

/** Path of each sample's form page. */
const FORM_PATH: Record<SampleName, string> = { "classic-post": "/signup", "spa-fetch": "/", login: "/", "cross-origin-api": "/" };

export interface Sample {
  /** URL of the form page, on localhost (the cross-origin sample's CSP names localhost and 127.0.0.1 only). */
  url: string;
  /** The API origin of the cross-origin sample, else the page origin. */
  apiOrigin: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startOnce(name: SampleName): Promise<Sample> {
  const port = await freePort();
  let apiPort = await freePort();
  while (apiPort === port) apiPort = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: `${SAMPLES_DIR}${name}`,
    env: { ...process.env, PORT: String(port), API_PORT: String(apiPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name} did not start within 15 s.\n${out}`));
    }, 15_000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (/listening/.test(out)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited early (code ${code}).\n${out}`));
    });
  });
  return {
    url: `http://localhost:${port}${FORM_PATH[name]}`,
    apiOrigin: name === "cross-origin-api" ? `http://localhost:${apiPort}` : `http://localhost:${port}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Starts a sample on free ports, retrying when a port was taken in between. */
export async function startSample(name: SampleName): Promise<Sample> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await startOnce(name);
    } catch (err) {
      last = err;
      if (!(err instanceof Error) || !/EADDRINUSE/.test(err.message)) break;
    }
  }
  throw last;
}
