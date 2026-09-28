import type { CheckPage } from "./types";

/**
 * /checks/keyboard-completion/. Sources: app/src/checks/keyboard-completion.ts (the keys it uses, which fields must be
 * set, when the submit counts as accepted, when it skips), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json: the steps, the evidence, the test) and TESTING.md "Known limitations" (multi-step
 * forms, file inputs and widgets it may not recognise).
 */
export const page = {
  id: "keyboard-completion",
  description:
    "How the keyboard-completion check fills and sends a form with Tab, arrows, Space and Enter alone, with a real finding, its Playwright test and the fix.",
  lede: "Someone who can't use a mouse fills in a form with Tab, arrow keys, Space and Enter. AI builders often draw choices as clickable cards or custom pickers that Tab skips. The form then can't be finished from the keyboard.",
  severity: "high",
  steps: [
    {
      label: "Pressing Tab through the form and filling each field from the keyboard",
      line: "Only Tab, arrow keys, Space, Enter and typing are used from here; the mouse is never touched.",
    },
    {
      label: "Recording the Tab sequence",
      line: "Each stop is recorded with what has focus, so a field that Tab jumps over shows up in the order.",
    },
    {
      label: "Tab 2: button (no name)",
      line: "After the name field, Tab stops on a button with no name. The next Tab jumps past the pet type cards.",
    },
    {
      label: "Tab 3: Start date (typed a value)",
      line: "Focus lands on the start date, and the pet type choice before it was never focused.",
    },
    {
      label: "Tab 10: Book",
      line: "The submit button is reached, but a choice the form needs was never set, so the form isn't sent.",
    },
  ],
  notCounted:
    "A field that nothing marks as required is filled when Tab reaches it, but never reported on its own. Such a field left out of the Tab order could be a spam trap, hidden on purpose.",
  evidence: [
    {
      label: "Tab sequence through the form",
      caption: "Tab visits 14 stops and never lands on the pet type cards.",
      alt: "Kennel's booking form filled in from the keyboard one Tab stop at a time. At the end the Dog, Cat and Other cards are outlined in red and labelled Never reached by Tab.",
    },
    {
      label: "Keyboard walk through the form (14 stops)",
      caption: "The walk's result: a field Tab can't reach, after 14 stops.",
    },
  ],
  reproduce:
    "The exported test opens the page and presses Tab up to 200 times. It waits for focus to reach the first pet type option, and fails while Tab never gets there.",
  background: [
    {
      label: "WCAG: Understanding Keyboard",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
      why: "The criterion this check tests: everything a page does must work from a keyboard alone.",
    },
    {
      label: "WAI-ARIA Authoring Practices: the radio group pattern",
      href: "https://www.w3.org/WAI/ARIA/apg/patterns/radio/",
      why: "The keys a custom choice of cards must answer: Tab into the group, arrow keys between options, Space to pick.",
    },
  ],
  limits: [
    "File inputs are left empty. Custom date pickers, rich-text editors and widgets from less common libraries may not be recognised.",
    "On a multi-step form, Enter on the first step shows the next one without saving. The check stops there and says why.",
    "When the keyboard typed nothing and the submit was refused, there is nothing to judge. The scenario is skipped with the reason.",
    "A sign-in form gets made-up credentials; its refusal still proves the keyboard sent the form.",
  ],
  related: ["focus-visible", "error-announcement"],
} as const satisfies CheckPage;
