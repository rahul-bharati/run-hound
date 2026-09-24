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

/** No form was found on the target page. */
export class NoFormFoundError extends Error {
  constructor(public readonly url: string) {
    super(`No form found on ${url}`);
    this.name = "NoFormFoundError";
  }
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
];

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

/**
 * Accepts what people type: "localhost:3000/book" and "127.0.0.1:5173" get "http://" in front. A URL that already
 * names a scheme ("https://", "file://") is left alone for the safety gate to judge.
 */
export function normalizeTargetUrl(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
