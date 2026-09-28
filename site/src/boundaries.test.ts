// Client components receive data as props; they never import the route registry, the modules built on it (lib/nav,
// lib/metadata, lib/structured-data) or a content module, directly or through another module, which would ship them to
// every browser (measured: a client header importing lib/nav.ts added 3,954 B gzip to every page,
// content-architecture.md §1.4). And the registry (content/routes.ts) stays loadable by plain Node: what it imports
// reaches no .tsx, image or CSS file, and never the modules built on it (an import cycle). `pnpm test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { sourceFiles } from "../scripts/lib/build-output.mjs";

const src = new URL("./", import.meta.url).pathname;

/** A file that starts with the "use client" directive (comments and blank lines may come first). */
const isClient = (text: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(text);

/** Where each value import (not `import type`) of a file points, as a path under src/ when it is one. */
function valueImports(file: string, text: string): string[] {
  const specifiers = [
    ...[...text.matchAll(/^\s*import\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*export\s+(?!type\b)[^;]*?\s+from\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  return specifiers.map((specifier) => {
    if (specifier.startsWith("@/")) return specifier.slice(2);
    if (specifier.startsWith(".")) return relative(src, resolve(dirname(file), specifier));
    return specifier;
  });
}

/**
 * Server-only modules: the registry and every content module, and the modules built on the registry (lib/nav,
 * lib/metadata, lib/structured-data), which would bring it along.
 */
const forbidden = (target: string) =>
  /^content(\/|$)/.test(target) || /^lib\/(nav|metadata|structured-data)(\.ts)?$/.test(target);

/** The file under src/ an import names ("lib/nav" is lib/nav.ts), when it is one of `known`. */
function fileOf(target: string, known: Map<string, string>): string | undefined {
  const bare = target.replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
  for (const ending of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const file = join(src, `${bare}${ending}`);
    if (known.has(file)) return file;
  }
  return undefined;
}

/**
 * Every client file's value imports, followed through the modules it reaches (another client file starts its own
 * walk, so it isn't followed): a forbidden module anywhere on the way is reported with the path to it.
 */
export function offenders(files: { file: string; text: string }[]): string[] {
  const known = new Map(files.map(({ file, text }) => [file, text]));
  const found: string[] = [];
  for (const { file, text } of files) {
    if (!isClient(text)) continue;
    const seen = new Set<string>([file]);
    const queue: { file: string; text: string; via: string[] }[] = [{ file, text, via: [] }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const target of valueImports(current.file, current.text)) {
        const via = [...current.via, target];
        if (forbidden(target)) {
          found.push(`${relative(src, file)} imports ${via.join(" → ")}`);
          continue;
        }
        const next = fileOf(target, known);
        if (!next || seen.has(next)) continue;
        seen.add(next);
        const nextText = known.get(next)!;
        if (!isClient(nextText)) queue.push({ file: next, text: nextText, via });
      }
    }
  }
  return found;
}

/**
 * The registry's own imports (content/routes.ts and every module it reaches through value imports): the modules plain
 * Node loads for the build scripts and `pnpm test` (scripts/test-hooks.mjs), where a .tsx file can't load, and where an
 * import of lib/nav, lib/metadata or lib/structured-data (which import the registry) would be a cycle: a module read
 * before it has run (a TDZ error at load). Each problem with the path to it.
 */
export function registryProblems(files: { file: string; text: string }[], start = join(src, "content/routes.ts")): string[] {
  const known = new Map(files.map(({ file, text }) => [file, text]));
  const problems: string[] = [];
  const seen = new Set<string>([start]);
  const queue: { file: string; via: string[] }[] = [{ file: start, via: [] }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of valueImports(current.file, known.get(current.file) ?? "")) {
      const via = [...current.via, target];
      if (/^lib\/(nav|metadata|structured-data)(\.ts)?$/.test(target)) problems.push(`content/routes imports ${via.join(" → ")} (a cycle)`);
      if (/\.(css|png|jpe?g|gif|svg|webp|avif|woff2?)$/.test(target)) problems.push(`content/routes imports ${via.join(" → ")} (a file plain Node can't load)`);
      const next = fileOf(target, known);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      if (next.endsWith(".tsx")) problems.push(`content/routes imports ${via.join(" → ")} (a .tsx file plain Node can't load)`);
      else queue.push({ file: next, via });
    }
  }
  return problems;
}

describe("the registry loads in plain Node", () => {
  test("content/routes.ts reaches no .tsx, image or CSS file, and never lib/nav, lib/metadata or lib/structured-data (a cycle)", () => {
    const files = sourceFiles(src).map((file) => ({ file, text: readFileSync(file, "utf8") }));
    assert.deepEqual(registryProblems(files), []);
  });

  test("the check follows the registry's imports", () => {
    const at = (name: string) => join(src, name);
    const probes = [
      { file: at("content/routes.ts"), text: `import { pageRoutes } from "@/content/routes/pages";\nimport type { NavLink } from "@/lib/nav";\n` },
      { file: at("content/routes/pages.ts"), text: `import { site } from "@/lib/site";\nimport { hero } from "../hero";\n` },
      { file: at("lib/site.ts"), text: `export const site = {};\n` },
      { file: at("content/hero.ts"), text: `import { absoluteUrl } from "@/lib/structured-data";\nimport { Mark } from "@/components/mark";\nimport still from "@/assets/hero.png";\n` },
      { file: at("components/mark.tsx"), text: `export const Mark = () => null;\n` },
    ];
    assert.deepEqual(registryProblems(probes), [
      "content/routes imports content/routes/pages → content/hero → lib/structured-data (a cycle)",
      "content/routes imports content/routes/pages → content/hero → components/mark (a .tsx file plain Node can't load)",
      "content/routes imports content/routes/pages → content/hero → assets/hero.png (a file plain Node can't load)",
    ]);
  });
});

describe("client boundaries", () => {
  test('no "use client" file imports a content module, lib/nav, lib/metadata or lib/structured-data (types are fine)', () => {
    const files = sourceFiles(src).map((file) => ({ file, text: readFileSync(file, "utf8") }));
    assert.ok(files.some(({ text }) => isClient(text)), "no client component found; has the directive check stopped matching?");
    assert.deepEqual(offenders(files), []);
  });

  test("the check follows imports through other modules (a shared helper that imports lib/nav)", () => {
    const at = (name: string) => join(src, name);
    const probes = [
      { file: at("components/menu.tsx"), text: `"use client";\nimport { links } from "./menu-data";\n` },
      { file: at("components/menu-data.ts"), text: `import { format } from "@/lib/format-links";\nexport const links = format();\n` },
      { file: at("lib/format-links.ts"), text: `import { headerLinks } from "./nav";\nexport const format = () => headerLinks();\n` },
      { file: at("lib/nav.ts"), text: `export const headerLinks = () => [];\n` },
    ];
    assert.deepEqual(offenders(probes), ["components/menu.tsx imports components/menu-data → lib/format-links → lib/nav"]);
    const typeOnly = [
      { file: at("components/menu.tsx"), text: `"use client";\nimport { links } from "./menu-data";\n` },
      { file: at("components/menu-data.ts"), text: `import type { NavLink } from "@/lib/nav";\nexport const links: NavLink[] = [];\n` },
    ];
    assert.deepEqual(offenders(typeOnly), []);
  });

  test("the check catches each way of importing them", () => {
    const at = (name: string) => join(src, "components", name);
    const probes = [
      { file: at("a.tsx"), text: `"use client";\nimport { headerLinks } from "@/lib/nav";\n` },
      { file: at("b.tsx"), text: `// A comment first.\n'use client';\nimport { routes } from "@/content/routes";\n` },
      { file: at("c.tsx"), text: `"use client";\nimport home from "../content/home";\n` },
      { file: at("d.tsx"), text: `"use client";\nconst m = import("@/content/checks/data");\n` },
      { file: at("e.tsx"), text: `"use client";\nexport { footer } from "@/content/routes";\n` },
      { file: at("i.tsx"), text: `"use client";\nimport { routeGraph } from "@/lib/structured-data";\n` },
      { file: at("j.tsx"), text: `"use client";\nimport { pageTitle } from "../lib/metadata";\n` },
    ];
    assert.equal(offenders(probes).length, probes.length, offenders(probes).join("\n"));
    const fine = [
      { file: at("f.tsx"), text: `"use client";\nimport type { NavLink } from "@/lib/nav";\nimport type { Route } from "@/content/routes";\n` },
      { file: at("g.tsx"), text: `import { headerLinks } from "@/lib/nav";\n` },
      { file: at("h.tsx"), text: `"use client";\nimport { site } from "@/lib/site";\n` },
    ];
    assert.deepEqual(offenders(fine), []);
  });
});
