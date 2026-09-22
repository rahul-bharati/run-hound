import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export type RouteHandler = (
  req: RecordedRequest,
  res: ServerResponse,
) => void | Promise<void>;

export interface FixtureServer {
  /** Base URL with no trailing slash, e.g. http://127.0.0.1:53211 */
  url: string;
  /** Every request received, in order. */
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

/**
 * Tiny HTTP server for tests on a random port. `routes` keys are "METHOD /path" (exact path match,
 * query ignored) and win over static files; `root` serves static files; `pages` serves inline HTML by path.
 */
export async function startFixtureServer(options: {
  root?: string;
  pages?: Record<string, string>;
  routes?: Record<string, RouteHandler>;
} = {}): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(recorded);

    const path = new URL(recorded.url, "http://x").pathname;
    const route = options.routes?.[`${recorded.method} ${path}`];
    if (route) return route(recorded, res);

    const page = options.pages?.[path];
    if (page !== undefined) {
      res.writeHead(200, { "content-type": types[".html"] });
      return res.end(page);
    }

    if (options.root) {
      const file = normalize(join(options.root, path === "/" ? "index.html" : path));
      if (file.startsWith(normalize(options.root))) {
        try {
          const body = await readFile(file);
          res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
          return res.end(body);
        } catch {
          // fall through to 404
        }
      }
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Helper for JSON route handlers. */
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
