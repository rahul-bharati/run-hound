/**
 * An app whose server never answers some requests (ENG-1): the error path forgets to send a response, a common bug and
 * exactly what verbose-errors and client-only-validation probe. Checks that fetch from inside the page must give up on
 * their own; page.evaluate has no timeout of its own.
 *
 * The page is a two-field contact form (name required, email) that posts JSON to /api/save and loads /app.js.
 * - A valid body with a name gets 201.
 * - `hang: "malformed"`: a body that is not JSON is never answered (verbose-errors' malformed replay).
 * - `hang: "invalid"`: a JSON body with an empty name is never answered (client-only-validation's replay).
 * - `hang: "refetch"`: /app.js is answered when the page loads it as a script, never when a script fetches it
 *   (bundle-secrets' re-fetch, Sec-Fetch-Dest: empty).
 * close() ends the requests left hanging, so the server can stop.
 */
import type { ServerResponse } from "node:http";
import { json, startFixtureServer, type FixtureServer } from "../../../test-support/server.js";

export interface HangApp extends FixtureServer {
  /** Requests the server left unanswered so far. */
  hung(): number;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title><script src="/app.js"></script></head>
<body><main><h1>Contact</h1>
<form id="contact" novalidate>
  <label for="name">Name</label><input id="name" name="name" required>
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email">
  <button type="submit">Save</button><p id="msg" role="status"></p>
</form></main>
<script>
document.getElementById("contact").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value, email = document.getElementById("email").value;
  if (!name.trim()) { document.getElementById("msg").textContent = "Please enter your name"; return; }
  const r = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email }) });
  document.getElementById("msg").textContent = r.ok ? "Saved" : "Could not save";
});
</script></body></html>`;

export async function startHangApp(hang: "malformed" | "invalid" | "refetch"): Promise<HangApp> {
  const pending: ServerResponse[] = [];
  const server = await startFixtureServer({
    pages: { "/contact": PAGE },
    routes: {
      "GET /app.js": (req, res) => {
        if (hang === "refetch" && req.headers["sec-fetch-dest"] === "empty") return void pending.push(res);
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("window.appReady = true;\n");
      },
      "POST /api/save": (req, res) => {
        let body: { name?: unknown } | null = null;
        try {
          body = JSON.parse(req.body) as { name?: unknown };
        } catch {
          if (hang === "malformed") return void pending.push(res);
          return json(res, 400, { error: "Please send JSON." });
        }
        const named = typeof body?.name === "string" && body.name.trim() !== "";
        if (!named && hang === "invalid") return void pending.push(res);
        if (!named) return json(res, 400, { errors: { name: "Please enter your name." } });
        json(res, 201, { id: "1", ...body });
      },
    },
  });
  return {
    ...server,
    hung: () => pending.length,
    async close() {
      for (const res of pending.splice(0)) res.destroy();
      await server.close();
    },
  };
}
