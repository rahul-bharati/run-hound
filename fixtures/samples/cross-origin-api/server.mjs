// cross-origin-api: the page is served on PORT; its JavaScript saves to a JSON API on API_PORT, a different origin
// (same host, different port) that allows the page's origin through CORS. This is the "API on another origin" case.
//
// PORT      GET /              the page (public/index.html + public/app.js)
// API_PORT  GET  /api/rsvps    { rsvps: [...] }
//           POST /api/rsvps    JSON { name, email, attending, guests, dietary }; 201 { rsvp } or 400 { errors }
//           OPTIONS            CORS preflight, answered only for the page's own origin (loopback host, PORT)
//
// Data is in memory. Env: PORT (default 4104), API_PORT (default 4105; must differ), HOST (default: all interfaces),
// PAGE_HOSTS (extra host names the page may be opened with besides loopback, comma list; e.g. a compose service name).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4104);
const API_PORT = Number(process.env.API_PORT ?? 4105);
const HOST = process.env.HOST || undefined;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MAX_BODY = 16 * 1024;
const SAVE_DELAY_MS = 250;

if (PORT === API_PORT) {
  console.error("cross-origin-api: PORT and API_PORT must differ.");
  process.exit(1);
}

const LIMITS = { name: 80, email: 254, dietary: 500 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Extra host names the page may be opened with (comma list), e.g. the compose service name "cross-origin-api".
const PAGE_HOSTS = new Set((process.env.PAGE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));

/** @type {{id: string, name: string, email: string, attending: "yes" | "no", guests: number, dietary: string, createdAt: string}[]} */
const rsvps = [];

const PAGE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/**
 * Page headers, with a CSP whose connect-src allows the API on the host the page was opened with. CSP source lists
 * can't hold IPv6 literals, so a page opened at http://[::1]:PORT can't reach the API; use localhost or 127.0.0.1.
 */
function pageHeaders(req) {
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
  const hosts = new Set(["localhost", "127.0.0.1"]);
  if (/^[a-z0-9.-]+$/i.test(host)) hosts.add(host.toLowerCase());
  const api = [...hosts].map((h) => `http://${h}:${API_PORT}`).join(" ");
  return {
    ...PAGE_HEADERS,
    "content-security-policy": `default-src 'self'; connect-src 'self' ${api}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  };
}
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1d4ed8"/></svg>`;

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

// ---- page server (PORT) ------------------------------------------------------------------------

const page = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = STATIC[url.pathname];
    if (file && req.method === "GET") {
      let body = await readFile(join(PUBLIC, file[0]), "utf8");
      if (file[0] === "index.html") body = body.replace("__API_PORT__", String(API_PORT));
      return send(res, 200, body, { ...pageHeaders(req), "content-type": file[1], "cache-control": "no-cache" });
    }
    if ((url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") && req.method === "GET") {
      return send(res, 200, FAVICON, { ...pageHeaders(req), "content-type": "image/svg+xml" });
    }
    send(res, 404, "Page not found", { ...pageHeaders(req), "content-type": "text/plain; charset=utf-8" });
  } catch {
    if (!res.headersSent) send(res, 500, "Something went wrong", { ...PAGE_HEADERS, "content-type": "text/plain; charset=utf-8" });
    else res.destroy();
  }
});

// ---- API server (API_PORT) ---------------------------------------------------------------------

/** CORS headers for a request from the page's own origin (a loopback host on PORT); none for anyone else. */
function cors(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  try {
    const u = new URL(origin);
    const host = u.host.replace(/:\d+$/, "").toLowerCase();
    if (u.protocol === "http:" && (LOOPBACK.has(host) || PAGE_HOSTS.has(host)) && Number(u.port) === PORT) {
      return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, accept",
        "access-control-max-age": "600",
        vary: "Origin",
      };
    }
  } catch {
    // not a URL: no CORS headers
  }
  return { vary: "Origin" };
}

function json(req, res, status, value) {
  send(res, status, JSON.stringify(value), {
    ...cors(req),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validate(input) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const guests = typeof input.guests === "number" ? input.guests : Number(str(input.guests) || NaN);
  const values = { name: str(input.name), email: str(input.email), attending: str(input.attending), guests, dietary: str(input.dietary) };
  const errors = {};
  if (!values.name) errors.name = "Enter your name";
  else if (values.name.length > LIMITS.name) errors.name = `Your name must be ${LIMITS.name} characters or fewer`;
  if (!values.email) errors.email = "Enter your email address";
  else if (values.email.length > LIMITS.email || !EMAIL.test(values.email)) errors.email = "Enter an email address in the format name@example.com";
  if (values.attending !== "yes" && values.attending !== "no") errors.attending = "Choose whether you're coming";
  if (!Number.isInteger(values.guests) || values.guests < 1 || values.guests > 6) errors.guests = "Enter a number from 1 to 6";
  if (values.dietary.length > LIMITS.dietary) errors.dietary = `Dietary needs must be ${LIMITS.dietary} characters or fewer`;
  return { values, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (method === "OPTIONS") return send(res, 204, "", cors(req));
    if (url.pathname === "/api/rsvps" && method === "GET") return json(req, res, 200, { rsvps });
    if (url.pathname === "/api/rsvps" && method === "POST") {
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") return json(req, res, 415, { error: "Send the RSVP as JSON." });
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch (err) {
        if (err?.status === 413) return json(req, res, 413, { error: "The RSVP is too long." });
        return json(req, res, 400, { error: "The request body must be valid JSON." });
      }
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return json(req, res, 400, { error: "The request body must be a JSON object." });
      }
      await sleep(SAVE_DELAY_MS);
      const { values, errors } = validate(input);
      if (Object.keys(errors).length > 0) return json(req, res, 400, { errors });
      const rsvp = { id: randomUUID(), ...values, createdAt: new Date().toISOString() };
      rsvps.push(rsvp);
      return json(req, res, 201, { rsvp });
    }
    json(req, res, 404, { error: "Not found." });
  } catch {
    if (!res.headersSent) json(req, res, 500, { error: "Something went wrong. Please try again." });
    else res.destroy();
  }
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

try {
  await Promise.all([listen(page, PORT), listen(api, API_PORT)]);
} catch (err) {
  console.error(`cross-origin-api: could not listen: ${err?.message ?? err}`);
  process.exit(1);
}
const shown = HOST ?? "localhost";
console.log(`cross-origin-api listening on http://${shown}:${PORT}/ (API http://${shown}:${API_PORT}/api/rsvps)`);

const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
