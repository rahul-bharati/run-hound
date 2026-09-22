// Kennel: a deliberately breakable pet-sitting booking app for testing Run Hound.
// Serves the built frontend (dist/) and a small in-memory JSON API, plus a mock third-party
// analytics server on a second port. Bugs are switched on with KENNEL_BUGS (see CONTRACT.md).
// Uses only Node built-ins.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SECRETS = join(ROOT, "server", "secrets");

const V0_BUGS = [
  "F01", "F02", "F03", "F04", "F05", "F06",
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09",
  "S01", "S02", "S03", "S04",
];

const PORT = Number(process.env.PORT ?? 3000);
const ANALYTICS_PORT = Number(process.env.ANALYTICS_PORT ?? 3001);
// Unset HOST means "all interfaces" (dual-stack where available, so both localhost forms work).
const HOST = process.env.HOST || undefined;
const MAX_BODY = 1_000_000;

/** Parses KENNEL_BUGS: "none" | "all" | comma list (case-insensitive, whitespace ignored). */
export function parseBugs(raw = "none") {
  const value = raw.replace(/\s+/g, "").toUpperCase();
  if (value === "" || value === "NONE") return new Set();
  if (value === "ALL") return new Set(V0_BUGS);
  const bugs = new Set();
  for (const id of value.split(",").filter(Boolean)) {
    if (!V0_BUGS.includes(id)) {
      console.error(`kennel: unknown bug id "${id}" in KENNEL_BUGS (known: ${V0_BUGS.join(", ")})`);
      process.exit(1);
    }
    bugs.add(id);
  }
  return bugs;
}

const bugs = parseBugs(process.env.KENNEL_BUGS);
const on = (id) => bugs.has(id);

// ---- helpers -----------------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8" });
}

/** Reads the request body as a string; rejects with status 413 past MAX_BODY. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- bookings ----------------------------------------------------------------------------------

/** @type {Map<string, object>} insertion order = creation order */
const bookings = new Map();

const PET_TYPES = ["dog", "cat", "other"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Thrown for input the S04 build "can't handle"; its stack leaks to the client. */
class MalformedBookingError extends Error {}

/**
 * Validates a create body. Returns { errors } or { booking }.
 * "malformed" problems (wrong type, too long, impossible date) are plain 400s in clean mode;
 * with S04 on they throw instead, so the 500 handler leaks a real stack trace.
 */
function validateBooking(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    if (on("S04")) throw new MalformedBookingError("Booking payload must be an object");
    return { errors: { body: "Send the booking as a JSON object." } };
  }
  const errors = {};
  let malformed = false;
  const bad = (field, message, isMalformed = false) => {
    errors[field] ??= message;
    malformed ||= isMalformed;
  };
  /** Returns the trimmed string, "" when absent, or undefined for a non-string value. */
  const text = (field) => {
    const v = body[field];
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") {
      bad(field, "Must be text.", true);
      return undefined;
    }
    return v.trim();
  };

  const petName = text("petName");
  if (petName === "") bad("petName", "Enter your pet's name.");
  else if (petName && petName.length > 50) bad("petName", "Pet name must be 50 characters or fewer.", true);

  const petType = text("petType");
  if (petType === "") bad("petType", "Choose a pet type.");
  else if (petType !== undefined && !PET_TYPES.includes(petType)) bad("petType", "Choose dog, cat or other.", true);

  const startDate = text("startDate");
  if (startDate === "") bad("startDate", "Enter a start date.");
  else if (startDate !== undefined && !isValidDate(startDate)) bad("startDate", "Enter a valid start date.", true);

  const endDate = text("endDate");
  if (endDate === "") bad("endDate", "Enter an end date.");
  else if (endDate !== undefined && !isValidDate(endDate)) bad("endDate", "Enter a valid end date.", true);
  else if (!on("F06") && startDate && isValidDate(startDate) && endDate && endDate < startDate) {
    bad("endDate", "End date must be on or after the start date.");
  }

  const ownerEmail = text("ownerEmail");
  if (ownerEmail === "") bad("ownerEmail", "Enter your email address.");
  else if (ownerEmail !== undefined && ownerEmail.length > 254) bad("ownerEmail", "Email address is too long.", true);
  else if (ownerEmail !== undefined && !EMAIL_RE.test(ownerEmail)) bad("ownerEmail", "Enter an email address like name@example.com.");

  const phone = text("phone");
  if (phone && phone.length > 30) bad("phone", "Phone must be 30 characters or fewer.", true);

  const instructions = text("instructions");
  if (instructions && instructions.length > 1000) bad("instructions", "Special instructions must be 1000 characters or fewer.", true);

  if (Object.keys(errors).length) {
    if (on("S04") && malformed) throw new MalformedBookingError(`Cannot normalise booking: ${Object.keys(errors).join(", ")}`);
    return { errors };
  }
  return { booking: { petName, petType, startDate, endDate, ownerEmail, phone, instructions } };
}

async function createBooking(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    if (on("S04")) throw err; // SyntaxError with a stack, leaked by the 500 handler
    return json(res, 400, { errors: { body: "The request body is not valid JSON." } });
  }
  const result = validateBooking(body);
  if (result.errors) return json(res, 400, { errors: result.errors });
  if (result.booking.petName === "Crash") {
    // The deliberate server fault (see docs/v0-spec.md).
    throw new Error(`Booking store crashed while saving pet "${result.booking.petName}"`);
  }
  const booking = { id: randomUUID(), ...result.booking, createdAt: new Date().toISOString() };
  bookings.set(booking.id, booking);
  return json(res, 201, booking);
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (pathname === "/api/__config" && method === "GET") {
    const host = new URL(`http://${req.headers.host ?? "localhost"}`).hostname;
    return json(res, 200, { bugs: [...bugs].sort(), analyticsUrl: `http://${host}:${ANALYTICS_PORT}` });
  }
  if (pathname === "/api/__reset" && method === "POST") {
    bookings.clear();
    return send(res, 204, "");
  }
  if (pathname === "/api/availability" && method === "GET") return json(res, 200, { available: true });
  if (pathname === "/api/bookings" && method === "GET") return json(res, 200, [...bookings.values()]);
  if (pathname === "/api/bookings" && method === "POST") return createBooking(req, res);

  const match = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (match && method === "DELETE") {
    const id = decodeURIComponent(match[1]);
    if (!bookings.delete(id)) return json(res, 404, { error: "Not found" });
    return send(res, 204, "");
  }
  return json(res, 404, { error: "Not found" });
}

// ---- static files ------------------------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Bug-only scripts served next to the bundle (S01/S02). */
const SECRET_SCRIPTS = [
  { bug: "S01", path: "/config/ai-client.js", file: "ai-client.js" },
  { bug: "S02", path: "/config/supabase-client.js", file: "supabase-client.js" },
];

let indexTemplate;
function indexHtml() {
  indexTemplate ??= readFileSync(join(DIST, "index.html"), "utf8");
  const tags = SECRET_SCRIPTS.filter((s) => on(s.bug)).map((s) => `<script src="${s.path}"></script>`).join("");
  return tags ? indexTemplate.replace("</head>", `${tags}</head>`) : indexTemplate;
}

async function serveStatic(res, pathname) {
  const secret = SECRET_SCRIPTS.find((s) => s.path === pathname && on(s.bug));
  if (secret) {
    const body = await readFile(join(SECRETS, secret.file));
    return send(res, 200, body, { "content-type": TYPES[".js"] });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "Bad request", { "content-type": "text/plain; charset=utf-8" });
  }
  const file = normalize(join(DIST, decoded));
  if (!file.startsWith(DIST + sep) || file.endsWith(`${sep}index.html`)) {
    return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
  try {
    const body = await readFile(file);
    const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
    send(res, 200, body, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": cache });
  } catch {
    send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
}

// ---- app server --------------------------------------------------------------------------------

const app = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://kennel.local");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { allow: "GET, HEAD" });
    if (url.pathname === "/") return send(res, 302, "", { location: "/book" });
    if (url.pathname === "/book" || url.pathname === "/book/") {
      return send(res, 200, indexHtml(), { "content-type": TYPES[".html"] });
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err?.status === 413) return json(res, 413, { error: "Request body too large" });
    console.error(`kennel: ${req.method} ${url.pathname} failed: ${err?.message ?? err}`);
    // S04: the stack trace goes to the client. Clean mode keeps it in the server log only.
    if (on("S04")) return json(res, 500, { error: "Something went wrong", stack: String(err?.stack ?? err) });
    return json(res, 500, { error: "Something went wrong" });
  }
});

// ---- mock analytics (a different port, so a different origin: a "third party") ----------------

/** @type {{ method: string, url: string, body: string }[]} */
let hits = [];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
};

const analytics = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://analytics.local");
  const method = req.method ?? "GET";
  try {
    if (method === "OPTIONS") return send(res, 204, "", CORS);
    if (url.pathname === "/collect" && (method === "GET" || method === "POST")) {
      const body = method === "POST" ? await readBody(req) : "";
      hits.push({ method, url: req.url ?? "/collect", body });
      return send(res, 204, "", CORS);
    }
    if (url.pathname === "/hits" && method === "GET") {
      return send(res, 200, JSON.stringify({ hits }), { ...CORS, "content-type": "application/json; charset=utf-8" });
    }
    if (url.pathname === "/reset" && method === "POST") {
      hits = [];
      return send(res, 204, "", CORS);
    }
    send(res, 404, JSON.stringify({ error: "Not found" }), { ...CORS, "content-type": "application/json; charset=utf-8" });
  } catch {
    if (!res.headersSent) send(res, 400, "", CORS);
  }
});

// ---- start / stop ------------------------------------------------------------------------------

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
  readFileSync(join(DIST, "index.html"));
} catch {
  console.error("kennel: dist/index.html is missing. Run `pnpm build` (vite build) first.");
  process.exit(1);
}

try {
  await Promise.all([listen(app, PORT), listen(analytics, ANALYTICS_PORT)]);
} catch (err) {
  console.error(`kennel: could not listen: ${err?.message ?? err}`);
  process.exit(1);
}

const shown = HOST ?? "localhost";
const active = bugs.size ? [...bugs].sort().join(",") : "none";
console.log(`kennel listening on http://${shown}:${PORT}/book (analytics http://${shown}:${ANALYTICS_PORT}, bugs: ${active})`);

function shutdown() {
  app.close();
  analytics.close();
  app.closeAllConnections();
  analytics.closeAllConnections();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
