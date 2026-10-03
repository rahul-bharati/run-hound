/**
 * credential-fields fixtures. GOOD: password and confirm password accept paste and carry
 * autocomplete="new-password".
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

/** BAD (A07): paste blocked on confirm password. Deterministic, so the finding is "confirmed". */
export const pasteBlocked: BookingVariant = {
  script: `
    document.getElementById('confirmPassword').addEventListener('paste', (event) => event.preventDefault());
  `,
};

/** BAD (advisory): paste works, but the password fields have no autocomplete tokens. */
export const autocompleteMissing: BookingVariant = {
  replace: [
    ['<input id="password" name="password" type="password" autocomplete="new-password">', '<input id="password" name="password" type="password">'],
    ['<input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password">', '<input id="confirmPassword" name="confirmPassword" type="password">'],
  ],
};
