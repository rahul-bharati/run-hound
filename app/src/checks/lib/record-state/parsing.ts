/** JSON/form record identity: parsing bodies, reading values, comparing fields, multipart. Pure data transforms. */

import type { JsonObject } from "../../../types/record-state.js";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** A JSON object body (not an array, not a scalar), or null. */
export function jsonObjectBody(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  const value = parseJson(body);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** How a save's body is encoded, judged from the body itself (the capture keeps no request headers). */
export function bodyKind(body: string | null): "json" | "form" | null {
  if (!body) return null;
  if (jsonObjectBody(body)) return "json";
  // application/x-www-form-urlencoded: name=value pairs joined by "&", nothing a multipart body or plain text holds.
  return /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body) ? "form" : null;
}

/**
 * True when the JSON text `text` holds the record's id under its key (`"id":"t1"`), at any depth, whitespace aside.
 * A number id must end there: `"id":7` is not in `"id":70`.
 */
export function holdsId(text: string, id: { key: string; value: string | number }): boolean {
  const needle = `${JSON.stringify(id.key)}:${JSON.stringify(id.value)}`.replace(/\s+/g, "");
  const flat = text.replace(/\s+/g, "");
  if (typeof id.value === "string") return flat.includes(needle);
  for (let at = flat.indexOf(needle); at >= 0; at = flat.indexOf(needle, at + 1)) {
    if (!/[0-9.eE]/.test(flat.charAt(at + needle.length))) return true;
  }
  return false;
}

/**
 * True when a save's own body names the record's id: a JSON body holding it under its key, a form-encoded field of
 * that name, or a multipart part of that name. A create can't know an id the server assigns, so such a save edits a
 * record that was already there. An app that makes its ids in the browser is taken for an edit too: the safe side.
 */
export function bodyNamesId(body: string | null, id: { key: string; value: string | number }): boolean {
  if (!body) return false;
  if (holdsId(body, id)) return true;
  const want = String(id.value);
  if (bodyKind(body) === "form") return new URLSearchParams(body).getAll(id.key).includes(want);
  return multipartHas(body, id.key, want);
}

/** True when a multipart body has a part named `name` whose value is `value`. */
export function multipartHas(body: string, name: string, value: string): boolean {
  return new RegExp(`[;\\s]name="${escapeRegExp(name)}"[^\\r\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n${escapeRegExp(value)}\\r?\\n`).test(body);
}

/** The part names of a multipart body. */
export function multipartNames(body: string): string[] {
  return [...body.matchAll(/[;\s]name="([^"]*)"/g)].map((m) => m[1]!);
}

export function plainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The fields of the record whose values differ between `before` and `after` (the record objects): changed, added or
 * removed, in the order they first appear.
 */
export function changedFields(before: JsonObject, after: JsonObject): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.filter((k) => {
    const had = Object.prototype.hasOwnProperty.call(before, k);
    const has = Object.prototype.hasOwnProperty.call(after, k);
    return had !== has || (had && !sameValue(before[k], after[k]));
  });
}