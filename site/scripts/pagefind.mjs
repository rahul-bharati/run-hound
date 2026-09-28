/**
 * Runs in `pnpm build` before check-budgets: the site's search index, built with Pagefind 1.5.2's Node API from the
 * prerendered pages the route registry marks searchable (every indexable page but the legal ones; never /_design/ or
 * the 404). Each page is added at its route (docs.html is /docs/, as check-seo maps it), with its result group (Docs,
 * Check, FAQ or Page, from the registry) as the "group" meta and filter. Pages mark what to index themselves:
 * data-pagefind-body on <main>, data-pagefind-ignore on repeated parts.
 *
 * It writes public/pagefind/ (git-ignored; the Dockerfile copies public/ next to the server), or, for a build in
 * another folder (NEXT_DIST_DIR), <that folder>/pagefind/, which the lab serves at /pagefind/, so builds side by side
 * don't write over each other's index. The old index is removed first.
 *
 * It fails unless the index holds exactly the registry's searchable routes: a searchable page that wasn't prerendered
 * or has no words to index fails the build.
 *
 * Usage: node scripts/pagefind.mjs [--dir <pages>] [--manifest <json>] [--out <dir>]
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import * as pagefind from "pagefind";
import { appDir, distDir, distName, fileOf, siteDir } from "./lib/build-output.mjs";
import { loadRegistry, option } from "./lib/registry.mjs";

const args = process.argv.slice(2);
const dir = resolve(option(args, "dir") ?? appDir);
const out = resolve(option(args, "out") ?? (distName === ".next" ? join(siteDir, "public", "pagefind") : join(distDir, "pagefind")));
const errors = [];

const { routes } = await loadRegistry(option(args, "manifest"));
const searchable = routes.filter((r) => r.indexable && r.search);
if (searchable.length === 0) {
  console.error("pagefind: no searchable routes in the registry (content/routes.ts `search`)");
  process.exit(1);
}

const { index, errors: createErrors } = await pagefind.createIndex({ forceLanguage: "en" });
if (!index) {
  console.error(`pagefind: could not start Pagefind: ${createErrors.join("; ")}`);
  process.exit(1);
}

const indexed = [];
try {
  for (const route of searchable) {
    const file = join(dir, fileOf(route.path));
    if (!existsSync(file)) {
      errors.push(`${route.path} (${route.id}) is searchable in the registry, but ${fileOf(route.path)} was not prerendered`);
      continue;
    }
    // The result's group, from the registry: a meta the dialog shows and a filter it can narrow by.
    const html = (await readFile(file, "utf8")).replace(
      /<body\b/i,
      `<body data-pagefind-meta="group:${route.search}" data-pagefind-filter="group:${route.search}"`,
    );
    const { errors: fileErrors, file: added } = await index.addHTMLFile({ url: route.path, content: html });
    if (fileErrors.length > 0) errors.push(`${route.path}: ${fileErrors.join("; ")}`);
    else if (added.url !== route.path) errors.push(`${route.path}: Pagefind indexed it as ${added.url}`);
    else indexed.push({ path: route.path, group: route.search });
  }

  // What the index really holds: one fragment per page (gzip, "pagefind_dcd" then JSON with the page's url). A page
  // with nothing in its body is left out, whatever addHTMLFile answered.
  const { files, errors: fileErrors } = await index.getFiles();
  if (fileErrors.length > 0) errors.push(`reading the index: ${fileErrors.join("; ")}`);
  const urls = new Set(
    files
      .filter((f) => f.path.startsWith("fragment/"))
      .map((f) => JSON.parse(gunzipSync(Buffer.from(f.content)).toString("utf8").replace(/^pagefind_dcd/, "")).url),
  );
  for (const page of indexed) if (!urls.has(page.path)) errors.push(`${page.path}: indexed with no words (Pagefind left it out)`);
  for (const url of urls) if (!searchable.some((r) => r.path === url)) errors.push(`${url} is in the index but not searchable in the registry`);

  if (errors.length === 0) {
    rmSync(out, { recursive: true, force: true });
    const { errors: writeErrors } = await index.writeFiles({ outputPath: out });
    if (writeErrors.length > 0) errors.push(`writing ${out}: ${writeErrors.join("; ")}`);
    else {
      const entry = JSON.parse(readFileSync(join(out, "pagefind-entry.json"), "utf8"));
      const pages = Object.values(entry.languages ?? {}).reduce((sum, language) => sum + language.page_count, 0);
      if (pages !== searchable.length) {
        errors.push(`the index holds ${pages} pages, the registry has ${searchable.length} searchable routes`);
      }
    }
  }
} finally {
  await pagefind.close();
}

for (const error of errors) console.error(`pagefind: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(
  `pagefind: indexed ${indexed.length} pages (the registry's ${searchable.length} searchable routes) into ${relative(siteDir, out) || out}: ` +
    indexed.map((p) => `${p.path} (${p.group})`).join(", "),
);
