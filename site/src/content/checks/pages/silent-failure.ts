import type { CheckPage } from "./types";

/**
 * /checks/silent-failure/. Sources: app/src/checks/silent-failure.ts (the intercepted 500, the 5 s wait, what counts
 * as announced, the kept values, the page-post and wizard skips), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json: the steps, the recording, the test).
 */
export const page = {
  id: "silent-failure",
  description:
    "How the silent failure check makes a save fail on purpose and looks for an announced error, with a real Kennel finding, its Playwright test and the fix.",
  lede: "When a save fails, the page should say so and keep what was typed. AI builders often write only the path where the save works. A failed save then leaves a spinner or nothing, and people think it went through.",
  severity: "high",
  steps: [
    {
      label: "Filling the form with valid test values",
      line: "Every field gets a value the form accepts, so the server is the only thing that goes wrong.",
    },
    {
      label: "Submitted; the save request was answered with 500",
      line: "Run Hound answers the save request itself with a 500, so nothing reaches your server and nothing is stored.",
    },
    {
      label: "Waiting up to 5 s for an error message",
      line: "A visible message has to appear and be announced, by an alert, a live region or focus moving to it.",
    },
    {
      label: "Checking the typed values are still there",
      line: "The fields should still hold what was typed, so a person can try again without starting over.",
    },
    {
      label: "5.0 s after the failed save",
      line: "Five seconds on, the page showed no message at all, only a spinner on the button, so the check fails.",
    },
  ],
  notCounted:
    "A form sent as a regular page post is skipped: a server's page after an error can't be judged. A first wizard step that only shows the next step isn't treated as a refusal either.",
  evidence: [
    {
      label: "submit while the server fails",
      caption: "The save fails with a 500, and no message appears within 5 seconds.",
      alt: "Kennel's booking form sent while the save fails: 5 seconds later the Book button still spins and no error shows.",
    },
  ],
  reproduce:
    'The exported test makes the save answer 500 before filling the form with the run\'s values, then clicks "Book". It passes only when an alert mentioning an error, a failure or "try again" is visible within 5 seconds.',
  background: [
    {
      label: "MDN: ARIA alert role",
      href: "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role",
      why: 'Text inside an element with role "alert" is read out by screen readers as soon as it appears.',
    },
    {
      label: "WCAG 2.2: Understanding Status Messages",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html",
      why: "A message such as a failed save must reach screen reader users without taking their focus away.",
    },
  ],
  limits: [
    "The failure is always a 500 answer; a timeout or a dropped connection isn't simulated.",
    "A message that takes longer than 5 seconds to appear counts as no message.",
    'The exported test looks only for role "alert"; the check also accepts a live region or focus on the message.',
  ],
  related: ["error-announcement", "console-network-errors", "double-submit"],
} as const satisfies CheckPage;
