/**
 * Shared helpers for the V1 page-wide HTTP checks (security-headers, cookie-flags, cors, source-maps): finding the
 * page's own document response, telling a dev server from a production build, and header card lines.
 */
import type { Capture, Severity } from "../../core/types.js";
import { DEV_SERVER_NOISE } from "../console-network-errors.js";

export type CapturedRequest = Capture["requests"][number];

/**
 * Scripts and requests only a dev server serves (hot reload clients, React refresh, dev runtimes): Vite, Next.js with
 * webpack (unhashed webpack.js / main-app.js / react-refresh.js) or Turbopack ("[turbopack]_browser_dev_hmr-client",
 * next-devtools), webpack dev server, Nuxt, Astro. Production builds hash these file names, so they never match.
 */
const DEV_SERVER_ASSET =
  /\/@vite\/client|\/@react-refresh|\/@id\/|\/node_modules\/\.vite\/|\/_next\/static\/chunks\/(webpack|react-refresh|main-app)\.js|\/_next\/static\/development\/|\[turbopack\]_browser_dev|_next\/static\/chunks\/[^/]*next-devtools|hmr-client|\/_nuxt\/@vite|webpack-dev-server|\/__webpack_hmr|\/@fs\/|\/__astro_dev|\/@astrojs\//i;

function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * True when the page came from a dev server (Vite, Next.js dev, webpack dev server, Nuxt, Astro): it loaded a hot
 * reload client or a dev-only runtime. Dev servers don't send the headers, cookie flags and CORS settings of the
 * production build, so the header, cookie and CORS checks mark their findings advisory there, and source-maps skips.
 */
export function looksLikeDevServer(capture: Capture): boolean {
  return capture.requests.some((r) => DEV_SERVER_ASSET.test(decoded(r.url)) || DEV_SERVER_NOISE.test(r.url));
}

export const DEV_SERVER_NOTE =
  "The page comes from a dev server, which doesn't send the headers, cookie flags and CORS settings of a production build, so findings are advisory: check them again on a production build (for example `vite preview` or `next start`).";

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * The response to the page's own document: the last top-level document request on the target's origin that was
 * answered 2xx with headers recorded. Undefined when there is none (the page failed to load).
 */
export function documentResponse(capture: Capture, targetUrl: string): CapturedRequest | undefined {
  return capture.requests
    .filter((r) => r.resourceType === "document" && r.responseHeaders && r.status !== null && r.status >= 200 && r.status < 300 && sameOrigin(r.url, targetUrl))
    .pop();
}

/** "GET /book" from a request, for card titles. */
export function requestLine(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname}${u.search}`;
  } catch {
    return `${method} ${url}`;
  }
}

/**
 * Headers whose value may be a credential (a token in a custom header, an Authorization echo). Their values are never
 * shown: redactSecrets only knows key formats, not a random session token.
 */
const CREDENTIAL_HEADER = /auth|token|session|secret|key|cookie|signature|credential|csrf|xsrf|password|jwt/i;

/**
 * Response headers as card lines ("name: value"), sorted. set-cookie values are cut to the cookie's name, and the
 * values of credential-like headers are hidden.
 */
export function headerLines(headers: Record<string, string>, mark: (name: string) => boolean = () => false): { text: string; mark?: boolean }[] {
  return Object.keys(headers)
    .sort()
    .flatMap((name) =>
      headers[name]!.split("\n").map((value) => {
        const shown =
          name === "set-cookie"
            ? `${value.split("=")[0]}=… (value hidden)${value.includes(";") ? value.slice(value.indexOf(";")) : ""}`
            : CREDENTIAL_HEADER.test(name)
              ? `… (value hidden, ${value.length} chars)`
              : value;
        return { text: `${name}: ${shown}`, ...(mark(name) ? { mark: true } : {}) };
      }),
    );
}

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** The most severe of `severities` (low when empty). */
export function worst(severities: Severity[]): Severity {
  return severities.reduce<Severity>((a, b) => (RANK[b] > RANK[a] ? b : a), "low");
}
