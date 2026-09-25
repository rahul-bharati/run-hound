/**
 * The server contract built by the scaffold (CONTRACT.md "Process", "Routes", "API", "Response headers, cookies and
 * source maps", W06/W08/W09): bug parsing, static files and the SPA fallback, security headers, the session cookie,
 * source maps, the API pipeline (404s, malformed JSON, body limit, the "Crash" rule, Idempotency-Key replay) and a
 * browser smoke test of the six routes.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.mjs";
import { ALL_BUGS as SERVER_BUGS, BugConfigError, parseBugs } from "../server/bugs.mjs";
import { badRequest, crashIfNamed, created, createRouter, isCrash, ok, validator } from "../server/http.mjs";
import { verifyPassword } from "../server/passwords.mjs";
import { createSeed, DEMO_ACCOUNT as SEED_ACCOUNT } from "../server/seed.mjs";
import {
  ALL_BUGS,
  api,
  axeViolations,
  closeBrowser,
  CSP,
  DEMO_ACCOUNT,
  FERNWAY_ROOT,
  freePort,
  openPage,
  ROUTES,
  STACK_RE,
  useFernway,
  type Fernway,
} from "./support.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CLEAN_COOKIE = new RegExp(`^fernway_session=${UUID}; Path=/; HttpOnly; SameSite=Lax$`);
const W09_COOKIE = new RegExp(`^fernway_session=${UUID}; Path=/; SameSite=Lax$`);
const STRIPE_SECRET = /sk_live_[A-Za-z0-9]{24,}/;

const DIST = join(FERNWAY_ROOT, "dist");
const distAssets = () => readdirSync(join(DIST, "assets"));

function expectSecurityHeaders(headers: Headers) {
  expect(headers.get("content-security-policy")).toBe(CSP);
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
}

function expectNoSecurityHeaders(headers: Headers) {
  expect(headers.get("content-security-policy")).toBeNull();
  expect(headers.get("x-content-type-options")).toBeNull();
  expect(headers.get("referrer-policy")).toBeNull();
}

/** A raw GET that does not normalise the path (fetch would resolve "..", so traversal needs node:http). */
function rawGet(fw: Fernway, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: fw.port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Runs the real entry point with the given env and waits for it to exit (for start-up failures). */
function runServer(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: FERNWAY_ROOT,
      env: { ...process.env, HOST: "127.0.0.1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

afterAll(async () => {
  await closeBrowser();
});

// ---- FERNWAY_BUGS ------------------------------------------------------------------------------

describe("FERNWAY_BUGS parsing", () => {
  it("knows W01..W10, the same list the tests use", () => {
    expect([...SERVER_BUGS]).toEqual([...ALL_BUGS]);
  });

  it("none, empty and unset mean clean mode; all enables every id", () => {
    expect([...parseBugs()]).toEqual([]);
    expect([...parseBugs("none")]).toEqual([]);
    expect([...parseBugs(" NONE ")]).toEqual([]);
    expect([...parseBugs("")]).toEqual([]);
    expect([...parseBugs("all")].sort()).toEqual([...ALL_BUGS]);
    expect([...parseBugs("ALL")].sort()).toEqual([...ALL_BUGS]);
  });

  it("a comma list is case-insensitive and ignores whitespace and empty entries", () => {
    expect([...parseBugs("w01, W06 ,,w10")].sort()).toEqual(["W01", "W06", "W10"]);
    expect([...parseBugs(" w0 8 ")]).toEqual(["W08"]);
  });

  it("an unknown id throws, naming the known ids", () => {
    expect(() => parseBugs("W01,W99")).toThrow(BugConfigError);
    expect(() => parseBugs("W99")).toThrow(/W99.*W01, W02, W03, W04, W05, W06, W07, W08, W09, W10/);
  });

  it("the server exits 1 on an unknown id and names the known ids", async () => {
    const port = await freePort();
    const { code, stderr, stdout } = await runServer({ PORT: String(port), FERNWAY_BUGS: "W01,x42" });
    expect(code).toBe(1);
    expect(stderr).toContain("X42");
    expect(stderr).toContain("W01, W02, W03, W04, W05, W06, W07, W08, W09, W10");
    expect(stdout).not.toContain("fernway listening");
  });

  it("the server rejects a PORT that is not a port number", async () => {
    const { code, stderr } = await runServer({ PORT: "not-a-port", FERNWAY_BUGS: "none" });
    expect(code).toBe(1);
    expect(stderr).toContain("PORT");
  });
});

// ---- clean mode over HTTP ----------------------------------------------------------------------

describe("clean mode: pages, static files and headers", () => {
  const ref = useFernway("none");

  it("prints the listening line with the active bugs", () => {
    expect(ref.fw.output()).toMatch(/fernway listening on http:\/\/127\.0\.0\.1:\d+\/ \(bugs: none\)/);
  });

  it.each(ROUTES)("%s serves index.html with 200, the security headers and a first-visit session cookie", async (route) => {
    const res = await fetch(`${ref.fw.url}${route}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(res.headers);
    expect(res.headers.get("set-cookie")).toMatch(CLEAN_COOKIE);
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<html lang="en">');
  });

  it("accepts a trailing slash on the routes", async () => {
    for (const route of ["/app/", "/app/settings/", "/signup/"]) {
      expect((await fetch(`${ref.fw.url}${route}`)).status).toBe(200);
    }
  });

  it("does not set the session cookie again once the browser has one", async () => {
    const first = await fetch(`${ref.fw.url}/`);
    const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
    const second = await fetch(`${ref.fw.url}/app`, { headers: { cookie } });
    expect(second.status).toBe(200);
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it.each(["/nope", "/app/nope", "/pricing", "/index.html", "/assets"])("unknown page %s answers 404 with the SPA (Page not found view)", async (path) => {
    const res = await fetch(`${ref.fw.url}${path}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toContain('<div id="root"></div>');
  });

  it("a missing file answers a plain 404", async () => {
    for (const path of ["/assets/missing.js", "/images/missing.webp", "/config/billing.js"]) {
      const res = await fetch(`${ref.fw.url}${path}`);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expectSecurityHeaders(res.headers);
    }
  });

  it("serves hashed assets with their MIME type and immutable caching", async () => {
    const assets = distAssets();
    const js = assets.find((f) => f.endsWith(".js"))!;
    const css = assets.find((f) => f.endsWith(".css"))!;
    const font = assets.find((f) => f.endsWith(".woff2"))!;
    for (const [file, type] of [
      [js, "text/javascript; charset=utf-8"],
      [css, "text/css; charset=utf-8"],
      [font, "font/woff2"],
    ] as const) {
      const res = await fetch(`${ref.fw.url}/assets/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expectSecurityHeaders(res.headers);
    }
  });

  it("serves public files (favicon, theme script, every image) with their MIME types", async () => {
    const images = readdirSync(join(DIST, "images")).filter((f) => /\.(svg|webp|png|jpe?g|avif)$/.test(f));
    expect(images.length).toBeGreaterThan(0);
    const types: Record<string, string> = {
      svg: "image/svg+xml",
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      avif: "image/avif",
      js: "text/javascript; charset=utf-8",
    };
    for (const path of ["/favicon.svg", "/theme-init.js", ...images.map((f) => `/images/${f}`)]) {
      const res = await fetch(`${ref.fw.url}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe(types[path.split(".").pop()!]);
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  it("source maps are built hidden and every *.map answers 404", async () => {
    const maps = distAssets().filter((f) => f.endsWith(".map"));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) expect((await fetch(`${ref.fw.url}/assets/${map}`)).status).toBe(404);
    const js = distAssets().filter((f) => f.endsWith(".js"));
    for (const file of js) expect(readFileSync(join(DIST, "assets", file), "utf8")).not.toContain("sourceMappingURL");
  });

  it("never serves files outside dist/", async () => {
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fserver%2findex.mjs", "/%2e%2e/%2e%2e/package.json"]) {
      const res = await rawGet(ref.fw, path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.body, path).not.toContain('"name": "fernway"');
      expect(res.body, path).not.toContain("createApp");
    }
  });

  it("non-GET requests to pages answer 405", async () => {
    const res = await fetch(`${ref.fw.url}/`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("GET /api/__config answers { bugs: [] } in clean mode; POST /api/__reset answers 204", async () => {
    const config = await api(ref.fw, "/api/__config");
    expect(config.status).toBe(200);
    expect(config.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(config.body).toEqual({ bugs: [] });
    expectSecurityHeaders(config.headers);
    const reset = await fetch(`${ref.fw.url}/api/__reset`, { method: "POST" });
    expect(reset.status).toBe(204);
    expect(await reset.text()).toBe("");
  });

  it("unknown /api/* paths answer 404 { error: 'Not found' } for every method, with no CORS headers", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await api(ref.fw, "/api/does-not-exist", { method, headers: { origin: "http://evil.example" } });
      expect(res.status, method).toBe(404);
      expect(res.body, method).toEqual({ error: "Not found" });
      for (const [name] of res.headers) expect(name.startsWith("access-control-"), name).toBe(false);
      expectSecurityHeaders(res.headers);
    }
    expect((await api(ref.fw, "/api")).status).toBe(404);
  });

  it("the clean bundle and page carry no secret", async () => {
    const html = await (await fetch(`${ref.fw.url}/`)).text();
    expect(html).not.toContain("/config/billing.js");
    for (const file of distAssets().filter((f) => !f.endsWith(".map") && !f.endsWith(".woff2"))) {
      expect(readFileSync(join(DIST, "assets", file), "utf8"), file).not.toMatch(STRIPE_SECRET);
    }
    expect(readFileSync(join(DIST, "index.html"), "utf8")).not.toMatch(/sk_live_/);
  });
});

// ---- bug switches ------------------------------------------------------------------------------

describe("W08: no security headers", () => {
  const ref = useFernway("W08");

  it("pages, assets and the API answer without CSP, nosniff or Referrer-Policy", async () => {
    const js = distAssets().find((f) => f.endsWith(".js"))!;
    for (const path of ["/", "/app", "/nope", `/assets/${js}`, "/api/__config", "/api/nope"]) {
      const res = await fetch(`${ref.fw.url}${path}`);
      expectNoSecurityHeaders(res.headers);
    }
  });

  it("changes nothing else: the cookie keeps HttpOnly", async () => {
    expect((await fetch(`${ref.fw.url}/`)).headers.get("set-cookie")).toMatch(CLEAN_COOKIE);
  });
});

describe("W09: session cookie without HttpOnly", () => {
  const ref = useFernway("W09");

  it("sets fernway_session with Path=/ and SameSite=Lax but no HttpOnly", async () => {
    const res = await fetch(`${ref.fw.url}/`);
    expect(res.headers.get("set-cookie")).toMatch(W09_COOKIE);
    expectSecurityHeaders(res.headers);
  });
});

describe("W06: a Stripe-style live secret key in the page's JavaScript", () => {
  const ref = useFernway("w06");

  it("index.html loads /config/billing.js, which holds an obviously fake sk_live_ key", async () => {
    const html = await (await fetch(`${ref.fw.url}/app`)).text();
    expect(html).toContain('<script src="/config/billing.js"></script>');
    const res = await fetch(`${ref.fw.url}/config/billing.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const text = await res.text();
    const key = text.match(STRIPE_SECRET)?.[0];
    expect(key).toBeTruthy();
    expect(key).toMatch(/FAKE/);
  });

  it("the browser really loads the key script, with no console errors (CSP allows it)", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      const scripts = events.requests.filter((r) => r.resourceType() === "script").map((r) => new URL(r.url()).pathname);
      expect(scripts).toContain("/config/billing.js");
      expect(await page.evaluate(() => typeof (window as unknown as { fernwayBilling?: unknown }).fernwayBilling)).toBe("object");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("GET /api/__config lists the enabled ids, sorted", async () => {
    expect((await api(ref.fw, "/api/__config")).body).toEqual({ bugs: ["W06"] });
  });
});

describe("FERNWAY_BUGS=all", () => {
  const ref = useFernway("all");

  it("GET /api/__config lists all ten ids, sorted", async () => {
    expect((await api(ref.fw, "/api/__config")).body).toEqual({ bugs: [...ALL_BUGS] });
  });
});

// ---- the API pipeline (in-process app with test routes) ----------------------------------------

describe("API pipeline", () => {
  let server: Server;
  let base = "";
  const logs: string[] = [];
  let calls = 0;
  let flaky = 0;
  let resetHookRuns = 0;
  const app = createApp({
    root: FERNWAY_ROOT,
    log: (line) => logs.push(line),
    modules: [
      {
        register(router, ctx) {
          ctx.onReset(() => {
            resetHookRuns++;
          });
          router.post("/api/echo", ({ body, idempotencyKey }) => created({ n: ++calls, body, idempotencyKey }));
          router.post("/api/echo-no-idem", ({ body }) => created({ n: ++calls, body }), { idempotency: false });
          router.post("/api/crash", ({ body }) => {
            crashIfNamed(body.name);
            return created({ n: ++calls });
          });
          router.post("/api/flaky", () => {
            flaky++;
            if (flaky === 1) throw new Error("temporary failure in /home/someone/server/db.mjs");
            return created({ n: ++calls });
          });
          router.get("/api/throws", () => {
            throw new Error("boom at /srv/fernway/server/app.mjs:12:3");
          });
          router.put("/api/items/:id", ({ params, body }) => ok({ id: params.id, body }));
          router.post("/api/validate", ({ body }) => {
            const v = validator(body);
            const email = v.email("email", { required: "Enter your email." });
            const size = v.oneOf("size", ["S", "M"] as const, { required: "Choose a size." });
            if (!v.ok) return badRequest(v.errors);
            return created({ email, size });
          });
          router.get("/api/store", () => ok({ projects: ctx.store.projects.length, members: ctx.store.members.length }));
          router.post("/api/store/mutate", () => {
            ctx.store.projects.push({ ...ctx.store.projects[0]!, id: "extra" });
            return created({ projects: ctx.store.projects.length });
          });
        },
      },
    ],
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeAll(async () => {
    const port = await freePort();
    server = createServer((req, res) => void app.handle(req, res));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    app.reset();
    logs.length = 0;
    calls = 0;
  });

  it("parses a JSON object body; an empty body is {}", async () => {
    const res = await post("/api/echo", { a: 1, nested: { b: [1, 2] } });
    expect(res.status).toBe(201);
    expect((await res.json()).body).toEqual({ a: 1, nested: { b: [1, 2] } });
    const empty = await fetch(`${base}/api/echo`, { method: "POST" });
    expect(empty.status).toBe(201);
    expect((await empty.json()).body).toEqual({});
  });

  it("malformed JSON answers 400 { errors: { body } }", async () => {
    for (const raw of ["{not json", "{\"a\":", "undefined"]) {
      const res = await post("/api/echo", raw);
      expect(res.status, raw).toBe(400);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["errors"]);
      expect(typeof body.errors.body).toBe("string");
    }
  });

  it("a JSON value that is not an object answers 400", async () => {
    for (const raw of ["[1,2]", "null", "42", "\"text\""]) {
      const res = await post("/api/echo", raw);
      expect(res.status, raw).toBe(400);
      expect(typeof (await res.json()).errors.body).toBe("string");
    }
  });

  it("a body over the limit answers 413", async () => {
    const res = await post("/api/echo", JSON.stringify({ big: "x".repeat(300 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body too large" });
  });

  it("the name 'Crash' (after trim) makes the request fail with a bare 500", async () => {
    const res = await post("/api/crash", { name: "  Crash " });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Something went wrong" });
    expect(text).not.toMatch(STACK_RE);
    expect((await post("/api/crash", { name: "Crashy" })).status).toBe(201);
    expect(isCrash("Crash", "x")).toBe(true);
    expect(isCrash("crash", 1, null)).toBe(false);
  });

  it("a thrown error answers 500 without stack, paths or internals; the detail goes to the server log", async () => {
    const res = await fetch(`${base}/api/throws`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Something went wrong" });
    expect(text).not.toMatch(STACK_RE);
    expect(text).not.toContain("/srv/");
    expect(logs.join("\n")).toContain("boom");
  });

  it("route params are decoded; HEAD matches GET routes", async () => {
    const res = await fetch(`${base}/api/items/a%20b`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
    expect(await res.json()).toEqual({ id: "a b", body: {} });
    expect((await fetch(`${base}/api/store`, { method: "HEAD" })).status).toBe(200);
  });

  it("the same Idempotency-Key replays the first response (no second record)", async () => {
    const first = await post("/api/echo", { v: 1 }, { "idempotency-key": "key-1" });
    const second = await post("/api/echo", { v: 2 }, { "idempotency-key": "key-1" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await first.json();
    const b = await second.json();
    expect(b).toEqual(a);
    expect(a.n).toBe(1);
    expect(a.idempotencyKey).toBe("key-1");
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    // A new key is a new record.
    expect((await (await post("/api/echo", { v: 3 }, { "idempotency-key": "key-2" })).json()).n).toBe(2);
    // No key: every request is new.
    expect((await (await post("/api/echo", { v: 4 })).json()).n).toBe(3);
  });

  it("concurrent requests with one key (a double click) create one record", async () => {
    const [x, y] = await Promise.all([post("/api/echo", { v: 1 }, { "idempotency-key": "dbl" }), post("/api/echo", { v: 1 }, { "idempotency-key": "dbl" })]);
    const [bx, by] = [await x.json(), await y.json()];
    expect(bx).toEqual(by);
    expect(calls).toBe(bx.n);
  });

  it("a key is scoped to its endpoint", async () => {
    const a = await (await post("/api/echo", {}, { "idempotency-key": "shared" })).json();
    const b = await (await post("/api/crash", { name: "ok" }, { "idempotency-key": "shared" })).json();
    expect(b.n).toBe(a.n + 1);
  });

  it("{ idempotency: false } ignores the header (W03's server side)", async () => {
    const a = await (await post("/api/echo-no-idem", {}, { "idempotency-key": "same" })).json();
    const b = await (await post("/api/echo-no-idem", {}, { "idempotency-key": "same" })).json();
    expect(b.n).toBe(a.n + 1);
  });

  it("server failures are not cached: a retry with the same key runs again", async () => {
    flaky = 0;
    const first = await post("/api/flaky", {}, { "idempotency-key": "retry" });
    expect(first.status).toBe(500);
    const second = await post("/api/flaky", {}, { "idempotency-key": "retry" });
    expect(second.status).toBe(201);
    const crash1 = await post("/api/crash", { name: "Crash" }, { "idempotency-key": "c" });
    const crash2 = await post("/api/crash", { name: "Crash" }, { "idempotency-key": "c" });
    expect([crash1.status, crash2.status]).toEqual([500, 500]);
    expect(crash2.headers.get("idempotent-replayed")).toBeNull();
  });

  it("validation errors come back as 400 { errors: { field: message } } (and replay like any response)", async () => {
    const res = await post("/api/validate", { email: "nope", extra: "ignored" }, { "idempotency-key": "v" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { email: "Enter an email address like name@example.com.", size: "Choose a size." } });
    const good = await post("/api/validate", { email: " Ada@Example.test ", size: "M" });
    expect(await good.json()).toEqual({ email: "ada@example.test", size: "M" });
  });

  it("POST /api/__reset restores the seed, clears the replay cache and runs onReset hooks", async () => {
    const before = resetHookRuns;
    await post("/api/store/mutate", {});
    expect((await (await fetch(`${base}/api/store`)).json()).projects).toBe(7);
    const k1 = await (await post("/api/echo", {}, { "idempotency-key": "after-reset" })).json();
    const reset = await fetch(`${base}/api/__reset`, { method: "POST" });
    expect(reset.status).toBe(204);
    expect(resetHookRuns).toBe(before + 1);
    expect(await (await fetch(`${base}/api/store`)).json()).toEqual({ projects: 6, members: 8 });
    const k2 = await (await post("/api/echo", {}, { "idempotency-key": "after-reset" })).json();
    expect(k2.n).toBe(k1.n + 1);
  });

  it("ctx.sessionCookie follows W09; ctx.sessionUser resolves a session", () => {
    expect(app.ctx.sessionCookie("abc")).toBe("fernway_session=abc; Path=/; HttpOnly; SameSite=Lax");
    const w09 = createApp({ bugs: new Set(["W09"]), modules: [] });
    expect(w09.ctx.sessionCookie("abc")).toBe("fernway_session=abc; Path=/; SameSite=Lax");
    expect(app.ctx.sessionUser({})).toBeNull();
    app.ctx.store.sessions.set("sid-1", "alex-rivera");
    expect(app.ctx.sessionUser({ fernway_session: "sid-1" })?.email).toBe(DEMO_ACCOUNT.email);
  });

  it("registering one method and path twice throws", () => {
    const router = createRouter();
    router.get("/api/x", () => ok(1));
    expect(() => router.get("/api/x", () => ok(2))).toThrow(/twice/);
    expect(() => router.get("/nope", () => ok(1))).toThrow(/\/api\//);
  });
});

// ---- seed ----------------------------------------------------------------------------------------

describe("seed data", () => {
  it("has 6 projects, 8 members with avatar indexes 0-7, 1 profile, tasks and the demo account", () => {
    const seed = createSeed();
    expect(seed.projects).toHaveLength(6);
    expect(new Set(seed.projects.map((p) => p.status))).toEqual(new Set(["active", "paused", "done"]));
    expect(seed.members).toHaveLength(8);
    expect(seed.members.map((m) => m.avatar)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(seed.members[0]!.name).toBe("Alex Rivera");
    for (const p of seed.projects) expect(seed.members.some((m) => m.id === p.ownerId)).toBe(true);
    for (const t of seed.tasks) expect(seed.projects.some((p) => p.id === t.projectId)).toBe(true);
    expect(seed.profile.displayName).toBe("Alex Rivera");
    expect(seed.profile.bio.length).toBeLessThanOrEqual(160);
    expect(Object.keys(seed.notifications)).toHaveLength(4);
    expect(SEED_ACCOUNT).toEqual(DEMO_ACCOUNT);
  });

  it("stores the demo password hashed, never in plain text", () => {
    const seed = createSeed();
    const user = seed.users[0]!;
    expect(JSON.stringify(seed.users)).not.toContain(DEMO_ACCOUNT.password);
    expect(verifyPassword(DEMO_ACCOUNT.password, user.passwordHash)).toBe(true);
    expect(verifyPassword("wrong-password", user.passwordHash)).toBe(false);
  });

  it("returns a fresh copy each time", () => {
    const a = createSeed();
    a.projects.pop();
    a.profile.bio = "changed";
    const b = createSeed();
    expect(b.projects).toHaveLength(6);
    expect(b.profile.bio).not.toBe("changed");
  });
});

// ---- the six routes in a browser ---------------------------------------------------------------

describe("the routes render in a browser (clean mode)", () => {
  const ref = useFernway("none");

  it.each(ROUTES)("%s renders one h1 and one main, a Fernway: title, and loads with no errors", async (route) => {
    const { page, events, close } = await openPage(ref.fw, route);
    try {
      await page.locator("h1").first().waitFor();
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.locator("main").count()).toBe(1);
      expect(await page.title()).toMatch(/^Fernway: \S/);
      expect(await page.locator("html").getAttribute("lang")).toBe("en");
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
      const paths = events.requests.map((r) => new URL(r.url()).pathname);
      expect(paths).toContain("/api/__config");
      expect(events.requests.every((r) => r.url().startsWith(ref.fw.url))).toBe(true);
    } finally {
      await close();
    }
  });

  it("an unknown path shows the Page not found view (document 404, nothing else failing)", async () => {
    const { page, events, close } = await openPage(ref.fw, "/definitely/not/here");
    try {
      await page.getByRole("heading", { level: 1, name: "Page not found" }).waitFor();
      expect(await page.title()).toBe("Fernway: Page not found");
      expect(events.badResponses).toEqual([`404 ${ref.fw.url}/definitely/not/here`]);
      expect(events.pageErrors).toEqual([]);
      expect(events.consoleErrors.filter((e) => !e.includes("404"))).toEqual([]);
    } finally {
      await close();
    }
  });

  it("follows the OS color scheme, and the theme toggle switches and remembers it", async () => {
    const { page, close } = await openPage(ref.fw, "/", { colorScheme: "dark" });
    try {
      expect(await page.locator("html").getAttribute("class")).toContain("dark");
      const toggle = page.getByRole("button", { name: "Switch to light theme" });
      expect(await toggle.getAttribute("aria-pressed")).toBe("true");
      await toggle.click();
      const back = page.getByRole("button", { name: "Switch to dark theme" });
      await back.waitFor();
      expect(await back.getAttribute("aria-pressed")).toBe("false");
      expect(await page.locator("html").getAttribute("class")).not.toContain("dark");
      await page.reload({ waitUntil: "networkidle" });
      expect(await page.locator("html").getAttribute("class") ?? "").not.toContain("dark");
    } finally {
      await close();
    }
  });

  it("the app shell: sidebar collapse, command palette (Ctrl+K), notifications and account menu", async () => {
    const { page, events, close } = await openPage(ref.fw, "/app");
    try {
      const collapse = page.getByRole("button", { name: "Collapse sidebar" });
      expect(await collapse.getAttribute("aria-expanded")).toBe("true");
      await collapse.click();
      const expand = page.getByRole("button", { name: "Expand sidebar" });
      expect(await expand.getAttribute("aria-expanded")).toBe("false");
      await expand.click();

      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog", { name: "Search Fernway" });
      await palette.waitFor();
      await page.getByRole("combobox", { name: "Search Fernway" }).fill("settings");
      await page.getByRole("option", { name: "Settings" }).click();
      await page.waitForURL(`${ref.fw.url}/app/settings`);
      await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();

      await page.getByRole("button", { name: "Search" }).click();
      await palette.waitFor();
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });

      await page.getByRole("button", { name: "Notifications" }).click();
      const items = page.getByRole("dialog").getByRole("listitem");
      expect(await items.count()).toBe(3);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Account menu" }).click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      expect(await menu.getByRole("menuitem").allTextContents()).toEqual(["Profile", "Settings", "Sign out"]);
      await page.keyboard.press("Escape");

      expect(await page.getByText("Signed in as Alex Rivera · Demo workspace").count()).toBeGreaterThan(0);
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("the shell and every placeholder page pass axe (Run Hound's tags) in %s mode", async (colorScheme) => {
    for (const route of [...ROUTES, "/nope"]) {
      const { page, close } = await openPage(ref.fw, route, { colorScheme, reducedMotion: "reduce" });
      try {
        await page.locator("h1").first().waitFor();
        expect(await axeViolations(page), `${route} (${colorScheme})`).toEqual([]);
      } finally {
        await close();
      }
    }
  });

  it("the shell's open overlays (palette, notifications, account menu) pass axe", async () => {
    const { page, close } = await openPage(ref.fw, "/app", { reducedMotion: "reduce" });
    try {
      await page.getByRole("button", { name: "Search" }).click();
      await page.getByRole("dialog", { name: "Search Fernway" }).waitFor();
      expect(await axeViolations(page), "palette").toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Notifications" }).click();
      await page.getByRole("dialog").waitFor();
      expect(await axeViolations(page), "notifications").toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menu").waitFor();
      expect(await axeViolations(page), "account menu").toEqual([]);
    } finally {
      await close();
    }
  });

  it("at 320px wide no route scrolls horizontally", async () => {
    for (const route of ROUTES) {
      const { page, close } = await openPage(ref.fw, route, { viewport: { width: 320, height: 800 } });
      try {
        await page.locator("h1").first().waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, route).toBeLessThanOrEqual(1);
      } finally {
        await close();
      }
    }
  });
});

describe("W05: icon-only shell buttons lose their names on /app only", () => {
  const ref = useFernway("W05");

  it("collapse and notifications have no accessible name on /app, and keep them on /app/settings", async () => {
    const { page, close } = await openPage(ref.fw, "/app");
    try {
      await page.locator("h1").waitFor();
      expect(await page.getByRole("button", { name: "Collapse sidebar" }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Notifications" }).count()).toBe(0);
      expect(await page.locator("button[aria-controls=app-sidebar]").count()).toBe(1);
      await page.goto(`${ref.fw.url}/app/settings`, { waitUntil: "networkidle" });
      await page.locator("h1").waitFor();
      expect(await page.getByRole("button", { name: "Collapse sidebar" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Notifications" }).count()).toBe(1);
    } finally {
      await close();
    }
  });
});
