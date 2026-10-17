/**
 * Version check (docs/desktop-architecture.md, Rule 8). The desktop app never installs an update; at launch it asks
 * GitHub Releases for the latest published version and, if it is newer, the UI offers to open the download page.
 *
 * Pure: no Electron, and the network call is the injected `fetch`. The request is one anonymous GET to
 * `https://api.github.com/repos/<repo>/releases/latest` carrying only an `accept` header and a `user-agent`
 * (`Run-Hound-Desktop/<version>`); no token, no cookies, no machine or usage data.
 *
 * It never throws: offline, a timeout, a rate limit (403/429) or an unexpected body all come back as
 * `{ latest: null, newer: false, url: null, error }`, and the app just carries on without a notice.
 */

import type { DesktopVersionCheckChannel } from "./contract.js";

export type UpdateCheckResult = DesktopVersionCheckChannel["response"];

/** The part of a fetch Response this module reads, so a test can pass a plain object. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The global `fetch` fits this; so does a test double. */
export type FetchLike = (url: string, init: { readonly headers: Record<string, string>; readonly signal: AbortSignal }) => Promise<FetchResponseLike>;

export interface CheckLatestReleaseOptions {
  readonly fetch: FetchLike;
  /** The running app's version, e.g. "0.6.5". */
  readonly current: string;
  /** `owner/name` of the GitHub repository that publishes the releases. */
  readonly repo?: string;
  /** How long the whole check (request and body) may take before it gives up. */
  readonly timeoutMs?: number;
}

export const DEFAULT_REPO = "rahul-bharati/run-hound";
export const DEFAULT_TIMEOUT_MS = 8_000;

/** Environment switch that turns the check off (tests, CI and offline users). */
export const NO_UPDATE_CHECK_ENV = "RUNHOUND_NO_UPDATE_CHECK";

export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[NO_UPDATE_CHECK_ENV] ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated pre-release identifiers; empty for a release. */
  readonly pre: readonly string[];
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Parses "1.2.3", "v1.2.3" and "1.2.3-rc.1" (build metadata is ignored, as semver says). Null for anything else. */
export function parseVersion(raw: string): Semver | null {
  const m = SEMVER.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

const isNumeric = (id: string): boolean => /^\d+$/.test(id);

/** Semver precedence: negative when `a` is older than `b`, zero when equal, positive when newer. Null if either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  // A release outranks any pre-release of the same version.
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    // The shorter list is older when everything before it is equal.
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (isNumeric(p) && isNumeric(q)) return Number(p) < Number(q) ? -1 : 1;
    if (isNumeric(p) !== isNumeric(q)) return isNumeric(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const failed = (current: string, error: string): UpdateCheckResult => ({ latest: null, current, newer: false, url: null, error });

/** The tag with any leading "v" removed, e.g. "v0.7.0" gives "0.7.0". */
const stripV = (tag: string): string => tag.trim().replace(/^v/, "");

async function request(options: CheckLatestReleaseOptions, repo: string): Promise<UpdateCheckResult> {
  const { current } = options;
  if (!parseVersion(current)) return failed(current, "unrecognised current version");
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced rather than only aborted: a fetch that ignores its signal must not hold the check open.
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    const exchange = (async (): Promise<unknown> => {
      const res = await options.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { accept: "application/vnd.github+json", "user-agent": `Run-Hound-Desktop/${current}` },
        signal: controller.signal,
      });
      if (res.status === 403 || res.status === 429) throw new Error("rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })();
    // If the timeout wins, the exchange's later rejection (the abort) must not surface as unhandled.
    exchange.catch(() => undefined);
    const body = await Promise.race([exchange, timedOut]);
    return interpret(body, current, repo);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "timeout" || message === "rate limited" || /^HTTP \d+$/.test(message)) return failed(current, message);
    return failed(current, err instanceof SyntaxError ? "malformed response" : "offline");
  } finally {
    clearTimeout(timer);
  }
}

/** The link is opened in the user's browser, so only this repository's release pages on github.com are accepted. */
function releasePageUrl(raw: string, repo: string): string | null {
  try {
    const url = new URL(raw);
    const ok = url.protocol === "https:" && url.hostname === "github.com" && url.port === "" && url.username === "" && url.password === "";
    return ok && url.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/`) ? url.href : null;
  } catch {
    return null;
  }
}

function interpret(body: unknown, current: string, repo: string): UpdateCheckResult {
  if (typeof body !== "object" || body === null) return failed(current, "malformed response");
  const { tag_name: tag, html_url: htmlUrl } = body as Record<string, unknown>;
  if (typeof tag !== "string" || typeof htmlUrl !== "string") return failed(current, "malformed response");
  const latest = stripV(tag);
  if (!parseVersion(latest)) return failed(current, "malformed response");
  const url = releasePageUrl(htmlUrl, repo);
  if (!url) return failed(current, "unexpected release link");
  const order = compareVersions(latest, current);
  return { latest, current, newer: order !== null && order > 0, url };
}

/** Asks GitHub Releases for the latest release and compares it with `current`. Never throws. */
export async function checkLatestRelease(options: CheckLatestReleaseOptions): Promise<UpdateCheckResult> {
  try {
    return await request(options, options.repo ?? DEFAULT_REPO);
  } catch {
    return failed(options.current, "offline");
  }
}

/**
 * One check per launch: the first call starts it, every later call (the background start after the window shows, and
 * each ask from the renderer) gets the same answer without another request. A failure is kept too, so a rate-limited
 * or offline launch does not retry on every ask.
 */
export function createUpdateChecker(options: CheckLatestReleaseOptions & { readonly disabled?: boolean }): () => Promise<UpdateCheckResult> {
  let result: Promise<UpdateCheckResult> | undefined;
  return () => {
    result ??= options.disabled ? Promise.resolve(failed(options.current, "disabled")) : checkLatestRelease(options);
    return result;
  };
}
