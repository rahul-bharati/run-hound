/**
 * focus-visible fixtures. GOOD: every control shows a 3px outline on :focus-visible.
 * BAD (A04): text inputs drop the outline with no replacement.
 * GOOD_REPLACED: outline removed but replaced by a box-shadow ring, which counts as visible focus.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

export const outlineRemoved: BookingVariant = {
  css: "input[type=text]:focus, input[type=text]:focus-visible, input[type=email]:focus, input[type=email]:focus-visible { outline: none; box-shadow: none; }",
};

export const outlineReplacedByShadow: BookingVariant = {
  css: "input:focus, input:focus-visible { outline: none; box-shadow: 0 0 0 3px #1a4fd6; }",
};

/**
 * Text-like inputs only: Chromium ignores border and background on native radios, so a fixture that
 * styled them that way really would leave the radio group without a focus indicator.
 */
const TEXT_INPUTS = ["text", "email", "tel", "password"].flatMap((t) => [`input[type=${t}]:focus`, `input[type=${t}]:focus-visible`]).join(", ");

/** GOOD: outline removed, focus shown by a thicker, different-coloured border instead. */
export const outlineReplacedByBorder: BookingVariant = {
  css: `${TEXT_INPUTS} { outline: none; box-shadow: none; border: 3px solid #1a4fd6; }`,
};

/** GOOD: outline removed, focus shown by a background colour change instead. */
export const outlineReplacedByBackground: BookingVariant = {
  css: `${TEXT_INPUTS} { outline: none; box-shadow: none; background: #fff3b0; }`,
};

/** GOOD: the page focuses Pet name on load; its focused style must not be mistaken for its resting style. */
export const autofocus: BookingVariant = {
  script: 'document.getElementById("petName").focus();',
};
