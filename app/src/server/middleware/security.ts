/** Security headers and Content-Security-Policy middleware. The shared constants live in constants/server-constants.ts. */
import { createHash } from "node:crypto";
import { BASE_HEADERS, DEFAULT_CSP } from "../../constants/server-constants.js";

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

/** The UI's CSP: only its own inline script and stylesheet (by hash; no other inline code, no style attributes),
 * images from this server and data: URIs (the mark), requests only to this server. */
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

/** Hono middleware that adds BASE_HEADERS to every response and a default CSP unless one is already set or the
 * response is an image (the screencast frame carries image/jpeg; pixels can't be redacted and a CSP would only
 * get in the way of debugging). */
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