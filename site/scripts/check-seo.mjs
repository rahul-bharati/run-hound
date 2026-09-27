/**
 * Runs after scripts/csp.mjs (package.json "build"): checks what search engines and AI answer engines read in every
 * prerendered page, and fails the build when a page would ship without it. Every page is prerendered, so these files
 * are exactly what visitors and crawlers get.
 *
 * For each .html under .next/server/app, except Next.js's own pages (_not-found, _global-error) and pages marked
 * noindex, the build fails when:
 * - a page marked noindex is listed in sitemap.xml, or (when sitemap.xml exists) an indexable page isn't listed in it
 *   or it lists a page that wasn't prerendered;
 * - the page has no <title> or meta description, or has other than one h1;
 * - its canonical link is missing, isn't an absolute http(s) URL ending in "/", isn't the page's own route, or (when
 *   NEXT_PUBLIC_SITE_URL is set, as in the Docker build) isn't on that address;
 * - a JSON-LD block (<script type="application/ld+json">, components/json-ld.tsx) doesn't parse, lacks "@context" or
 *   names another context than https://schema.org, contains a raw "<" (JsonLd escapes it), has an @id that isn't an
 *   absolute URL on the canonical's origin, has a WebPage (or AboutPage, FAQPage, CollectionPage) whose url isn't the
 *   canonical, a WebSite whose url isn't the home page, a BreadcrumbList whose last item isn't the canonical, an
 *   FAQPage anywhere but /faq/ (the only page with visible questions and answers), or a rating or review (the site has
 *   none);
 * - the page has no JSON-LD or more than one block (components/json-ld.tsx renders one graph per page), or its JSON-LD
 *   has other than one WebPage node (WebPage, AboutPage, FAQPage or CollectionPage);
 * - a page refers to an @id that no page defines (lib/structured-data.ts defines the site, maintainer and app on the
 *   home page, and every page defines its own WebPage), so losing the home page's SoftwareApplication fails the build.
 *
 * It warns, and with --strict fails, when a title is longer than 60 characters, and when a meta description is longer
 * than 160 characters (search results cut it) or shorter than 70 (too thin to be shown rather than replaced by text
 * from the page).
 *
 * Usage: node scripts/check-seo.mjs [--strict] [dir]   (dir: .next/server/app by default)
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const site = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dir = resolve(site, args.find((arg) => !arg.startsWith("--")) ?? ".next/server/app");
// `||`, as in lib/site.ts: Docker passes an unset build arg as an empty string.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

/** schema.org WebPage and the page types lib/structured-data.ts uses: their url must be the canonical. */
const pageTypes = new Set(["WebPage", "AboutPage", "FAQPage", "CollectionPage"]);

/** The only context the site's JSON-LD uses (lib/structured-data.ts graph()). */
const schemaContext = /^https?:\/\/schema\.org\/?$/;

/** Ratings and reviews: the site has none, so no page may claim any. */
const ratingTypes = new Set(["AggregateRating", "Review", "Rating"]);

const errors = [];
const warnings = [];

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

/** The attributes of one start tag, names lower-cased and values decoded. */
function attributesOf(tag) {
  const attributes = {};
  const inside = tag.replace(/^<[a-z]+/i, "").replace(/\/?>$/, "");
  for (const [, name, double, single, bare] of inside.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    attributes[name.toLowerCase()] = decode(double ?? single ?? bare ?? "");
  }
  return attributes;
}

const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => attributesOf(tag));

async function* htmlFiles(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

/** The route a prerendered file serves, with the trailing slash: index.html is "/", docs.html "/docs/". */
function routeOf(name) {
  const segments = name
    .replace(/\.html$/, "")
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.at(-1) === "index") segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

const typesOf = (node) => [node["@type"]].flat().filter((type) => typeof type === "string");

/** Every object in a parsed JSON-LD value, depth first. */
function* objectsIn(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* objectsIn(item);
  } else if (value && typeof value === "object") {
    yield value;
    for (const item of Object.values(value)) yield* objectsIn(item);
  }
}

if (!existsSync(dir)) {
  console.error(`check-seo: ${relative(site, dir) || dir} is missing. Run this after next build (pnpm build does).`);
  process.exit(1);
}

/** The pages sitemap.xml lists (Next.js writes app/sitemap.ts's output as sitemap.xml.body), by path. */
const sitemapFile = join(dir, "sitemap.xml.body");
const sitemapPaths = new Set();
if (existsSync(sitemapFile)) {
  for (const [, loc] of (await readFile(sitemapFile, "utf8")).matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      sitemapPaths.add(new URL(decode(loc.trim())).pathname);
    } catch {
      errors.push(`sitemap.xml: <loc>${loc}</loc> is not an absolute URL`);
    }
  }
}

/** The @ids some page defines (a node with more than its @id), and each page's bare references ("page id"). */
const defined = new Set();
const referenced = new Set();
/** The routes of the indexable prerendered pages, to compare with sitemap.xml. */
const indexable = new Set();
let pages = 0;
let blocks = 0;

for await (const file of htmlFiles(dir)) {
  const name = relative(dir, file);
  // Next.js's own pages: their names start with "_", which the app directory never routes.
  if (name.split(sep).some((segment) => segment.startsWith("_"))) continue;
  const html = await readFile(file, "utf8");
  const fail = (message) => errors.push(`${name}: ${message}`);
  const warn = (message) => warnings.push(`${name}: ${message}`);

  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
  if (head === undefined) {
    fail("no <head>. Has Next.js changed how it prerenders pages?");
    continue;
  }
  const metas = tags(head, "meta");
  const robots = metas.filter((meta) => meta.name?.toLowerCase() === "robots").map((meta) => meta.content ?? "");
  const route = routeOf(name);
  if (robots.some((content) => /\bnoindex\b/i.test(content))) {
    if (sitemapPaths.has(route)) fail(`is noindex but sitemap.xml lists ${route}`);
    continue;
  }
  pages += 1;
  indexable.add(route);

  const title = decode(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "").trim();
  if (!title) fail("no <title>");
  else if (title.length > 60) warn(`title is ${title.length} characters (at most 60)`);
  // Outside scripts, so text in the RSC payload can't count.
  const h1s = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").match(/<h1\b/gi)?.length ?? 0;
  if (h1s !== 1) fail(`${h1s} h1 elements, not 1`);
  const description = metas.find((meta) => meta.name?.toLowerCase() === "description")?.content?.trim();
  if (!description) fail("no meta description");
  else if (description.length > 160) warn(`meta description is ${description.length} characters (at most about 155)`);
  else if (description.length < 70) warn(`meta description is ${description.length} characters (at least about 70)`);

  const canonicals = tags(head, "link")
    .filter((link) => (link.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .map((link) => link.href ?? "");
  let canonical;
  if (canonicals.length !== 1) {
    fail(`${canonicals.length} canonical links, not 1`);
  } else {
    canonical = canonicals[0];
    let url;
    try {
      url = new URL(canonical);
    } catch {
      url = undefined;
    }
    if (!url || !/^https?:$/.test(url.protocol) || !canonical.startsWith(`${url.protocol}//`)) {
      fail(`canonical "${canonical}" is not an absolute http(s) URL`);
      canonical = undefined;
    } else if (!canonical.endsWith("/")) {
      fail(`canonical "${canonical}" does not end with "/"`);
    } else if (url.pathname !== route || url.search || url.hash) {
      fail(`canonical "${canonical}" is not this page's route, ${route}`);
    } else if (siteUrl && url.origin !== new URL(siteUrl).origin) {
      fail(`canonical "${canonical}" is not on NEXT_PUBLIC_SITE_URL (${siteUrl})`);
    }
  }
  const origin = canonical ? new URL(canonical).origin : undefined;

  let pageBlocks = 0;
  let pageNodes = 0;
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']?application\/ld\+json/i.test(attributes)) continue;
    pageBlocks += 1;
    blocks += 1;
    const block = `JSON-LD block ${pageBlocks}`;
    if (body.includes("<")) fail(`${block} contains a raw "<"; escape it as \\u003c (components/json-ld.tsx)`);
    let data;
    try {
      data = JSON.parse(body);
    } catch (error) {
      fail(`${block} is not valid JSON: ${error.message}`);
      continue;
    }
    const tops = [data].flat();
    if (tops.length === 0 || tops.some((top) => !top || typeof top !== "object" || !top["@context"])) {
      fail(`${block} has no "@context"`);
    } else if (tops.some((top) => typeof top["@context"] !== "string" || !schemaContext.test(top["@context"]))) {
      fail(`${block}: "@context" is not https://schema.org`);
    }
    for (const node of objectsIn(data)) {
      const id = node["@id"];
      if (id !== undefined) {
        let idUrl;
        try {
          idUrl = typeof id === "string" ? new URL(id) : undefined;
        } catch {
          idUrl = undefined;
        }
        if (!idUrl || (origin && idUrl.origin !== origin)) {
          fail(`${block}: @id ${JSON.stringify(id)} is not an absolute URL on ${origin ?? "the site"}`);
        } else if (Object.keys(node).length === 1) {
          referenced.add(`${name} ${id}`);
        } else {
          defined.add(id);
        }
      }
      const types = typesOf(node);
      if (types.some((type) => pageTypes.has(type))) pageNodes += 1;
      if (canonical && types.some((type) => pageTypes.has(type)) && node.url !== canonical) {
        fail(`${block}: the ${types.join("/")} url ${JSON.stringify(node.url)} is not the canonical ${canonical}`);
      }
      if (origin && types.includes("WebSite") && node.url !== `${origin}/`) {
        fail(`${block}: the WebSite url ${JSON.stringify(node.url)} is not the home page ${origin}/`);
      }
      if (canonical && types.includes("BreadcrumbList")) {
        const last = [node.itemListElement].flat().at(-1)?.item;
        const lastUrl = last && typeof last === "object" ? (last["@id"] ?? last.url) : last;
        if (lastUrl !== canonical) {
          fail(`${block}: the breadcrumb's last item ${JSON.stringify(lastUrl)} is not the canonical ${canonical}`);
        }
      }
      if (types.includes("FAQPage") && route !== "/faq/") fail(`${block}: an FAQPage outside /faq/`);
      if ("aggregateRating" in node || "review" in node || types.some((type) => ratingTypes.has(type))) {
        fail(`${block}: a rating or review (the site has none; lib/structured-data.ts)`);
      }
    }
  }
  if (pageBlocks === 0) fail("no JSON-LD (lib/structured-data.ts, components/json-ld.tsx)");
  else if (pageBlocks > 1) fail(`${pageBlocks} JSON-LD blocks; render one graph per page`);
  if (pageBlocks > 0 && pageNodes !== 1) {
    fail(`${pageNodes} WebPage nodes (WebPage, AboutPage, FAQPage or CollectionPage), not 1`);
  }
}

for (const reference of referenced) {
  const [name, id] = reference.split(" ");
  if (!defined.has(id)) errors.push(`${name}: refers to ${id}, which no page defines`);
}
if (existsSync(sitemapFile)) {
  for (const route of indexable) {
    if (!sitemapPaths.has(route)) errors.push(`sitemap.xml doesn't list ${route} (app/sitemap.ts)`);
  }
  for (const path of sitemapPaths) {
    if (!indexable.has(path)) errors.push(`sitemap.xml lists ${path}, which is no indexable prerendered page`);
  }
}
if (pages === 0) errors.push(`no indexable prerendered pages in ${relative(site, dir) || dir}`);

for (const warning of warnings) console.warn(`check-seo: ${strict ? "" : "warning: "}${warning}`);
for (const error of errors) console.error(`check-seo: ${error}`);
console.log(
  `check-seo: ${pages} pages in ${relative(site, dir) || dir}, ${blocks} JSON-LD blocks, ` +
    `${errors.length} errors, ${warnings.length} warnings${strict ? " (strict)" : ""}`,
);
if (errors.length > 0 || (strict && warnings.length > 0)) process.exit(1);
