/**
 * Password-leak detection for sign-in (auth.ts): the function that decides whether a request carries the password
 * (raw or encoded) anywhere in its body, URL, host name, headers or Referer. Pure over Sent + URL + string; no
 * Playwright Session, no Page. The matching rules (encoded forms, weak-password boundary, header skipping) live
 * in `./password-primitives.ts`. The Sent shape is declared in `interfaces/auth.ts`.
 */
import type { Request } from "playwright";
import type { Sent } from "../../interfaces/auth.js";
import { isCredentialHeader } from "../context.js";
import {
  BROWSER_HEADERS,
  includesNeedle,
  passwordIn,
  textCarries,
  urlCarries,
} from "./password-primitives.js";
import { SESSION_NAME } from "./session-detection.js";

export function sentOf(request: Request): Sent {
  return {
    url: request.url(),
    body: request.postDataBuffer()?.toString("utf8") ?? "",
    headers: request.headers(),
    navigation: request.isNavigationRequest(),
  };
}

/** A paused request (Fetch.requestPaused) as `stops` reads it. */
export function pausedSent(event: { request: { url: string; headers: Record<string, string>; postData?: string; postDataEntries?: { bytes?: string }[] }; resourceType: string }): Sent {
  const { request } = event;
  const body = request.postData ?? Buffer.concat((request.postDataEntries ?? []).map((entry) => Buffer.from(entry.bytes ?? "", "base64"))).toString("utf8");
  return { url: request.url, body, headers: request.headers, navigation: event.resourceType === "Document" };
}

/**
 * Whether a request header names a credential (0.6.0 review, round 1): Authorization, an API key, an x-…-token or a
 * header whose name says session, auth, token or key. Never a cookie (the storage state has those), and never a CSRF
 * header: a cookie-session app may keep its CSRF token in sessionStorage without its session living there.
 */
export function isCredentialName(name: string): boolean {
  if (/^(cookie|referer)$/i.test(name) || /csrf|xsrf/i.test(name) || BROWSER_HEADERS.test(name)) return false;
  return isCredentialHeader(name) || SESSION_NAME.test(name);
}

/**
 * Whether `request` carries `password` (0.6.0 review): in its body (raw, form- or percent-encoded, JSON-escaped or in
 * any JSON string, base64, and JSON inside a form field), in its query, hash, path (urlCarries) or user name and
 * password, in a header the page set (an Authorization "Basic" header decoded too), or in the Referer's address. A
 * form's POST body is URL-encoded and a JSON body escapes " and \, so a test of the raw text alone lets a password
 * with a space or ( ) ! ~ " \ @ through.
 */
export function carriesPassword(request: Sent, password: string): boolean {
  if (!password) return false;
  const holds = passwordIn(password);

  if (textCarries(request.body, password, holds)) return true;

  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }
  if (url && urlCarries(url, password, holds)) return true;

  for (const [name, value] of Object.entries(request.headers)) {
    if (BROWSER_HEADERS.test(name)) continue;
    if (/^referer$/i.test(name)) {
      // The page's own address, which never holds the password legitimately: only its query, hash, path and user info
      // are read (urlCarries), so a weak password that is part of the host name isn't taken for one.
      try {
        if (urlCarries(new URL(value), password, holds)) return true;
      } catch {
        // Not an address.
      }
      continue;
    }
    if (holds(value)) return true;
    const basic = /^basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(value);
    if (basic && includesNeedle(Buffer.from(basic[1]!, "base64").toString("utf8"), password)) return true;
  }
  return false;
}