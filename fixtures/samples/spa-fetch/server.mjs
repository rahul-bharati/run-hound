// spa-fetch: a vanilla-JS contact form that saves with fetch (JSON) to /api/messages on the same origin.
//
// GET  /                the page (public/index.html + public/app.js)
// GET  /api/messages    { messages: [...] }
// POST /api/messages    JSON { name, email, topic, message }; 201 { message } or 400 { errors: { field: text } }
//
// Data is in memory. Env: PORT (default 4102), HOST (default: all interfaces).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4102);
const HOST = process.env.HOST || undefined;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MAX_BODY = 16 * 1024;
const SAVE_DELAY_MS = 250;

const TOPICS = ["General question", "Billing", "Feedback"];
const LIMITS = { name: 80, email: 254, message: 1000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {{id: string, name: string, email: string, topic: string, message: string, createdAt: string}[]} */
const messages = [];

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
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1d4ed8"/></svg>`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...HEADERS, ...headers });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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
  const values = { name: str(input.name), email: str(input.email), topic: str(input.topic) || TOPICS[0], message: str(input.message) };
  const errors = {};
  if (!values.name) errors.name = "Enter your name";
  else if (values.name.length > LIMITS.name) errors.name = `Your name must be ${LIMITS.name} characters or fewer`;
  if (!values.email) errors.email = "Enter your email address";
  else if (values.email.length > LIMITS.email || !EMAIL.test(values.email)) errors.email = "Enter an email address in the format name@example.com";
  if (!TOPICS.includes(values.topic)) errors.topic = "Choose a topic from the list";
  if (!values.message) errors.message = "Enter a message";
  else if (values.message.length > LIMITS.message) errors.message = `Your message must be ${LIMITS.message} characters or fewer`;
  return { values, errors };
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

    if (url.pathname === "/api/messages" && method === "GET") return json(res, 200, { messages });
    if (url.pathname === "/api/messages" && method === "POST") {
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") return json(res, 415, { error: "Send the message as JSON." });
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch (err) {
        if (err?.status === 413) return json(res, 413, { error: "The message is too long." });
        return json(res, 400, { error: "The request body must be valid JSON." });
      }
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return json(res, 400, { error: "The request body must be a JSON object." });
      }
      await sleep(SAVE_DELAY_MS);
      const { values, errors } = validate(input);
      if (Object.keys(errors).length > 0) return json(res, 400, { errors });
      const message = { id: randomUUID(), ...values, createdAt: new Date().toISOString() };
      messages.push(message);
      return json(res, 201, { message });
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found." });
    send(res, 404, "Page not found", { "content-type": "text/plain; charset=utf-8" });
  } catch {
    if (!res.headersSent) json(res, 500, { error: "Something went wrong. Please try again." });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`spa-fetch listening on http://${HOST ?? "localhost"}:${PORT}/`);
});

const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
