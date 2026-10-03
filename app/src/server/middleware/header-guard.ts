/**
 * Header guard for the AI settings and test accounts: never let another site's page drive them, not even with a
 * GET. Every request must carry X-Run-Hound: 1: an <img>, <link> or form can't send a custom header, and a cross-site
 * fetch with one needs a CORS preflight this server never grants. Sec-Fetch-Site (browsers mark cross-site GETs with
 * it) and the Origin check in middleware/host.ts stay as further layers.
 */
import type { Context, Next } from "hono";

export function headerGuard(path: string) {
  return async (c: Context, next: Next) => {
    const site = (c.req.header("sec-fetch-site") ?? "").toLowerCase();
    if (site === "cross-site" || site === "same-site")
      return c.json({ error: "Cross-site requests are not allowed." }, 403);
    if (c.req.header("x-run-hound") !== "1")
      return c.json(
        { error: `Requests to ${path} must send the header X-Run-Hound: 1.` },
        403,
      );
    await next();
  };
}
