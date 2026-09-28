import type { CheckPage } from "./types";

/**
 * /checks/double-submit/. Sources: app/src/checks/double-submit.ts (how it counts, what it ignores, when it skips),
 * the Kennel 0.6.0 run's featured finding (content/runs/kennel-0.6.0.json: the steps, the evidence, the test) and
 * TESTING.md "Known limitations" (multi-step and sign-in forms).
 */
export const page = {
  id: "double-submit",
  description:
    "How the double-submit check catches a form that saves twice on a double click, with a real finding, its Playwright test and the fix to ask for.",
  lede: "A double click on a slow save should create one record, not two. AI builders often leave the submit button active while the save is in flight. One double click then saves the same booking, order or sign-up twice.",
  severity: "high",
  steps: [
    {
      label: "Filling the form with valid test values",
      line: "Every field gets a value the form accepts, tagged with this run's token so its saves can be told apart.",
    },
    {
      label: 'Double-clicked "Book"',
      line: "Playwright double-clicks the submit button once, the way an impatient person on a slow connection would.",
    },
    {
      label: "Waiting for the save requests to finish",
      line: "Run Hound records every save request sent after the click, with its time since the double click started.",
    },
    {
      label: "After the double click: 2 save requests",
      line: "Two saves of the same form to one endpoint fail the check; one save passes.",
    },
  ],
  notCounted:
    "Other writes the page sends on submit, such as telemetry, are counted apart, so they never look like a double booking. Reads that GraphQL or RPC apps send as POST requests are left out too.",
  evidence: [
    {
      label: "double-click Book",
      caption: "The double click, then two saved copies of one booking in the list.",
      alt: "Kennel's booking form: the Book button is double-clicked, then the bookings list shows the same booking twice, marked Saved copy 1 and Saved copy 2.",
    },
    {
      label: "save requests from one double click",
      caption: "Both save requests, 29.8 and 30.0 ms after the double click started.",
    },
  ],
  reproduce:
    'The exported test fills the form with the run\'s values, double-clicks "Book" and waits 3 seconds. It passes only when exactly one save request reached the app\'s own address.',
  background: [
    {
      label: "MDN: the disabled attribute",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled",
      why: "Disabling the button while the save is pending is the simplest guard against a second click.",
    },
    {
      label: "IETF: the Idempotency-Key HTTP header",
      href: "https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/",
      why: "A guard on the server: it keeps one record per key, however many requests carry that key.",
    },
  ],
  limits: [
    "Search forms aren't tested, and sign-in forms are skipped: neither saves a record that a double click could duplicate.",
    "On a multi-step form only the first step is tested; when it saves nothing, the check is skipped and says why.",
    "The exported test counts only requests to the page's own address, while the check also counts an API elsewhere that receives the run's values.",
  ],
  related: ["silent-failure", "persistence", "client-only-validation"],
} as const satisfies CheckPage;
