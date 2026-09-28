/**
 * Runs after scripts/csp.mjs (package.json "build"): checks what search engines and AI answer engines read in every
 * prerendered page, and fails the build when a page would ship without it. Every page is prerendered, so these files
 * are exactly what visitors and crawlers get.
 *
 * For each .html under .next/server/app (or the NEXT_DIST_DIR build folder's), except Next.js's own pages (_not-found,
 * _global-error), the build fails when an internal route (a path segment starting with "_", such as /_design/) isn't
 * noindex; and for each page not marked noindex, when:
 * - a page marked noindex is listed in sitemap.xml, or (when sitemap.xml exists) an indexable page isn't listed in it
 *   or it lists a page that wasn't prerendered;
 * - the page has no <title> or meta description, or has other than one h1, or another heading comes before the h1
 *   (a closed dialog's h2 in the header counts: the h1 must be the first heading a screen reader or crawler meets);
 * - the page shows a breadcrumb (nav aria-label="Breadcrumb"; aria-hidden separators are no part of a name) whose
 *   names or links differ from its BreadcrumbList, or has none;
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
 * Usage: node scripts/check-seo.mjs [--strict] [dir]   (dir: .next/server/app, or NEXT_DIST_DIR's, by default)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
// The file-to-route mapping and the HTML helpers every build guard, pagefind and the lab share.
import { appDir, decode, htmlFiles, isFrameworkPage, routeOf, tags, visibleBreadcrumb } from "./lib/build-output.mjs";

const site = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dir = resolve(site, args.find((arg) => !arg.startsWith("--")) ?? appDir);
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
  // Next.js's own pages (the 404 and the error page) need no canonical and are never indexed.
  if (isFrameworkPage(name)) continue;
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
  const noindex = robots.some((content) => /\bnoindex\b/i.test(content));
  // An internal route (a path segment starting with "_": /_design/ lives in app/%5Fdesign) is for reviewing the site,
  // never for search: it must be noindex, and it stays out of the sitemap check.
  if (route.split("/").some((segment) => segment.startsWith("_")) && !noindex) {
    fail(`${route} is an internal route and must be noindex`);
    continue;
  }
  if (noindex) {
    if (sitemapPaths.has(route)) fail(`is noindex but sitemap.xml lists ${route}`);
    continue;
  }
  pages += 1;
  indexable.add(route);

  const title = decode(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "").trim();
  if (!title) fail("no <title>");
  else if (title.length > 60) warn(`title is ${title.length} characters (at most 60)`);
  // Outside scripts, so text in the RSC payload can't count.
  const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  const h1s = withoutScripts.match(/<h1\b/gi)?.length ?? 0;
  if (h1s !== 1) fail(`${h1s} h1 elements, not 1`);
  const firstHeading = withoutScripts.match(/<h([1-6])\b/i)?.[1];
  if (h1s > 0 && firstHeading !== "1") fail(`the first heading is an h${firstHeading}, not the h1`);
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
  let breadcrumbList;
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
      if (types.includes("BreadcrumbList")) breadcrumbList = node;
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
  const visible = visibleBreadcrumb(withoutScripts);
  if (visible && !breadcrumbList) fail("a visible breadcrumb but no BreadcrumbList");
  else if (visible) {
    const items = [breadcrumbList.itemListElement].flat();
    const names = items.map((item) => item?.name);
    if (JSON.stringify(visible.map((crumb) => crumb.name)) !== JSON.stringify(names)) {
      fail(`the visible breadcrumb ${JSON.stringify(visible.map((crumb) => crumb.name))} is not the BreadcrumbList ${JSON.stringify(names)}`);
    } else {
      visible.forEach((crumb, i) => {
        const item = items[i]?.item;
        const value = item && typeof item === "object" ? (item["@id"] ?? item.url) : item;
        let path;
        try {
          path = new URL(value).pathname;
        } catch {
          path = String(value);
        }
        if (crumb.href && crumb.href !== path) fail(`the visible breadcrumb's "${crumb.name}" links ${crumb.href}, the BreadcrumbList ${path}`);
      });
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
