// Fills the standalone server's image cache at build time, so a new deployment serves every screenshot from disk
// instead of resizing and encoding it (up to 1.5 s for a 3840 px AVIF) while the first visitor waits.
//
// Run after `pnpm build`, once .next/static and public/ sit in .next/standalone (the Dockerfile does both): it
// starts .next/standalone/server.js on 127.0.0.1, collects every /_next/image URL in the prerendered pages (img src
// and srcset, <source> srcset, <link> imagesrcset and href), requests each one in every format next.config.ts lists
// (AVIF and WebP, picked by the Accept header; read from the build's required-server-files.json) with one request per
// CPU, at most 8 by default, and stops the server. WARM_IMAGES_CONCURRENCY changes the cap: the server's memory grows
// with the requests in flight (measured at about 2.7 GB for 8 and 5.5 GB for 24), and a build step has no memory
// limit. Any answer but 200 fails the build. The server writes each result to .next/standalone/.next/cache/images (its
// distDir is ./.next, relative to server.js), keyed by URL, width, quality and format, and ships with the image.
//
// Node built-ins only.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const standalone = fileURLToPath(new URL("../.next/standalone/", import.meta.url));
const pagesDir = join(standalone, ".next", "server", "app");
const cacheDir = join(standalone, ".next", "cache", "images");

function fail(message) {
  console.error(`warm-images: ${message}`);
  process.exit(1);
}

for (const path of ["server.js", ".next/static", "public"]) {
  if (!existsSync(join(standalone, path))) {
    fail(`.next/standalone/${path} is missing: run pnpm build, then copy .next/static and public/ into it.`);
  }
}

// The formats the server encodes (next.config.ts images.formats), as the build recorded them, so a format dropped
// from the config isn't requested (the server would answer with another one, and this script would fail).
const { config } = JSON.parse(await readFile(join(standalone, ".next", "required-server-files.json"), "utf8"));
const formats = config.images.formats;

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => join(e.parentPath, e.name));
}

// Every /_next/image URL in src, srcset, imagesrcset and href attributes, as the browser would request it.
async function imageUrls(files) {
  const urls = new Set();
  for (const file of files) {
    const html = await readFile(file, "utf8");
    for (const [, value] of html.matchAll(/\s(?:src|srcset|imagesrcset|href)="([^"]*)"/gi)) {
      for (const candidate of value.split(",")) {
        const url = candidate.trim().split(/\s+/)[0].replaceAll("&amp;", "&");
        if (url.startsWith("/_next/image")) urls.add(url);
      }
    }
  }
  return [...urls];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(origin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server.js exited with code ${child.exitCode} before it answered`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server.js did not answer on ${origin} within 30 s`);
}

const files = await htmlFiles(pagesDir);
const urls = await imageUrls(files);
if (urls.length === 0) fail(`no /_next/image URLs in ${files.length} prerendered pages; nothing to warm`);

const jobs = urls.flatMap((url) => formats.map((accept) => ({ url, accept })));
const concurrency = Math.min(availableParallelism(), Number(process.env.WARM_IMAGES_CONCURRENCY) || 8, jobs.length);

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
// sharp runs on libuv's thread pool (4 threads by default): give this build-time server one thread per request.
const server = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    UV_THREADPOOL_SIZE: String(Math.max(concurrency, 4)),
  },
  stdio: ["ignore", "inherit", "inherit"],
});
const exited = new Promise((resolve) => server.once("exit", resolve));
const failures = [];
const outcome = { MISS: 0, HIT: 0, STALE: 0 };
let bytes = 0;
const started = Date.now();

try {
  await waitUntilReady(origin, server);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const { url, accept } = jobs[next++];
        try {
          const signal = AbortSignal.timeout(60_000);
          const response = await fetch(origin + url, { headers: { Accept: accept }, signal });
          const body = await response.arrayBuffer();
          const type = response.headers.get("content-type") ?? "";
          if (response.status === 200 && type !== accept) {
            // next/dist/server/image-optimizer.js answers with the original image when an encode fails, for
            // example when it takes longer than experimental.imgOptTimeoutInSeconds (7 s by default).
            failures.push(
              `${type || "(no content-type)"} for ${accept} ${url} (the optimiser fell back to the original image: ` +
                "an encode likely hit Next's 7 s imgOptTimeoutInSeconds; retry with a lower WARM_IMAGES_CONCURRENCY)",
            );
            continue;
          }
          if (response.status !== 200) {
            failures.push(`${response.status} ${type || "(no content-type)"} for ${accept} ${url}`);
            continue;
          }
          bytes += body.byteLength;
          const cache = response.headers.get("x-nextjs-cache") ?? "";
          if (cache in outcome) outcome[cache]++;
        } catch (error) {
          failures.push(`${error.name}: ${error.message} for ${accept} ${url}`);
        }
      }
    }),
  );
} catch (error) {
  failures.push(error.message);
} finally {
  server.kill("SIGTERM");
  await exited;
}

if (failures.length > 0) {
  fail(`${failures.length} failed while warming ${jobs.length} image requests:\n  ${failures.join("\n  ")}`);
}

// One cache entry (a directory) per URL and format. Fewer means the server could not write some of them.
const entries = (await readdir(cacheDir).catch(() => [])).length;
if (entries < jobs.length) {
  fail(`${entries} entries in ${cacheDir}, expected at least ${jobs.length}; check the server log above`);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const megabytes = (bytes / 1024 / 1024).toFixed(1);
console.log(
  `warm-images: ${urls.length} image URLs from ${files.length} pages, ${jobs.length} requests (${formats.join(", ")}, ` +
    `${concurrency} at a time) in ${seconds} s: ${outcome.MISS} encoded, ${outcome.HIT + outcome.STALE} already ` +
    `cached, ${megabytes} MB. ${entries} entries in .next/standalone/.next/cache/images.`,
);
