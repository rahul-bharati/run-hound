// login: an email + password sign-in form that talks JSON to /api/session on the same origin.
//
// GET    /              the page (public/index.html + public/app.js)
// GET    /api/session   200 { user: { email } | null } (never 401, so loading the page logs no error)
// POST   /api/session   JSON { email, password }; 200 { user } and an HttpOnly session cookie, 401 on wrong credentials,
//                       400 when a field is missing
// DELETE /api/session   signs out (204)
//
// The only account is demo@example.test / correct-horse. Env: PORT (default 4103), HOST (default: all interfaces).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4103);
const HOST = process.env.HOST || undefined;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MAX_BODY = 8 * 1024;

const DEMO = { email: "demo@example.test", password: "correct-horse" };
/** session id -> email */
const sessions = new Map();

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

function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
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

function sessionOf(req) {
  const match = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? "");
  return match ? match[1] : null;
}

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

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

    if (url.pathname === "/api/session") {
      if (method === "GET") {
        const sid = sessionOf(req);
        const email = sid ? sessions.get(sid) : undefined;
        return json(res, 200, { user: email ? { email } : null });
      }
      if (method === "DELETE") {
        const sid = sessionOf(req);
        if (sid) sessions.delete(sid);
        return send(res, 204, "", { "set-cookie": "sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
      }
      if (method === "POST") {
        const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (type !== "application/json") return json(res, 415, { error: "Send the sign-in details as JSON." });
        let input;
        try {
          input = JSON.parse(await readBody(req));
        } catch (err) {
          if (err?.status === 413) return json(res, 413, { error: "The request is too large." });
          return json(res, 400, { error: "The request body must be valid JSON." });
        }
        const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
        const password = typeof input?.password === "string" ? input.password : "";
        if (!email || !password) return json(res, 400, { error: "Enter your email address and password." });
        if (!same(email, DEMO.email) || !same(password, DEMO.password)) {
          return json(res, 401, { error: "That email and password don't match an account." });
        }
        const sid = randomBytes(24).toString("base64url");
        sessions.set(sid, DEMO.email);
        return json(res, 200, { user: { email: DEMO.email } }, { "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Strict` });
      }
      return json(res, 405, { error: "Method not allowed." }, { allow: "GET, POST, DELETE" });
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found." });
    send(res, 404, "Page not found", { "content-type": "text/plain; charset=utf-8" });
  } catch {
    if (!res.headersSent) json(res, 500, { error: "Something went wrong. Please try again." });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`login listening on http://${HOST ?? "localhost"}:${PORT}/`);
});

const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
