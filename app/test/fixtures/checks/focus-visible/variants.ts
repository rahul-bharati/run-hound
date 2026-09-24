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

/**
 * BAD for the text inputs, GOOD for the date field: every outline is removed, but a native date field still shows
 * focus by highlighting its first segment, so only the text inputs may be reported.
 */
export const dateSegmentOnly: BookingVariant = {
  css: "input:focus, input:focus-visible { outline: none; box-shadow: none; }",
  replace: [
    [
      '<input id="ownerEmail" name="ownerEmail" type="email" required autocomplete="email">',
      '<input id="ownerEmail" name="ownerEmail" type="email" required autocomplete="email"><label for="startDate">Start date</label><input id="startDate" name="startDate" type="date">',
    ],
  ],
};

/**
 * GOOD: a Next.js dev-tools host (<nextjs-portal>, a shadow root with a button that has no focus style) is injected
 * into the page, as `next dev` does. It is not part of the app and must not be reported.
 */
export const devToolsOverlay: BookingVariant = {
  script: `customElements.define("nextjs-portal", class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = '<style>button { outline: none; border: 0; background: #111; color: #fff; }</style><button>Issues</button>';
  }
});
document.body.append(document.createElement("nextjs-portal"));`,
};
