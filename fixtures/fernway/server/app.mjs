// Fernway's request handler: static files from dist/, the SPA fallback, the JSON API (route modules in
// server/routes/), security headers, the session cookie and the Idempotency-Key replay cache. See CONTRACT.md.
// Node built-ins only. server/index.mjs reads the environment and listens; tests can create an app in-process.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "./http.mjs";
import * as auth from "./routes/auth.mjs";
import * as marketing from "./routes/marketing.mjs";
import * as onboarding from "./routes/onboarding.mjs";
import * as workspace from "./routes/workspace.mjs";
import { createSeed } from "./seed.mjs";

/** fixtures/fernway */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS = join(ROOT, "server", "secrets");

/** The six client-side routes: each serves index.html with 200 (a trailing slash is accepted too). */
export const SPA_ROUTES = Object.freeze(["/", "/signup", "/login", "/onboarding", "/app", "/app/settings"]);

/** Route modules, each exporting register(router, ctx). */
export const ROUTE_MODULES = Object.freeze([marketing, auth, onboarding, workspace]);

/** Largest accepted request body. */
export const MAX_BODY = 256 * 1024;

export const SESSION_COOKIE = "fernway_session";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** Bug-only scripts served next to the bundle and loaded by index.html (W06; same approach as Kennel S01/S02). */
const SECRET_SCRIPTS = Object.freeze([{ bug: "W06", path: "/config/billing.js", file: "billing.js" }]);

/**
 * W06's obviously fake Stripe-style key, put together here and written into billing.js as it is served, so the
 * repository never holds a string that secret scanners (GitHub push protection) would block. It grants nothing.
 */
const FAKE_STRIPE_SECRET = ["sk", "live", "FAKEfernwayDemoOnly0000000000FAKE"].join("_");
const FAKE_SECRET_PLACEHOLDER = "__FERNWAY_FAKE_STRIPE_SECRET__";

const REPLAY_LIMIT = 2_000;

/**
 * @typedef {object} AppContext  What route modules get as `ctx` in register(router, ctx).
 * @property {ReadonlySet<string>} bugs       Enabled bug ids.
 * @property {(id: string) => boolean} bugOn  True when FERNWAY_BUGS enables that id.
 * @property {import("./seed.mjs").Store} store  The in-memory data. The object is stable but POST /api/__reset
 *   replaces its fields, so read `ctx.store.projects` inside handlers; never keep a reference to a field.
 * @property {(sessionId?: string) => string} sessionCookie  A Set-Cookie value for fernway_session (a new UUID
 *   when no id is given): "Path=/; HttpOnly; SameSite=Lax", without HttpOnly under W09.
 * @property {(cookies: Record<string, string>) => import("./seed.mjs").User | null} sessionUser  The user signed in
 *   with the request's fernway_session cookie, or null.
 * @property {(fn: () => void) => void} onReset  Runs fn on POST /api/__reset (for module-private state).
 * @property {() => string} newId  A random UUID.
 * @property {() => string} now    The current time as an ISO string.
 */

/**
 * @param {object} [options]
 * @param {ReadonlySet<string>} [options.bugs]  Enabled bug ids (parseBugs).
 * @param {string} [options.root]  Fernway root; static files come from <root>/dist.
 * @param {readonly { register: (router: import("./http.mjs").Router, ctx: AppContext) => void }[]} [options.modules]
 * @param {(line: string) => void} [options.log]  Server-side error log (default: console.error).
 */
export function createApp({ bugs = new Set(), root = ROOT, modules = ROUTE_MODULES, log = (line) => console.error(line) } = {}) {
  const dist = join(root, "dist");
  /** @param {string} id */
  const on = (id) => bugs.has(id);

  const store = createSeed();
  /** @type {(() => void)[]} */
  const resetHooks = [];
  /** @type {Map<string, Promise<import("./http.mjs").ApiResponse>>} */
  const replays = new Map();

  /** @type {AppContext} */
  const ctx = {
    bugs,
    bugOn: on,
    store,
    sessionCookie(sessionId = randomUUID()) {
      const flags = on("W09") ? "Path=/; SameSite=Lax" : "Path=/; HttpOnly; SameSite=Lax";
      return `${SESSION_COOKIE}=${sessionId}; ${flags}`;
    },
    sessionUser(cookies) {
      const sid = cookies[SESSION_COOKIE];
      const userId = sid ? store.sessions.get(sid) : undefined;
      return (userId && store.users.find((u) => u.id === userId)) || null;
    },
    onReset(fn) {
      resetHooks.push(fn);
    },
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  };

  const router = createRouter();
  for (const m of modules) m.register(router, ctx);

  function reset() {
    const fresh = createSeed();
    for (const key of Object.keys(store)) delete store[/** @type {keyof typeof store} */ (key)];
    Object.assign(store, fresh);
    replays.clear();
    for (const fn of resetHooks) fn();
  }

  // ---- responses -------------------------------------------------------------------------------

  /** The three clean-mode security headers; W08 drops them all. */
  function securityHeaders() {
    if (on("W08")) return {};
    return {
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    };
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {number} status
   * @param {string | Buffer} body
   * @param {Record<string, string>} [headers]
   */
  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      "cache-control": "no-store",
      "content-length": String(Buffer.byteLength(body)),
      ...securityHeaders(),
      ...headers,
    });
    res.end(body);
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {number} status
   * @param {unknown} value
   * @param {Record<string, string>} [headers]
   */
  function sendJson(res, status, value, headers = {}) {
    send(res, status, JSON.stringify(value), { "content-type": TYPES[".json"], ...headers });
  }

  const notFoundText = (/** @type {import("node:http").ServerResponse} */ res) =>
    send(res, 404, "Not found", { "content-type": TYPES[".txt"] });

  // ---- requests --------------------------------------------------------------------------------

  /** @param {string | undefined} header @returns {Record<string, string>} */
  function parseCookies(header) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const part of (header ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i < 1) continue;
      const name = part.slice(0, i).trim();
      if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
    }
    return out;
  }

  /**
   * Reads the body as UTF-8. Past MAX_BODY it keeps draining (so the 413 reaches the client) and rejects with
   * status 413; a client that keeps sending far past the limit is cut off.
   * @param {import("node:http").IncomingMessage} req
   * @returns {Promise<string>}
   */
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooLarge = false;
      /** @type {Buffer[]} */
      const chunks = [];
      req.on("data", (/** @type {Buffer} */ chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          tooLarge = true;
          chunks.length = 0;
          if (size > MAX_BODY * 16) req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (tooLarge) reject(Object.assign(new Error("body too large"), { status: 413 }));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }

  // ---- API -------------------------------------------------------------------------------------

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {import("./http.mjs").ApiResponse} result
   * @param {Record<string, string>} [extra]
   */
  function sendApi(res, result, extra = {}) {
    if (!result || typeof result.status !== "number") throw new Error("route handler returned no response");
    const headers = { ...(result.headers ?? {}), ...extra };
    if (result.status === 204 || result.body === undefined) return send(res, result.status, "", headers);
    return sendJson(res, result.status, result.body, headers);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   */
  async function handleApi(req, res, url) {
    const method = (req.method ?? "GET").toUpperCase();
    const path = url.pathname;

    if (path === "/api/__config" && (method === "GET" || method === "HEAD")) {
      return sendJson(res, 200, { bugs: [...bugs].sort() });
    }
    if (path === "/api/__reset" && method === "POST") {
      await readBody(req);
      reset();
      return send(res, 204, "");
    }

    const match = router.match(method, path);
    if (!match) return sendJson(res, 404, { error: "Not found" });

    /** @type {Record<string, unknown>} */
    let body = {};
    if (method !== "GET" && method !== "HEAD") {
      const raw = await readBody(req);
      if (raw.trim() !== "") {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { errors: { body: "The request body is not valid JSON." } });
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return sendJson(res, 400, { errors: { body: "Send the data as a JSON object." } });
        }
        body = parsed;
      }
    }

    const header = req.headers["idempotency-key"];
    const idempotencyKey = (Array.isArray(header) ? header[0] : header)?.trim().slice(0, 255) || null;
    /** @type {import("./http.mjs").ApiRequest} */
    const request = {
      req,
      url,
      method,
      path,
      params: match.params,
      query: url.searchParams,
      body,
      cookies: parseCookies(req.headers.cookie),
      idempotencyKey,
    };

    const cacheable = idempotencyKey && method !== "GET" && method !== "HEAD" && match.route.idempotency;
    if (!cacheable) return sendApi(res, await match.route.handler(request));

    // The same key on the same endpoint answers the first response again, including while the first request is
    // still running (a double click). Server failures are not cached, so a retry with the same key can succeed.
    const cacheKey = `${method} ${match.route.pattern} ${path} ${idempotencyKey}`;
    const earlier = replays.get(cacheKey);
    if (earlier) return sendApi(res, await earlier, { "idempotent-replayed": "true" });

    const pending = Promise.resolve().then(() => match.route.handler(request));
    replays.set(cacheKey, pending);
    if (replays.size > REPLAY_LIMIT) replays.delete(/** @type {string} */ (replays.keys().next().value));
    let result;
    try {
      result = await pending;
    } catch (err) {
      replays.delete(cacheKey);
      throw err;
    }
    if (!result || result.status >= 500) replays.delete(cacheKey);
    return sendApi(res, result);
  }

  // ---- static files and the SPA ----------------------------------------------------------------

  /** @type {string | undefined} */
  let indexTemplate;
  function indexHtml() {
    indexTemplate ??= readFileSync(join(dist, "index.html"), "utf8");
    const tags = SECRET_SCRIPTS.filter((s) => on(s.bug))
      .map((s) => `<script src="${s.path}"></script>`)
      .join("");
    return tags ? indexTemplate.replace("</head>", `${tags}</head>`) : indexTemplate;
  }

  /**
   * index.html with the given status (200 for the six routes, 404 otherwise); sets the session cookie on a
   * visitor's first page load.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {number} status
   */
  function sendPage(req, res, status) {
    const cookies = parseCookies(req.headers.cookie);
    const cookie = cookies[SESSION_COOKIE] ? {} : { "set-cookie": ctx.sessionCookie() };
    send(res, status, indexHtml(), { "content-type": TYPES[".html"], ...cookie });
  }

  /** @param {string} pathname */
  const isSpaRoute = (pathname) => {
    const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return SPA_ROUTES.includes(trimmed);
  };

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} pathname
   */
  async function serveStatic(req, res, pathname) {
    const secret = SECRET_SCRIPTS.find((s) => s.path === pathname && on(s.bug));
    if (secret) {
      const body = (await readFile(join(SECRETS, secret.file), "utf8")).replace(FAKE_SECRET_PLACEHOLDER, FAKE_STRIPE_SECRET);
      return send(res, 200, body, { "content-type": TYPES[".js"] });
    }
    if (isSpaRoute(pathname)) return sendPage(req, res, 200);

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return send(res, 400, "Bad request", { "content-type": TYPES[".txt"] });
    }
    const file = normalize(join(dist, decoded));
    const ext = extname(decoded).toLowerCase();
    // Source maps are built "hidden" and never served.
    if (ext === ".map") return notFoundText(res);
    if (!file.startsWith(dist + sep) || basename(file) === "index.html") return sendPage(req, res, 404);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      const body = await readFile(file);
      const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return send(res, 200, body, { "content-type": TYPES[/** @type {keyof typeof TYPES} */ (ext)] ?? "application/octet-stream", "cache-control": cache });
    } catch {
      // A missing file answers plain 404; any other path is an unknown page: the SPA's "Page not found" view.
      return ext ? notFoundText(res) : sendPage(req, res, 404);
    }
  }

  // ---- entry point -----------------------------------------------------------------------------

  /**
   * The node:http request listener.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://fernway.local");
    const method = (req.method ?? "GET").toUpperCase();
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (method !== "GET" && method !== "HEAD") {
        return send(res, 405, "Method not allowed", { "content-type": TYPES[".txt"], allow: "GET, HEAD" });
      }
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (res.headersSent) return void res.destroy();
      const e = /** @type {{ status?: number, message?: string }} */ (err);
      if (e?.status === 413) return sendJson(res, 413, { error: "Request body too large" }, { connection: "close" });
      // The detail stays in the server log; the client gets no stack, path or internals.
      log(`fernway: ${method} ${url.pathname} failed: ${e?.message ?? String(err)}`);
      return sendJson(res, 500, { error: "Something went wrong" });
    }
  }

  return { handle, ctx, router, store, reset };
}
