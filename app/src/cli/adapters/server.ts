import { serve } from "@hono/node-server";
import type { IServerHandle, IServerOptions } from "../../interfaces/cli.js";

export function startServerWithApp(options: IServerOptions): IServerHandle {
  const server = serve(
    { fetch: options.app.fetch, port: options.port, hostname: options.host },
    (info) => {
      const host = info.address.includes(":") ? `[${info.address}]` : info.address;
      options.stdout.write(`Run Hound listening on http://${host}:${info.port}\n`);
    },
  );
  return {
    close: (callback) => { server.close(callback); },
    get listening() { return server.listening; },
    on: (event, listener) => { server.on(event, listener); },
  };
}
