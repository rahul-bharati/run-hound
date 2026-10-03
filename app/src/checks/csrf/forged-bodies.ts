/** Forge request construction for the csrf check: how the captured save's body is rewritten for the cross-site page. */

import { isTokenField, TOKEN_FIELD } from "../lib/csrf-tokens.js";
import { jsonObjectBody, type CapturedRequest } from "../lib/record-state.js";
import { looksLikeReference } from "../lib/cross-site-query.js";
import type { ForgedBodies } from "../../interfaces/csrf.js";
import { MARKER_SUFFIX } from "../../constants/csrf-constants.js";

/** A value as text: a string as it is, null or undefined as "", an object as JSON. */
export const asText = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A body encoded as `application/x-www-form-urlencoded` (name=value pairs joined by "&"), judged from the body itself. */
export function looksFormEncoded(body: string | null | undefined): body is string {
  return Boolean(body) && /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(body!);
}

/** A multipart/form-data body's text fields in order, read from the body itself. Null when it isn't multipart text fields. */
export function multipartEntries(body: string | null | undefined): [string, string][] | null {
  const first = body ? /^--([^\r\n]+)\r?\n/.exec(body) : null;
  if (!body || !first) return null;
  const entries: [string, string][] = [];
  for (const part of body.split(`--${first[1]!}`).slice(1)) {
    if (part.startsWith("--")) break;
    const m = /^\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)\r?\n$/.exec(part);
    if (!m) return null;
    const name = /\bname="([^"]*)"/i.exec(m[1]!)?.[1];
    if (name === undefined) return null;
    const file = /\bfilename="([^"]*)"/i.exec(m[1]!);
    if (file) {
      if (file[1] === "" && m[2] === "") continue;
      return null;
    }
    entries.push([name, m[2]!]);
  }
  return entries.length > 0 ? entries : null;
}

/** A value with MARKER_SUFFIX right after the run token, so it still carries the token but is unique; keeps the total length within 4 of the original. */
export function markValue(value: string, key: string): string {
  const i = value.toLowerCase().indexOf(key);
  if (i < 0) return `${value}${key}${MARKER_SUFFIX}`;
  const token = value.slice(i, i + key.length);
  const tail = value.slice(i + key.length);
  if (tail.length >= 4) return `${value.slice(0, i)}${token}${MARKER_SUFFIX}${tail.slice(4)}`;
  const before = value.slice(0, i);
  return `${before.slice(Math.min(before.length, 4 - tail.length))}${token}${MARKER_SUFFIX}`;
}

/** The forged bodies for `save`, with every run-token value, at any depth, changed to a new value that carries the marker; null when the body can't be forged. */
export function forgedBodies(
  save: CapturedRequest,
  key: string,
  tokens: ReadonlySet<string>,
  placed: ReadonlySet<string>,
  fromPage: ReadonlySet<string>,
): ForgedBodies | null {
  const dropped = new Set<string>();
  const unplaced = new Set<string>();
  const urlOnly = new Set<string>();
  const references = new Set<string>();
  const isToken = (k: string, v: unknown) => {
    if (!isTokenField(k, v, tokens, key)) return false;
    dropped.add(k);
    const text = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
    if (!TOKEN_FIELD.test(k) && text !== null && !placed.has(text)) {
      unplaced.add(k);
      if (!fromPage.has(text)) urlOnly.add(k);
      if (looksLikeReference(k, text)) references.add(k);
    }
    return true;
  };
  const leftOut = () => ({ dropped: [...dropped], unplaced: [...unplaced], urlOnly: [...urlOnly], references: [...references] });
  const json = jsonObjectBody(save.postData);
  const marked: string[] = [];

  if (json) {
    const walk = (v: unknown, top: string): unknown => {
      if (typeof v === "string") {
        if (!v.toLowerCase().includes(key)) return v;
        marked.push(top);
        return markValue(v, key);
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, top));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
          if (!isToken(k, x)) out[k] = walk(x, top);
        }
        return out;
      }
      return v;
    };
    const forged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json)) {
      if (!isToken(k, v)) forged[k] = walk(v, k);
    }
    if (marked.length === 0) {
      const first = Object.keys(forged).find((k) => typeof forged[k] === "string");
      if (first === undefined) return null;
      forged[first] = markValue(forged[first] as string, key);
      marked.push(first);
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(forged)) params.append(k, asText(v));
    return {
      kind: "json",
      form: params.toString(),
      json: JSON.stringify(forged),
      marked: marked[0]!,
      fields: Object.keys(forged),
      ...leftOut(),
    };
  }

  const multipart = looksFormEncoded(save.postData) ? null : multipartEntries(save.postData);
  const entries = multipart ?? (looksFormEncoded(save.postData) ? [...new URLSearchParams(save.postData)] : null);
  if (!entries) return null;
  const kept = entries.filter(([k, v]) => !isToken(k, v));
  const withToken = kept.map(([, v], i) => (v.toLowerCase().includes(key) ? i : -1)).filter((i) => i >= 0);
  const at = withToken.length > 0 ? withToken : kept.length > 0 ? [0] : [];
  if (at.length === 0) return null;
  const forged = kept.map(([k, v], i): [string, string] => [k, at.includes(i) ? markValue(v, key) : v]);
  return {
    kind: multipart ? "multipart" : "form",
    form: new URLSearchParams(forged).toString(),
    marked: forged[at[0]!]![0],
    fields: [...new Set(forged.map(([k]) => k))],
    ...leftOut(),
  };
}

/** Why a save's body can't be forged (forgedBodies returned null), said for what the body is. */
export function unforgeable(body: string | null | undefined): string {
  let json: unknown;
  try {
    json = body ? (JSON.parse(body) as unknown) : undefined;
  } catch {
    json = undefined;
  }
  if (Array.isArray(json)) {
    return "this form's save is a JSON array, not an object with named fields, and Run Hound doesn't rebuild one on a cross-site page, so this save wasn't forged.";
  }
  if (json === null || (json !== undefined && typeof json !== "object")) {
    return "this form's save is a bare JSON value, not an object with named fields, and Run Hound doesn't rebuild one on a cross-site page, so this save wasn't forged.";
  }
  if (json !== undefined) {
    return "this form's save is a JSON object with no text field Run Hound can forge (the typed value isn't in it as text, as when the page encodes it before sending it), so this save wasn't forged.";
  }
  if (body && /^--[^\r\n]+\r?\n/.test(body) && /\bfilename="[^"]/i.test(body)) {
    return "this form's save is a multipart body that carries a file, which Run Hound doesn't rebuild on a cross-site page, so this save wasn't forged.";
  }
  return "this form's save isn't form-encoded, multipart text fields or a JSON object, so a cross-site page can't rebuild it.";
}