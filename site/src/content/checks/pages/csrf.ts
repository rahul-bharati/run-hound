import type { CheckPage } from "./types";

/**
 * /checks/csrf/. Sources: app/src/checks/csrf.ts (the other site, which requests it forges and how, the verdict from a
 * re-read, the put-back, bearer-token sessions), docs/v2-spec.md "`csrf`", the Fernway 0.6.0 run's featured finding
 * (content/runs/fernway-0.6.0.json) and TESTING.md "The write-side checks" and "Known limitations" (the tokens it
 * recognises, the bodies it doesn't forge, the 30-second wait, GraphQL, exported specs).
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
    "The forged request's own answer. Only a new value that Account A reads back afterwards is a finding, never a status code.",
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
    "Inconclusive, never a pass, off localhost and 127.0.0.1, and when a forge gets no answer within 30 seconds and nothing was stored.",
    "On a session sent as a bearer token, not a cookie, it passes: no cookie rides along. A stored forge then means the save needs no session.",
    "Only anti-CSRF tokens it recognises are left out. A token your scripts keep in memory and send under another name is replayed, so a protected save can fail.",
    "It never forges at a record Account A already had. A JSON array, a file upload and a GraphQL app that reads with POST are skipped.",
  ],
  related: ["cors", "write-access"],
} as const satisfies CheckPage;
