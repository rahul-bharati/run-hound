/** Private helpers for the AI modules: portable JSON Schema builders, type guards and text clean-up. */
import { redactSecrets } from "../engine/redact.js";
import type { JsonSchema } from "./types.js";

/** An object schema in the portable subset: every property required, additionalProperties false. */
export function objectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export const stringSchema: JsonSchema = { type: "string" };
export const booleanSchema: JsonSchema = { type: "boolean" };
export const integerSchema: JsonSchema = { type: "integer" };

/** A string limited to `values`; with `nullable`, null is allowed too. */
export function enumSchema(values: readonly string[], nullable = false): JsonSchema {
  return nullable ? { type: ["string", "null"], enum: [...values, null] } : { type: "string", enum: [...values] };
}

/** A value of `type` or null ("nullable, not optional"). */
export function nullable(type: "string" | "integer"): JsonSchema {
  return { type: [type, "null"] };
}

export function arraySchema(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trims, collapses whitespace and cuts to `max` characters (never ending in a space). */
export function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max).trimEnd();
}

/** Redacts secrets, then cuts to `max` characters. For every page or finding string sent to a model. */
export function safeText(text: string, max: number): string {
  return redactSecrets(text).slice(0, max);
}
