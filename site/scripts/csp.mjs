/**
 * Runs after `next build` (package.json "build"): gives every prerendered page a Content-Security-Policy that allows
 * its own inline scripts by their SHA-256 hashes, and no other inline script.
 *
 * Every page on the site is prerendered, and Next.js puts each page's data in inline <script> elements. Allowing them
 * with 'unsafe-inline' would allow any inline script (Run Hound's own security-headers check reports that), and nonces
 * would make every page render on each request. Hashes keep the pages static: they are computed here from the HTML
 * the build wrote, and the policy goes in the page's .meta file next to it, whose headers the Next.js server sends with
 * the page (in .next/ for `next start`, and in the standalone copy the Dockerfile ships).
 *
 * The build fails when a page has no .meta file or no inline script: that would mean Next.js changed how it
 * prerenders pages, and this script needs a look. Anything that rewrites the HTML after the build (Cloudflare's
 * Rocket Loader, for example) must stay off, or the scripts no longer match their hashes and the browser blocks them.
 *
 * Google Analytics loads only after consent, as an external script (components/consent); Cloudflare Web Analytics is
 * injected at the edge as an external script too. Neither needs an inline script.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const site = join(import.meta.dirname, "..");
const outputs = [".next/server/app", ".next/standalone/.next/server/app"];

/** The page's policy, with its own inline scripts allowed by hash. */
function policy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")} https://www.googletagmanager.com https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://www.googletagmanager.com https://*.google-analytics.com",
    "font-src 'self'",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 'sha256-…' for each distinct inline script (a <script> without src) in the page, in page order. */
function inlineScriptHashes(html) {
  const hashes = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
    if (!hashes.includes(hash)) hashes.push(hash);
  }
  return hashes;
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

let failed = false;
for (const output of outputs) {
  const dir = join(site, output);
  if (!existsSync(dir)) {
    if (output === outputs[0]) {
      console.error(`csp: ${output} is missing. Run this after next build (pnpm build does).`);
      process.exit(1);
    }
    continue;
  }
  let pages = 0;
  let scripts = 0;
  for await (const html of htmlFiles(dir)) {
    const name = relative(dir, html);
    const metaFile = html.replace(/\.html$/, ".meta");
    if (!existsSync(metaFile)) {
      console.error(`csp: ${output}/${name} has no .meta file, so its policy can't be set.`);
      failed = true;
      continue;
    }
    const hashes = inlineScriptHashes(await readFile(html, "utf8"));
    if (hashes.length === 0) {
      console.error(`csp: ${output}/${name} has no inline script. Has Next.js changed how it prerenders pages?`);
      failed = true;
      continue;
    }
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    meta.headers = { ...meta.headers, "content-security-policy": policy(hashes) };
    await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    pages += 1;
    scripts += hashes.length;
  }
  if (pages === 0) {
    console.error(`csp: no prerendered pages in ${output}.`);
    failed = true;
  }
  console.log(`csp: ${pages} pages in ${output}, ${scripts} inline scripts allowed by hash`);
}
if (failed) process.exit(1);
