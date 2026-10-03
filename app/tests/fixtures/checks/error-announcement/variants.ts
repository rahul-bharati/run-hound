/**
 * error-announcement fixtures. GOOD: on an empty submit every invalid field gets aria-invalid="true",
 * aria-describedby pointing at its message, a polite status summary and focus on the first invalid field.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

/** BAD (A05): errors are red text only: no aria-invalid, no aria-describedby, no live region, no focus move. */
export const redTextOnly: BookingVariant = {
  replace: [
    ["const ACCESSIBLE_ERRORS = true;", "const ACCESSIBLE_ERRORS = false;"],
    ['<div id="status" role="status" aria-live="polite"></div>', '<div id="status"></div>'],
    ['<div id="form-error" class="alert" role="alert"></div>', '<div id="form-error" class="alert"></div>'],
  ],
};

/** BAD: aria-invalid is set, but the visible message is not associated (no describedby, no live region). */
export const invalidWithoutMessage: BookingVariant = {
  ...redTextOnly,
  script: `
    form.addEventListener('submit', () => {
      queueMicrotask(() => {
        for (const el of form.querySelectorAll('.error:not([hidden])')) {
          const key = el.id.replace(/-error$/, '');
          for (const control of form.querySelectorAll('[name="' + key + '"]')) control.setAttribute('aria-invalid', 'true');
        }
      });
    });
  `,
};

/**
 * GOOD: the app leans on the browser's own validation (no novalidate, no custom error wiring).
 * Chromium refuses to submit and announces the first invalid field itself, which is accessible enough.
 */
export const nativeValidation: BookingVariant = {
  replace: [
    ["const ACCESSIBLE_ERRORS = true;", "const ACCESSIBLE_ERRORS = false;"],
    ['<form id="booking" action="/api/bookings" method="post" novalidate>', '<form id="booking" action="/api/bookings" method="post">'],
  ],
};
