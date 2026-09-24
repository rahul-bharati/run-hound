// classic-post: a server-rendered sign-up form with no JavaScript.
//
// GET  /signup              the form
// POST /signup              urlencoded; valid -> 303 to /signup/thanks/<id>; invalid -> 422 and the form again,
//                           with an error summary (role="alert"), aria-invalid and aria-describedby on each field
// GET  /signup/thanks/<id>  the saved values
//
// A hidden one-time form token makes a repeated POST (double-click, back + resubmit) land on the same record
// instead of creating a second one. Data is in memory. Env: PORT (default 4101), HOST (default: all interfaces).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4101);
const HOST = process.env.HOST || undefined;
const MAX_BODY = 16 * 1024;

const TEAM_SIZES = ["Just me", "2 to 10", "11 to 50", "More than 50"];
const LIMITS = { name: 80, email: 254, company: 100, usage: 500 };

/** @type {Map<string, {id: string, name: string, email: string, company: string, teamSize: string, usage: string, newsletter: boolean, createdAt: string}>} */
const signups = new Map();
/** form token -> signup id, so a repeated POST of the same form returns the first record. */
const usedTokens = new Map();

const CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1f2937; background: #ffffff; }
body { margin: 0; }
main { max-width: 36rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 0.5rem; }
p { margin: 0 0 1rem; }
.hint { color: #4b5563; font-size: 0.95rem; margin: 0.125rem 0 0.25rem; }
.field { margin: 0 0 1.25rem; }
label, legend { display: block; font-weight: 600; }
fieldset { border: 0; margin: 0 0 1.25rem; padding: 0; }
input[type="text"], input[type="email"], select, textarea {
  display: block; width: 100%; max-width: 100%; font: inherit; color: inherit; background: #ffffff;
  border: 2px solid #6b7280; border-radius: 6px; padding: 0.5rem 0.625rem; margin-top: 0.25rem;
}
textarea { min-height: 6rem; resize: vertical; }
.check { display: flex; gap: 0.5rem; align-items: flex-start; font-weight: 400; }
.check input { width: 1.25rem; height: 1.25rem; margin: 0.15rem 0 0; flex: none; }
[aria-invalid="true"] { border-color: #b91c1c; }
.error { color: #b91c1c; font-weight: 600; margin: 0.25rem 0 0; }
.summary { border: 3px solid #b91c1c; border-radius: 6px; padding: 1rem; margin: 0 0 1.5rem; }
.summary h2 { font-size: 1.125rem; margin: 0 0 0.5rem; }
.summary ul { margin: 0; padding-left: 1.25rem; }
a { color: #1d4ed8; }
button { font: inherit; font-weight: 600; color: #ffffff; background: #1d4ed8; border: 2px solid #1d4ed8; border-radius: 6px; padding: 0.625rem 1.25rem; cursor: pointer; }
button:hover { background: #1e40af; }
:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
a:focus-visible, button:focus-visible { outline-color: #111827; }
dl { margin: 0 0 1.5rem; }
dt { font-weight: 600; }
dd { margin: 0 0 0.75rem; overflow-wrap: anywhere; white-space: pre-wrap; }
`;

const HEADERS = {
  "content-security-policy": "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Harbor Notes</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...HEADERS, ...headers });
  res.end(body);
}

function html(res, status, body) {
  send(res, status, body, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
}

const FIELD_LABELS = { name: "Full name", email: "Email address", company: "Company", teamSize: "Team size", usage: "What will you use Harbor Notes for?" };

/** Renders the form; `values` and `errors` come back from a rejected POST. */
function formPage(values = {}, errors = {}) {
  const v = { name: "", email: "", company: "", teamSize: TEAM_SIZES[0], usage: "", newsletter: false, ...values };
  const keys = Object.keys(errors);
  const firstInvalid = keys[0];
  const describedBy = (key, hint) => {
    const ids = [hint, errors[key] ? `${key}-error` : null].filter(Boolean);
    return ids.length ? ` aria-describedby="${ids.join(" ")}"` : "";
  };
  const invalid = (key) => (errors[key] ? ' aria-invalid="true"' : "");
  const autofocus = (key) => (key === firstInvalid ? " autofocus" : "");
  const errorText = (key) => (errors[key] ? `<p class="error" id="${key}-error">${esc(errors[key])}</p>` : "");

  const summary = keys.length
    ? `<div class="summary" role="alert" aria-labelledby="summary-title">
  <h2 id="summary-title">There ${keys.length === 1 ? "is a problem" : `are ${keys.length} problems`} with your sign-up</h2>
  <ul>${keys.map((k) => `<li><a href="#${k}">${esc(errors[k])}</a></li>`).join("")}</ul>
</div>`
    : "";

  return page(keys.length ? "Error: Sign up" : "Sign up", `<h1 id="form-title">Sign up for Harbor Notes</h1>
<p>Create your team's notebook. Fields marked "required" must be filled in.</p>
${summary}
<form method="post" action="/signup" aria-labelledby="form-title">
  <input type="hidden" name="form_token" value="${randomUUID()}">
  <div class="field">
    <label for="name">Full name (required)</label>
    <input type="text" id="name" name="name" autocomplete="name" required maxlength="${LIMITS.name}" value="${esc(v.name)}"${invalid("name")}${describedBy("name")}${autofocus("name")}>
    ${errorText("name")}
  </div>
  <div class="field">
    <label for="email">Email address (required)</label>
    <p class="hint" id="email-hint">We send your sign-in link here.</p>
    <input type="email" id="email" name="email" autocomplete="email" required maxlength="${LIMITS.email}" spellcheck="false" value="${esc(v.email)}"${invalid("email")}${describedBy("email", "email-hint")}${autofocus("email")}>
    ${errorText("email")}
  </div>
  <div class="field">
    <label for="company">Company (optional)</label>
    <input type="text" id="company" name="company" autocomplete="organization" maxlength="${LIMITS.company}" value="${esc(v.company)}"${invalid("company")}${describedBy("company")}${autofocus("company")}>
    ${errorText("company")}
  </div>
  <div class="field">
    <label for="teamSize">Team size</label>
    <select id="teamSize" name="teamSize"${invalid("teamSize")}${describedBy("teamSize")}${autofocus("teamSize")}>
      ${TEAM_SIZES.map((s) => `<option${s === v.teamSize ? " selected" : ""}>${esc(s)}</option>`).join("")}
    </select>
    ${errorText("teamSize")}
  </div>
  <div class="field">
    <label for="usage">What will you use Harbor Notes for? (optional)</label>
    <textarea id="usage" name="usage" maxlength="${LIMITS.usage}"${invalid("usage")}${describedBy("usage")}${autofocus("usage")}>${esc(v.usage)}</textarea>
    ${errorText("usage")}
  </div>
  <div class="field">
    <label class="check" for="newsletter"><input type="checkbox" id="newsletter" name="newsletter" value="yes"${v.newsletter ? " checked" : ""}> Send me the monthly product newsletter</label>
  </div>
  <button type="submit">Create account</button>
</form>`);
}

function thanksPage(s) {
  return page("Thank you", `<h1>Thanks, you're signed up</h1>
<p>We saved these details:</p>
<dl>
  <dt>${FIELD_LABELS.name}</dt><dd>${esc(s.name)}</dd>
  <dt>${FIELD_LABELS.email}</dt><dd>${esc(s.email)}</dd>
  <dt>${FIELD_LABELS.company}</dt><dd>${esc(s.company || "Not given")}</dd>
  <dt>${FIELD_LABELS.teamSize}</dt><dd>${esc(s.teamSize)}</dd>
  <dt>${FIELD_LABELS.usage}</dt><dd>${esc(s.usage || "Not given")}</dd>
  <dt>Newsletter</dt><dd>${s.newsletter ? "Yes" : "No"}</dd>
</dl>
<p><a href="/signup">Sign up someone else</a></p>`);
}

function notFound(res) {
  html(res, 404, page("Page not found", `<h1>Page not found</h1><p><a href="/signup">Go to the sign-up form</a></p>`));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input) {
  const errors = {};
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  const company = (input.company ?? "").trim();
  const usage = (input.usage ?? "").trim();
  const teamSize = input.teamSize ?? "";
  if (!name) errors.name = "Enter your full name";
  else if (name.length > LIMITS.name) errors.name = `Full name must be ${LIMITS.name} characters or fewer`;
  if (!email) errors.email = "Enter your email address";
  else if (email.length > LIMITS.email || !EMAIL.test(email)) errors.email = "Enter an email address in the format name@example.com";
  if (company.length > LIMITS.company) errors.company = `Company must be ${LIMITS.company} characters or fewer`;
  if (!TEAM_SIZES.includes(teamSize)) errors.teamSize = "Choose a team size from the list";
  if (usage.length > LIMITS.usage) errors.usage = `Your answer must be ${LIMITS.usage} characters or fewer`;
  const values = { name, email, company, teamSize: TEAM_SIZES.includes(teamSize) ? teamSize : TEAM_SIZES[0], usage, newsletter: input.newsletter === "yes" };
  return { errors, values };
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

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1d4ed8"/></svg>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    if (url.pathname === "/styles.css" && method === "GET") return send(res, 200, CSS, { "content-type": "text/css; charset=utf-8" });
    if ((url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") && method === "GET") {
      return send(res, 200, FAVICON, { "content-type": "image/svg+xml" });
    }
    if (url.pathname === "/" && method === "GET") return send(res, 302, "", { location: "/signup" });

    if (url.pathname === "/signup" && method === "GET") return html(res, 200, formPage());
    if (url.pathname === "/signup" && method === "POST") {
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/x-www-form-urlencoded" && type !== "multipart/form-data") {
        return html(res, 415, page("Unsupported form", `<h1>We couldn't read that form</h1><p><a href="/signup">Go back to the sign-up form</a></p>`));
      }
      let raw;
      try {
        raw = await readBody(req);
      } catch (err) {
        if (err?.status === 413) {
          return html(res, 413, page("Too much text", `<h1>That was too much text</h1><p>Please shorten your answers. <a href="/signup">Go back to the sign-up form</a></p>`));
        }
        throw err;
      }
      const input = Object.fromEntries(new URLSearchParams(raw));
      const token = typeof input.form_token === "string" ? input.form_token : "";
      if (token && usedTokens.has(token)) {
        return send(res, 303, "", { location: `/signup/thanks/${usedTokens.get(token)}` });
      }
      const { errors, values } = validate(input);
      if (Object.keys(errors).length > 0) return html(res, 422, formPage(values, errors));
      const id = randomUUID().slice(0, 8);
      signups.set(id, { id, ...values, createdAt: new Date().toISOString() });
      if (token) usedTokens.set(token, id);
      return send(res, 303, "", { location: `/signup/thanks/${id}` });
    }

    const thanks = /^\/signup\/thanks\/([a-f0-9-]{1,36})$/.exec(url.pathname);
    if (thanks && method === "GET") {
      const signup = signups.get(thanks[1]);
      return signup ? html(res, 200, thanksPage(signup)) : notFound(res);
    }

    if (["GET", "HEAD"].includes(method)) return notFound(res);
    send(res, 405, "Method not allowed", { "content-type": "text/plain; charset=utf-8", allow: "GET, POST" });
  } catch {
    if (!res.headersSent) html(res, 500, page("Something went wrong", `<h1>Something went wrong</h1><p>Please try again.</p>`));
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`classic-post listening on http://${HOST ?? "localhost"}:${PORT}/signup`);
});

const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
