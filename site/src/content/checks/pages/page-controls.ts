import type { CheckPage } from "./types";

/**
 * /checks/page-controls/. Sources: app/src/checks/page-controls.ts (controls outside the forms, at most 20, the
 * destructive and sign-out rules, toggles set back) and the probe it shares with app/src/checks/dead-control.ts (the
 * 1500 ms window, already-selected controls), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json: the steps, the recording, the test) and content/checks/data.ts.
 */
export const page = {
  id: "page-controls",
  description:
    "How the page controls check clicks the buttons outside a page's forms and flags any that do nothing, with a real Kennel finding and the fix to ask for.",
  lede: 'Toolbars, list actions and toggles outside a form can look finished and do nothing. AI builders can lay out a control such as "Refresh" in a first draft and never write its code.',
  severity: "high",
  steps: [
    {
      label: 'Clicking "Refresh" and watching for a reaction',
      line: "Each control outside the forms is clicked on a freshly loaded page, with nothing typed anywhere first.",
    },
    {
      label: '"Refresh" did nothing; recording the click as evidence',
      line: "No request, page change, navigation, storage change or focus move followed within 1.5 seconds.",
    },
    {
      label: 'Before clicking "Refresh"',
      line: "The page is loaded again for the recording, and its first frame marks the control about to be clicked.",
    },
    {
      label: '1.5 s after clicking "Refresh"',
      line: "The second frame, taken after the wait, shows the bookings list exactly as it was, so the check fails.",
    },
  ],
  notCounted:
    "Controls inside a form, which the dead controls check clicks, and controls that look destructive unless you allow them. A tab or filter that is already selected is skipped, since choosing it again changes nothing.",
  evidence: [
    {
      label: "clicking Refresh does nothing",
      caption: "Refresh is clicked above the bookings list, and the list stays exactly as it was.",
      alt: "Kennel's booking page: the Refresh button above Your bookings is marked, clicked, then marked again as clicked with nothing happening.",
    },
  ],
  reproduce:
    'The exported test opens the page and waits for its loading to finish, so that isn\'t taken for a reaction. It snapshots the page, clicks "Refresh" and, 1.5 seconds later, expects the page, a request or the focus to differ.',
  background: [
    {
      label: "MDN: The a element, onclick events",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#onclick_events",
      why: 'A link with href="#" used as a button goes nowhere unless a script handles its click.',
    },
    {
      label: "MDN: Element click event",
      href: "https://developer.mozilla.org/en-US/docs/Web/API/Element/click_event",
      why: "The event a control's handler listens for; with no listener, clicking the control changes nothing.",
    },
  ],
  limits: [
    "At most 20 controls are clicked, each on a freshly loaded page.",
    "A checkbox or switch that saves when clicked, such as a task's done box, is set back afterwards.",
    "In a signed-in run, a control that signs out is never clicked, even when destructive scenarios are allowed.",
  ],
  related: ["dead-control", "console-network-errors"],
} as const satisfies CheckPage;
