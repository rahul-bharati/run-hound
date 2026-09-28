/**
 * External links (DESIGN.md §5.2 "Links": checked weekly, non-blocking): every http(s) link on a built page that leaves
 * the site, and every link in llms.txt and llms-full.txt, answers with a 2xx or 3xx status. Internal links, #fragments
 * and redirect chains are check-registry.mjs's (pnpm build), and every github.com/…/blob/main/<path> link must name a
 * file in the repository (scripts/repo-links.test.mjs); this one asks the network, so it runs only when named:
 * pnpm lab external-links (and weekly in .github/workflows/site-links.yml, which reports without blocking anything).
 *
 * Each address is asked once (HEAD, then GET when a server refuses HEAD), 6 at a time, with a 20 s limit. The site's
 * own origin (NEXT_PUBLIC_SITE_URL, or the production address in content) is left out, since it is the build under
 * test. Results go to <lab out>/external-links.json.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appDir, htmlFilesSync, routeOf, tags, withoutScripts } from "../../lib/build-output.mjs";
import { origin } from "../lib/browser.mjs";
import { writeJson } from "../lib/out.mjs";

const base = origin();
const own = new Set(["run-hound.rahulbharati.com", "localhost", "127.0.0.1", new URL(base).hostname]);
/** Addresses that exist to be written to, not fetched: the security advisory form needs a signed-in GitHub user. */
const notFetched = [/^https:\/\/github\.com\/[^/]+\/[^/]+\/security\/advisories\/new$/];

function externalLinks() {
  const found = new Map();
  const add = (href, where) => {
    let url;
    try {
      url = new URL(href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || own.has(url.hostname)) return;
    url.hash = "";
    const key = url.href;
    if (!found.has(key)) found.set(key, new Set());
    found.get(key).add(where);
  };
  for (const file of htmlFilesSync(appDir)) {
    const html = withoutScripts(readFileSync(file, "utf8"));
    const where = routeOf(file.slice(appDir.length + 1));
    for (const a of tags(html, "a")) if (a.href) add(a.href, where);
  }
  return found;
}

async function status(url) {
  const ask = async (method) => {
    const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "run-hound-site-link-check" } });
    return response.status;
  };
  try {
    const head = await ask("HEAD");
    if (head === 405 || head === 403 || head === 404 || head >= 500) return await ask("GET");
    return head;
  } catch (error) {
    return String(error?.cause?.code ?? error?.name ?? error);
  }
}

test("every external link answers 2xx or 3xx", async () => {
  const links = externalLinks();
  for (const text of ["llms.txt", "llms-full.txt"]) {
    const body = await (await fetch(`${base}/${text}`)).text();
    for (const [, href] of body.matchAll(/\((https?:\/\/[^)\s]+)\)/g)) {
      const url = new URL(href);
      if (!own.has(url.hostname)) {
        url.hash = "";
        if (!links.has(url.href)) links.set(url.href, new Set());
        links.get(url.href).add(`/${text}`);
      }
    }
  }
  const urls = [...links.keys()].filter((u) => !notFetched.some((p) => p.test(u))).sort();
  const results = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        results[url] = { status: await status(url), on: [...links.get(url)].sort() };
      }
    }),
  );
  writeJson("external-links.json", { checked: urls.length, skipped: [...links.keys()].filter((u) => !urls.includes(u)), results });
  const broken = Object.entries(results)
    .filter(([, r]) => !(typeof r.status === "number" && r.status >= 200 && r.status < 400))
    .map(([url, r]) => `${url}: ${r.status} (on ${r.on.slice(0, 3).join(", ")}${r.on.length > 3 ? ", …" : ""})`);
  assert.ok(urls.length > 0, "no external links found: has the build moved?");
  assert.deepEqual(broken, []);
});
