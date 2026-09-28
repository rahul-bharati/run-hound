/**
 * Runs after check-seo (package.json "build"): checks the built site against the route registry (content/routes.ts,
 * through lib/nav.ts registryManifest()), and fails the build when:
 * - an indexable prerendered page is not in the registry, or an indexable registry page was not prerendered;
 * - an internal route (such as /_design/) is built without noindex, or a registry page is noindex;
 * - a page's <title> or meta description isn't the registry's, its page node (WebPage, AboutPage, FAQPage or
 *   CollectionPage) has another type or name, or has dateModified exactly when the registry doesn't date it;
 * - a page's BreadcrumbList, or its visible breadcrumb (nav aria-label="Breadcrumb"; aria-hidden separators are no
 *   part of a name), isn't the registry trail;
 * - an anchor the registry promises (route.anchors) is missing from its page;
 * - an internal link, on any page including the 404, points at no page or file, at no id on its page (#fragment),
 *   leaves out the trailing slash (a redirect on every click) or goes to a redirect; a redirect leads to another;
 * - a link to the site in llms.txt or llms-full.txt (an absolute URL on the site's own origin, from the home page's
 *   canonical link) does the same; a #fragment there that the page has but the registry doesn't promise is a note, so
 *   the id can be added to the route's anchors;
 * - an indexable page no other indexable page links to (an orphan: links from the 404, from internal routes such as
 *   /_design/ and from the llms files lead no reader or crawler through the site);
 * - a route's source file doesn't exist.
 *
 * Usage: node scripts/check-registry.mjs [--dist <build folder>] [--public <dir>] [--site <dir>] [--manifest <json>]
 * (the build folder is NEXT_DIST_DIR or .next; the registry comes from src/ unless --manifest names a JSON file).
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  decode,
  distDir as defaultDist,
  htmlFiles,
  jsonLdBlocks,
  routeOf,
  siteDir,
  tags,
  visibleBreadcrumb,
  withoutScripts,
} from "./lib/build-output.mjs";
import { loadRegistry, option } from "./lib/registry.mjs";

const args = process.argv.slice(2);
const dist = resolve(option(args, "dist") ?? defaultDist);
const publicDir = resolve(option(args, "public") ?? join(siteDir, "public"));
const sourceRoot = resolve(option(args, "site") ?? siteDir);
const appDir = join(dist, "server", "app");

if (!existsSync(appDir)) {
  console.error(`check-registry: ${relative(siteDir, appDir) || appDir} is missing. Run this after next build (pnpm build does).`);
  process.exit(1);
}

const { routes } = await loadRegistry(option(args, "manifest"));
const errors = [];
const pageTypes = new Set(["WebPage", "AboutPage", "FAQPage", "CollectionPage"]);
/** Next.js's own pages: the 404 (its links are checked) and the error page (skipped). */
const notFound = "_not-found.html";
const skipped = new Set(["_global-error.html"]);

/** The user redirects the build knows (Next.js's own trailing-slash rules are "internal"). */
const redirects = (() => {
  const file = join(dist, "routes-manifest.json");
  if (!existsSync(file)) return [];
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return (manifest.redirects ?? []).filter((r) => !r.internal).map((r) => ({ ...r, pattern: new RegExp(r.regex) }));
})();
const redirectOf = (path) => redirects.find((r) => r.pattern.test(path));

/** Every built page: its file name, route, markup without scripts, ids, links and whether it is noindex. */
const pages = new Map();
for await (const file of htmlFiles(appDir)) {
  const name = relative(appDir, file);
  if (skipped.has(name)) continue;
  const html = await readFile(file, "utf8");
  const clean = withoutScripts(html);
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const robots = tags(head, "meta").filter((m) => m.name?.toLowerCase() === "robots").map((m) => m.content ?? "");
  const route = name === notFound ? "404" : routeOf(name);
  pages.set(route, {
    name,
    html,
    head,
    clean,
    noindex: robots.some((content) => /\bnoindex\b/i.test(content)),
    ids: new Set([...clean.matchAll(/\sid="([^"]*)"/g)].map((m) => decode(m[1]))),
    links: tags(clean, "a").map((a) => a.href).filter((href) => href !== undefined),
  });
}

const byPath = new Map(routes.map((r) => [r.path, r]));

/** Whether a URL path names a file the site serves (metadata routes, public/, static media), not a page. */
function fileExists(path) {
  if (path.startsWith("/_next/static/")) return existsSync(join(dist, "static", decodeURIComponent(path.slice("/_next/static/".length))));
  const rel = decodeURIComponent(path.slice(1));
  return existsSync(join(appDir, `${rel}.body`)) || existsSync(join(publicDir, rel));
}

/** Checks one link on a page; returns the page path it points at (for the orphan check), or undefined. */
function checkLink(page, from, href) {
  if (/^(mailto:|tel:|javascript:|https?:|\/\/)/i.test(href) || href === "") return undefined;
  return checkUrl(page, href, new URL(href, `https://site.invalid${from === "404" ? "/" : from}`));
}

/** Checks a link to the site, already resolved to a URL; `href` is how the page wrote it (for the message). */
function checkUrl(page, href, url) {
  const path = decodeURIComponent(url.pathname);
  const fragment = decodeURIComponent(url.hash.slice(1));
  const fail = (message) => errors.push(`${page.name}: link ${href} ${message}`);
  const redirect = redirectOf(path);
  if (redirect) {
    fail(`redirects (${redirect.statusCode ?? 308} to ${redirect.destination}); link the final URL`);
    return undefined;
  }
  const last = path.split("/").at(-1);
  if (last.includes(".")) {
    if (!fileExists(path)) fail("points at no page or file");
    return undefined;
  }
  if (!path.endsWith("/")) {
    if (pages.has(`${path}/`)) fail(`redirects to ${path}/; link the page's own URL`);
    else fail("points at no page");
    return undefined;
  }
  const target = pages.get(path);
  if (!target) {
    fail("points at no page");
    return undefined;
  }
  if (fragment && !target.ids.has(fragment)) errors.push(`${page.name}: link ${href}: no id="${fragment}" on ${path}`);
  return path;
}

const typeOf = (node) => [node["@type"]].flat()[0];
const pathOf = (item) => {
  const value = item && typeof item === "object" ? (item["@id"] ?? item.url) : item;
  try {
    return new URL(value).pathname;
  } catch {
    return String(value);
  }
};

let links = 0;
let promised = 0;
const linkedFrom = new Map();
const notes = [];

for (const [path, page] of pages) {
  // Links first: every page, the 404 included. Only an indexable page's links make a page reachable.
  for (const href of page.links) {
    const target = checkLink(page, path, href);
    if (href.startsWith("/") || href.startsWith("#")) links += 1;
    if (target && target !== path && path !== "404" && !page.noindex) linkedFrom.set(target, (linkedFrom.get(target) ?? 0) + 1);
  }
  if (path === "404") continue;

  const route = byPath.get(path);
  const fail = (message) => errors.push(`${page.name}: ${message}`);
  if (!route) {
    if (!page.noindex) fail(`${path} is prerendered but not in the registry (content/routes.ts)`);
    else fail(`${path} is prerendered (noindex) but not in the registry; register it as an internal route`);
    continue;
  }
  if (!route.indexable) {
    if (!page.noindex) fail(`${path} is an internal route (${route.id}) and must be noindex`);
    continue;
  }
  if (page.noindex) fail(`${path} is noindex, but the registry lists it as an indexable page`);

  const title = decode(page.head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "").trim();
  if (title !== route.title) fail(`title ${JSON.stringify(title)} is not the registry's ${JSON.stringify(route.title)}`);
  const description = tags(page.head, "meta").find((m) => m.name?.toLowerCase() === "description")?.content?.trim();
  if (description !== route.description) fail(`meta description is not the registry's: ${JSON.stringify(description)}`);

  const nodes = jsonLdBlocks(page.html).flatMap((block) => [block].flat().flatMap((top) => top?.["@graph"] ?? [top]));
  const pageNode = nodes.find((node) => node && pageTypes.has(typeOf(node)));
  if (pageNode) {
    if (typeOf(pageNode) !== route.webPage.type) fail(`the page node is a ${typeOf(pageNode)}, the registry says ${route.webPage.type}`);
    if (pageNode.name !== route.webPage.name) fail(`the page node's name ${JSON.stringify(pageNode.name)} is not the registry's ${JSON.stringify(route.webPage.name)}`);
    if (route.webPage.dated && !pageNode.dateModified) fail("the page node has no dateModified, the registry dates this page");
    if (!route.webPage.dated && pageNode.dateModified) fail("the page node has a dateModified, but the registry doesn't date this page");
  }

  const trail = route.trail.map((crumb) => [crumb.name, crumb.path]);
  const list = nodes.find((node) => node && typeOf(node) === "BreadcrumbList");
  if (path !== "/") {
    if (!list) fail(`no BreadcrumbList; the registry trail is ${route.trail.map((c) => c.name).join(" > ")}`);
    else {
      const got = [list.itemListElement].flat().map((item) => [item.name, pathOf(item.item)]);
      if (JSON.stringify(got) !== JSON.stringify(trail)) {
        fail(`BreadcrumbList ${JSON.stringify(got)} is not the registry trail ${JSON.stringify(trail)}`);
      }
    }
  }
  const visible = visibleBreadcrumb(page.clean);
  if (visible) {
    const names = visible.map((item) => item.name);
    const want = route.trail.map((crumb) => crumb.name);
    if (JSON.stringify(names) !== JSON.stringify(want)) {
      fail(`the visible breadcrumb ${JSON.stringify(names)} is not the registry trail ${JSON.stringify(want)}`);
    } else {
      visible.forEach((item, i) => {
        if (item.href && item.href !== route.trail[i].path) {
          fail(`the visible breadcrumb's ${JSON.stringify(item.name)} links ${item.href}, the registry trail ${route.trail[i].path}`);
        }
      });
    }
  }

  for (const anchor of route.anchors) {
    promised += 1;
    if (!page.ids.has(anchor)) fail(`anchor #${anchor} (promised in the registry) is missing`);
  }
}

// The llms files: their links to the site are absolute URLs on the site's origin, which the home page's canonical link
// (or its page node's url) gives.
const siteOrigin = (() => {
  const home = pages.get("/");
  if (!home) return undefined;
  const canonical = tags(home.head, "link").find((l) => l.rel?.toLowerCase() === "canonical")?.href;
  const node = jsonLdBlocks(home.html)
    .flatMap((block) => [block].flat().flatMap((top) => top?.["@graph"] ?? [top]))
    .find((n) => n && pageTypes.has(typeOf(n)));
  try {
    return new URL(canonical ?? node?.url).origin;
  } catch {
    return undefined;
  }
})();
let llmsLinks = 0;
for (const name of ["llms.txt", "llms-full.txt"]) {
  const file = join(appDir, `${name}.body`);
  if (!existsSync(file) || !siteOrigin) continue;
  const text = readFileSync(file, "utf8");
  for (const [raw] of text.matchAll(/https?:\/\/[^\s)<>"'`\]]+/g)) {
    const href = raw.replace(/[.,;:!?]+$/, "");
    let url;
    try {
      url = new URL(href);
    } catch {
      continue; // not a URL after all ("http://" in a sentence)
    }
    if (url.origin !== siteOrigin) continue;
    llmsLinks += 1;
    const target = checkUrl({ name }, href, url);
    const fragment = decodeURIComponent(url.hash.slice(1));
    const route = target && byPath.get(target);
    if (fragment && route && pages.get(target)?.ids.has(fragment) && !route.anchors.includes(fragment)) {
      notes.push(`${name} links ${target}#${fragment}, which the registry doesn't promise (content/routes: anchors)`);
    }
  }
}

let internalNotBuilt = 0;
for (const route of routes) {
  const built = pages.has(route.path);
  if (!built) {
    if (route.indexable) errors.push(`${route.path} (${route.id}): in the registry but not prerendered`);
    else internalNotBuilt += 1;
  }
  if ((route.indexable || built) && !existsSync(join(sourceRoot, route.source))) {
    errors.push(`${route.path} (${route.id}): source ${route.source} does not exist`);
  }
  if (route.indexable && built && route.path !== "/" && !linkedFrom.get(route.path)) {
    errors.push(`${route.path} (${route.id}): no other page links to it (an orphan)`);
  }
}

for (const redirect of redirects) {
  const next = redirectOf(redirect.destination);
  if (next) errors.push(`redirect ${redirect.source} → ${redirect.destination} leads to another redirect (a chain)`);
}

const indexablePages = [...pages.keys()].filter((path) => path !== "404" && byPath.get(path)?.indexable).length;
for (const note of [...new Set(notes)]) console.log(`check-registry: note: ${note}`);
for (const error of errors) console.error(`check-registry: ${error}`);
console.log(
  `check-registry: ${indexablePages} pages, ${routes.length} registry routes (${internalNotBuilt} internal, not built), ` +
    `${links} internal links, ${llmsLinks} links in llms files, ${promised} promised anchors, ${errors.length} errors`,
);
if (errors.length > 0) process.exit(1);
