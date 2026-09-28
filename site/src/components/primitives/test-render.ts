/**
 * Lets `node --test` render the site's .tsx components to HTML, for tests of the primitives (and any later component
 * test that needs one). Node strips TypeScript types itself but can't compile JSX, so this adds a module hook that
 * compiles a .tsx file with TypeScript (a devDependency already) to CommonJS, the way Next.js would compile it for
 * the server: JSX through react/jsx-runtime, and `import Link from "next/link"` with the CommonJS interop Next.js's
 * bundler applies. It resolves "@/…" and imports without an extension to .ts, .tsx or index files, as
 * scripts/test-hooks.mjs does for .ts files.
 *
 * Import it before the component (a static import of this file, then `await import("./component")`): the hook applies
 * to modules loaded after it is registered. Rendering is React's own renderToStaticMarkup, as for a static page:
 * "use client" components render their first state (effects don't run), so interaction is tested on the pure logic
 * they call. Next.js inlines its config into next/link at build time; the site's trailingSlash is set here the same
 * way, so a link to "/faq/" renders as "/faq/".
 *
 * Never imported by the site itself.
 */
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

type ResolveResult = { url: string; format?: string; shortCircuit?: boolean };
type Hooks = {
  resolve: (specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult) => ResolveResult;
  load: (url: string, context: unknown, next: (u: string, c: unknown) => unknown) => unknown;
};
// module.registerHooks is in Node 22.15+ and 24 (the site's CI runs Node 24); @types/node 20 doesn't declare it yet.
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: Hooks) => void };

const src = new URL("../../", import.meta.url);
const flag = Symbol.for("run-hound.site.tsx-hooks");
const state = globalThis as typeof globalThis & { [flag]?: true };

if (!state[flag]) {
  state[flag] = true;
  // next/link reads these at runtime outside a Next.js build (next.config.ts: trailingSlash: true).
  process.env.__NEXT_TRAILING_SLASH = "true";
  registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL ?? "";
      let base: URL | undefined;
      if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), src);
      else if (/^\.\.?\//.test(specifier) && /\.tsx?$/.test(parent)) base = new URL(specifier, parent);
      if (base) {
        const endings = /\.[cm]?[jt]sx?$/.test(base.pathname) ? [""] : [".ts", ".tsx", "/index.ts", "/index.tsx"];
        for (const ending of endings) {
          const url = new URL(`${base.href}${ending}`);
          if (!existsSync(url)) continue;
          // .tsx is compiled to CommonJS below; .ts files are ES modules whose types Node strips.
          const format = url.pathname.endsWith(".tsx") ? "commonjs" : url.pathname.endsWith(".ts") ? "module-typescript" : undefined;
          return { url: url.href, ...(format ? { format } : {}), shortCircuit: true };
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);
      const source = readFileSync(new URL(url), "utf8");
      const { outputText } = ts.transpileModule(source, {
        fileName: new URL(url).pathname,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      });
      return { format: "commonjs", source: outputText, shortCircuit: true };
    },
  });
}

/** A React element rendered to static HTML, as a prerendered page has it. */
export function html(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** HTML character references decoded, for comparing rendered text with the source strings. */
export function decode(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

/** The text of an HTML fragment: tags dropped, references decoded. */
export function textOf(fragment: string): string {
  return decode(fragment.replace(/<[^>]+>/g, ""));
}

/**
 * The first element in `markup` whose opening tag matches `open` (a regex source for the tag's attributes, such as
 * `role="status"`), with its inner HTML: the element is found by counting nested tags of the same name.
 */
export function element(markup: string, tag: string, open = ""): { outer: string; inner: string; attrs: string } | undefined {
  const start = new RegExp(`<${tag}(\\s[^>]*?)?${open ? `(?=[^>]*${open})` : ""}[^>]*>`, "i").exec(markup);
  if (!start) return undefined;
  const tagRe = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, "gi");
  tagRe.lastIndex = start.index;
  let depth = 0;
  for (let m = tagRe.exec(markup); m; m = tagRe.exec(markup)) {
    if (m[2] === "/") continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const outer = markup.slice(start.index, m.index + m[0].length);
      return { outer, inner: markup.slice(start.index + start[0].length, m.index), attrs: start[0] };
    }
  }
  return undefined;
}

/** Every element of `tag` in `markup` whose opening tag matches `open`. */
export function elements(markup: string, tag: string, open = ""): { outer: string; inner: string; attrs: string }[] {
  const found: { outer: string; inner: string; attrs: string }[] = [];
  let rest = markup;
  for (let hit = element(rest, tag, open); hit; hit = element(rest, tag, open)) {
    found.push(hit);
    rest = rest.slice(rest.indexOf(hit.outer) + hit.attrs.length);
  }
  return found;
}
