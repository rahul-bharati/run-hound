import type { CheckPage } from "./types";

/**
 * /checks/axe-states/. Sources: app/src/checks/axe-states.ts (the four states, the WCAG tags it runs, the animation
 * wait and the contrast recheck, what it doesn't scan), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json: the steps, the evidence, the test) and TESTING.md "Known limitations" (the account's
 * own email on a profile form, multi-step forms).
 */
export const page = {
  id: "axe-states",
  description:
    "How the axe-states check scans a form empty, after an error and after a save with axe-core, with a real finding, its Playwright test and the fix.",
  lede: "Screen readers need a name for every button and field, and low-vision readers need text with enough contrast. AI builders often ship icon-only buttons, placeholder-only fields and faint text. A look at the empty form misses what its other states add.",
  severity: "high",
  steps: [
    {
      label: "Scanning the empty form with axe",
      line: "axe-core runs its WCAG A and AA rules on the page as it first loads.",
    },
    {
      label: 'Marking the 1 element that fail "button-name"',
      line: "Each failing element is outlined on a frame, here the icon-only button beside the name field.",
    },
    {
      label: "Scanning the form after an empty submit",
      line: "The form is sent empty, and the page is scanned again with its error messages showing.",
    },
    {
      label: "Scanning the form after a server error",
      line: "Run Hound answers the save with a server error itself, so nothing is saved, then scans that state.",
    },
    {
      label: "Scanning the page after two submissions",
      line: "Two saves with test values reach the success state, and the page gets its last scan.",
    },
    {
      label: 'Marking the 2 elements that fail "target-size"',
      line: "After the saves, target-size fails too. Each rule broken in any state becomes a finding of its own.",
    },
  ],
  notCounted:
    "A state the form never reached, such as success after a save that was never sent, isn't scanned. Text still fading in is never judged for contrast: a contrast failure must still be there a moment later.",
  evidence: [
    {
      label: "axe button-name in the initial state",
      caption: "The button without a name, marked in the form's first state.",
      alt: "Kennel's booking form with the icon-only button in the Pet name field outlined in red: button-name, no accessible name. Its facts list impact critical and WCAG 4.1.2.",
    },
    {
      label: 'axe rule "button-name" (critical), seen in: initial, invalid submit, server error, success',
      caption: "The rule, its impact and the four states it failed in.",
    },
  ],
  reproduce:
    'The exported test opens the page and waits up to 3 seconds for entrance animations to end. It then runs axe-core with only the "button-name" rule, and passes when that finds no violation.',
  background: [
    {
      label: "WCAG: Understanding Name, Role, Value",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
      why: "The criterion behind button-name: every control needs a name that assistive technology can read out.",
    },
    {
      label: "MDN: the aria-label attribute",
      href: "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label",
      why: "How to name a button that shows only an icon, when there is no visible text to name it.",
    },
  ],
  limits: [
    "It runs only the rules tagged WCAG 2.0 and 2.1 A and AA, and 2.2 AA, not axe's best-practice rules.",
    "A scan waits up to 3 seconds for animations to end. An endless one, such as a spinner, isn't waited for.",
    "Signed in, on a profile form showing the account's own email, it saves a test address over it. Nothing puts the email back.",
    "On a multi-step form only the first step is scanned. Submitting it shows the next step, not a server error or a success.",
  ],
  related: ["error-announcement", "focus-visible", "credential-fields"],
} as const satisfies CheckPage;
