/**
 * Anti-CSRF token helpers for write-access: the body's token fields (tokenFieldsOf), the body token swap
 * (swapToken, with the snapshot semantics that replace every duplicate of `from` at once), and the per-write
 * token rewrite (withOwnTokens) so a replay carries the identity's own token. The "drifted" cookies a token
 * goes with (driftedFor) live in `./drift.ts`. The other focused modules (identity, record matching, record
 * body, write build, credentials, version stamps, restoration) live alongside this one.
 */
import { isTokenField, type TokenSource } from "../../checks/lib/csrf-tokens.js";
import { parseJson } from "../../checks/lib/record-state.js";
import { driftedFor } from "./drift.js";
import type { JsonObject } from "../../checks/lib/record-state.js";
import type { Write } from "../../interfaces/write-access.js";

/** The anti-CSRF token fields of a JSON or form body, at any depth (a JSON key path is joined with "."). */
export function tokenFieldsOf(body: string | null, kind: Write["kind"], tokens: ReadonlySet<string>, runKey: string): { field: string; value: string }[] {
  if (!body || !kind) return [];
  if (kind === "form") {
    return [...new URLSearchParams(body)].filter(([k, v]) => isTokenField(k, v, tokens, runKey)).map(([field, value]) => ({ field, value }));
  }
  const out: { field: string; value: string }[] = [];
  const walk = (n: unknown, path: string[], depth: number) => {
    if (depth > 6 || !n || typeof n !== "object" || Array.isArray(n)) return;
    for (const [k, v] of Object.entries(n as JsonObject)) {
      if (typeof v === "string" && isTokenField(k, v, tokens, runKey)) out.push({ field: [...path, k].join("."), value: v });
      else walk(v, [...path, k], depth + 1);
    }
  };
  walk(parseJson(body), [], 0);
  return out;
}

/** `body` (JSON or form) with each token field's value `from` replaced by `to`, wherever a field holds exactly it. */
export function swapToken(body: string, kind: "json" | "form", from: string, to: string): string {
  if (kind === "form") {
    const params = new URLSearchParams(body);
    for (const [k, v] of Array.from(params.entries())) if (v === from) params.set(k, to);
    return params.toString();
  }
  const walk = (n: unknown): unknown => {
    if (typeof n === "string") return n === from ? to : n;
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === "object") return Object.fromEntries(Object.entries(n as JsonObject).map(([k, v]) => [k, walk(v)]));
    return n;
  };
  return JSON.stringify(walk(parseJson(body)));
}

/**
 * Gives each write that carries an anti-CSRF token field (Django's csrfmiddlewaretoken, Rails' authenticity_token, a
 * _csrf field) the scenario identity's own token where Run Hound can read one (`theirs`: the tokens a page opened as
 * that identity holds, paired with Account A's, `ours`, by where they came from, or a hidden input of the field's
 * name). A write whose token can't be swapped still carries Account A's: its `tokens` say so, and a refusal of it
 * (TOKEN_REFUSALS) is then no proof of an ownership check.
 */
export function withOwnTokens(writes: Write[], ours: TokenSource[], theirs: TokenSource[], runKey: string, drift: ReadonlySet<string>): Write[] {
  const values = new Set(ours.map((t) => t.value));
  return writes.map((w) => {
    const fields = tokenFieldsOf(w.body, w.kind, values, runKey);
    if (fields.length === 0 || !w.body || !w.kind) return w;
    let body = w.body;
    const tokens = fields.map(({ field, value }) => {
      const source = ours.find((t) => t.value === value);
      const name = field.split(".").pop()!;
      const mine = (source && theirs.find((t) => t.kind === source.kind && t.name === source.name)) ?? theirs.find((t) => t.kind === "input" && t.name === name);
      if (!mine || mine.value === value) return { field, swapped: false };
      body = swapToken(body, w.kind!, value, mine.value);
      const drifted = driftedFor(mine, drift);
      return { field, swapped: true, ...(drifted.length > 0 ? { drifted } : {}) };
    });
    return { ...w, body, tokens };
  });
}
