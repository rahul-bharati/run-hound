// Fernway's tiny API toolkit: a route registry, JSON response helpers, a body validator and the "Crash" rule.
// Node built-ins only. Route modules (server/routes/*.mjs) use these; server/app.mjs does the dispatching.

/**
 * @typedef {object} ApiResponse What a handler returns; server/app.mjs serialises it as JSON.
 * @property {number} status
 * @property {unknown} [body] JSON value; omit for 204.
 * @property {Record<string, string>} [headers] Extra headers, e.g. { "set-cookie": ctx.sessionCookie(id) }.
 */

/**
 * @typedef {object} ApiRequest What a handler receives.
 * @property {import("node:http").IncomingMessage} req
 * @property {URL} url
 * @property {string} method  Upper case.
 * @property {string} path    url.pathname
 * @property {Record<string, string>} params  Values of ":name" segments, URL-decoded.
 * @property {URLSearchParams} query
 * @property {Record<string, unknown>} body  Parsed JSON object for POST/PUT/PATCH/DELETE ({} when empty); {} for GET.
 * @property {Record<string, string>} cookies
 * @property {string | null} idempotencyKey  The Idempotency-Key header (trimmed), or null.
 */

/** @typedef {(request: ApiRequest) => ApiResponse | Promise<ApiResponse>} Handler */

/**
 * @typedef {object} RouteOptions
 * @property {boolean} [idempotency] De-duplicate save requests by their Idempotency-Key header (default true). Pass
 *   false to ignore the header (W03 does this for POST /api/tasks).
 */

/**
 * @typedef {object} Route
 * @property {string} method
 * @property {string} pattern
 * @property {RegExp} regex
 * @property {string[]} keys
 * @property {Handler} handler
 * @property {boolean} idempotency
 */

/**
 * @typedef {object} Router
 * @property {(pattern: string, handler: Handler, options?: RouteOptions) => Router} get
 * @property {(pattern: string, handler: Handler, options?: RouteOptions) => Router} post
 * @property {(pattern: string, handler: Handler, options?: RouteOptions) => Router} put
 * @property {(pattern: string, handler: Handler, options?: RouteOptions) => Router} patch
 * @property {(pattern: string, handler: Handler, options?: RouteOptions) => Router} delete
 * @property {(method: string, path: string) => { route: Route, params: Record<string, string> } | null} match
 * @property {() => readonly Route[]} list
 */

/**
 * Creates a route registry. Patterns are exact paths with optional ":name" segments, e.g. "/api/projects/:id".
 * Registering the same method and pattern twice throws (two modules fighting over one endpoint).
 * @returns {Router}
 */
export function createRouter() {
  /** @type {Route[]} */
  const routes = [];

  /** @param {string} method */
  const add = (method) =>
    /**
     * @param {string} pattern
     * @param {Handler} handler
     * @param {RouteOptions} [options]
     */
    (pattern, handler, options = {}) => {
      if (!pattern.startsWith("/api/")) throw new Error(`route "${pattern}" must start with /api/`);
      if (routes.some((r) => r.method === method && r.pattern === pattern)) {
        throw new Error(`route ${method} ${pattern} is registered twice`);
      }
      const keys = [];
      const source = pattern
        .split("/")
        .map((segment) => {
          if (segment.startsWith(":")) {
            keys.push(segment.slice(1));
            return "([^/]+)";
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");
      routes.push({ method, pattern, regex: new RegExp(`^${source}/?$`), keys, handler, idempotency: options.idempotency ?? true });
      return router;
    };

  /** @type {Router} */
  const router = {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    match(method, path) {
      const wanted = method === "HEAD" ? "GET" : method;
      for (const route of routes) {
        if (route.method !== wanted) continue;
        const m = route.regex.exec(path);
        if (!m) continue;
        /** @type {Record<string, string>} */
        const params = {};
        route.keys.forEach((key, i) => {
          try {
            params[key] = decodeURIComponent(m[i + 1] ?? "");
          } catch {
            params[key] = m[i + 1] ?? "";
          }
        });
        return { route, params };
      }
      return null;
    },
    list: () => routes,
  };
  return router;
}

// ---- responses ---------------------------------------------------------------------------------

/**
 * @param {number} status
 * @param {unknown} [body]
 * @param {Record<string, string>} [headers]
 * @returns {ApiResponse}
 */
export const json = (status, body, headers) => ({ status, body, ...(headers ? { headers } : {}) });
/** 200 with a JSON body. @param {unknown} body @param {Record<string, string>} [headers] */
export const ok = (body, headers) => json(200, body, headers);
/** 201 with the created record. @param {unknown} body @param {Record<string, string>} [headers] */
export const created = (body, headers) => json(201, body, headers);
/** 204, no body. */
export const noContent = () => json(204);
/** 400 { errors: { <field>: <message> } }. @param {Record<string, string>} errors */
export const badRequest = (errors) => json(400, { errors });
/** 409 { errors: { <field>: <message> } }, e.g. an email already on the list. @param {Record<string, string>} errors */
export const conflict = (errors) => json(409, { errors });
/** 401 { error }. @param {string} message */
export const unauthorized = (message) => json(401, { error: message });
/** 404 { error: "Not found" }. */
export const notFound = () => json(404, { error: "Not found" });

// ---- the "Crash" rule --------------------------------------------------------------------------

/** Thrown to produce the deliberate 500 (CONTRACT.md: the name "Crash" in any name field). */
export class CrashError extends Error {}

/**
 * True when any value is a string equal to "Crash" after trimming.
 * @param {...unknown} values
 */
export function isCrash(...values) {
  return values.some((v) => typeof v === "string" && v.trim() === "Crash");
}

/**
 * Throws CrashError (answered as 500 { error: "Something went wrong" }) when any value is "Crash" after trimming.
 * Call it in create/update handlers with the request's name fields, after validation passes.
 * @param {...unknown} values
 */
export function crashIfNamed(...values) {
  if (isCrash(...values)) throw new CrashError("Deliberate failure: a name field was \"Crash\"");
}

// ---- validation --------------------------------------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date as YYYY-MM-DD (UTC). */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {string} value */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * A small body validator. Each method reads one field, records the first error for it and returns the cleaned
 * value (so handlers build the record from the return values). Unknown keys are simply never read.
 *
 *   const v = validator(body);
 *   const email = v.email("email", { required: "Enter your work email." });
 *   const teamSize = v.oneOf("teamSize", ["1–5", "6–20", "21–50", "51+"], { required: "Choose your team size." });
 *   if (!v.ok) return badRequest(v.errors);
 *
 * @param {Record<string, unknown>} body
 */
export function validator(body) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @param {string} field @param {string} message */
  const fail = (field, message) => {
    errors[field] ??= message;
  };
  /** @param {string} field @returns {string | undefined} trimmed text, "" when absent, undefined when not text */
  const readText = (field) => {
    const v = body[field];
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") {
      fail(field, "Must be text.");
      return undefined;
    }
    return v.trim();
  };

  return {
    errors,
    get ok() {
      return Object.keys(errors).length === 0;
    },
    /** Adds an error for a field (keeps the first one). @param {string} field @param {string} message */
    fail,
    /**
     * Text field. `required` is the message for an empty value (omit for optional).
     * @param {string} field
     * @param {{ required?: string, max?: number, maxMessage?: string, min?: number, minMessage?: string }} [opts]
     */
    text(field, opts = {}) {
      const v = readText(field);
      if (v === undefined) return "";
      if (v === "") {
        if (opts.required) fail(field, opts.required);
        return "";
      }
      if (opts.min !== undefined && v.length < opts.min) fail(field, opts.minMessage ?? `Use at least ${opts.min} characters.`);
      if (opts.max !== undefined && v.length > opts.max) fail(field, opts.maxMessage ?? `Use ${opts.max} characters or fewer.`);
      return v;
    },
    /**
     * Email field (trimmed, lower-cased).
     * @param {string} field
     * @param {{ required?: string, invalid?: string }} [opts]
     */
    email(field, opts = {}) {
      const v = readText(field);
      if (v === undefined) return "";
      if (v === "") {
        if (opts.required) fail(field, opts.required);
        return "";
      }
      if (v.length > 254 || !EMAIL_RE.test(v)) fail(field, opts.invalid ?? "Enter an email address like name@example.com.");
      return v.toLowerCase();
    },
    /**
     * One of a fixed list of strings.
     * @template {string} T
     * @param {string} field
     * @param {readonly T[]} values
     * @param {{ required?: string, invalid?: string }} [opts]
     * @returns {T | ""}
     */
    oneOf(field, values, opts = {}) {
      const v = readText(field);
      if (v === undefined) return "";
      if (v === "") {
        if (opts.required) fail(field, opts.required);
        return "";
      }
      if (!values.includes(/** @type {T} */ (v))) {
        fail(field, opts.invalid ?? `Choose one of: ${values.join(", ")}.`);
        return "";
      }
      return /** @type {T} */ (v);
    },
    /**
     * Boolean field (absent = false). `mustBeTrue` is the message when it must be checked (consent, terms).
     * @param {string} field
     * @param {{ mustBeTrue?: string }} [opts]
     */
    boolean(field, opts = {}) {
      const v = body[field];
      if (v !== undefined && v !== null && typeof v !== "boolean") {
        fail(field, "Must be true or false.");
        return false;
      }
      const value = v === true;
      if (opts.mustBeTrue && !value) fail(field, opts.mustBeTrue);
      return value;
    },
    /**
     * Number field (accepts a number or a numeric string).
     * @param {string} field
     * @param {{ required?: string, min?: number, max?: number, integer?: boolean, invalid?: string }} [opts]
     * @returns {number | null}
     */
    number(field, opts = {}) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") {
        if (opts.required) fail(field, opts.required);
        return null;
      }
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
      const bad =
        !Number.isFinite(n) ||
        (opts.integer && !Number.isInteger(n)) ||
        (opts.min !== undefined && n < opts.min) ||
        (opts.max !== undefined && n > opts.max);
      if (bad) {
        fail(field, opts.invalid ?? `Enter a number${opts.min !== undefined && opts.max !== undefined ? ` from ${opts.min} to ${opts.max}` : ""}.`);
        return null;
      }
      return n;
    },
    /**
     * Date field as YYYY-MM-DD.
     * @param {string} field
     * @param {{ required?: string, invalid?: string, notBefore?: string, notBeforeMessage?: string }} [opts]
     */
    date(field, opts = {}) {
      const v = readText(field);
      if (v === undefined) return "";
      if (v === "") {
        if (opts.required) fail(field, opts.required);
        return "";
      }
      if (!isRealDate(v)) {
        fail(field, opts.invalid ?? "Enter a valid date.");
        return "";
      }
      if (opts.notBefore && v < opts.notBefore) fail(field, opts.notBeforeMessage ?? "Choose a date that is not in the past.");
      return v;
    },
    /**
     * Array of strings (trimmed, empty entries dropped).
     * @param {string} field
     * @param {{ max?: number, maxMessage?: string }} [opts]
     * @returns {string[]}
     */
    stringArray(field, opts = {}) {
      const raw = body[field];
      if (raw === undefined || raw === null) return [];
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
        fail(field, "Must be a list of text values.");
        return [];
      }
      const values = raw.map((x) => x.trim()).filter(Boolean);
      if (opts.max !== undefined && values.length > opts.max) fail(field, opts.maxMessage ?? `Add at most ${opts.max}.`);
      return values;
    },
  };
}
