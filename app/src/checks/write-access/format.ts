/**
 * Formatting and joining helpers for write-access: formText (a value as the app's own body holds it), decodeValue
 * (a URL-decoded value or its original on failure), joinFields (a note's "a, b and c" join), endpoints
 * (endpointOf of a list, joined with ", ").
 */

import { endpointOf } from "../../checks/lib/functional-finding.js";

/** A value as text: a string as it is, null or undefined as "", an object as JSON. */
export const formText = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Decoded URL-encoded value, or its original when the decode fails. */
export const decodeValue = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** A helper for the verdict notes: "a and b" / "a, b and c" of `fields`. */
export const joinFields = (fields: string[]) => (fields.length <= 1 ? fields.join("") : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`);

/** The endpoints of `ws`, joined with ", " (endpointOf each). */
export const endpoints = (ws: { method: string; url: string }[]) => ws.map((w) => endpointOf(w.method, w.url)).join(", ");
