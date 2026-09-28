/**
 * The one reader of the site's CSS as data: src/styles/tokens.test.ts checks tokens.css and globals.css with it, and
 * /_design/ reads the values it shows through it (app/%5Fdesign/tokens.ts), so the two never parse the file two ways.
 * It knows as much CSS as those files use: comments, nested blocks (@media, @layer, @theme, rules) and declarations.
 * Plain functions with no Node or browser API, so the build and `node --test` both load it.
 */

/** A block by its prelude (whitespace collapsed: "@media (width >= 40rem)", ":root"), its declarations and its nested blocks. */
export type CssBlock = { prelude: string; declarations: Map<string, string>; children: CssBlock[] };

/** Parses a stylesheet into its tree of blocks. Declaration values have their whitespace collapsed. */
export function parseCss(css: string): CssBlock {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const root: CssBlock = { prelude: "", declarations: new Map(), children: [] };
  const stack: CssBlock[] = [root];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      const block: CssBlock = { prelude: buffer.trim().replace(/\s+/g, " "), declarations: new Map(), children: [] };
      stack.at(-1)!.children.push(block);
      stack.push(block);
      buffer = "";
    } else if (char === "}" || char === ";") {
      const statement = buffer.trim();
      const colon = statement.indexOf(":");
      // A declaration: a name, a colon, a value. At-rules without a block (@import) are not declarations.
      if (colon > 0 && !statement.startsWith("@")) {
        stack.at(-1)!.declarations.set(statement.slice(0, colon).trim(), statement.slice(colon + 1).trim().replace(/\s+/g, " "));
      }
      buffer = "";
      if (char === "}" && stack.length > 1) stack.pop();
    } else buffer += char;
  }
  return root;
}

/**
 * The declarations of every block found along `path` from the top (each step a prelude), merged in source order:
 * [":root"] is the top-level :root blocks; ["@media (width >= 40rem)", ":root"] the :root blocks inside that query.
 */
export function declarationsAt(tree: CssBlock, path: readonly string[]): Map<string, string> {
  let level: CssBlock[] = [tree];
  for (const step of path) level = level.flatMap((block) => block.children.filter((child) => child.prelude === step));
  const merged = new Map<string, string>();
  for (const block of level) for (const [name, value] of block.declarations) merged.set(name, value);
  return merged;
}

/** Follows a value that is one var() reference through `layers` (the first that defines the name wins) to a literal. */
export function resolveVar(value: string, layers: readonly Map<string, string>[], depth = 0): string {
  // A custom property's name: "--", a word character, then word characters and hyphens. (Written this way so that
  // scripts/check-budgets.mjs's scan for arbitrary Tailwind values, a hyphen before a bracket, doesn't count it.)
  const match = /^var\((--\w[\w-]*)\)$/.exec(value.trim());
  if (!match || depth > 8) return value;
  for (const layer of layers) {
    const next = layer.get(match[1]);
    if (next !== undefined) return resolveVar(next, layers, depth + 1);
  }
  return value;
}

/**
 * The total, in rem, of a length that is a sum of rem lengths and var() references to them, such as
 * "calc(var(--header-height) + 1rem)". Throws on anything else, so a test can't pass on a value it didn't understand.
 */
export function remTotal(value: string, layers: readonly Map<string, string>[]): number {
  const body = /^calc\((.*)\)$/.exec(value.trim())?.[1] ?? value;
  let total = 0;
  for (const term of body.split("+")) {
    const literal = resolveVar(term.trim(), layers);
    const rem = /^(\d+(?:\.\d+)?)rem$/.exec(literal);
    if (!rem) throw new Error(`remTotal: "${term.trim()}" in "${value}" is not a rem length (resolved to "${literal}")`);
    total += Number(rem[1]);
  }
  return total;
}
