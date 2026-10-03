/**
 * The existing-record hold and a REST save whose JSON body has a "query" field (0.6.0 close-out round 2,
 * docs/v2-spec.md "Records Account A already had"): a saved search ({name, query}), a saved filter or a default-search
 * setting ({query}) is a write, never a GraphQL read (core/saves.ts isGraphQlRead asks for a GraphQL document), so the
 * hold judges it like any other save. One that edits a record the page read as Account A (GET /api/settings, then
 * POST /api/settings; GET /api/searches/s1, then POST /api/searches/s1 or POST /api/searches {id: "s1", …}) is stopped
 * before it reaches the app, and nothing is changed. A GraphQL read sent as a POST still goes, and still counts as a
 * read.
 */
import type { ServerResponse } from "node:http";
import type { Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../../support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../../support/server.js";
import type { CheckContext } from "../../../../src/core/types.js";
import { attachCapture } from "../../../../src/engine/capture.js";
import { holdExistingEdits } from "../../../../src/checks/lib/record-state.js";

const RUN_TOKEN = "Rs7e57a1";
/** A test value as canaryValues makes it: the run token, lower case, inside. */
const TEST_VALUE = "Search rs7e57a1ws";

let browser: Browser;
const servers: FixtureServer[] = [];
beforeAll(async () => {
  browser = await getBrowser();
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(closeBrowser);

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/**
 * A page that reads `readPath` on load (Account A's saved search s1, or A's settings), optionally with a GraphQL read
 * sent as a POST too, and whose form POSTs `body` (a JS expression over the typed value T) to `savePath`. The app's
 * records change only when a write reaches it.
 */
async function queryKeyApp(o: { readPath: string; savePath: string; body: string; gqlRead?: boolean }) {
  const records: Record<string, Record<string, unknown>> = {
    "/api/searches/s1": { id: "s1", name: "Open tasks", query: "status:open" },
    "/api/settings": { query: "status:open" },
  };
  const writes: string[] = [];
  const apply = (path: string, body: string) => {
    writes.push(`POST ${path} ${body}`);
    const b = JSON.parse(body) as Record<string, unknown>;
    const target = path === "/api/searches" ? records[`/api/searches/${String(b.id)}`] : records[path];
    if (target) for (const k of ["name", "query"]) if (typeof b[k] === "string") target[k] = b[k];
  };
  const server = await startFixtureServer({
    pages: {
      "/app": `<!doctype html><html lang="en"><head><title>Saved search</title></head><body><main><h1>Saved search</h1>
<form id="f"><label for="q">Search</label><input id="q" name="query"><button type="submit">Save</button></form><p id="done"></p></main>
<script>
var reads = [fetch(${JSON.stringify(o.readPath)}).then(function (r) { return r.json(); })];
${
  o.gqlRead
    ? "reads.push(fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'Me', query: 'query Me { me { id name } }', variables: {} }) }).then(function (r) { return r.json(); }));"
    : ""
}
Promise.all(reads).then(function () { document.body.dataset.ready = '1'; });
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var T = document.getElementById('q').value;
  fetch(${JSON.stringify(o.savePath)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${o.body}) })
    .catch(function () {}).then(function () { document.getElementById('done').textContent = 'done'; });
});
</script></body></html>`,
    },
    routes: {
      "GET /api/searches/s1": (_req, res) => json(res, 200, records["/api/searches/s1"]),
      "GET /api/settings": (_req, res) => json(res, 200, records["/api/settings"]),
      "POST /api/searches/s1": (req, res) => {
        apply("/api/searches/s1", req.body);
        json(res, 200, records["/api/searches/s1"]);
      },
      "POST /api/searches": (req, res) => {
        apply("/api/searches", req.body);
        json(res, 200, { ok: true });
      },
      "POST /api/settings": (req, res) => {
        apply("/api/settings", req.body);
        json(res, 200, records["/api/settings"]);
      },
      "POST /graphql": (req, res) => {
        writes.push(`POST /graphql ${req.body}`);
        json(res, 200, { data: { me: { id: "u1", name: "Alex" } } });
      },
    },
  });
  servers.push(server);
  return Object.assign(server, { records, writes });
}

/** Submits the page's form with TEST_VALUE under a hold; what reached the app, and the hold. */
async function submitHeld(server: FixtureServer) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const capture = attachCapture(page);
    await page.goto(`${server.url}/app`);
    await page.waitForSelector("body[data-ready='1']");
    await page.waitForLoadState("networkidle");
    const ctx = { targetUrl: `${server.url}/app`, runToken: RUN_TOKEN, request: async () => ({ status: 500, headers: {}, body: "" }) } as unknown as CheckContext;
    const hold = await holdExistingEdits(ctx, page, capture);
    try {
      await page.fill("#q", TEST_VALUE);
      await page.click("button[type=submit]");
      await page.waitForSelector("#done:text('done')");
    } finally {
      await hold.release();
    }
    return hold;
  } finally {
    await context.close();
  }
}

describe("holdExistingEdits: a REST save whose body has a query field is judged like any other save", () => {
  it.each([
    ["POST /api/settings {query} after GET /api/settings", { readPath: "/api/settings", savePath: "/api/settings", body: "{ query: T }" }, "/api/settings"],
    [
      "POST /api/searches/s1 {name, query} after GET /api/searches/s1",
      { readPath: "/api/searches/s1", savePath: "/api/searches/s1", body: "{ name: 'Name ' + T, query: T }" },
      "/api/searches/s1",
    ],
    [
      "POST /api/searches {id: s1, name, query} after GET /api/searches/s1",
      { readPath: "/api/searches/s1", savePath: "/api/searches", body: "{ id: 's1', name: 'Name ' + T, query: T }" },
      "/api/searches/s1",
    ],
  ])("stops %s: nothing reaches the app", async (_name, shape, record) => {
    const server = await queryKeyApp(shape);
    const before = JSON.stringify(server.records[record]);
    const hold = await submitHeld(server);
    expect(server.writes.filter((w) => !w.startsWith("POST /graphql"))).toEqual([]);
    expect(JSON.stringify(server.records[record])).toBe(before);
    expect(hold.stopped.map((w) => `${w.method} ${new URL(w.url).pathname}`)).toEqual([`POST ${shape.savePath}`]);
    expect(hold.verdict()).toMatch(/changes a record Account A already had/);
    expect(hold.verdict()).toMatch(/before it reached the app, so nothing was changed/);
  });

  it("still lets a GraphQL read sent as a POST through, and still stops the edit after it", async () => {
    const server = await queryKeyApp({ readPath: "/api/settings", savePath: "/api/settings", body: "{ query: T }", gqlRead: true });
    const hold = await submitHeld(server);
    // The GraphQL read went on load, before the hold; the settings save is stopped.
    expect(server.writes.map((w) => w.split(" ").slice(0, 2).join(" "))).toEqual(["POST /graphql"]);
    expect(hold.stopped.map((w) => new URL(w.url).pathname)).toEqual(["/api/settings"]);
    // The GraphQL read's answer counts with the page's reads; its body is sent again when a re-read needs it.
    expect(hold.reads().some((r) => r.post && /query Me/.test(r.post))).toBe(true);
  });

  it("lets a REST create with a query field through: POST /api/searches with no id the page read", async () => {
    const server = await queryKeyApp({ readPath: "/api/searches/s1", savePath: "/api/searches", body: "{ name: 'Name ' + T, query: T }" });
    const hold = await submitHeld(server);
    expect(server.writes).toHaveLength(1);
    expect(hold.stopped).toEqual([]);
    expect(hold.verdict()).toBeNull();
  });
});
