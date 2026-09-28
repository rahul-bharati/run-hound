import type { CheckPage } from "./types";

/**
 * /checks/focus-visible/. Sources: app/src/checks/focus-visible.ts (what counts as a visible indicator, the pixel
 * comparison, the dev-tool overlays it skips, how far it tabs, how many frames it records), the Kennel 0.6.0 run's
 * featured finding (content/runs/kennel-0.6.0.json: the steps, the evidence, the test).
 */
export const page = {
  id: "focus-visible",
  description:
    "How the focus-visible check tabs through a page and finds controls that show no focus, with a real finding, its Playwright test and the fix.",
  lede: "Keyboard users follow a focus ring to know which control they are on. AI-built styles often remove the browser's outline and put nothing in its place. Focus then vanishes as people press Tab.",
  severity: "high",
  steps: [
    {
      label: "Pressing Tab through every control",
      line: "Tab walks the whole page, not only the form, until focus wraps back to where it started.",
    },
    {
      label: "Tab 1: Pet name",
      line: "The focused field's outline, shadow, border, background and underline are compared with its resting style.",
    },
    {
      label: "Tab 4: End date",
      line: "The end date shows its focus, so it passes; it appears only as context before the next failure.",
    },
    {
      label: "Tab 5: Owner email",
      line: "No style changes, and a screenshot comparison finds no changed pixels around the field either, so this stop fails.",
    },
    {
      label: "Tab 9: Confirm password",
      line: "The sixth control with no visible focus; the finding lists all six in Tab order.",
    },
  ],
  notCounted:
    "Dev-server overlays and toolbars, such as Next.js or Vite's, are skipped because they aren't part of the app. A text caret in a field never counts as a focus indicator.",
  evidence: [
    {
      label: "Tab sequence through the page",
      caption: "Tab by Tab, six controls take focus with nothing on screen to show it.",
      alt: "Kennel's booking form stepped through with the Tab key. One field after another is outlined in red and labelled No visible focus, ending on Confirm password.",
    },
  ],
  reproduce:
    "For each of the six controls, the exported test reloads the page and presses Tab until that control has focus. It then expects an outline, or a style that differs from the control at rest.",
  background: [
    {
      label: "WCAG: Understanding Focus Visible",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html",
      why: "The criterion this check tests: a page used from the keyboard always shows which control has focus.",
    },
    {
      label: "MDN: the :focus-visible pseudo-class",
      href: "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:focus-visible",
      why: "The selector for a focus style that keyboard users see, without a ring on every mouse click.",
    },
  ],
  limits: [
    "The walk stops when focus wraps back to the start, or after 300 presses of Tab.",
    "Any change to the border, background, shadow or underline counts as an indicator, however faint, so a weak one passes.",
    "At most 6 failing controls get a frame of their own; the finding still names all of them.",
  ],
  related: ["keyboard-completion", "reflow-320"],
} as const satisfies CheckPage;
