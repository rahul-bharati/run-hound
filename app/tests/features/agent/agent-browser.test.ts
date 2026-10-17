import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeBrowser, getBrowser } from "../../support/harness.js";
import { startFixtureServer, type FixtureServer } from "../../support/server.js";
import { AgentBrowser } from "../../../src/agent/browser.js";
import { runNavigationTool, type NavigationCall, type ToolRun } from "../../../src/agent/tools.js";
import type { PageObservation, ObservedNode } from "../../../src/interfaces/agent.js";
import type { AgentToolErrorCode } from "../../../src/types/agent.js";
import { createCheckContext, type RunningCheckContext } from "../../../src/engine/context.js";
import { emptyForm } from "../../../src/engine/discover.js";

// A navigation that never answers must fail within the test's time, not after AGENT_NAVIGATION_TIMEOUT_MS (20 s).
vi.mock(import("../../../src/config/agent.js"), async (importOriginal) => {
  const original = await importOriginal();
  // The constant's type is the literal 20000, so the shortened copy needs the module's own type.
  return { ...original, AGENT_NAVIGATION_TIMEOUT_MS: 1_500 } as unknown as typeof original;
});

/**
 * AgentBrowser and runNavigationTool in real Chromium (docs/agent-spec.md "The agent's page", "Navigation tools",
 * "Observations", "Tool failures", and the JSDoc of src/agent/browser.ts and src/agent/tools.ts). The agent's page is
 * opened through a real RunningCheckContext (createCheckContext, openForm: false) against a fixture server on 127.0.0.1.
 *
 * Contract these tests pin down (interpretations marked *):
 * - AgentBrowser.open opens the context's target URL and records nothing: `latest` is null until observe(). Each
 *   observe() is numbered 1, 2, ...; the model's refs are "<number>.<Playwright ref>" (Playwright's own ref is "e12" on
 *   the first document of a page, and "f1e12", "f2e12", ... on later ones, so only its shape as a word is assumed).
 *   `status` is whatever observe() was given (null without one). `path` has no query or hash.
 * - resolve(ref) gives a locator for a ref of the latest observation, through Playwright's `aria-ref=<ref>` selector
 *   (the test named "pins aria-ref" is the one that fails if a Playwright upgrade drops it). Any other ref is
 *   `stale-ref`: an earlier observation's (even when Playwright kept the same ref), a malformed one, one never issued
 *   (an iframe's included), anything before the first observation, and anything that is not a string. A ref that
 *   carries a selector fragment is never a selector.
 * - No observation holds a field's value: not the ones a page loads with, not the ones typed after (page.fill).
 * - problems count what happened since the last observation (console errors, page errors, requests that failed or
 *   answered 400 or more; a redirect is neither); a dialog (alert, confirm, prompt) is dismissed and reported in the
 *   next observation by its type and redacted message; hide is applied to what the page says.
 *   * A dialog is reported once (the observation after it has none). The page's title goes through hide too, and a
 *     page without a title has `title: null`.
 * - goto: the response's status; `off-target` when the guard refused it or a redirect escaped (then a fresh page
 *   is open on the start page), `page-error` for a network error or a timeout. Only what happened during that call
 *   counts: an earlier escape or block does not fail a later navigation. back: `invalid-input` with no earlier page.
 * - runNavigationTool: observe (counted false), navigate (counted true) and back (counted true), all with action
 *   class "observation", the path after the call, and a non-negative duration. navigate checks isBriefPath first
 *   (invalid-input), then the scope (off-target; a scope path matches itself and its sub-paths, not "/apple" for
 *   "/app"; no scope paths = the whole origin). A 404 or 500 page is a successful navigation whose observation has
 *   the status. A refusal is a result, never an exception; the observation is in it when the page is usable.
 *   * An aborted signal fails as `cancelled` before anything is done, and then nothing is counted (a call that did
 *     nothing is not a browser action). A page closed under the tool does not make it throw.
 *   * back's observation carries no status that is asserted. observe's status is not asserted either way.
 */

const MARKER = "ACME-SECRET";
const hide = (text: string): string => text.replaceAll(MARKER, "[hidden]");
const FIELD_VALUES = ["secret-bio-value", "hunter2hunter2"];

/** Prefilled fields on every page, so every observation in this file has values it must not show. */
const FIELDS = `<label>Bio <input id="bio" value="secret-bio-value"></label>
<label>Password <input id="pw" type="password" value="hunter2hunter2"></label>
<label>Note <input id="note"></label>`;

const doc = (title: string | null, body: string, script = "") =>
  `<!doctype html><html lang="en"><head>${title === null ? "" : `<title>${title}</title>`}</head><body><main>${body}${FIELDS}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

const APP_PAGE = doc(
  "Profile page",
  `<h1>Profile</h1>
<label>Plan <select id="plan"><option>Free</option><option selected>Pro</option></select></label>
<label><input type="checkbox" id="email" checked> Email me</label>
<button id="save" disabled>Save</button><button id="delete">Delete account</button>
<a id="docs" href="https://other.example/x?token=abc">Docs</a><a id="help" href="/app/help?x=1#h">Help</a>
<p id="who">Signed in as ${MARKER}</p>
<iframe src="/framed" title="frame"></iframe>`,
);

const REFUSED_HOST = "http://203.0.113.9/";
/** A navigation that times out must not leave the call waiting for Playwright's default 30 s snapshot timeout. */
const MUCH_LESS_THAN_30_S = 20_000;

let server: FixtureServer;
const hung: { end(): void }[] = [];

beforeAll(async () => {
  server = await startFixtureServer({
    pages: {
      "/": doc("Home", "<h1>Home</h1>"),
      "/start": doc("Start page", "<h1>Start</h1>"),
      "/app": APP_PAGE,
      "/app/x": doc("App X", "<h1>App X</h1>"),
      "/app/settings": doc("Settings", "<h1>Settings</h1>"),
      "/apple": doc("Apple", "<h1>Apple</h1>"),
      "/docs": doc("Docs", "<h1>Docs</h1>"),
      "/framed": "<!doctype html><html><body><button>Inner</button></body></html>",
      "/titled": doc(`Welcome ${MARKER}`, "<h1>Titled</h1>"),
      "/untitled": doc(null, "<h1>Untitled</h1>"),
      "/noisy": doc("Noisy", "<h1>Noisy</h1>", `console.error("first"); console.error("second"); console.warn("a warning"); console.log("a log");`),
      "/page-error": doc("Page error", "<h1>Page error</h1>", `setTimeout(function () { throw new Error("late failure"); }, 0);`),
      "/fetch-404": doc("Fetch 404", "<h1>Fetch 404</h1>", `fetch("/api/missing").catch(function () {});`),
      "/fetch-500": doc("Fetch 500", "<h1>Fetch 500</h1>", `fetch("/api/boom").catch(function () {});`),
      "/fetch-fail": doc("Fetch fail", "<h1>Fetch fail</h1>", `fetch("/api/dropped").catch(function () {});`),
      "/alert-on-load": doc("Alerts", "<h1>Alerts</h1>", `alert("Welcome ${MARKER}");`),
      "/js-out": doc("Script leaves", "<h1>Script leaves</h1>", `location.href = "${REFUSED_HOST}blocked";`),
    },
    routes: {
      "GET /old": (_req, res) => {
        res.writeHead(302, { location: "/app" });
        res.end();
      },
      "GET /redirect-out": (_req, res) => {
        res.writeHead(302, { location: REFUSED_HOST });
        res.end();
      },
      "GET /gone": (_req, res) => {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(doc("Gone", "<h1>Gone</h1>"));
      },
      "GET /boom": (_req, res) => {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(doc("Boom", "<h1>Boom</h1>"));
      },
      "GET /api/boom": (_req, res) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end("{}");
      },
      "GET /api/dropped": (_req, res) => {
        res.destroy();
      },
      "GET /hang": (_req, res) => {
        hung.push(res);
      },
    },
  });
});

afterAll(async () => {
  await mainPage.dispose();
  await closeBrowser();
  for (const res of hung) res.end();
  await server?.close();
});

interface Launched {
  agent: AgentBrowser;
  context: RunningCheckContext;
  artifactsDir: string;
  targetUrl: string;
  shared: boolean;
}

const launched = new Set<Launched>();

/** An AgentBrowser on a real check context whose start page is `startPath` of `target` (the fixture server by default). */
async function launch(startPath = "/start", options: { target?: FixtureServer; shared?: boolean } = {}): Promise<Launched> {
  const target = options.target ?? server;
  const targetUrl = `${target.url}${startPath}`;
  const artifactsDir = await mkdtemp(join(tmpdir(), "rh-agent-browser-"));
  const context = createCheckContext({ browser: await getBrowser(), form: emptyForm(targetUrl), targetUrl, artifactsDir, openForm: false });
  const agent = await AgentBrowser.open({ context, origin: target.url, hide });
  const made = { agent, context, artifactsDir, targetUrl, shared: options.shared ?? false };
  launched.add(made);
  return made;
}

async function dispose(made: Launched) {
  launched.delete(made);
  await made.context.dispose().catch(() => undefined);
  await rm(made.artifactsDir, { recursive: true, force: true });
}

afterEach(async () => {
  for (const made of launched) if (!made.shared) await dispose(made);
});

/**
 * An AgentBrowser shared by the tests that only need a page to look at, started by the first test that asks (so a
 * failure shows in each of them). Every navigation costs about half a second of network idle, so tests that don't
 * need a page of their own use this one, and set up what they need (a page, a clean observation) themselves.
 */
function sharedLaunch(startPath: string) {
  let made: Launched | undefined;
  return {
    async get(): Promise<Launched> {
      made ??= await launch(startPath, { shared: true });
      return made;
    },
    async dispose() {
      if (made) await dispose(made);
    },
  };
}

interface RawNode {
  role?: string;
  ref?: string;
  children?: (RawNode | string)[];
}

function rawWalk(nodes: (RawNode | string)[]): RawNode[] {
  return nodes.flatMap((node) => (typeof node === "string" ? [] : [node, ...rawWalk(node.children ?? [])]));
}

function walk(nodes: ObservedNode[] | undefined): ObservedNode[] {
  return (nodes ?? []).flatMap((node) => [node, ...walk(node.children)]);
}

function find(observation: PageObservation, role: string, name?: string): ObservedNode {
  const node = walk(observation.tree).find((n) => n.role === role && (name === undefined || n.name === name));
  if (!node) throw new Error(`expected the observation to hold a ${role}${name ? ` named "${name}"` : ""}: ${JSON.stringify(observation.tree)}`);
  return node;
}

/** The part of a model ref after the observation's number: Playwright's own ref. */
const playwrightRef = (ref: string): string => ref.slice(ref.indexOf(".") + 1);

/** Nothing the page holds as a field value, a typed value or a hidden marker is anywhere in what the model gets. */
function expectNoValues(value: unknown, extra: string[] = []) {
  const json = JSON.stringify(value);
  for (const secret of [...FIELD_VALUES, MARKER, ...extra]) expect(json).not.toContain(secret);
}

function observationOf(run: ToolRun): PageObservation {
  if (!run.result.ok || !run.result.observation) throw new Error(`expected a success with an observation, got ${JSON.stringify(run.result)}`);
  return run.result.observation;
}

function errorOf(run: ToolRun): { code: AgentToolErrorCode; message: string } {
  if (run.result.ok) throw new Error(`expected a failure, got ${JSON.stringify(run.result)}`);
  return run.result.error;
}

function runTool(agent: AgentBrowser, call: NavigationCall, scopePaths: readonly string[] = [], signal?: AbortSignal) {
  return runNavigationTool(agent, call, { scopePaths, ...(signal ? { signal } : {}) });
}

const navigate = (path: string): NavigationCall => ({ tool: "navigate", path });

/** Requests the fixture server got for pages (not the icon Chromium may ask for). */
const pageRequests = () => server.requests.filter((r) => !r.url.startsWith("/favicon")).length;

async function showDialog(agent: AgentBrowser, kind: "alert" | "confirm" | "prompt", message: string) {
  await agent.page.evaluate(
    ([k, m]) => {
      setTimeout(() => {
        if (k === "alert") alert(m);
        else if (k === "confirm") confirm(m);
        else prompt(m);
      }, 0);
    },
    [kind, message] as const,
  );
  await agent.page.waitForTimeout(300);
}


/** The agent most tests borrow. Whatever page it is on, a test that needs one opens it, and observes to start clean. */
const mainPage = sharedLaunch("/start");
const main = async (): Promise<AgentBrowser> => (await mainPage.get()).agent;

/** The shared agent on `path`, with a fresh observation taken: its problems and dialog start from nothing. */
async function mainOn(path: string): Promise<AgentBrowser> {
  const agent = await main();
  if (agent.path !== path) await agent.goto(path);
  await agent.observe();
  return agent;
}

/** An agent whose server has gone away, started once for the tests that need a connection that is refused. */
let downAgent: Promise<AgentBrowser> | undefined;
function refusedAgent(): Promise<AgentBrowser> {
  downAgent ??= (async () => {
    const down = await startFixtureServer({ pages: { "/start": doc("Down", "<h1>Down</h1>") } });
    const { agent } = await launch("/start", { target: down, shared: true });
    await down.close();
    return agent;
  })();
  return downAgent;
}

/** The number of the observation, read from the refs it issued. */
function numberOf(observation: PageObservation): number {
  const ref = walk(observation.tree)[0]?.ref;
  if (ref === undefined) throw new Error("the observation shows no node");
  return Number(ref.slice(0, ref.indexOf(".")));
}

describe("AgentBrowser: the page and its observations", () => {
  it("opens the context's start page, has no observation yet, and shows the path without query or hash", async () => {
    const { agent, targetUrl } = await launch("/start?token=abc123#frag");
    expect(agent.latest).toBeNull();
    expect(agent.page.url()).toBe(targetUrl);
    expect(agent.page.isClosed()).toBe(false);
    expect(agent.path).toBe("/start");

    const observation = await agent.observe();
    expect(observation.path).toBe("/start");
    expect(JSON.stringify(observation)).not.toContain("abc123");
    expect(JSON.stringify(observation)).not.toContain("frag");
  });

  it("numbers observations from 1, prefixes each ref with its number, and keeps the latest", async () => {
    const { agent } = await launch("/start");
    const first = await agent.observe();
    expect(agent.latest).toEqual(first);
    const heading = find(first, "heading", "Start");
    for (const node of walk(first.tree)) expect(node.ref).toMatch(/^1\.\w+$/);

    const second = await agent.observe();
    expect(agent.latest).toEqual(second);
    for (const node of walk(second.tree)) expect(node.ref).toMatch(/^2\.\w+$/);
    expect(playwrightRef(find(second, "heading", "Start").ref)).toBe(playwrightRef(heading.ref));
  });

  it("reports the status it is given, and null without one", async () => {
    const agent = await main();
    expect((await agent.observe()).status).toBeNull();
    expect((await agent.observe(200)).status).toBe(200);
    expect((await agent.observe(404)).status).toBe(404);
    expect((await agent.observe(null)).status).toBeNull();
  });

  it("describes the page: title, headings, controls and their state, with hide applied", async () => {
    const agent = await main();
    await agent.goto("/app");
    const observation = await agent.observe(200);

    expect(observation.path).toBe("/app");
    expect(observation.title).toBe("Profile page");
    expect(observation.truncated).toBe(false);
    expect(find(observation, "heading", "Profile")).toMatchObject({ level: 1 });
    expect(find(observation, "button", "Save").disabled).toBe(true);
    expect(find(observation, "button", "Delete account").destructive).toBe(true);
    expect(find(observation, "button", "Save").destructive).toBeFalsy();
    expect(find(observation, "checkbox", "Email me").checked).toBe(true);
    expect(find(observation, "combobox", "Plan").options).toEqual(["Free", "Pro"]);
    expect(find(observation, "link", "Docs").url).toBe("https://other.example");
    expect(find(observation, "link", "Help").url).toBe("/app/help");
    expect(JSON.stringify(observation)).toContain("Signed in as [hidden]");
    expectNoValues(observation);
  });

  it("shows an iframe without its content, and issues no ref inside it", async () => {
    const agent = await main();
    await agent.goto("/app");
    // Playwright's own snapshot of the page, to learn which refs live inside the frame (they are not told apart by shape).
    const raw = (await agent.page.ariaSnapshotJSON({ mode: "ai" })) as RawNode[];
    const frame = rawWalk(raw).find((node) => node.role === "iframe");
    const inside = rawWalk(frame?.children ?? []).flatMap((node) => (node.ref ? [node.ref] : []));
    expect(inside.length).toBeGreaterThan(0);

    const observation = await agent.observe(200);
    const n = numberOf(observation);
    expect(find(observation, "iframe").children ?? []).toEqual([]);
    expect(JSON.stringify(observation)).not.toContain("Inner");
    for (const ref of inside) {
      expect(JSON.stringify(observation), ref).not.toContain(`"${n}.${ref}"`);
      expect(agent.resolve(`${n}.${ref}`), ref).toEqual({ error: "stale-ref" });
    }
  });

  it("never shows a field's value: not the ones the page loaded with, not the ones typed after", async () => {
    const { agent } = await launch("/app");
    const before = await agent.observe();
    expect(find(before, "textbox", "Bio").filled).toBe(true);
    expect(find(before, "textbox", "Password").filled).toBe(true);
    expect(find(before, "textbox", "Note").filled).toBe(false);
    expectNoValues(before);

    await agent.page.fill("#note", "typed-by-the-agent-42");
    await agent.page.fill("#bio", "an-edited-bio-value");
    const after = await agent.observe();
    expect(find(after, "textbox", "Note").filled).toBe(true);
    expectNoValues(after, ["typed-by-the-agent-42", "an-edited-bio-value"]);

    // The same through the tool.
    const run = await runTool(agent, { tool: "observe" });
    expect(find(observationOf(run), "textbox", "Note").filled).toBe(true);
    expectNoValues(run, ["typed-by-the-agent-42", "an-edited-bio-value"]);

    await agent.page.fill("#note", "");
    const cleared = await agent.observe();
    expect(find(cleared, "textbox", "Note").filled).toBe(false);
    expectNoValues(cleared, ["typed-by-the-agent-42"]);
  });

  it("applies hide to the page's title too, and gives a page without a title a null title *", async () => {
    const agent = await main();
    await agent.goto("/titled");
    const titled = await agent.observe(200);
    expect(titled.title).toBe("Welcome [hidden]");
    expectNoValues(titled);

    await agent.goto("/untitled");
    expect((await agent.observe(200)).title).toBeNull();
  });
});

describe("AgentBrowser: resolving refs", () => {
  const ELEMENTS = [
    ["textbox", "Bio", "bio"],
    ["textbox", "Password", "pw"],
    ["combobox", "Plan", "plan"],
    ["checkbox", "Email me", "email"],
    ["button", "Save", "save"],
    ["button", "Delete account", "delete"],
    ["link", "Docs", "docs"],
    ["link", "Help", "help"],
  ] as const;

  it("pins aria-ref=: a current ref resolves to the element it names (Playwright's aria-ref= selector)", async () => {
    const agent = await mainOn("/app");
    const observation = await agent.observe();
    for (const [role, name, id] of ELEMENTS) {
      const resolved = agent.resolve(find(observation, role, name).ref);
      if (!("locator" in resolved)) throw new Error(`"${name}" did not resolve: ${resolved.error}`);
      expect(await resolved.locator.count(), name).toBe(1);
      expect(await resolved.locator.evaluate((el) => el.id), name).toBe(id);
    }
  });

  it("resolves the refs of the latest observation after the page changed", async () => {
    const agent = await main();
    await agent.goto("/app/settings");
    await agent.goto("/app");
    const observation = await agent.observe(200);
    const resolved = agent.resolve(find(observation, "button", "Delete account").ref);
    if (!("locator" in resolved)) throw new Error(`did not resolve: ${resolved.error}`);
    expect(await resolved.locator.evaluate((el) => el.id)).toBe("delete");
  });

  it("fails a ref of an earlier observation as stale-ref, even when Playwright kept the same ref", async () => {
    const agent = await mainOn("/app");
    const first = await agent.observe();
    const old = find(first, "button", "Save").ref;
    const second = await agent.observe();
    const current = find(second, "button", "Save").ref;

    // The premise: Playwright names the same element the same way in both snapshots.
    expect(playwrightRef(current)).toBe(playwrightRef(old));
    expect(old).not.toBe(current);

    expect(agent.resolve(old)).toEqual({ error: "stale-ref" });
    const resolved = agent.resolve(current);
    if (!("locator" in resolved)) throw new Error(`did not resolve: ${resolved.error}`);
    expect(await resolved.locator.evaluate((el) => el.id)).toBe("save");
  });

  it("fails every ref as stale-ref before the first observation", async () => {
    const { agent } = await launch("/app");
    expect(agent.resolve("1.e2")).toEqual({ error: "stale-ref" });
    expect(agent.resolve("e2")).toEqual({ error: "stale-ref" });
  });

  it("fails a ref of the page before a navigation as stale-ref once the new page is observed", async () => {
    const agent = await mainOn("/app");
    const before = find(await agent.observe(), "button", "Save").ref;
    await agent.goto("/app/settings");
    await agent.observe(200);
    expect(agent.resolve(before)).toEqual({ error: "stale-ref" });
  });

  // Written for the latest observation's number `n`, which only the test knows.
  it.each<[string, (n: number) => unknown]>([
    ["an empty string", () => ""],
    ["Playwright's ref without the number", () => "e5"],
    ["only a number", (n) => `${n}`],
    ["a number and a dot", (n) => `${n}.`],
    ["a dot and a ref", () => ".e5"],
    ["two refs", (n) => `${n}.e5.e6`],
    ["a word for a number", () => "x.e5"],
    ["a negative number", () => "-1.e5"],
    ["observation zero", () => "0.e5"],
    ["a later observation than the latest", (n) => `${n + 1}.e2`],
    ["an earlier observation than the latest", (n) => `${n - 1}.e2`],
    ["a ref nothing was issued for", (n) => `${n}.e99999`],
    ["a ref with a selector appended", (n) => `${n}.e2 >> nth=0`],
    ["a ref that is a list of selectors", (n) => `${n}.e2, button`],
    ["a ref with leading space", (n) => ` ${n}.e2`],
    ["a ref with a trailing newline", (n) => `${n}.e2\n`],
    ["an aria-ref selector", () => "aria-ref=e2"],
    ["a css selector", () => "#delete"],
    ["undefined", () => undefined],
    ["null", () => null],
    ["a number", () => 1],
    ["an object", (n) => ({ ref: `${n}.e2` })],
  ])("fails %s as stale-ref", async (_name, ref) => {
    const agent = await mainOn("/app");
    const n = numberOf(await agent.observe());
    expect(agent.resolve(ref(n) as string)).toEqual({ error: "stale-ref" });
  });
});

describe("AgentBrowser: problems and dialogs", () => {
  const NONE = { consoleErrors: 0, pageErrors: 0, failedRequests: 0 };

  it("reports no problems on a page that has none", async () => {
    const agent = await mainOn("/start");
    await agent.goto("/app");
    expect((await agent.observe(200)).problems).toEqual(NONE);
  });

  it("counts console errors since the last observation, and not warnings or logs", async () => {
    const agent = await mainOn("/start");
    await agent.goto("/noisy");
    expect((await agent.observe(200)).problems).toEqual({ consoleErrors: 2, pageErrors: 0, failedRequests: 0 });
  });

  it("counts a page error", async () => {
    const agent = await mainOn("/start");
    await agent.goto("/page-error");
    const { problems } = await agent.observe(200);
    expect(problems.pageErrors).toBe(1);
    expect(problems.failedRequests).toBe(0);
  });

  it.each([
    ["a request the app answered with 404", "/fetch-404"],
    ["a request the app answered with 500", "/fetch-500"],
    ["a request that failed", "/fetch-fail"],
  ])("counts %s as a failed request", async (_name, path) => {
    const agent = await mainOn("/start");
    await agent.goto(path);
    const { problems } = await agent.observe(200);
    expect(problems.failedRequests).toBe(1);
    expect(problems.pageErrors).toBe(0);
  });

  it("does not count a redirect as a failed request", async () => {
    const agent = await mainOn("/start");
    expect(await agent.goto("/old")).toEqual({ status: 200 });
    expect((await agent.observe(200)).problems).toEqual(NONE);
  });

  it("counts only what happened since the last observation", async () => {
    const agent = await mainOn("/start");
    await agent.goto("/noisy");
    expect((await agent.observe(200)).problems.consoleErrors).toBe(2);
    expect((await agent.observe()).problems).toEqual(NONE);

    await agent.page.evaluate(() => {
      console.error("one more");
    });
    expect((await agent.observe()).problems.consoleErrors).toBe(1);
    expect((await agent.observe()).problems.consoleErrors).toBe(0);
  });

  it("counts what happened before the first observation, and none of it again", async () => {
    const { agent } = await launch("/noisy");
    expect((await agent.observe()).problems.consoleErrors).toBe(2);
    await agent.goto("/app");
    expect((await agent.observe(200)).problems).toEqual(NONE);
  });

  it.each(["alert", "confirm", "prompt"] as const)("dismisses a %s and reports it, redacted, in the next observation", async (kind) => {
    const agent = await mainOn("/app");
    await showDialog(agent, kind, `Heads up ${MARKER}`);

    const observation = await agent.observe();
    expect(observation.dialog).toEqual({ type: kind, message: "Heads up [hidden]" });
    expectNoValues(observation);
    // The page was not left blocked.
    expect(await agent.page.evaluate(() => 1 + 1)).toBe(2);
  });

  it("reports a dialog once *", async () => {
    const agent = await mainOn("/app");
    await showDialog(agent, "alert", "Only once");
    expect((await agent.observe()).dialog).toEqual({ type: "alert", message: "Only once" });
    expect((await agent.observe()).dialog).toBeNull();
  });

  it("reports no dialog on a page that opened none", async () => {
    const agent = await mainOn("/app");
    expect((await agent.observe()).dialog).toBeNull();
  });

  it("dismisses a dialog a page opens while it loads, and reports it", async () => {
    const agent = await mainOn("/start");
    expect(await agent.goto("/alert-on-load")).toEqual({ status: 200 });
    const observation = await agent.observe(200);
    expect(observation.dialog).toEqual({ type: "alert", message: "Welcome [hidden]" });
    expect(find(observation, "heading", "Alerts")).toBeDefined();
  });
});

describe("AgentBrowser: goto and back", () => {
  it("opens a path on the origin and gives the response's status", async () => {
    const agent = await main();
    expect(await agent.goto("/app/settings")).toEqual({ status: 200 });
    expect(agent.path).toBe("/app/settings");
    expect(agent.page.url()).toBe(`${server.url}/app/settings`);
    expect(find(await agent.observe(200), "heading", "Settings")).toBeDefined();
  });

  it.each([
    ["/gone", 404],
    ["/boom", 500],
    ["/nowhere", 404],
  ])("gives the status of %s (%i) as a success", async (path, status) => {
    const agent = await main();
    expect(await agent.goto(path)).toEqual({ status });
    expect(agent.path).toBe(path);
  });

  it("follows a redirect on the origin and gives the final status and path", async () => {
    const agent = await main();
    expect(await agent.goto("/old")).toEqual({ status: 200 });
    expect(agent.path).toBe("/app");
  });

  it("fails as off-target when a redirect escapes to a refused host, opens a fresh start page, and goes on", async () => {
    const { agent, context, targetUrl } = await launch("/start");
    await agent.goto("/app");
    const before = agent.page;

    const result = await agent.goto("/redirect-out");

    expect(result).toMatchObject({ error: "off-target" });
    expect(typeof (result as { message: string }).message).toBe("string");
    expect(context.escaped.length).toBeGreaterThan(0);
    expect(agent.page).not.toBe(before);
    expect(agent.page.isClosed()).toBe(false);
    expect(agent.page.url()).toBe(targetUrl);
    expect(agent.path).toBe("/start");
    expect(find(await agent.observe(200), "heading", "Start")).toBeDefined();

    // An earlier escape does not fail the next call.
    expect(await agent.goto("/app/settings")).toEqual({ status: 200 });
    expect(agent.path).toBe("/app/settings");
    expect(await agent.goto("/old")).toEqual({ status: 200 });
  });

  it("fails as off-target when the guard refuses a navigation the page makes, and goes on", async () => {
    const { agent, context } = await launch("/start");
    const result = await agent.goto("/js-out");

    expect(result).toMatchObject({ error: "off-target" });
    // The premise: the guard did refuse it, and did not close the page (Chromium shows an error page in its place).
    expect(context.blocked.some((entry) => entry.includes("203.0.113.9"))).toBe(true);
    expect(agent.page.isClosed()).toBe(false);

    // And the next call is not failed by the block that came before it.
    expect(await agent.goto("/app/settings")).toEqual({ status: 200 });
  });

  it("fails as page-error when the server refuses the connection", async () => {
    const agent = await refusedAgent();
    const result = await agent.goto("/start");
    expect(result).toMatchObject({ error: "page-error" });
    expect(typeof (result as { message: string }).message).toBe("string");
  });

  it("fails as page-error when the navigation times out, and the agent can go on *", async () => {
    const { agent } = await launch("/start");
    const started = Date.now();
    const result = await agent.goto("/hang");
    expect(result).toMatchObject({ error: "page-error" });
    // About the (shortened) timeout, not Playwright's 30 s default wait for a snapshot of a page that is still loading.
    expect(Date.now() - started).toBeLessThan(MUCH_LESS_THAN_30_S);
    expect(agent.page.isClosed()).toBe(false);

    expect(await agent.goto("/app/settings")).toEqual({ status: 200 });
    expect(agent.path).toBe("/app/settings");
  });

  it("goes back to the previous page, until there is none, then fails as invalid-input", async () => {
    const { agent } = await launch("/start");
    expect(await agent.back()).toMatchObject({ error: "invalid-input" });
    expect(agent.path).toBe("/start");

    await agent.goto("/app");
    await agent.goto("/app/settings");

    const result = await agent.back();
    expect(result).not.toHaveProperty("error");
    expect(agent.path).toBe("/app");
    expect(find(await agent.observe(), "heading", "Profile")).toBeDefined();

    await agent.back();
    expect(agent.path).toBe("/start");
    const last = await agent.back();
    expect(last).toMatchObject({ error: "invalid-input" });
    expect(typeof (last as { message: string }).message).toBe("string");
    expect(agent.path).toBe("/start");
  });
});

describe("runNavigationTool: observe", () => {
  it("returns a fresh observation of the current page, and is not a browser action", async () => {
    const agent = await mainOn("/app");
    const run = await runTool(agent, { tool: "observe" });

    expect(run.result.ok).toBe(true);
    const observation = observationOf(run);
    expect(observation.path).toBe("/app");
    expect(find(observation, "heading", "Profile")).toBeDefined();
    expect(run.counted).toBe(false);
    expect(run.actionClass).toBe("observation");
    expect(run.path).toBe("/app");
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(run.durationMs)).toBe(true);
    expect(agent.latest).toEqual(observation);
    expectNoValues(run);
  });

  it("numbers its observations, so the refs it gives are the latest", async () => {
    const agent = await mainOn("/app");
    const first = observationOf(await runTool(agent, { tool: "observe" }));
    const second = observationOf(await runTool(agent, { tool: "observe" }));
    expect(numberOf(second)).toBe(numberOf(first) + 1);
    expect(agent.resolve(find(first, "button", "Save").ref)).toEqual({ error: "stale-ref" });
    expect(agent.resolve(find(second, "button", "Save").ref)).toHaveProperty("locator");
  });

  it("reports a dialog the page opened since the last observation", async () => {
    const agent = await mainOn("/app");
    await showDialog(agent, "alert", `Heads up ${MARKER}`);
    const run = await runTool(agent, { tool: "observe" });
    expect(observationOf(run).dialog).toEqual({ type: "alert", message: "Heads up [hidden]" });
    expectNoValues(run);
    expect(observationOf(await runTool(agent, { tool: "observe" })).dialog).toBeNull();
  });

  it("reports the console errors since the last observation, once", async () => {
    const agent = await mainOn("/start");
    await agent.goto("/noisy");
    const run = await runTool(agent, { tool: "observe" });
    expect(observationOf(run).problems.consoleErrors).toBe(2);
    expect(observationOf(await runTool(agent, { tool: "observe" })).problems).toEqual({ consoleErrors: 0, pageErrors: 0, failedRequests: 0 });
  });
});

describe("runNavigationTool: navigate", () => {
  it("opens a path on the origin: the observation has its path and 200, the call is counted", async () => {
    const { agent } = await launch("/start");
    const run = await runTool(agent, navigate("/app/settings"));

    expect(run.result.ok).toBe(true);
    const observation = observationOf(run);
    expect(observation.path).toBe("/app/settings");
    expect(observation.status).toBe(200);
    expect(observation.title).toBe("Settings");
    expect(find(observation, "heading", "Settings").ref).toMatch(/^1\.\w+$/);
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(run.path).toBe("/app/settings");
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(agent.path).toBe("/app/settings");
    expect(agent.latest).toEqual(observation);
    expectNoValues(run);

    // The next navigation gets the next observation number, and the earlier refs go stale.
    const second = observationOf(await runTool(agent, navigate("/app")));
    expect(find(second, "heading", "Profile").ref).toMatch(/^2\.\w+$/);
    expect(agent.resolve(find(observation, "heading", "Settings").ref)).toEqual({ error: "stale-ref" });
    expectNoValues(second);
  });

  it("follows a redirect on the origin, and the path is where it ended", async () => {
    const agent = await mainOn("/start");
    const run = await runTool(agent, navigate("/old"));
    expect(observationOf(run).path).toBe("/app");
    expect(observationOf(run).status).toBe(200);
    expect(run.path).toBe("/app");
    expect(observationOf(run).problems.failedRequests).toBe(0);
  });

  it.each([
    ["/gone", 404],
    ["/boom", 500],
    ["/nowhere", 404],
  ])("%s (%i): still ok, with the status in the observation", async (path, status) => {
    const agent = await mainOn("/start");
    const run = await runTool(agent, navigate(path));

    expect(run.result.ok).toBe(true);
    expect(observationOf(run).status).toBe(status);
    expect(observationOf(run).path).toBe(path);
    expect(run.counted).toBe(true);
    expect(run.path).toBe(path);
    expectNoValues(run);
  });

  it("reports the page's problems in the observation that follows the navigation", async () => {
    const agent = await mainOn("/start");
    const run = await runTool(agent, navigate("/noisy"));
    expect(observationOf(run).problems.consoleErrors).toBe(2);
  });

  it("reports a dialog a page opens while it loads", async () => {
    const agent = await mainOn("/start");
    const run = await runTool(agent, navigate("/alert-on-load"));
    expect(run.result.ok).toBe(true);
    expect(observationOf(run).dialog).toEqual({ type: "alert", message: "Welcome [hidden]" });
    expectNoValues(run);
  });

  describe("a path that isn't a brief path", () => {
    it.each([
      ["no leading slash", "app"],
      ["a full URL", "http://127.0.0.1:1/app"],
      ["another host", "//evil.example/app"],
      ["a double slash", "/app//settings"],
      ["a parent segment", "/app/../settings"],
      ["a dot segment", "/app/./settings"],
      ["a query", "/app?tab=1"],
      ["a hash", "/app#top"],
      ["a backslash", "/app\\settings"],
      ["a space", "/app settings"],
      ["a control character", "/app\u0007"],
      ["an empty path", ""],
      ["a scheme", "javascript:alert(1)"],
      ["a path longer than 2,048 characters", `/${"a".repeat(2_100)}`],
    ])("%s is invalid-input, counted, and sends nothing", async (_name, path) => {
      const agent = await mainOn("/start");
      const sent = pageRequests();
      const run = await runTool(agent, navigate(path));

      expect(run.result.ok).toBe(false);
      expect(errorOf(run).code).toBe("invalid-input");
      expect(typeof errorOf(run).message).toBe("string");
      expect(run.counted).toBe(true);
      expect(run.actionClass).toBe("observation");
      expect(pageRequests()).toBe(sent);
      expect(agent.path).toBe("/start");
      expect(run.path).toBe("/start");
      expectNoValues(run);
    });

    it("a path that isn't a string is invalid-input too, not an exception *", async () => {
      const agent = await mainOn("/start");
      const run = await runTool(agent, { tool: "navigate", path: 42 } as unknown as NavigationCall);
      expect(errorOf(run).code).toBe("invalid-input");
      expect(run.counted).toBe(true);
    });

    it("is checked before the scope: a bad path is invalid-input even outside it", async () => {
      const agent = await mainOn("/start");
      const run = await runTool(agent, navigate("/other//x"), ["/app"]);
      expect(errorOf(run).code).toBe("invalid-input");
    });
  });
});

describe("runNavigationTool: the brief's scope paths", () => {
  it.each([
    ["the scope path itself", "/app"],
    ["a path below it", "/app/x"],
    ["a deeper path below it", "/app/settings"],
    ["a path below it that does not exist", "/app/missing/page"],
  ])("with scope /app: %s (%s) is allowed", async (_name, path) => {
    const agent = await main();
    const run = await runTool(agent, navigate(path), ["/app"]);
    expect(run.result.ok).toBe(true);
    expect(observationOf(run).path).toBe(path);
    expect(run.counted).toBe(true);
  });

  it.each([
    ["a sibling that starts with the same letters", "/apple"],
    ["the root", "/"],
    ["a prefix of the scope", "/ap"],
    ["another section", "/docs"],
    ["the start page outside the scope", "/start"],
  ])("with scope /app: %s (%s) is off-target, counted, and sends nothing", async (_name, path) => {
    const agent = await mainOn("/app");
    const sent = pageRequests();
    const run = await runTool(agent, navigate(path), ["/app"]);

    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("off-target");
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(pageRequests()).toBe(sent);
    expect(agent.path).toBe("/app");
    expect(run.path).toBe("/app");
    expectNoValues(run);
  });

  it("allows a path under any of several scope paths, and nothing else", async () => {
    const agent = await main();
    const scope = ["/docs", "/app/settings"];
    for (const path of ["/docs", "/docs/guide", "/app/settings", "/app/settings/profile"]) {
      const run = await runTool(agent, navigate(path), scope);
      expect(run.result.ok, path).toBe(true);
    }
    for (const path of ["/app", "/app/x", "/app/settings2", "/documents", "/"]) {
      const run = await runTool(agent, navigate(path), scope);
      expect(run.result.ok, path).toBe(false);
      expect(errorOf(run).code, path).toBe("off-target");
    }
  });

  it("with no scope paths, the whole origin is allowed", async () => {
    const agent = await main();
    for (const path of ["/apple", "/", "/docs"]) {
      const run = await runTool(agent, navigate(path), []);
      expect(run.result.ok, path).toBe(true);
      expect(observationOf(run).path).toBe(path);
    }
  });
});

describe("runNavigationTool: leaving the target", () => {
  it("a redirect to a refused host is off-target, counted, a fresh start page is open, and the next navigation works", async () => {
    const { agent, context, targetUrl } = await launch("/start");
    await runTool(agent, navigate("/app"));
    const before = agent.page;

    const run = await runTool(agent, navigate("/redirect-out"));

    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("off-target");
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(run.path).toBe("/start");
    expect(context.escaped.length).toBeGreaterThan(0);
    expect(agent.page).not.toBe(before);
    expect(agent.page.isClosed()).toBe(false);
    expect(agent.page.url()).toBe(targetUrl);
    expectNoValues(run);

    // The agent can go on from the start page, with an observation of it.
    const again = await runTool(agent, { tool: "observe" });
    expect(observationOf(again).path).toBe("/start");
    expect(find(observationOf(again), "heading", "Start")).toBeDefined();
    expectNoValues(again);

    const next = await runTool(agent, navigate("/app/settings"));
    expect(next.result.ok).toBe(true);
    expect(observationOf(next).path).toBe("/app/settings");
  });

  it("a navigation the guard refuses, made by the page itself, is off-target and counted", async () => {
    const agent = await mainOn("/start");
    const { context } = await mainPage.get();
    const run = await runTool(agent, navigate("/js-out"));

    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("off-target");
    expect(run.counted).toBe(true);
    expect(context.blocked.some((entry) => entry.includes("203.0.113.9"))).toBe(true);
    expectNoValues(run);

    const next = await runTool(agent, navigate("/app"));
    expect(next.result.ok).toBe(true);
  });
});

describe("runNavigationTool: page failures", () => {
  it("a connection that is refused is page-error, counted", async () => {
    const agent = await refusedAgent();
    const run = await runTool(agent, navigate("/start"));
    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("page-error");
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(errorOf(run).message).not.toMatch(/\n\s+at /);
  });

  it("a navigation that times out is page-error, counted, within about the timeout *", async () => {
    const { agent } = await launch("/start");
    const started = Date.now();
    const run = await runTool(agent, navigate("/hang"));
    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("page-error");
    expect(run.counted).toBe(true);
    expect(errorOf(run).message).not.toMatch(/\n\s+at /);
    expect(agent.page.isClosed()).toBe(false);
    // The observation of a page that is still loading would wait 30 s for Playwright's own timeout; the agent must not.
    expect(Date.now() - started).toBeLessThan(MUCH_LESS_THAN_30_S);

    const next = await runTool(agent, navigate("/app/settings"));
    expect(next.result.ok).toBe(true);
    expect(observationOf(next).path).toBe("/app/settings");
  });

  it("a page closed under the tool does not make it throw *", async () => {
    const { agent } = await launch("/start");
    await agent.page.close();
    const run = await runTool(agent, { tool: "observe" });
    expect(run.result).toBeDefined();
    expect(run.counted).toBe(false);
  });
});

describe("runNavigationTool: back", () => {
  it("goes back to the previous page: its path in the observation, counted; the refs of the pages it left go stale", async () => {
    const { agent } = await launch("/start");
    const first = observationOf(await runTool(agent, navigate("/app")));
    const settings = observationOf(await runTool(agent, navigate("/app/settings")));

    const run = await runTool(agent, { tool: "back" });

    expect(run.result.ok).toBe(true);
    expect(observationOf(run).path).toBe("/app");
    expect(find(observationOf(run), "heading", "Profile")).toBeDefined();
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(run.path).toBe("/app");
    expect(agent.path).toBe("/app");
    expect(agent.latest).toEqual(observationOf(run));
    expectNoValues(run);

    expect(agent.resolve(find(first, "heading", "Profile").ref)).toEqual({ error: "stale-ref" });
    expect(agent.resolve(find(settings, "heading", "Settings").ref)).toEqual({ error: "stale-ref" });
  });

  it("with no earlier page it is invalid-input and still counted, and again once back has gone as far as it can", async () => {
    const { agent } = await launch("/start");
    const run = await runTool(agent, { tool: "back" });

    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("invalid-input");
    expect(run.counted).toBe(true);
    expect(run.actionClass).toBe("observation");
    expect(run.path).toBe("/start");
    expectNoValues(run);

    await runTool(agent, navigate("/app"));
    expect((await runTool(agent, { tool: "back" })).result.ok).toBe(true);
    const last = await runTool(agent, { tool: "back" });
    expect(errorOf(last).code).toBe("invalid-input");
    expect(last.counted).toBe(true);
    expect(last.path).toBe("/start");
  });
});

describe("runNavigationTool: cancellation", () => {
  it.each([
    ["observe", { tool: "observe" } as NavigationCall],
    ["navigate", { tool: "navigate", path: "/app" } as NavigationCall],
    ["back", { tool: "back" } as NavigationCall],
  ])("an aborted signal fails %s as cancelled, before doing anything *", async (_name, call) => {
    const agent = await main();
    await runTool(agent, navigate("/app/settings"));
    const latest = agent.latest;
    const sent = pageRequests();
    const controller = new AbortController();
    controller.abort();

    const run = await runTool(agent, call, [], controller.signal);

    expect(run.result.ok).toBe(false);
    expect(errorOf(run).code).toBe("cancelled");
    expect(run.counted).toBe(false);
    expect(run.actionClass).toBe("observation");
    expect(pageRequests()).toBe(sent);
    expect(agent.path).toBe("/app/settings");
    expect(run.path).toBe("/app/settings");
    expect(agent.latest).toBe(latest);
    expectNoValues(run);
  });

  it("a signal that is not aborted changes nothing", async () => {
    const agent = await mainOn("/start");
    const run = await runTool(agent, navigate("/app"), [], new AbortController().signal);
    expect(run.result.ok).toBe(true);
    expect(run.counted).toBe(true);
  });

  it("checks the signal before it checks the call: a bad path with an aborted signal is cancelled", async () => {
    const agent = await main();
    const controller = new AbortController();
    controller.abort();
    const run = await runTool(agent, navigate("not-a-path"), [], controller.signal);
    expect(errorOf(run).code).toBe("cancelled");
  });
});
