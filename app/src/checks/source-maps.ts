/**
 * source-maps (V1): for every script the page loads from its own origin, look for a source map (the SourceMap header,
 * a sourceMappingURL comment, else "<script>.map") and download it from inside the page, following no redirects.
 * Fails when a map is public: medium when it carries the original source code (sourcesContent), low when it only
 * lists the source files. Inline (data:) maps count too. Dev servers always serve maps, so on a dev server the
 * scenario is skipped with the reason.
 */
import type { Page } from "playwright";
import type { Check } from "../core/types.js";
import { checkResult, clip, FindingList, guarded, listOf, playwrightSpec, plural, scenarioFor } from "./lib/a11y-common.js";
import { looksLikeDevServer } from "./lib/http-checks.js";

const ID = "source-maps" as const;
const MAX_SCRIPTS = 15;

export interface ExposedMap {
  script: string;
  map: string;
  foundBy: "header" | "comment" | "guessed" | "inline";
  sources: string[];
  withContent: boolean;
}

/** The sourceMappingURL at the end of a script, if any. */
export function sourceMappingUrl(scriptText: string): string | null {
  const tail = scriptText.slice(-4000);
  const m = /\/[/*][#@]\s*sourceMappingURL=([^\s*'"]+)/g;
  let last: string | null = null;
  for (let hit = m.exec(tail); hit; hit = m.exec(tail)) last = hit[1]!;
  return last;
}

/** A parsed source map, or null when `text` isn't one. */
export function parseMap(text: string): { sources: string[]; withContent: boolean } | null {
  try {
    const map = JSON.parse(text.replace(/^\)\]\}'[^\n]*\n/, "")) as { mappings?: unknown; sources?: unknown; sourcesContent?: unknown; sections?: unknown };
    if (typeof map.mappings !== "string" && !Array.isArray(map.sections)) return null;
    const sources = Array.isArray(map.sources) ? map.sources.filter((s): s is string => typeof s === "string") : [];
    const withContent = Array.isArray(map.sourcesContent) && map.sourcesContent.some((c) => typeof c === "string" && c.length > 0);
    return { sources, withContent };
  } catch {
    return null;
  }
}

/**
 * GET from inside the page, no redirects followed, at most 15 s: the status and up to 8 MB of text. The body is read
 * as a stream and cut at the limit, so a huge response never fills the page's memory.
 */
async function fetchText(page: Page, url: string): Promise<{ status: number; text: string }> {
  return (await page.evaluate(
    `(async () => {
      const LIMIT = 8 * 1024 * 1024;
      try {
        const r = await fetch(${JSON.stringify(url)}, { redirect: "manual", cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
        if (r.status !== 200 || !r.body) return { status: r.status, text: "" };
        const reader = r.body.getReader();
        const chunks = [];
        let size = 0;
        while (size < LIMIT) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
        await reader.cancel().catch(() => undefined);
        const all = new Uint8Array(Math.min(size, LIMIT));
        let at = 0;
        for (const c of chunks) {
          const part = c.subarray(0, all.length - at);
          all.set(part, at);
          at += part.length;
          if (at >= all.length) break;
        }
        return { status: r.status, text: new TextDecoder().decode(all) };
      } catch {
        return { status: 0, text: "" };
      }
    })()`,
  )) as { status: number; text: string };
}

function decodeDataUrl(url: string): string | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    return m[1] ? Buffer.from(m[2]!, "base64").toString("utf8") : decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export const check: Check = {
  id: ID,
  title: "The app's source code isn't public",
  category: "security",
  scope: "page",

  plan() {
    return [
      scenarioFor(ID, "public-maps", {
        title: "Look for public source maps",
        description: `Checks up to ${MAX_SCRIPTS} of the page's own scripts for a source map anyone can download (which hands out the original source code). Downloads only; follows no redirects. Skipped on a dev server, which always serves source maps.`,
        priority: "medium",
      }),
    ];
  },

  async run(ctx, scenario) {
    return guarded(ID, scenario, async (startedAt) => {
      const findings = new FindingList(ID, "security");
      const { page, capture } = await ctx.openPage();
      if (looksLikeDevServer(capture)) {
        return {
          ...checkResult(ID, scenario, startedAt, []),
          status: "skipped",
          notes: "The page comes from a dev server, which always serves source maps. Run this check against a production build (for example `vite preview` or `next start`).",
        };
      }
      const scripts = capture.requests
        .filter((r) => r.resourceType === "script" && r.status === 200 && sameOrigin(r.url, ctx.targetUrl))
        .map((r) => ({ url: r.url, headers: r.responseHeaders ?? {} }))
        .filter((s, i, all) => all.findIndex((o) => o.url === s.url) === i)
        .slice(0, MAX_SCRIPTS);
      if (scripts.length === 0) return checkResult(ID, scenario, startedAt, [], "The page loads no scripts from its own origin.");

      const exposed: ExposedMap[] = [];
      for (const script of scripts) {
        ctx.step(`Looking for the source map of ${new URL(script.url).pathname}`, page);
        const header = script.headers["sourcemap"] ?? script.headers["x-sourcemap"];
        let ref: string | null = header ?? null;
        let foundBy: ExposedMap["foundBy"] = "header";
        if (!ref) {
          const body = await fetchText(page, script.url);
          ref = sourceMappingUrl(body.text);
          foundBy = "comment";
        }
        let text: string | null = null;
        let mapUrl: string;
        if (ref?.startsWith("data:")) {
          foundBy = "inline";
          mapUrl = `${script.url} (inline)`;
          text = decodeDataUrl(ref);
        } else {
          if (!ref) foundBy = "guessed";
          mapUrl = new URL(ref ?? `${new URL(script.url).pathname}.map`, script.url).href;
          // Another origin's map is that origin's business, and would be a request off the target.
          if (!sameOrigin(mapUrl, ctx.targetUrl)) continue;
          const got = await fetchText(page, mapUrl);
          text = got.status === 200 ? got.text : null;
        }
        const parsed = text ? parseMap(text) : null;
        if (parsed) exposed.push({ script: script.url, map: mapUrl, foundBy, ...parsed });
      }
      if (exposed.length === 0) return checkResult(ID, scenario, startedAt, [], `Checked ${plural(scripts.length, "script")}: no public source maps.`);

      const withContent = exposed.filter((m) => m.withContent);
      const how = { header: "SourceMap header", comment: "sourceMappingURL comment", guessed: "guessed (<script>.map)", inline: "inline in the script" } as const;
      const card = await ctx.captureCard("public source maps", {
        title: `${plural(exposed.length, "public source map")}`,
        subtitle: "Downloaded from inside the page, no redirects followed",
        lines: exposed.flatMap((m) => [
          { text: `${m.map}`, mark: true },
          { text: `  for ${m.script} (${how[m.foundBy]})` },
          { text: `  ${plural(m.sources.length, "source file")}${m.withContent ? ", with their full source code" : ", names only"}` },
          ...m.sources.slice(0, 4).map((s) => ({ text: `    ${clip(s, 100)}` })),
        ]),
        facts: [
          { label: "Scripts checked", value: String(scripts.length) },
          { label: "Public maps", value: String(exposed.length) },
          { label: "With source code", value: String(withContent.length) },
        ],
      });
      const first = exposed[0]!;
      const f = findings.add({
        title:
          exposed.length === 1
            ? `Source map is public${first.withContent ? ", with the original source code" : ""} (${clip(new URL(first.script).pathname, 50)})`
            : `${exposed.length} source maps are public${withContent.length ? ", with the original source code" : ""}`,
        severity: withContent.length > 0 ? "medium" : "low",
        location: first.map,
        locations: exposed.map((m) => m.map),
        meaning: `Anyone can download ${exposed.length === 1 ? "a source map" : "source maps"} for the app's scripts${withContent.length ? ", which contain the original, unminified source code" : ", which list the app's source files"} (${listOf(exposed.flatMap((m) => m.sources).slice(0, 4))}).`,
        impact: `Readable source makes it much easier to find weak spots: hidden admin routes, API endpoints, feature flags, comments and any keys left in the code. Production sites usually keep source maps private or upload them only to their error tracker.`,
        fix: `Ask your AI or developer: "Stop serving source maps publicly in production: turn them off in the build (Vite: build.sourcemap false or 'hidden'; Next.js: productionBrowserSourceMaps false), or upload them to the error tracker and block *.map on the server."`,
        evidence: [card],
      });
      const fetchable = exposed.filter((m) => m.foundBy !== "inline");
      f.spec = playwrightSpec(ID, 1, "source maps are not public", ctx.targetUrl, [
        ...fetchable.map((m) => `expect((await page.request.get(${JSON.stringify(m.map)}, { maxRedirects: 0 })).status(), ${JSON.stringify(`${m.map} should not be public`)}).not.toBe(200);`),
        ...(fetchable.length === 0 ? [`// The maps are inline (data: URLs in the scripts): remove them from the production build.`] : []),
      ].join("\n"));
      return checkResult(ID, scenario, startedAt, findings.items);
    });
  },
};
