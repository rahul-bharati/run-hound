/**
 * Password-matching primitives shared by the auth engine: the regexes and helpers that say whether a body, a query,
 * a path, a host name or a header carries a password (raw or encoded). Pure functions on strings and URL objects —
 * no Playwright. Consumed by `password-detection` (request leak) and `session-detection` (session storage leak).
 *
 * The matching is byte-for-byte exact with the pre-extraction behavior: a weak password ("demo") is only matched as a
 * whole segment, not inside a longer token, while any other password matches as a plain substring (see `includesNeedle`).
 */
import { domainToUnicode } from "node:url";

/** A query key that names a password (compared lower-case, letters and digits only): password, user[password], pwd, pin … */
export const PASSWORD_KEY = /(password|passwd|passcode|passphrase|pwd|secret)$|^(pass|pw|pin)$/;

/**
 * Headers the browser sets itself: none of them carries what a page typed. The Referer is not among them: a page can
 * put the password in its own address without a request (history.replaceState), and the Referer then carries it.
 */
export const BROWSER_HEADERS = /^(?:user-agent|accept(?:-.*)?|sec-.*|origin|host|connection|content-(?:type|length)|upgrade-insecure-requests|cache-control|pragma)$/i;

/** decodeURIComponent, or `text` as it is when it isn't well-formed. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** `text` with its runs of percent escapes decoded and "+" read as a space (a form body); a malformed run stays as it is. */
export function percentDecoded(text: string): string {
  return text.replace(/\+/g, " ").replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The forms a password takes in a request besides the raw text: percent-encoded (encodeURIComponent, and a form's "+"
 * for a space), JSON-escaped, and base64 (standard and URL-safe) at each of the three byte alignments, only the
 * characters that come from the password alone and only when that is at least 8 characters.
 */
export function encodedForms(password: string): string[] {
  const forms = new Set([
    encodeURIComponent(password),
    new URLSearchParams({ p: password }).toString().slice(2),
    JSON.stringify(password).slice(1, -1),
  ]);
  const bytes = Buffer.from(password, "utf8");
  for (const skip of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(skip), bytes]).toString("base64");
    const needle = encoded.slice([0, 2, 3][skip], Math.floor((skip + bytes.length) / 3) * 4);
    if (needle.length >= 8) forms.add(needle).add(needle.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  forms.delete(password);
  forms.delete("");
  return [...forms];
}

/**
 * A weak password: shorter than 8 characters and only word characters ("demo", "test"). It can be part of an app's own
 * words and addresses, so it is only matched where it stands on its own (includesNeedle), and a same-origin script's
 * request whose address holds it under a key that doesn't name a password ("?user=demo") is not taken for a leak
 * (carriesUnderPasswordKey). Any other password is distinctive enough.
 */
export function isWeak(password: string): boolean {
  return password.length < 8 && !/\W/.test(password);
}

/**
 * Whether `text` holds `needle`. A weak password (isWeak: "test", "demo") is only a match when it stands on its own — a
 * non-word character or the text's edge on each side — so it is not found inside a larger token ("latest", "testing")
 * on another origin and a weak password doesn't fail a legitimate sign-in (0.6.0 review). A form body, a query and a
 * JSON body all delimit a value they carry (`"test"`, `=test&`, `test`), so a real leak of even a weak password is still
 * caught. Any other password is distinctive enough to match as a plain substring.
 */
export function includesNeedle(text: string, needle: string): boolean {
  if (!isWeak(needle)) return text.includes(needle);
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const before = i === 0 ? "" : text[i - 1]!;
    const after = i + needle.length >= text.length ? "" : text[i + needle.length]!;
    if (!/\w/.test(before) && !/\w/.test(after)) return true;
  }
  return false;
}

/**
 * Whether a text holds `password`: raw or in one of its encoded forms (encodedForms), in the text as it is or with its
 * percent escapes decoded (JSON inside a form field: `data=` + encodeURIComponent(JSON.stringify(…))).
 */
export function passwordIn(password: string): (text: string) => boolean {
  const forms = encodedForms(password);
  return (text: string) => {
    if (!text) return false;
    const decoded = percentDecoded(text);
    return [text, decoded].some((t) => includesNeedle(t, password) || forms.some((f) => t.includes(f)));
  };
}

/**
 * Whether `url`'s query, hash, or user name and password carry the password (raw or encoded: holds), never its path:
 * what a request to the sign-in page's own origin is read for (0.6.0 review, round 1). A GET form puts the password in
 * the query; the path of an ordinary address holds the app's own words ("password" in /api/account/password-status).
 */
export function queryCarries(url: URL, holds: (text: string) => boolean): boolean {
  if (holds(url.search) || holds(url.hash)) return true;
  return [url.username, url.password].some((part) => part !== "" && holds(part));
}

/**
 * Whether `url` carries the password: in its query or hash, in its path, or in its user name or password. A weak
 * password ("demo") counts in the path only as a whole segment: it is part of many an app's own paths
 * (/assets/demo-theme.css). Any other password counts anywhere in the path, raw or encoded (holds), so one with other
 * characters around it (/steal/<password>x, /log-<password>-end.gif) is found too (0.6.0 review, round 3).
 */
export function urlCarries(url: URL, password: string, holds: (text: string) => boolean): boolean {
  if (queryCarries(url, holds)) return true;
  for (const segment of url.pathname.split("/")) if (segment && (safeDecode(segment) === password || percentDecoded(segment) === password)) return true;
  return !isWeak(password) && holds(url.pathname);
}

/**
 * Whether `url`'s host name carries a password that isn't weak (0.6.0 review, round 1): a page that puts it in a
 * subdomain (http://<password>.evil.example/) sends it to that site's DNS and server. A host name is lower-case (and an
 * international one punycode), so the password is looked for lower-cased, in the host name as the address has it and
 * as Unicode. A weak password ("demo") is part of many a host name (demo.example.com), so it isn't looked for there.
 */
export function hostCarries(url: URL, password: string): boolean {
  if (isWeak(password) || !url.hostname) return false;
  const needle = password.toLowerCase();
  const host = url.hostname.toLowerCase();
  return [host, domainToUnicode(host).toLowerCase(), percentDecoded(host).toLowerCase()].some((h) => h.includes(needle));
}

/** Whether a message's text carries `password` (a JSON body's strings included). */
export function textCarries(text: string, password: string, holds: (text: string) => boolean): boolean {
  if (holds(text)) return true;
  if (/^\s*[[{"]/.test(text)) {
    try {
      const strings: string[] = [];
      JSON.parse(text, (_key, value: unknown) => {
        if (typeof value === "string") strings.push(value);
        return value;
      });
      if (strings.some((s) => includesNeedle(s, password))) return true;
    } catch {
      // Not JSON.
    }
  }
  return false;
}

/**
 * True when a value of the URL's query (or its hash), or its user name or password (`http://user:<password>@host`),
 * is exactly `secret`: a password sent in the page address.
 */
export function carriesInQuery(url: URL, secret: string): boolean {
  if (!secret) return false;
  for (const value of url.searchParams.values()) if (value === secret) return true;
  if (url.hash.length > 1) {
    for (const value of new URLSearchParams(url.hash.slice(1)).values()) if (value === secret) return true;
  }
  return [url.username, url.password].some((part) => part !== "" && safeDecode(part) === secret);
}

/**
 * True when a value of the URL's query (or its hash) under a key that names a password (PASSWORD_KEY) is exactly
 * `secret`: how a script's request (not a navigation) carries a weak password in its address. A weak password under
 * any other key ("?user=demo") is one of the app's own words, not a leak.
 */
export function carriesUnderPasswordKey(url: URL, secret: string): boolean {
  if (!secret) return false;
  const params = [url.searchParams, ...(url.hash.length > 1 ? [new URLSearchParams(url.hash.slice(1))] : [])];
  return params.some((p) => [...p.entries()].some(([key, value]) => value === secret && PASSWORD_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))));
}