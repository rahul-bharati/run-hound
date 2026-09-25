// multi-form: one page with three forms and buttons outside them, the V1 (single page) case.
//
// GET  /                the page (public/index.html + public/app.js): header search, menu toggle, contact form,
//                       "Messages you've sent" with a Refresh button, newsletter form in the footer
// GET  /search?q=       server-rendered search results (the header search is a plain GET form)
// GET  /api/messages    { messages: [...] }
// POST /api/messages    JSON { name, email, order, message }; 201 { message } or 400 { errors: { field: text } }
// POST /api/subscribe   JSON { email }; 201 {} or 400 { errors: { email: text } } (the address is never shown again)
//
// Data is in memory. Env: PORT (default 4106), HOST (default: all interfaces).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4106);
const HOST = process.env.HOST || undefined;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MAX_BODY = 16 * 1024;
const SAVE_DELAY_MS = 250;

const LIMITS = { name: 80, email: 254, order: 20, message: 1000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRODUCTS = ["Trail tent (2 person)", "Summit tent (4 person)", "Camp lantern", "Pocket lantern", "Sleeping bag", "Camp stove"];

/** @type {{id: string, name: string, email: string, order: string, message: string, createdAt: string}[]} */
const messages = [];
/** @type {Set<string>} */
const subscribers = new Set();

const HEADERS = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#15803d"/></svg>`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...HEADERS, ...headers });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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

/** Parses a JSON object body, or answers the error itself and returns null. */
async function jsonBody(req, res) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    json(res, 415, { error: "Send the request as JSON." });
    return null;
  }
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch (err) {
    json(res, err?.status === 413 ? 413 : 400, { error: err?.status === 413 ? "The request is too long." : "The request body must be valid JSON." });
    return null;
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    json(res, 400, { error: "The request body must be a JSON object." });
    return null;
  }
  return input;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

function validateMessage(input) {
  const values = { name: str(input.name), email: str(input.email), order: str(input.order), message: str(input.message) };
  const errors = {};
  if (!values.name) errors.name = "Enter your name";
  else if (values.name.length > LIMITS.name) errors.name = `Your name must be ${LIMITS.name} characters or fewer`;
  if (!values.email) errors.email = "Enter your email address";
  else if (values.email.length > LIMITS.email || !EMAIL.test(values.email)) errors.email = "Enter an email address in the format name@example.com";
  if (values.order.length > LIMITS.order) errors.order = `The order number must be ${LIMITS.order} characters or fewer`;
  if (!values.message) errors.message = "Enter a message";
  else if (values.message.length > LIMITS.message) errors.message = `Your message must be ${LIMITS.message} characters or fewer`;
  return { values, errors };
}

function searchPage(q) {
  const query = q.trim().slice(0, 100);
  const hits = query ? PRODUCTS.filter((p) => p.toLowerCase().includes(query.toLowerCase())) : [];
  const list = hits.length ? `<ul>${hits.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : `<p>No products match “${esc(query)}”.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Search - Lantern Outdoor</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head>
<body><main><h1>Search results</h1><p>Results for “${esc(query)}”.</p>${list}<p><a href="/">Back to the contact page</a></p></main></body></html>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    const file = STATIC[url.pathname];
    if (file && method === "GET") {
      return send(res, 200, await readFile(join(PUBLIC, file[0])), { "content-type": file[1], "cache-control": "no-cache" });
    }
    if ((url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") && method === "GET") {
      return send(res, 200, FAVICON, { "content-type": "image/svg+xml" });
    }
    if (url.pathname === "/search" && method === "GET") {
      return send(res, 200, searchPage(url.searchParams.get("q") ?? ""), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    }

    if (url.pathname === "/api/messages" && method === "GET") return json(res, 200, { messages });
    if (url.pathname === "/api/messages" && method === "POST") {
      const input = await jsonBody(req, res);
      if (!input) return;
      await sleep(SAVE_DELAY_MS);
      const { values, errors } = validateMessage(input);
      if (Object.keys(errors).length > 0) return json(res, 400, { errors });
      const message = { id: randomUUID(), ...values, createdAt: new Date().toISOString() };
      messages.push(message);
      return json(res, 201, { message });
    }
    if (url.pathname === "/api/subscribe" && method === "POST") {
      const input = await jsonBody(req, res);
      if (!input) return;
      await sleep(SAVE_DELAY_MS);
      const email = str(input.email);
      if (!email) return json(res, 400, { errors: { email: "Enter your email address" } });
      if (email.length > LIMITS.email || !EMAIL.test(email)) return json(res, 400, { errors: { email: "Enter an email address in the format name@example.com" } });
      subscribers.add(email.toLowerCase());
      return json(res, 201, {});
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found." });
    send(res, 404, "Page not found", { "content-type": "text/plain; charset=utf-8" });
  } catch {
    if (!res.headersSent) json(res, 500, { error: "Something went wrong. Please try again." });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`multi-form listening on http://${HOST ?? "localhost"}:${PORT}/`);
});

const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
