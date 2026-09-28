// Fernway: a polished, AI-builder-style SaaS app for testing Run Hound (see ../CONTRACT.md).
// Serves the built frontend (dist/) and an in-memory JSON API. Bugs are switched on with FERNWAY_BUGS; FERNWAY_LOGIN
// (one-step | two-step) and FERNWAY_SESSION (cookie | session-storage) pick the sign-in form and where the session lives.
// Uses only Node built-ins.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createApp, ROOT } from "./app.mjs";
import { BugConfigError, parseBugs } from "./bugs.mjs";
import { ModeConfigError, parseLoginMode, parseSessionMode } from "./modes.mjs";

let bugs;
let login;
let session;
try {
  bugs = parseBugs(process.env.FERNWAY_BUGS);
  login = parseLoginMode(process.env.FERNWAY_LOGIN);
  session = parseSessionMode(process.env.FERNWAY_SESSION);
} catch (err) {
  if (!(err instanceof BugConfigError) && !(err instanceof ModeConfigError)) throw err;
  console.error(`fernway: ${err.message}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 4110);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`fernway: PORT must be a port number, got "${process.env.PORT}"`);
  process.exit(1);
}
// Unset HOST means "all interfaces" (dual-stack where available, so both localhost forms work).
const HOST = process.env.HOST || undefined;

if (!existsSync(join(ROOT, "dist", "index.html"))) {
  console.error("fernway: dist/index.html is missing. Run `pnpm --filter fernway build` (vite build) first.");
  process.exit(1);
}

const app = createApp({ bugs, login, session });
const server = createServer((req, res) => void app.handle(req, res));

server.once("error", (err) => {
  console.error(`fernway: could not listen: ${err.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const active = bugs.size ? [...bugs].sort().join(",") : "none";
  console.log(`fernway listening on http://${HOST ?? "localhost"}:${port}/ (bugs: ${active}) (login: ${login}, session: ${session})`);
});

function shutdown() {
  server.close();
  server.closeAllConnections();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
