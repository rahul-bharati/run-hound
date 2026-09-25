import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { ApiError, isApiError } from "@/lib/api";

/** Any thrown value as an ApiError (an unexpected exception reads like a server failure). */
export function toApiError(err: unknown): ApiError {
  if (isApiError(err)) return err;
  return new ApiError(500, "Something went wrong on our side. Please try again.");
}

/**
 * Puts a 4xx answer's field errors ({ errors: { <field>: <message> } }) on the form's fields and focuses the first.
 * Returns the first message, or null when the answer names none of `fields` (then show it as a form-level error).
 */
export function applyServerFieldErrors<T extends FieldValues>(form: UseFormReturn<T>, error: ApiError, fields: readonly Path<T>[]): string | null {
  if (error.isNetworkError || error.status >= 500) return null;
  const known = Object.entries(error.errors).filter(([field]) => (fields as readonly string[]).includes(field));
  known.forEach(([field, message], i) => form.setError(field as Path<T>, { type: "server", message }, { shouldFocus: i === 0 }));
  return known[0]?.[1] ?? null;
}
