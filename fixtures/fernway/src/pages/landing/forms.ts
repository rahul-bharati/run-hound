import { useRef, type FormEvent } from "react";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { isApiError } from "@/lib/api";

/** Waitlist "Team size" options (server/routes/marketing.mjs TEAM_SIZES). */
export const TEAM_SIZES = ["1–5", "6–20", "21–50", "51+"] as const;

/** Demo form "Company size" options (server/routes/marketing.mjs COMPANY_SIZES). */
export const COMPANY_SIZES = ["1–10", "11–50", "51–200", "201+"] as const;

/** Validation messages, worded like the server's (server/routes/marketing.mjs MESSAGES). */
export const MESSAGES = {
  emailRequired: "Enter your work email.",
  emailInvalid: "Enter an email address like name@example.com.",
  newsletterEmailRequired: "Enter your email address.",
  teamSizeRequired: "Choose your team size.",
  nameRequired: "Enter your full name.",
  nameTooLong: "Use 100 characters or fewer.",
  companySizeRequired: "Choose your company size.",
  dateRequired: "Choose a preferred date.",
  datePast: "Choose today or a later date.",
  messageTooLong: "Use 1000 characters or fewer.",
  consentRequired: "Agree to be contacted so we can schedule your demo.",
} as const;

/**
 * A submit handler for `<form onSubmit>` that runs react-hook-form's handleSubmit once at a time: a second submit
 * (a double click, or Enter pressed twice) while the first is still validating or saving is ignored, so one click
 * is one request even before the button re-renders as disabled.
 */
export function useGuardedSubmit<TFieldValues extends FieldValues, TTransformed>(
  form: UseFormReturn<TFieldValues, unknown, TTransformed>,
  onValid: (values: TTransformed) => Promise<void>,
) {
  const busy = useRef(false);
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    void form.handleSubmit(onValid)(event).finally(() => {
      busy.current = false;
    });
  };
}

/**
 * Puts a 400/409 answer's field messages on the matching fields and focuses the first one. Returns true when at
 * least one message belonged to a field of this form.
 */
export function showFieldErrors<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues, unknown, unknown>,
  error: unknown,
  fields: readonly FieldPath<TFieldValues>[],
): boolean {
  if (!isApiError(error)) return false;
  const hits = fields.filter((field) => typeof error.errors[field] === "string");
  hits.forEach((field, i) => form.setError(field, { type: "server", message: error.errors[field] }, { shouldFocus: i === 0 }));
  return hits.length > 0;
}

/** A message safe to show for any failed save (ApiError already words 5xx and network failures). */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return "Something went wrong on our side. Please try again.";
}
