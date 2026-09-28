/**
 * The routes a lab spec visits, from the route registry (the same manifest the build guards read): every indexable
 * page, the internal routes that were built, and a path that doesn't exist, for the 404.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appDir, fileOf } from "../../lib/build-output.mjs";
import { loadRegistry } from "../../lib/registry.mjs";

export const notFoundPath = "/no-such-page/";

/** { indexable: [...routes], internal: [...built internal routes], notFound } from the registry. */
export async function labRoutes() {
  const { routes } = await loadRegistry(process.env.LAB_MANIFEST);
  return {
    indexable: routes.filter((r) => r.indexable),
    internal: routes.filter((r) => !r.indexable && existsSync(join(appDir, fileOf(r.path)))),
    notFound: notFoundPath,
  };
}
