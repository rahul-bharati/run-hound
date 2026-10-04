import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { startDesktopEngine, type DesktopEngineFactory, type DesktopServerAdapter, type DesktopServerHandle } from "../src/entry.js";

/** A minimal Hono-like app for the test. */
const fakeApp = { fetch: async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
  return new Response("not found", { status: 404 });
}};

const fakeFactory: DesktopEngineFactory = () => fakeApp;

const liveServer: DesktopServerAdapter = {
  startServer({ app, port, host }): DesktopServerHandle {
    const srv: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length && req.method && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks).toString("utf8") : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
      }
      const webReq = new Request(`http://${host}:${port}${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        body,
      });
      const webRes = await app.fetch(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    });
    srv.listen(port, host);
    liveServerState.server = srv;
    return {
      close(callback: () => void) {
        srv.close(() => callback());
      },
      get listening() {
        return srv.listening;
      },
      on(event, listener) {
        srv.on(event, listener);
      },
    };
  },
};

const liveServerState: { server?: Server } = {};

describe("startDesktopEngine (factory-injected)", () => {
  let handle: Awaited<ReturnType<typeof startDesktopEngine>>["handle"] | undefined;
  let info: Awaited<ReturnType<typeof startDesktopEngine>>["info"] | undefined;

  beforeAll(async () => {
    const started = await startDesktopEngine({ headedBrowser: false, runHoundVersion: "9.9.9" }, fakeFactory, liveServer);
    handle = started.handle;
    info = started.info;
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it("leaves the Playwright environment to the caller, which applies it before importing the engine", () => {
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
  });

  it("reports the version the caller passes", () => {
    expect(info?.runHoundVersion).toBe("9.9.9");
  });

  it("returns a usable loopback URL", () => {
    expect(info?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it("returns a runs directory that is not the working-directory-relative default", () => {
    expect(info?.runsDir).not.toBe("runs");
    expect(info?.runsDir.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(info?.runsDir ?? "")).toBe(true);
  });

  it("returns a platform-appropriate config directory", () => {
    expect(info?.configDir).toBeTruthy();
    if (info?.platform === "darwin") {
      expect(info.configDir).toMatch(/Library[/\\]Application Support[/\\]run-hound$/);
    }
  });

  it("round-trips a request through the Hono app", async () => {
    const res = await fetch(`${info?.url}healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects with the listen error when the port is taken", async () => {
    const port = Number(new URL(info?.url ?? "").port);
    await expect(startDesktopEngine({ port, runHoundVersion: "9.9.9" }, fakeFactory, liveServer)).rejects.toThrow(/EADDRINUSE/);
  });

  it("stops the server when handle.stop() is called", async () => {
    expect(handle).toBeDefined();
    await handle?.stop();
  });
});
