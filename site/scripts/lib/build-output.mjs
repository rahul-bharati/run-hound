/**
 * Where a build of the site lives, and how its prerendered pages map to routes: shared by the build guards
 * (csp, check-seo, check-registry, check-copy, check-budgets, pagefind), the lab and warm-images. It also keeps the one
 * copy of the helpers they and the source tests share: the HTML files of a build, the source files of src/, and a
 * page's visible breadcrumb.
 *
 * The build folder is .next, or NEXT_DIST_DIR when it is set (next.config.ts reads the same variable), so several
 * builds of one checkout can sit side by side: NEXT_DIST_DIR=.next-lab pnpm build, then NEXT_DIST_DIR=.next-lab
 * pnpm lab. The standalone server keeps the same folder name inside .next-lab/standalone/. Such a build type-checks
 * with tsconfig.next-lab.json, which next.config.ts writes: tsconfig.json plus that folder's route types, so it fails
 * on every type error the default build fails on (scripts/dist-dir.test.mjs).
 *
 * Node built-ins only.
 */
import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/** The site's folder (site/). */
export const siteDir = resolve(import.meta.dirname, "../..");

/** The build folder's name, relative to the site: ".next" unless NEXT_DIST_DIR names another. */
export const distName = process.env.NEXT_DIST_DIR || ".next";

/** The build folder. */
export const distDir = resolve(siteDir, distName);

/** The prerendered pages (.html, .meta, .rsc) of the build. */
export const appDir = join(distDir, "server", "app");

/** The standalone server (server.js), and its own copy of the prerendered pages. */
export const standaloneDir = join(distDir, "standalone");
export const standaloneAppDir = join(standaloneDir, distName, "server", "app");

/** The route a prerendered file serves, with the trailing slash: index.html is "/", docs.html "/docs/". */
export function routeOf(name) {
  const segments = name
    .replace(/\.html$/, "")
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.at(-1) === "index") segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

/**
 * The file a route is prerendered to, relative to the pages folder: "/" is index.html, "/docs/" docs.html. A page in
 * a route group, such as app/(legal)/privacy, is written without the group (Next.js drops it).
 */
export function fileOf(route) {
  return route === "/" ? "index.html" : `${route.replace(/^\/|\/$/g, "")}.html`;
}

/** Every .html file under a folder, depth first; .segments folders hold no pages. */
export async function* htmlFiles(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".segments")) yield* htmlFiles(path);
    } else if (entry.name.endsWith(".html")) yield path;
  }
}

/** htmlFiles(), synchronously. */
export function* htmlFilesSync(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".segments")) yield* htmlFilesSync(path);
    } else if (entry.name.endsWith(".html")) yield path;
  }
}

/**
 * Next.js's own pages, by their file name in the pages folder: the 404 and the error page. An internal route of the
 * site (such as /_design/, prerendered as _design.html) is not one of them.
 */
export const isFrameworkPage = (name) => ["_not-found.html", "_global-error.html"].includes(name);

/**
 * The source files under a folder with these extensions (ts and tsx by default), tests (*.test.ts, .tsx) left out.
 * @param {string} folder
 * @param {string[]} [extensions]
 * @returns {string[]}
 */
export function sourceFiles(folder, extensions = ["ts", "tsx"]) {
  const wanted = new RegExp(`\\.(${extensions.join("|")})$`);
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extensions);
    return wanted.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML character references decoded: "&amp;" is "&", "&#x27;" is "'". */
export function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

/** The attributes of one start tag, names lower-cased and values decoded. */
export function attributesOf(tag) {
  const attributes = {};
  const inside = tag.replace(/^<[a-z][a-z0-9-]*/i, "").replace(/\/?>$/, "");
  for (const [, name, double, single, bare] of inside.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    attributes[name.toLowerCase()] = decode(double ?? single ?? bare ?? "");
  }
  return attributes;
}

/** The attributes of every start tag with this name. */
export const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => attributesOf(tag));

/** The page without its scripts (inline code and the RSC payload), keeping JSON-LD data blocks. */
export const withoutScripts = (html) =>
  html.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script\s*>/gi, "");

/** The <main> element's markup, or "" when the page has none. */
export function mainOf(html) {
  const start = html.search(/<main\b/i);
  if (start < 0) return "";
  const end = html.lastIndexOf("</main>");
  return end < start ? html.slice(start) : html.slice(start, end + "</main>".length);
}

/**
 * The page's visible breadcrumb (nav aria-label="Breadcrumb", one <li> per item): each item's name and the href of its
 * link (undefined for the current page). What screen readers skip is no part of a name: an aria-hidden separator, such
 * as the "/" the approved design puts in each item after the first.
 */
export function visibleBreadcrumb(html) {
  const nav = html.match(/<nav\b[^>]*aria-label="Breadcrumb"[^>]*>([\s\S]*?)<\/nav\s*>/i)?.[1];
  if (nav === undefined) return undefined;
  return [...nav.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map(([, item]) => {
    const shown = item.replace(/<([a-z][a-z0-9-]*)\b[^>]*\baria-hidden\s*=\s*["']?true["']?[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
    return {
      name: decode(shown.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      href: tags(shown, "a")[0]?.href,
    };
  });
}

/** The parsed JSON-LD blocks of a page (unparsable blocks are skipped; check-seo reports them). */
export function jsonLdBlocks(html) {
  const blocks = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']?application\/ld\+json/i.test(attributes)) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // check-seo fails the build on it.
    }
  }
  return blocks;
}
