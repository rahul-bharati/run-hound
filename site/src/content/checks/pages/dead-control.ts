import type { CheckPage } from "./types";

/**
 * /checks/dead-control/. Sources: app/src/checks/dead-control.ts (what counts as a reaction, the 1500 ms window, the
 * destructive and sign-out rules, covered controls, the recorded replay of a dead click), the Kennel 0.6.0 run's
 * featured finding (content/runs/kennel-0.6.0.json: the steps, the recording, the test) and content/checks/data.ts
 * (a button that saves may leave a record).
 */
export const page = {
  id: "dead-control",
  description:
    "How the dead controls check clicks every button in a form and flags the ones that do nothing, with a real Kennel finding, its test and the fix.",
  lede: 'A button can look ready and still do nothing when clicked. AI builders can draw a button such as "Save draft" before the feature behind it exists, and never connect it.',
  severity: "high",
  steps: [
    {
      label: 'Clicking "unnamed button" and watching for a reaction',
      line: "Every button but submit is clicked on a freshly loaded, filled-in form; the unnamed one changed the page and passed.",
    },
    {
      label: 'Clicking "Save draft" and watching for a reaction',
      line: "Run Hound waits 1.5 seconds for a request, a page change, navigation, a storage or value change, or focus moving.",
    },
    {
      label: '"Save draft" did nothing; recording the click as evidence',
      line: "Nothing reacted, so the page is loaded and filled in again, and the same click is recorded.",
    },
    {
      label: '1.5 s after clicking "Save draft"',
      line: "After the wait, the recording shows no request and no change of any kind, so the check fails.",
    },
  ],
  notCounted:
    "The submit button, which other checks test, and destructive-looking buttons such as Delete or Sign out, unless you allow them. A button that is hidden, disabled or under a visible cookie banner is skipped, and the notes say why.",
  evidence: [
    {
      label: "clicking Save draft does nothing",
      caption: "Save draft is clicked, and 1.5 seconds later nothing on the page has changed.",
      alt: 'Kennel\'s filled-in booking form: Save draft is marked, clicked, then marked "Clicked: nothing happened", beside zero requests and changes.',
    },
  ],
  reproduce:
    'The exported test fills the form with the run\'s values and waits for the page to finish loading. It snapshots the page, its storage, address and field values, then clicks "Save draft". After 1.5 seconds it expects a change, a request or moved focus.',
  background: [
    {
      label: "MDN: The button element",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button",
      why: 'A button of type "button" has no default behaviour: it does nothing until a script handles its click.',
    },
    {
      label: "MDN: addEventListener()",
      href: "https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener",
      why: "How a click handler is attached; a button nobody attached one to looks the same as one that works.",
    },
  ],
  limits: [
    "Each button gets 1.5 seconds to react, so a handler that waits longer before doing anything is reported as dead.",
    "A button under an invisible layer, such as a leftover backdrop, can't be clicked at all and is reported too.",
    "Only buttons inside the form are clicked here; the page controls check covers the rest of the page.",
  ],
  related: ["page-controls", "silent-failure"],
} as const satisfies CheckPage;
