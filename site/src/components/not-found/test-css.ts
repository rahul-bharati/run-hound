/**
 * For `node --test` only: a component that imports its stylesheet (import "./x.css", as Next.js bundles it) loads as
 * if the stylesheet were empty, so the 404's and the legal pages' tests can render them with test-render.ts. Import it
 * before the components, like test-render.ts. Never imported by the site itself.
 */
import * as nodeModule from "node:module";

type LoadResult = { format: string; source: string; shortCircuit: true };
type Hooks = { load: (url: string, context: unknown, next: (u: string, c: unknown) => unknown) => unknown };
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: Hooks) => void };

const flag = Symbol.for("run-hound.site.css-stub-hooks");
const state = globalThis as typeof globalThis & { [flag]?: true };

if (!state[flag]) {
  state[flag] = true;
  registerHooks({
    load(url, context, next) {
      if (url.startsWith("file:") && url.endsWith(".css")) return { format: "commonjs", source: "", shortCircuit: true } satisfies LoadResult;
      return next(url, context);
    },
  });
}
