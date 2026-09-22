/**
 * reflow-320 fixtures. GOOD: fluid layout (max-width, 100% inputs) with no horizontal scroll at 320x800.
 * BAD (A09): the main container is a fixed 600px wide.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

export const fixedWidth: BookingVariant = {
  css: "main { width: 600px; max-width: none; }",
};
