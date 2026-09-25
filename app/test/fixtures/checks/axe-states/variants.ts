/**
 * axe-states fixtures. GOOD is the clean baseline (no WCAG 2.x A/AA or 2.2 AA violations in the
 * initial, invalid-submit, server-error or success states). Each BAD variant violates exactly one axe rule.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

export const bad = {
  /** A01: phone input labelled only by its placeholder. */
  missingLabel: {
    rule: "label",
    bug: "A01",
    variant: { replace: [['<label class="block" for="phone">Phone (optional)</label>', ""]] },
  },
  /** A02: icon-only clear button with no accessible name. */
  namelessIconButton: {
    rule: "button-name",
    bug: "A02",
    variant: { replace: [[' aria-label="Clear pet name"', ""]] },
  },
  /** A06: helper text contrast too low (#aaaaaa on white is about 2.3:1). */
  lowContrastHelper: {
    rule: "color-contrast",
    bug: "A06",
    variant: { css: ".hint { color: #aaaaaa; }" },
  },
  /** A08: remove icon buttons are 16x16 px and packed together (WCAG 2.2 target size). */
  smallTargets: {
    rule: "target-size",
    bug: "A08",
    variant: {
      css: [
        ".bookings li { margin: 0; gap: 2px; line-height: 16px; font-size: 12px; }",
        // order: -1 puts every button at the start of its row, so they stack in one column 16 px apart. After the
        // (differently wide) names they sat just over 24 px apart diagonally, which axe rightly passes.
        ".remove { order: -1; width: 16px; height: 16px; min-width: 0; min-height: 0; padding: 0; font-size: 10px; line-height: 1; border-width: 0; }",
      ].join("\n"),
    },
  },
} satisfies Record<string, { rule: string; bug: string; variant: BookingVariant }>;

/**
 * Violation that only exists after an invalid submit: the inline error messages are hidden on load
 * and rendered in low-contrast pink (#f4a0a0 on white) when validation fails.
 */
export const invalidStateOnly = {
  rule: "color-contrast",
  bug: "A06",
  variant: { css: ".error { color: #f4a0a0; }" } satisfies BookingVariant,
};

/** All four single-rule defects at once. */
export const allRules: BookingVariant = {
  replace: [...bad.missingLabel.variant.replace, ...bad.namelessIconButton.variant.replace] as [string, string][],
  css: [bad.lowContrastHelper.variant.css, bad.smallTargets.variant.css].join("\n"),
};
