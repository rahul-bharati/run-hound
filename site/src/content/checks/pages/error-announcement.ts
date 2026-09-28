import type { CheckPage } from "./types";

/**
 * /checks/error-announcement/. Sources: app/src/checks/error-announcement.ts (which fields must announce an error,
 * what counts as announced, the empty submit Run Hound answers itself, when it skips), the Kennel 0.6.0 run's featured
 * finding (content/runs/kennel-0.6.0.json: the steps, the evidence, the test).
 */
export const page = {
  id: "error-announcement",
  description:
    "How the error-announcement check sends a form empty and finds errors screen readers never hear, with a real finding, its Playwright test and the fix.",
  lede: "When a form refuses an empty field, a screen reader user needs to hear which field and why. AI builders often show red text under the field without linking it or announcing it as it appears.",
  severity: "high",
  steps: [
    {
      label: "Submitting the form with every field empty",
      line: "Run Hound answers any save the empty submit sends by itself, so nothing reaches the app.",
    },
    {
      label: "Reading aria-invalid, aria-describedby and live regions",
      line: "Each field showing an error must be marked invalid, its message linked or announced in a live region.",
    },
    {
      label: 'Marking "Pet name" (error not announced)',
      line: "The name field's error is on screen, but nothing tells a screen reader it is there.",
    },
    {
      label: 'Marking "Pet type" (error not announced)',
      line: "The cards for the pet type show their message the same way: visible, unmarked and unlinked.",
    },
    {
      label: 'Marking "Owner email" (error not announced)',
      line: "Its hint is linked, but the new error message isn't, and the field is never marked invalid.",
    },
  ],
  notCounted:
    "A field that already holds a value when the page loads can't show an empty-field error, so it's left out. A browser's own validation bubble counts as announced.",
  evidence: [
    {
      label: "Error on Pet name after an empty submit",
      caption: "The error shows on screen, but nothing links it to its field.",
      alt: "Kennel's booking form after an empty submit. The Pet name field and its red message, Enter your pet's name., are outlined. The facts panel reads aria-invalid not set.",
    },
  ],
  reproduce:
    'The exported test clicks the submit button with the form empty. For each of the five fields it expects aria-invalid="true" and an aria-describedby message that has text.',
  background: [
    {
      label: "WCAG: Understanding Error Identification",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html",
      why: "An error found on input must name the field in error and describe the problem in text.",
    },
    {
      label: "MDN: the aria-invalid attribute",
      href: "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid",
      why: "How a field tells assistive technology that its value was refused, and when to set it.",
    },
    {
      label: "WCAG: Understanding Status Messages",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html",
      why: "Why a summary in a polite live region reaches screen reader users without moving their focus.",
    },
  ],
  limits: [
    "Errors only the server sends back aren't reached. When the page sends the empty form and marks no field, the check skips and says why.",
    "A submit button that stays disabled while the form is empty can't be pressed, so the check is skipped.",
    "It checks that a message is linked or announced, not whether its words explain the problem well.",
  ],
  related: ["silent-failure", "client-only-validation", "focus-visible"],
} as const satisfies CheckPage;
