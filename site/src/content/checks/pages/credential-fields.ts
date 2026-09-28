import type { CheckPage } from "./types";

/**
 * /checks/credential-fields/. Sources: app/src/checks/credential-fields.ts (which fields it tests, how a paste is sent
 * and when it counts as blocked, the autocomplete hint it asks for and why that finding is advisory), the Kennel 0.6.0
 * run's featured finding (content/runs/kennel-0.6.0.json: the steps, the evidence, the test).
 */
export const page = {
  id: "credential-fields",
  description:
    "How the credential-fields check pastes into password fields and reads their autofill hints, with a real finding, its Playwright test and the fix.",
  lede: "Many people paste their password from a password manager or a note instead of typing it. AI builders sometimes block paste on a confirm-password field to force retyping, which shuts those people out.",
  severity: "medium",
  steps: [
    {
      label: 'Pasting a test value into "Password"',
      line: "A 21-character test value is pasted the way a browser pastes it, and this field accepts it.",
    },
    {
      label: 'Pasting a test value into "Confirm password"',
      line: "The page cancels the same paste here, and the field stays empty.",
    },
  ],
  notCounted:
    "Nothing is submitted: the check only pastes and reads attributes. A missing autocomplete hint is reported apart, as low-severity advice, never as a confirmed failure.",
  evidence: [
    {
      label: "Paste into Confirm password",
      caption: "The same paste lands in Password and is refused in Confirm password.",
      alt: "Kennel's account fields. Password holds the pasted text as dots, outlined in green. Confirm password is empty, outlined in red and labelled Paste blocked.",
    },
  ],
  reproduce:
    "The exported test sends a cancelable paste event with the same test text to the confirm field. It passes only when the page lets the paste through.",
  background: [
    {
      label: "WCAG: Understanding Accessible Authentication (Minimum)",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html",
      why: "Signing in must not depend on remembering or retyping a password; pasting and password managers are the way round.",
    },
    {
      label: "MDN: the autocomplete attribute",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete",
      why: "The tokens, such as new-password and one-time-code, that tell a password manager what a field holds.",
    },
  ],
  limits: [
    "Only password fields, and fields whose name marks a one-time, 2FA, MFA or verification code, are tested.",
    "Only a paste the page cancels is caught. A page that lets the paste through and then clears the field isn't.",
    "It checks that an autocomplete hint exists, not that it is the right one: any value except off passes.",
  ],
  related: ["error-announcement", "focus-visible"],
} as const satisfies CheckPage;
