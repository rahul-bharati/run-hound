import type { CheckPage } from "./types";

/**
 * /checks/client-only-validation/. Sources: app/src/checks/client-only-validation.ts (the captured request answered
 * by Run Hound, the date-range or refused-when-empty rule, 4xx passes and 2xx or 5xx fails, localhost only, the
 * page-post skip, at most one record), the Kennel 0.6.0 run's featured finding (content/runs/kennel-0.6.0.json: the
 * steps, the replayed request card, the test) and content/checks/data.ts.
 */
export const page = {
  id: "client-only-validation",
  description:
    "How the client-only validation check sends an invalid save request straight to your server, with a real Kennel finding, its Playwright test and the fix.",
  lede: "A form that refuses bad input in the browser can still save it when the request is sent directly. AI builders often put the rules only in the form's code, so the server stores whatever reaches it.",
  severity: "high",
  steps: [
    {
      label: "Filling the form and capturing its save request (answered by Run Hound)",
      line: "Run Hound fills in and sends the form, then answers the save itself, so the valid record is never stored.",
    },
    {
      label: "Sending POST /api/bookings to the server with End date (2026-10-08) set before Start date (2026-10-11)",
      line: "The captured request goes straight to the server with the end date moved before the start; it answered 201.",
    },
  ],
  notCounted:
    "A field the form leaves optional is never emptied, since the server may rightly accept it empty. A redirect in answer to the replay isn't followed; it counts as not accepted.",
  evidence: [
    {
      label: "replayed request and response",
      caption: "The replayed request, end date before start date, and the server's 201 that saved it.",
    },
  ],
  reproduce:
    "The exported test opens the page and posts the captured booking, end date before start date, straight to /api/bookings. It passes only on a refusal: a status of at least 400 and below 500.",
  background: [
    {
      label: "OWASP: Input Validation Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html",
      why: "Validation has to run on the server, because anyone can switch off or go around the checks in the browser.",
    },
    {
      label: "CWE-602: Client-Side Enforcement of Server-Side Security",
      href: "https://cwe.mitre.org/data/definitions/602.html",
      why: "The weakness this check looks for: a rule the browser enforces that the server never checks again.",
    },
  ],
  limits: [
    "It runs against localhost targets only; on any other address it is planned but skipped, and the report says why.",
    "One rule is tried per form: the end date before the start date, or else one field it refuses empty.",
    "A server error in answer to the replay fails too: the server broke instead of refusing the bad data.",
  ],
  related: ["mass-assignment", "error-announcement"],
} as const satisfies CheckPage;
