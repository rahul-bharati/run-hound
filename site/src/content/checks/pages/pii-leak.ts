import type { CheckPage } from "./types";

/**
 * /checks/pii-leak/. Sources: app/src/checks/pii-leak.ts (the test values, the encodings and hashes it looks for, what
 * counts as a third party, when it is planned), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (the account's own email, test records).
 */
export const page = {
  id: "pii-leak",
  description:
    "How the pii-leak check catches a form that sends a customer's email or phone number to another site, with a real finding, its test and the fix.",
  lede: "A customer's email address should stay between them and your app. AI builders add analytics or ad tags on request, and a tag can copy form fields into its own requests. The email then reaches another company.",
  severity: "high",
  steps: [
    {
      label: "Filling the form with a test email and phone number",
      line: "Each run makes up its own email address and phone number, so any copy of them can be recognised.",
    },
    {
      label: "Capturing the form at submit",
      line: "Run Hound takes a picture of the form with the test values in place, just before it is sent.",
    },
    {
      label: "Submitting and watching requests to other sites",
      line: "Every request to a site other than the app's own is kept, with its address and its body.",
    },
    {
      label: "Found the test email address in a request to localhost:3161",
      line: "The email address sits in plain text in a request to another site, so the check fails.",
    },
  ],
  notCounted:
    "Requests to the app's own backend, wherever it is hosted. The app saving the form's record is not a third party.",
  evidence: [
    {
      label: "Form at submit with the test values",
      caption: "The form as submitted, with the test email and phone number marked.",
      alt: "Kennel's booking form at submit, with the test email address, the test phone number and the Book button marked.",
    },
    {
      label: "GET to localhost:3161 with the email address",
      caption: "The request to another site, the email address in its query string.",
    },
  ],
  reproduce:
    'The exported test fills the form with the same test values, clicks "Book" and watches every request to another site. It fails when one carries the test email.',
  background: [
    {
      label: "CWE-201: Insertion of Sensitive Information Into Sent Data",
      href: "https://cwe.mitre.org/data/definitions/201.html",
      why: "The weakness this is: data sent to another party carries personal details it should never see.",
    },
    {
      label: "CWE-359: Exposure of Private Personal Information to an Unauthorized Actor",
      href: "https://cwe.mitre.org/data/definitions/359.html",
      why: "Why an email address or phone number counts as private data that needs the person's consent to share.",
    },
  ],
  limits: [
    "Planned only for a form with an email or phone field. Other personal fields, such as a name or an address, aren't looked for.",
    "The email is looked for as plain text, base64 or a common hash. The phone is looked for as plain text or a hash. Other encodings are missed.",
    "Signed in, on a form showing the account's own email, it saves the test address over that email. Nothing puts it back.",
    "The test record it submits is real, and Run Hound doesn't delete it.",
  ],
  related: ["bundle-secrets", "security-headers"],
} as const satisfies CheckPage;
