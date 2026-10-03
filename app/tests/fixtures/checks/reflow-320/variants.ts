/**
 * reflow-320 fixtures. GOOD: fluid layout (max-width, 100% inputs) with no horizontal scroll at 320x800.
 * BAD (A09): the main container is a fixed 600px wide.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

export const fixedWidth: BookingVariant = {
  css: "main { width: 600px; max-width: none; }",
};

/**
 * The layout reflows, but a long unbroken test value (it contains the harness's run token "t3st"), saved by an
 * earlier scenario and listed on the page, spills past the screen edge. Advisory: caused by Run Hound's own data.
 */
export const longTestValue: BookingVariant = {
  script:
    'const p = document.createElement("p"); p.id = "saved-email"; p.style.fontSize = "24px"; p.textContent = "owner.t3stkeepxxxxxxxxxxxxxxxxxxxxxxxx@example.test"; document.querySelector("main").append(p);',
};

/** The same spill, from the page's own text (no test value): a real overflow, named by the element it comes from. */
export const longPageText: BookingVariant = {
  script:
    'const p = document.createElement("p"); p.id = "long-code"; p.style.fontSize = "24px"; p.textContent = "SUPPORT-REFERENCE-CODE-ABCDEFGHIJKLMNOPQRSTUVWXYZ"; document.querySelector("main").append(p);',
};

/**
 * A record an EARLIER Run Hound run saved (another run token, "deadbeef", than the harness's "t3st"): verbose-errors'
 * oversized value, 20,000 "x" characters after its test value, listed on the page. Still Run Hound's own data.
 */
export const earlierRunRecord: BookingVariant = {
  script: `const p = document.createElement("p"); p.id = "old-task"; p.textContent = "Task deadbeefverbose " + "x".repeat(20000); document.querySelector("main").append(p);`,
};
