/**
 * CheckContext.request() on a password-protected preview (http://user:pass@host/): the browser pages of a run answer
 * the site's HTTP authentication with the credentials taken out of the target URL (guard.ts rememberCredentials), and
 * the requests the access checks send must too, or every replay reads 401 and the check proves nothing. The site's
 * password is not an account: it answers for every identity, signed out included, as the browser does. It is only
 * sent to the origin it was given for, and only when the server asks for it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import { createCheckContext, type RunningCheckContext } from "./context.js";
import { emptyForm } from "./discover.js";
import { rememberCredentials } from "./guard.js";

const PASSWORD = "preview-Pa55word";
const BASIC = `Basic ${Buffer.from(`preview:${PASSWORD}`).toString("base64")}`;

let preview: FixtureServer;
/** Another local origin that records whether it was sent the preview's password. */
let elsewhere: FixtureServer;
let artifactsDir: string;
let ctx: RunningCheckContext;

beforeAll(async () => {
  preview = await startFixtureServer({
    routes: {
      "GET /api/notes": (req, res) => {
        if (req.headers.authorization !== BASIC) {
          res.writeHead(401, { "www-authenticate": 'Basic realm="preview"', "content-type": "text/plain" });
          res.end("Password required");
          return;
        }
        json(res, 200, { notes: [] });
      },
    },
  });
  elsewhere = await startFixtureServer({ routes: { "GET /api/echo": (req, res) => json(res, 200, { authorization: req.headers.authorization ?? null }) } });
  rememberCredentials(preview.url, { username: "preview", password: PASSWORD });
});

afterAll(async () => {
  await Promise.all([preview?.close(), elsewhere?.close()]);
  await closeBrowser();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), "rh-context-basic-"));
  ctx = createCheckContext({ browser: await getBrowser(), form: emptyForm(`${preview.url}/app`), targetUrl: `${preview.url}/app`, artifactsDir, runToken: "t3st" });
});

afterEach(async () => {
  await ctx.dispose();
  await rm(artifactsDir, { recursive: true, force: true });
});

describe("CheckContext.request on a password-protected preview", () => {
  it("answers the site's HTTP authentication for every identity, as the browser does", async () => {
    for (const as of ["self", "signed-out"] as const) {
      const res = await ctx.request(as, { method: "GET", url: `${preview.url}/api/notes` });
      expect(res.status, as).toBe(200);
    }
  });

  it("never sends the preview's password to another origin", async () => {
    const res = await ctx.request("self", { method: "GET", url: `${elsewhere.url}/api/echo` });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("Basic");
  });
});
