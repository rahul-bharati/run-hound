/**
 * The route registry for the build scripts, as plain data: lib/nav.ts registryManifest(), loaded from the TypeScript
 * source the pages render from (Node strips the types; scripts/test-hooks.mjs resolves the "@/" imports), or from a
 * JSON file given with --manifest (the scripts' tests use fixtures).
 *
 * Each route: { id, path, title (as the browser shows it), description, indexable, search, anchors, source,
 * trail: [{ name, path }], webPage: { type, name, dated } }.
 */
import { readFileSync } from "node:fs";

export async function loadRegistry(manifestFile) {
  if (manifestFile) return JSON.parse(readFileSync(manifestFile, "utf8"));
  await import("../test-hooks.mjs");
  const { registryManifest } = await import("../../src/lib/nav.ts");
  return registryManifest();
}

/** The value of a --name option, or undefined. */
export function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}
