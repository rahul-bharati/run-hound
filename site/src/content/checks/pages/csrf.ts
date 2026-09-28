import type { CheckPage } from "./types";

/**
 * /checks/csrf/. Sources: app/src/checks/csrf.ts (the other site, which requests it forges and how, the verdict from a
 * re-read, the put-back), docs/v2-spec.md "`csrf`", the Fernway 0.6.0 run's featured finding
 * (content/runs/fernway-0.6.0.json) and TESTING.md "Known limitations" (exported specs).
 */
export const page = {
  id: "csrf",
  description:
    "How the CSRF check sends a form's save from a page on another site in a signed-in browser, with a real finding, its Playwright test and the fix.",
  lede: "A page on another site shouldn't be able to save data as your signed-in user. An AI builder may set the session cookie to SameSite=None to fix a sign-in error, with no CSRF token. Then any site can submit changes for them.",
  severity: "high",
  steps: [
    {
      label: "Saving a test record as Account A",
      line: "Run Hound saves a test record through the form as Account A and notes the save request.",
    },
    {
      label: "Reloading to read the saved record",
      line: "A reload reads the record back as Account A: the value the verdict is judged against.",
    },
    {
      label: "Opening a page on another site",
      line: "A blank page on 127.0.0.1 opens in Account A's browser, a different site from localhost.",
    },
    {
      label: "Sending the forged save from another site (form-encoded)",
      line: "It submits the save with a new title and no token; Account A reading that title back fails the check.",
    },
  ],
  notCounted:
    "The forged request's own answer. Only a new value that Account A reads back afterwards counts, never a status code.",
  evidence: [
    {
      label: "The forged cross-site request",
      caption: "How the forged save was sent, and the cookie the browser attached.",
    },
  ],
  reproduce:
    "The exported test serves a page on 127.0.0.1 and posts the form-encoded save from it in Account A's browser. It fails if Account A then reads the forged title back.",
  background: [
    {
      label: "OWASP: Cross-Site Request Forgery Prevention Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html",
      why: "Tokens, SameSite cookies and Origin checks: the defences the suggested fix combines.",
    },
    {
      label: "CWE-352: Cross-Site Request Forgery (CSRF)",
      href: "https://cwe.mitre.org/data/definitions/352.html",
      why: "The weakness named in the finding, and why a signed-in browser makes the forged request work.",
    },
  ],
  limits: [
    "Inconclusive, never a pass, when no second site can be set up or the record can't be read back.",
    "It forges only this form's save for its own test record, and never touches a record Account A already had.",
    "Unticked by default: it changes Account A's test record, then puts it back through an update the app itself sent.",
  ],
  related: ["cors", "write-access"],
} as const satisfies CheckPage;
