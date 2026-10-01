/**
 * Security headers and Content-Security-Policy. The BASE_HEADERS run on every response (nosniff, X-Frame-Options,
 * Referrer-Policy) plus a default CSP that allows nothing; images skip the CSP. report.html and the UI get their own
 * policies: report.html is sandboxed with no scripts, the UI allows only its own inline script and stylesheet by hash.
 */
import { createHash } from "node:crypto";

/**
 * Security headers on every response: never framed (clickjacking), never MIME-sniffed, no Referer to other sites.
 * The UI and report.html get their own CSP (below); everything else gets one that allows nothing.
 */
export const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

export const DEFAULT_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * report.html is page-derived text with no script of its own: nothing runs in it (sandbox, no script-src), and it
 * gets an opaque origin, so even an escaping slip or a tampered file can't call the API. Inline styles and images
 * (its own artifacts and the data: URI mark) still load; allow-popups lets its links open in a new tab.
 */
export const REPORT_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "sandbox allow-popups allow-popups-to-escape-sandbox";

/** 'sha256-…' sources for every inline <script> and <style> in the UI document. */
export function inlineHashes(html: string, tag: "script" | "style"): string {
  const hashes = [
    ...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
  ].map(
    (m) =>
      `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`,
  );
  return hashes.join(" ") || "'none'";
}

/**
 * The UI's CSP: only its own inline script and stylesheet (by hash; no other inline code, no style attributes),
 * images from this server and data: URIs (the mark), requests only to this server.
 */
export function uiCsp(html: string): string {
  return [
    "default-src 'none'",
    `script-src ${inlineHashes(html, "script")}`,
    `style-src ${inlineHashes(html, "style")}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Hono middleware that adds BASE_HEADERS to every response and a default CSP unless one is already set or the
 * response is an image (the screencast frame carries image/jpeg; pixels can't be redacted and a CSP would only
 * get in the way of debugging).
 */
export function securityHeaders() {
  return async (c: { req: { method: string }; res: { headers: Headers }; header: (name: string, value: string) => void }, next: () => Promise<void>) => {
    await next();
    for (const [name, value] of Object.entries(BASE_HEADERS))
      c.header(name, value);
    if (
      !c.res.headers.has("content-security-policy") &&
      !(c.res.headers.get("content-type") ?? "").startsWith("image/")
    ) {
      c.header("content-security-policy", DEFAULT_CSP);
    }
  };
}
