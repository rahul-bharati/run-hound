/**
 * What a reader and a crawler get from each prerendered page, as one JSON file: the title, meta description, canonical,
 * robots, the text of <body> (outside scripts, styles and templates, whitespace collapsed) and the parsed JSON-LD. Two
 * of these files show whether a refactor changed what a page says, which "no visible change" steps must prove.
 *
 *   node scripts/lab/page-text.mjs --write <file>     record the build's pages
 *   node scripts/lab/page-text.mjs --compare <file>   compare the build with a recording; exit 1 on any difference
 *
 * Reads the build in NEXT_DIST_DIR (or .next). Node built-ins only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import {
  appDir,
  decode,
  distName,
  htmlFiles,
  isFrameworkPage,
  jsonLdBlocks,
  routeOf,
  tags,
} from "../lib/build-output.mjs";

/** The text of <body>: every text node outside script, style, template and noscript, whitespace collapsed. */
export function bodyText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i)?.[1] ?? html;
  return decode(
    body
      .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** One page as the snapshot keeps it. */
export function snapshotOf(html) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const metas = tags(head, "meta");
  const meta = (name) => metas.find((m) => m.name?.toLowerCase() === name)?.content ?? null;
  return {
    title: decode(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "").trim(),
    description: meta("description"),
    robots: meta("robots"),
    canonical: tags(head, "link").find((l) => (l.rel ?? "").toLowerCase() === "canonical")?.href ?? null,
    text: bodyText(html),
    jsonLd: jsonLdBlocks(html),
  };
}

/** Every prerendered page of the build (Next.js's own pages left out), by route. */
export async function snapshotBuild(dir = appDir) {
  const pages = {};
  for await (const file of htmlFiles(dir)) {
    const name = relative(dir, file);
    if (isFrameworkPage(name)) continue;
    pages[routeOf(name)] = snapshotOf(await readFile(file, "utf8"));
  }
  return Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)));
}

/** The differences between two snapshots, one line each. */
export function compareSnapshots(before, after) {
  const lines = [];
  for (const route of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[route];
    const b = after[route];
    if (!a) lines.push(`${route}: new page`);
    else if (!b) lines.push(`${route}: missing`);
    else {
      for (const key of ["title", "description", "robots", "canonical"]) {
        if (a[key] !== b[key]) lines.push(`${route}: ${key} ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
      }
      if (a.text !== b.text) {
        let i = 0;
        while (i < a.text.length && a.text[i] === b.text[i]) i += 1;
        lines.push(`${route}: text differs at ${i}: …${a.text.slice(Math.max(0, i - 40), i + 60)}… → …${b.text.slice(Math.max(0, i - 40), i + 60)}…`);
      }
      if (JSON.stringify(a.jsonLd) !== JSON.stringify(b.jsonLd)) lines.push(`${route}: JSON-LD differs`);
    }
  }
  return lines;
}

if (import.meta.main) {
  const [flag, file] = process.argv.slice(2);
  if (!["--write", "--compare"].includes(flag) || !file) {
    console.error("usage: node scripts/lab/page-text.mjs --write|--compare <file>");
    process.exit(2);
  }
  if (!existsSync(appDir)) {
    console.error(`page-text: ${distName}/server/app is missing; build first (NEXT_DIST_DIR=${distName} pnpm build).`);
    process.exit(1);
  }
  const now = await snapshotBuild();
  if (flag === "--write") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(now, null, 1)}\n`);
    console.log(`page-text: ${Object.keys(now).length} pages from ${distName} written to ${file}`);
  } else {
    const lines = compareSnapshots(JSON.parse(readFileSync(file, "utf8")), now);
    for (const line of lines) console.error(`page-text: ${line}`);
    console.log(`page-text: ${Object.keys(now).length} pages from ${distName} against ${file}: ${lines.length} differences`);
    if (lines.length > 0) process.exit(1);
  }
}
