import type { CheckPage } from "./types";

/**
 * /checks/reflow-320/. Sources: app/src/checks/reflow-320.ts (the 320 by 800 viewport, the one-pixel allowance, the
 * widest element it marks, how Run Hound's own test values are told apart), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json: the steps, the evidence, the test).
 */
export const page = {
  id: "reflow-320",
  description:
    "How the reflow-320 check opens a page 320 px wide and finds what makes it scroll sideways, with a real finding, its Playwright test and the fix.",
  lede: "At 400% zoom, or on a small phone, a page has 320 CSS pixels of width. AI builders often give forms and cards fixed widths that suit a laptop. The page then scrolls sideways and fields slide off screen.",
  severity: "medium",
  steps: [
    {
      label: "Measuring the page width at 320 px",
      line: "The page opens 320 pixels wide and 800 tall, and its scroll width is compared with the screen's.",
    },
    {
      label: "Capturing the whole page at 320 px",
      line: "Wider than the screen fails, and the widest element that sticks out is marked as the place to start.",
    },
  ],
  notCounted:
    "One pixel of overflow is allowed for rounding. A long word from Run Hound's own test values, such as a test email, is reported apart as low-severity advice.",
  evidence: [
    {
      label: "Page at 320 px wide",
      caption: "The form is 576 px wide on a 320 px screen.",
      alt: "Kennel's booking page captured 320 pixels wide. The booking form runs past the right edge of the screen, outlined in red and labelled 576 px wide.",
    },
    {
      label: "Measured page width at 320x800",
      caption: "The page's scroll width against the width of the screen.",
    },
  ],
  reproduce:
    "The exported test resizes the window to 320 by 800 and reads the page's scroll width. It fails while the page is wider than the screen by more than a pixel.",
  background: [
    {
      label: "WCAG: Understanding Reflow",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html",
      why: "The criterion this check tests: content fits a narrow viewport without scrolling in two directions.",
    },
    {
      label: "MDN: Responsive design",
      href: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design",
      why: "Fluid layouts, max-width and media queries: the usual ways to replace a fixed width.",
    },
  ],
  limits: [
    "Only a 320 by 800 screen is tested, so a layout that breaks at other widths isn't caught.",
    "A wide table or code block inside its own scrolling box doesn't widen the page, so it isn't reported.",
    "The page is measured as it loads; a menu or dialog opened later isn't.",
  ],
  related: ["axe-states", "focus-visible"],
} as const satisfies CheckPage;
