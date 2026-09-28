import type { CheckPage } from "./types";

/**
 * /checks/persistence/. Sources: app/src/checks/persistence.ts (which fields are compared, where it searches, the
 * skips for pages that show no records and for sign-in forms, "saved but no longer shown", forms in dialogs), the
 * Kennel 0.6.0 run's featured finding (content/runs/kennel-0.6.0.json: the steps, the recording, the request card,
 * the test) and content/checks/data.ts (one test record).
 */
export const page = {
  id: "persistence",
  description:
    "How the persistence check saves unique values, reloads the page and looks for each one, with a real Kennel finding, its Playwright test and the fix.",
  lede: "A form can report success while one of its fields never reaches the database. AI builders often add a field to the form but not to the request or the table behind it. Whatever people type there is lost.",
  severity: "critical",
  steps: [
    {
      label: "Typing a unique test value into every field",
      line: "Each text field gets a value no other run could type, carrying this run's token.",
    },
    {
      label: "Submitting the form",
      line: "The form goes to the server once, with every test value in place.",
    },
    {
      label: "Submitted; the server saved it",
      line: "The save request was answered with success, so each value should now be stored.",
    },
    {
      label: "Reloading the page and looking for every test value",
      line: "After a reload, Run Hound searches the page text and every field's value for each one.",
    },
    {
      label: "After reload",
      line: "The saved booking came back with 3 of 4 test values; the special instructions were missing, so the check fails.",
    },
  ],
  notCounted:
    "Passwords, dates and choice fields, which are never shown again or aren't unique enough to prove anything. Toasts and status messages don't count as the saved record either, since they only echo what was typed.",
  evidence: [
    {
      label: "values after save and reload",
      caption: "Typed, saved, reloaded: the booking is back, its special instructions are not.",
      alt: "Kennel's booking page: values typed and saved, then after a reload the new booking is marked missing its special instructions.",
    },
    {
      label: "Special instructions in the save request",
      caption: "The save request already carried the note empty, and the server stored it empty.",
    },
  ],
  reproduce:
    'The exported test fills the form with the run\'s unique values, clicks "Book" and reloads the page. It passes only when the special instructions text is shown again, as page text or as a field\'s value.',
  background: [
    {
      label: "MDN: The FormData() constructor",
      href: "https://developer.mozilla.org/en-US/docs/Web/API/FormData/FormData",
      why: "Built from the form itself, FormData picks up every named field, so a field added later can't be left out.",
    },
    {
      label: "IETF: RFC 9110, 201 Created",
      href: "https://www.rfc-editor.org/rfc/rfc9110.html#name-201-created",
      why: "A 201 says a record was created; it says nothing about whether every field made it into that record.",
    },
  ],
  limits: [
    "A page that shows no saved records, such as a newsletter or contact form, is skipped, not reported as lost.",
    "A value the server's answer carried but the page no longer shows is reported as saved but not shown.",
    "A form in a dialog is opened again after the reload, since an edit dialog shows the saved record.",
  ],
  related: ["client-only-validation", "silent-failure"],
} as const satisfies CheckPage;
