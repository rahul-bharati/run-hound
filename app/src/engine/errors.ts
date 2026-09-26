/** The target is not localhost, a private address or an explicitly allowed host. */
export class TargetNotAllowedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Refusing to test ${url}: ${reason}`);
    this.name = "TargetNotAllowedError";
  }
}

/** No form was found on the target page. `detail` says what the page was instead (an error status, a refused host). */
export class NoFormFoundError extends Error {
  constructor(
    public readonly url: string,
    public readonly detail?: string,
  ) {
    super(`No form found on ${url}${detail ? `: ${detail}.` : "."}`);
    this.name = "NoFormFoundError";
  }
}

/** What the page Run Hound opened turned out to be, for a plain "no form" message. */
export interface LoadedPage {
  /** The URL that was asked for. */
  requested: string;
  /** Where the browser ended up (after redirects). */
  final: string;
  /** HTTP status of the main document, or null when unknown. */
  status: number | null;
  /** The start of the page's visible text. */
  text: string;
}

/**
 * Why a page has no form, in one clause, or undefined when nothing stands out: the server answered with an error
 * status, a dev server refused the host name Run Hound used (common when Run Hound runs in a container and reaches
 * the app as host.docker.internal), or the page redirected somewhere else (often a sign-in page).
 */
export function explainNoForm(page: LoadedPage): string | undefined {
  const reasons: string[] = [];
  const text = page.text.replace(/\s+/g, " ").trim();
  const blocked = /Blocked request\. This host \("?([^")]+)"?\) is not allowed|Invalid Host header|Blocked cross-origin request/i.exec(text);
  if (blocked) {
    reasons.push(
      `the dev server refused the host name${blocked[1] ? ` "${blocked[1]}"` : ""} Run Hound used ("${text.slice(0, 120)}"). ` +
        "Allow it in the dev server's settings (Vite: server.allowedHosts; Next.js: allowedDevOrigins), or run Run Hound outside a container and use localhost",
    );
  }
  if (page.status !== null && page.status >= 400) reasons.push(`the page answered ${page.status}${page.status === 404 ? " (not found): check the path" : ""}`);
  let moved = false;
  try {
    const a = new URL(page.requested);
    const b = new URL(page.final);
    moved = a.origin !== b.origin || a.pathname !== b.pathname;
  } catch {
    moved = false;
  }
  if (moved) {
    const login = /log-?in|sign-?in|auth/i.test(page.final) ? ", which looks like a sign-in page (pages behind a login aren't supported yet)" : "";
    reasons.push(`the page redirected to ${page.final}${login}`);
  }
  return reasons.length > 0 ? reasons.join("; ") : undefined;
}

/** True when Run Hound itself runs inside a Docker or Podman container. */
export function inContainer(exists: (path: string) => boolean): boolean {
  return exists("/.dockerenv") || exists("/run/.containerenv");
}

/** Extra sentences for an unreachable localhost target when Run Hound runs in a container; undefined otherwise. */
export function containerLocalhostHint(url: string): string | undefined {
  let host: string;
  let port: string;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^\[|\]$/g, "");
    port = u.port;
  } catch {
    return undefined;
  }
  if (!(host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host === "::1")) return undefined;
  return (
    `Run Hound is running in a container, where ${host} is the container itself, not your computer. ` +
    `Use http://host.docker.internal${port ? `:${port}` : ""}/… with your app listening on all interfaces (for example vite --host), ` +
    "or run the container with --network host (Linux)."
  );
}

/** The target could not be loaded: nothing listening, name not found, connection dropped or a timeout. */
export class TargetUnreachableError extends Error {
  constructor(
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "TargetUnreachableError";
  }
}

/** Drops ANSI colour codes and Playwright's "Call log:" block, leaving the one-line reason. */
export function cleanErrorMessage(message: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "");
  const cut = plain.split(/\n\s*Call log:/)[0] ?? plain;
  return cut.replace(/\s+/g, " ").trim();
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Plain sentences for the Chromium network errors people actually hit when pointing at a local app. */
const NET_ERRORS: [RegExp, (url: string) => string][] = [
  [/ERR_CONNECTION_REFUSED/, (u) => `Nothing is answering at ${originOf(u)}. Is the app running, and on that port?`],
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/, (u) => `The host name in ${u} could not be found.`],
  [/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/, (u) => `The server at ${originOf(u)} closed the connection without answering.`],
  [/ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/, (u) => `${originOf(u)} could not be reached (the connection timed out).`],
  [/ERR_SSL|ERR_CERT/, (u) => `${originOf(u)} has an HTTPS certificate or TLS problem; try the http:// address of your local app.`],
  [/ERR_INVALID_URL/, (u) => `${u} is not a valid address.`],
  [
    /ERR_UNSAFE_PORT/,
    (u) => `Chromium refuses to open port ${portOf(u)}: it is on the list of ports that Chrome and other Chromium browsers block. Run your app on another port, such as 5173 or 8080.`,
  ],
];

/** The URL's port, including the scheme's default when none is written. */
function portOf(url: string): string {
  try {
    const u = new URL(url);
    return u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return "?";
  }
}

/**
 * Turns a Playwright navigation failure (net::ERR_*, timeouts) into a TargetUnreachableError with one plain
 * sentence. Anything else comes back unchanged, so real bugs keep their message.
 */
export function explainNavigationError(err: unknown, url: string): unknown {
  if (!(err instanceof Error)) return err;
  const message = cleanErrorMessage(err.message);
  for (const [pattern, explain] of NET_ERRORS) if (pattern.test(message)) return new TargetUnreachableError(url, explain(url));
  const net = /net::(ERR_[A-Z_]+)/.exec(message);
  if (net) return new TargetUnreachableError(url, `Could not open ${url} (${net[1]}).`);
  const timeout = /Timeout (\d+)ms exceeded/.exec(message);
  if (timeout) return new TargetUnreachableError(url, `${url} did not finish loading within ${Math.round(Number(timeout[1]) / 1000)} seconds.`);
  return err;
}

/** The user name and password written into a target URL (http://user:pass@host/), decoded. */
export interface TargetCredentials {
  username: string;
  password: string;
}

/** "scheme://" and everything up to the last "@" before the path: the userinfo, for URLs the parser rejects. */
const USERINFO = /^([a-z][a-z\d+.-]*:\/\/)[^/?#\\]*@/i;

function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * Accepts what people type ("localhost:3000/book" gets "http://" in front) and takes out a user name and password
 * written into it. The URL comes back without them, so they never reach a plan, report, spec file, log line or the
 * web UI; the browser still answers the app's HTTP authentication with them, for that origin only (guard.ts
 * rememberCredentials). A URL without them comes back as typed.
 */
export function splitTargetUrl(url: string): { url: string; credentials?: TargetCredentials } {
  const trimmed = url.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  if (!withScheme.includes("@")) return { url: withScheme };
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    // The gate refuses it and quotes it, so the userinfo must not be in it.
    return { url: withScheme.replace(USERINFO, "$1") };
  }
  if (!parsed.username && !parsed.password) return { url: withScheme };
  const credentials = { username: decoded(parsed.username), password: decoded(parsed.password) };
  parsed.username = "";
  parsed.password = "";
  return { url: parsed.href, credentials };
}

/**
 * Accepts what people type: "localhost:3000/book" and "127.0.0.1:5173" get "http://" in front. A URL that already
 * names a scheme ("https://", "file://") is left alone for the safety gate to judge. A user name and password in it
 * are dropped (see splitTargetUrl).
 */
export function normalizeTargetUrl(url: string): string {
  return splitTargetUrl(url).url;
}
