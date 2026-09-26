/**
 * deep-links (0.4.0, docs/v2-spec.md "deep-links"): do the app's own pages load when opened directly (a reload, a
 * shared link)? Driven against the shared accounts app (test-support/accounts-app.ts) signed in as alice, and against
 * small fixture sites for link selection and a not-found view answered with 200.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { startAccountsApp, type AccountsApp, type AccountsAppOptions } from "../../test-support/accounts-app.js";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { startFixtureServer, type FixtureServer, type RecordedRequest } from "../../test-support/server.js";
import { expectWellFormedFinding } from "../../test/fixtures/checks/assert-finding.js";
import type { AccountRef, CheckResult, DiscoveredPage, Scenario } from "../core/types.js";
import type { SessionState } from "../engine/auth.js";
import { createCheckContext, type RunningCheckContext } from "../engine/context.js";
import { discoverPage, emptyForm } from "../engine/discover.js";
import { check } from "./deep-links.js";

const A: AccountRef = { id: "a", label: "Account A" };
const RUN_TOKEN = "d17e57a1";

let browser: Browser;
const apps: AccountsApp[] = [];
const servers: FixtureServer[] = [];
const contexts: RunningCheckContext[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.dispose()));
  await Promise.all(apps.splice(0).map((a) => a.stop()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
afterAll(closeBrowser);

async function start(options: AccountsAppOptions = {}): Promise<AccountsApp> {
  const app = await startAccountsApp(options);
  apps.push(app);
  return app;
}

async function serve(pages: Record<string, string>): Promise<FixtureServer> {
  const server = await startFixtureServer({
    pages,
    routes: {
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
  servers.push(server);
  return server;
}

async function discoverWith(url: string, state: SessionState | undefined, ready: string): Promise<DiscoveredPage> {
  const context = await browser.newContext(state ? { storageState: state } : {});
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("heading", { level: 1, name: ready }).waitFor();
    await page.waitForLoadState("networkidle");
    return await discoverPage(page);
  } finally {
    await context.close();
  }
}

/** The scenario as the check plans it for the page, with the scope buildPlan adds to page-scoped checks. */
function scenarioFor(page: DiscoveredPage): Scenario {
  const planned = check.plan(page.forms[0] ?? emptyForm(page.url), page, { signedIn: true, otherAccount: false })[0];
  const fallback: Scenario = {
    id: "deep-links",
    checkId: "deep-links",
    title: "The app's pages load when opened directly",
    description: "",
    kind: "golden",
    priority: "medium",
    destructive: false,
    defaultSelected: true,
  };
  return { ...(planned ?? fallback), scope: "page", scopeLabel: "Whole page" };
}

async function runOn(o: { targetUrl: string; page: DiscoveredPage; self?: SessionState }): Promise<{ result: CheckResult; ctx: RunningCheckContext }> {
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-deep-links-"));
  dirs.push(artifactsDir);
  const ctx = createCheckContext({
    browser,
    form: o.page.forms[0] ?? emptyForm(o.targetUrl),
    discoveredPage: o.page,
    targetUrl: o.targetUrl,
    artifactsDir,
    runToken: RUN_TOKEN,
    checkId: "deep-links",
    ...(o.self ? { sessions: { self: o.self }, accounts: { self: A, other: null } } : {}),
  });
  contexts.push(ctx);
  return { result: await check.run(ctx, scenarioFor(o.page)), ctx };
}

/** Runs the check on the accounts app's /notes (links: Notes, Settings, Help) signed in as alice. */
async function runOnNotes(app: AccountsApp) {
  const page = await discoverWith(`${app.url}/notes`, app.storageState("alice"), "Your notes");
  app.reset();
  return runOn({ targetUrl: `${app.url}/notes`, page, self: app.storageState("alice") });
}

const pathOf = (r: RecordedRequest) => new URL(r.url, "http://x").pathname;
const documentGets = (requests: RecordedRequest[], path: string) => requests.filter((r) => r.method === "GET" && pathOf(r) === path);

describe("deep-links on the accounts app (signed in)", () => {
  it("deepLink404 (V05): /settings answers 404 when opened directly -> one high, confirmed finding with the path and status", async () => {
    const app = await start({ deepLink404: true });
    const { result } = await runOnNotes(app);

    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expectWellFormedFinding(f, { checkId: "deep-links", category: "broken-feature", severity: "high", confidence: "confirmed" });
    expect(f.title).toMatch(/\b1 page/);
    expect(f.title).toMatch(/^1 page shows an error when opened directly/);
    expect(f.locations).toHaveLength(1);
    expect(f.locations![0]).toContain("/settings");
    expect(f.locations![0]).toContain("404");
    const kinds = f.evidence.map((e) => e.kind);
    expect(kinds).toContain("frame");
    expect(kinds).toContain("card");
    expect(f.fix).toMatch(/index\.html/);
    // /help was opened directly as well, and it loads.
    expect(documentGets(app.requests, "/help").length).toBeGreaterThanOrEqual(1);
  });

  it("clean: every linked page opens directly -> pass; the direct opens were signed in and nothing signed out", async () => {
    const app = await start();
    const { result } = await runOnNotes(app);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    // In-app navigation never requests the document, so these GETs are the direct opens.
    expect(documentGets(app.requests, "/settings").length).toBeGreaterThanOrEqual(1);
    expect(documentGets(app.requests, "/help").length).toBeGreaterThanOrEqual(1);
    // Signed in, the pages never detour through /login?next=...
    expect(app.requests.filter((r) => pathOf(r) === "/login").map((r) => r.url)).toEqual([]);
    expect(app.requests.filter((r) => r.method !== "GET" && r.method !== "HEAD").map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });
});

describe("deep-links on other sites", () => {
  it("opens at most 10 same-origin links to other paths; never hash-only, downloads, other origins or destructive ones", async () => {
    const other = await serve({ "/elsewhere": "<!doctype html><title>Other</title><h1>Other app</h1>" });
    const numbered = Array.from({ length: 12 }, (_, i) => `/p${i + 1}`);
    const pages: Record<string, string> = {
      "/": `<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1>
<nav aria-label="Account">
  <a href="/session/end">Log out</a>
  <a href="/logout">Leave</a>
  <a href="/notes/7/delete">Tidy up</a>
  <a href="/unsubscribe?list=news">Email preferences</a>
  <a href="/files/report.pdf" download>Report</a>
  <a href="#top">Back to top</a>
  <a href="/?tab=2">Second tab</a>
  <a href="${other.url}/elsewhere">The other app</a>
  <a href="https://example.com/">Example</a>
</nav>
<main><ul>${numbered.map((p, i) => `<li><a href="${p}">Page ${i + 1}</a></li>`).join("")}</ul></main></body></html>`,
    };
    for (const [i, p] of numbered.entries()) pages[p] = `<!doctype html><html><head><title>Page ${i + 1}</title></head><body><h1>Page ${i + 1}</h1><p>Hello.</p></body></html>`;
    const site = await serve(pages);
    const page = await discoverWith(`${site.url}/`, undefined, "Home");
    site.requests.length = 0;
    const { result, ctx } = await runOn({ targetUrl: `${site.url}/`, page });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    const opened = new Set(site.requests.filter((r) => r.method === "GET").map(pathOf).filter((p) => numbered.includes(p)));
    expect(opened.size).toBe(10);
    for (const path of ["/session/end", "/logout", "/notes/7/delete", "/unsubscribe", "/files/report.pdf"]) {
      expect(documentGets(site.requests, path), `${path} was opened`).toEqual([]);
    }
    expect(site.requests.filter((r) => r.url.startsWith("/?")), "the page itself with another query").toEqual([]);
    expect(other.requests, "a link to another origin was opened").toEqual([]);
    expect(ctx.blocked, "tried to open a link to another host").toEqual([]);
  });

  it("a direct open that answers 200 but shows a not-found view, while the link works in the app -> finding with the path and status", async () => {
    const site = await serve({
      "/": `<!doctype html><html><head><title>Docs app</title></head><body>
<nav><a href="/docs" id="docs-link">Docs</a></nav><main id="view"><h1>Home</h1><p>Welcome.</p></main>
<script>
document.getElementById('docs-link').addEventListener('click', function (e) {
  e.preventDefault();
  history.pushState({}, '', '/docs');
  document.getElementById('view').innerHTML = '<h1>Docs</h1><p>Read me.</p>';
  document.title = 'Docs';
});
</script></body></html>`,
      // The host's own "soft 404": status 200, but the page says it doesn't exist.
      "/docs": `<!doctype html><html><head><title>Page not found</title></head><body><h1>404: this page doesn't exist</h1></body></html>`,
    });
    const page = await discoverWith(`${site.url}/`, undefined, "Home");
    const { result } = await runOn({ targetUrl: `${site.url}/`, page });

    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expectWellFormedFinding(f, { checkId: "deep-links", category: "broken-feature", severity: "high", confidence: "confirmed" });
    expect(f.locations).toHaveLength(1);
    expect(f.locations![0]).toContain("/docs");
    expect(f.locations![0]).toContain("200");
  });
});
