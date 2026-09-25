import type { ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, runPageCheck } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { check as cookieFlags, cookieProblems, isSessionCookie } from "./cookie-flags.js";
import { check as cors, corsVerdict, PROBE_ORIGIN } from "./cors.js";
import { check as pageControls } from "./page-controls.js";
import { check as securityHeaders, headerProblems } from "./security-headers.js";
import { check as sourceMaps, parseMap, sourceMappingUrl } from "./source-maps.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await closeBrowser();
});

/** Headers a well-configured production app sends with its pages. */
const GOOD_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const PAGE = `<!doctype html><html><head><title>Shop</title><script src="/app.js" defer></script></head><body>
<header><button type="button" id="theme">Toggle theme</button><button type="button" id="dead">Refresh</button><a href="/about">About</a></header>
<main><h1>Sign up</h1><form id="signup"><label for="email">Email</label><input id="email" name="email" type="email" required><button>Join</button></form>
<h2>Search</h2><form id="search" role="search"><label for="q">Search</label><input id="q" name="q"><button>Go</button></form>
<ul><li>Item <button type="button" id="del">Delete</button></li></ul></main></body></html>`;

const APP_JS = (map: boolean) => `document.getElementById("theme").addEventListener("click", () => document.body.classList.toggle("dark"));
fetch("/api/me", { credentials: "include" });${map ? "\n//# sourceMappingURL=app.js.map" : ""}`;

const MAP = JSON.stringify({ version: 3, sources: ["src/app.ts", "src/admin.ts"], sourcesContent: ["const secretRoute = '/admin';", ""], mappings: "AAAA" });

async function app(options: { headers?: Record<string, string>; cookie?: string; reflectCors?: boolean; map?: boolean } = {}) {
  const page = (res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...(options.headers ?? {}),
      ...(options.cookie ? { "set-cookie": options.cookie } : {}),
    });
    res.end(PAGE);
  };
  const s = await startFixtureServer({
    routes: {
      "GET /": (_req, res) => page(res),
      "GET /app.js": (_req, res) => {
        res.writeHead(200, { "content-type": "text/javascript", ...(options.headers ?? {}) });
        res.end(APP_JS(Boolean(options.map)));
      },
      "GET /app.js.map": (_req, res) => {
        res.writeHead(options.map ? 200 : 404, { "content-type": "application/json" });
        res.end(options.map ? MAP : "");
      },
      "GET /api/me": (req, res) => {
        const origin = req.headers.origin;
        const cors: Record<string, string> = options.reflectCors && origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } : {};
        res.writeHead(200, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ name: "Test" }));
      },
    },
  });
  servers.push(s);
  return `${s.url}/`;
}

describe("V1 page discovery via the page checks", () => {
  it("page-controls plans the buttons outside the forms, leaves destructive ones out, and finds the dead one", async () => {
    const { scenarios, results } = await runPageCheck(pageControls, await app({ headers: GOOD_HEADERS }));
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.description).toContain("Toggle theme");
    expect(scenarios[0]!.description).toContain("Refresh");
    expect(scenarios[0]!.description).toMatch(/Left out unless you allow destructive scenarios: "Delete"/);
    expect(results[0]!.status).toBe("fail");
    const [finding] = results[0]!.findings;
    expect(finding!.checkId).toBe("page-controls");
    expect(finding!.title).toBe('"Refresh" button does nothing');
    expect(finding!.evidence.some((e) => e.kind === "gif")).toBe(true);
  });
});

describe("security-headers", () => {
  it("headerProblems: nothing wrong with a good set; each missing header named", () => {
    expect(headerProblems(GOOD_HEADERS, false)).toEqual([]);
    expect(headerProblems({}, false).map((p) => p.header)).toEqual(["Content-Security-Policy", "Clickjacking protection (frame-ancestors or X-Frame-Options)", "X-Content-Type-Options"]);
    expect(headerProblems({ ...GOOD_HEADERS }, true).map((p) => p.header)).toEqual(["Strict-Transport-Security"]);
    const lax = headerProblems({ ...GOOD_HEADERS, "content-security-policy": "default-src * 'unsafe-inline'; frame-ancestors 'none'" }, false);
    expect(lax.map((p) => [p.header, p.severity])).toEqual([["Content-Security-Policy", "low"]]);
    const nonce = headerProblems({ ...GOOD_HEADERS, "content-security-policy": "script-src 'nonce-abc' 'unsafe-inline'; frame-ancestors 'none'" }, false);
    expect(nonce).toEqual([]);
    expect(headerProblems({ ...GOOD_HEADERS, "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" }, false)).toEqual([]);
  });

  it("passes on a page with good headers, fails with one finding and a card on a page without them", async () => {
    const good = await runPageCheck(securityHeaders, await app({ headers: GOOD_HEADERS }));
    expect(good.results[0]!.status).toBe("pass");
    const bad = await runPageCheck(securityHeaders, await app());
    expect(bad.results[0]!.status).toBe("fail");
    const [f] = bad.results[0]!.findings;
    expect(f!.title).toMatch(/^3 security header problems/);
    expect(f!.severity).toBe("medium");
    expect(f!.confidence).toBe("confirmed");
    expect(f!.evidence[0]!.kind).toBe("card");
    expect(f!.spec!.source).toContain('headers["content-security-policy"]');
  });
});

describe("cookie-flags", () => {
  it("recognises session-like names and leaves CSRF tokens alone", () => {
    for (const n of ["session", "connect.sid", "kennel_session", "auth_token", "sb-access-token", "remember_me", "JSESSIONID"]) expect(isSessionCookie(n), n).toBe(true);
    for (const n of ["theme", "csrftoken", "XSRF-TOKEN", "_ga", "consent"]) expect(isSessionCookie(n), n).toBe(false);
  });

  it("cookieProblems: HttpOnly always, SameSite=None from the header, Secure on https only", () => {
    const server = new Map([["sid", "sid=1; Path=/; SameSite=None; Secure"]]);
    expect(cookieProblems([{ name: "sid", httpOnly: true, secure: true }], server, true)[0]!.issues.map((i) => i.flag)).toEqual(["SameSite"]);
    expect(cookieProblems([{ name: "session", httpOnly: false, secure: false }], new Map(), false)).toEqual([
      { name: "session", setBy: "script", issues: [expect.objectContaining({ flag: "HttpOnly", severity: "high" })] },
    ]);
    expect(cookieProblems([{ name: "session", httpOnly: true, secure: false }], new Map([["session", "session=1; HttpOnly"]]), true)[0]!.issues.map((i) => i.flag)).toEqual(["Secure"]);
    expect(cookieProblems([{ name: "theme", httpOnly: false, secure: false }], new Map(), true)).toEqual([]);
  });

  it("passes with an HttpOnly session cookie and fails when scripts can read it", async () => {
    const good = await runPageCheck(cookieFlags, await app({ cookie: "app_session=abc123; Path=/; HttpOnly; SameSite=Lax" }));
    expect(good.results[0]!.status).toBe("pass");
    const bad = await runPageCheck(cookieFlags, await app({ cookie: "app_session=abc123; Path=/; SameSite=Lax" }));
    expect(bad.results[0]!.status).toBe("fail");
    const [f] = bad.results[0]!.findings;
    expect(f!.title).toBe('Session cookie "app_session" has no HttpOnly');
    expect(f!.severity).toBe("high");
    // The value never reaches the report.
    expect(JSON.stringify(f)).not.toContain("abc123");
    const none = await runPageCheck(cookieFlags, await app());
    expect(none.results[0]!.status).toBe("pass");
    expect(none.results[0]!.notes).toMatch(/set no cookies/);
  });
});

describe("cors", () => {
  it("corsVerdict: reflected with credentials is high, reflected alone low, * and absent fine", () => {
    const base = { url: "http://x/api", status: 200 };
    expect(corsVerdict({ ...base, allowOrigin: PROBE_ORIGIN, allowCredentials: true })?.severity).toBe("high");
    expect(corsVerdict({ ...base, allowOrigin: PROBE_ORIGIN, allowCredentials: false })).toMatchObject({ severity: "low", confidence: "advisory" });
    expect(corsVerdict({ ...base, allowOrigin: "*", allowCredentials: false })).toBeNull();
    expect(corsVerdict({ ...base, allowOrigin: null, allowCredentials: false })).toBeNull();
  });

  it("passes when the API doesn't reflect origins, and fails when it reflects any origin with credentials", async () => {
    const good = await runPageCheck(cors, await app({ headers: GOOD_HEADERS }));
    expect(good.results[0]!.status).toBe("pass");
    const s = await app({ headers: GOOD_HEADERS, reflectCors: true });
    const bad = await runPageCheck(cors, s);
    expect(bad.results[0]!.status).toBe("fail");
    const [f] = bad.results[0]!.findings;
    expect(f!.title).toBe("GET /api/me lets any website read it with the visitor's cookies");
    expect(f!.severity).toBe("high");
    // The probe really carried the foreign Origin, and was a GET the page itself had made.
    const server = servers[servers.length - 1]!;
    const probes = server.requests.filter((r) => r.headers.origin === PROBE_ORIGIN);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((r) => r.method === "GET")).toBe(true);
  });
});

describe("source-maps", () => {
  it("reads sourceMappingURL comments and recognises maps", () => {
    expect(sourceMappingUrl("a();\n//# sourceMappingURL=app.js.map\n")).toBe("app.js.map");
    expect(sourceMappingUrl("a();\n/*# sourceMappingURL=x.css.map */")).toBe("x.css.map");
    expect(sourceMappingUrl("a();")).toBeNull();
    expect(parseMap(MAP)).toEqual({ sources: ["src/app.ts", "src/admin.ts"], withContent: true });
    expect(parseMap("<html>not found</html>")).toBeNull();
    expect(parseMap(JSON.stringify({ version: 3, sources: [], mappings: "" }))).toEqual({ sources: [], withContent: false });
  });

  it("passes without maps and fails when a map with source code is public", async () => {
    const good = await runPageCheck(sourceMaps, await app());
    expect(good.results[0]!.status).toBe("pass");
    const bad = await runPageCheck(sourceMaps, await app({ map: true }));
    expect(bad.results[0]!.status).toBe("fail");
    const [f] = bad.results[0]!.findings;
    expect(f!.severity).toBe("medium");
    expect(f!.title).toMatch(/Source map is public, with the original source code/);
    expect(f!.location).toMatch(/\/app\.js\.map$/);
  });
});
