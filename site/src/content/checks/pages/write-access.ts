import type { CheckPage } from "./types";

/**
 * /checks/write-access/. Sources: app/src/checks/write-access.ts (which update and delete requests it replays and as
 * whom, the verdict from a re-read, the put-back), docs/v2-spec.md "`write-access`" and its 0.6.0 amendments, the
 * Fernway 0.6.0 run's featured finding (content/runs/fernway-0.6.0.json) and TESTING.md "Known limitations"
 * (write-access's replays, anti-CSRF headers, versions and GraphQL; exported specs).
 */
export const page = {
  id: "write-access",
  description:
    "How the write-access check replays an update as a second account and as a visitor to see if they can change your records, with a real finding.",
  lede: "Only a record's owner should be able to change it. AI-built APIs may look a record up by its id alone, without checking who is asking. Anyone signed in who learns an id can then edit or delete someone else's data.",
  severity: "critical",
  steps: [
    {
      label: "Saving a test record as Account A",
      line: "Run Hound saves a test record as Account A and notes the update the app then sends for it.",
    },
    {
      label: "Reloading to read the saved record",
      line: "A reload reads the record as Account A, the snapshot every later read is compared with.",
    },
    {
      label: "Sending PATCH /api/tasks/ffb60789-31bc-410f-8423-0a2247330054 as Account B",
      line: "Account B sends that same update with a new title, and Account A's next read shows it changed.",
    },
  ],
  notCounted:
    "The answer's status code alone: a 403 that still wrote counts. Fields the app updates by itself are left out of the comparison.",
  evidence: [
    {
      label: "PATCH /api/tasks/ffb60789-31bc-410f-8423-0a2247330054 as Account B",
      caption: "Account B's update was answered 200, and Account A's task title changed.",
    },
  ],
  reproduce:
    "The exported test sends the same PATCH as Account B and compares Account A's reads before and after. Set RECORD_ID and your sign-in request first.",
  background: [
    {
      label: "OWASP: Insecure Direct Object Reference Prevention Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html",
      why: "Why an id in the address is not permission, and how to scope each lookup to its user.",
    },
    {
      label: "CWE-639: Authorization Bypass Through User-Controlled Key",
      href: "https://cwe.mitre.org/data/definitions/639.html",
      why: "The weakness named in the finding: the server trusts the id the client sends.",
    },
  ],
  limits: [
    "Only updates and deletes the app itself sent for the new test record are replayed. Edit dialogs aren't opened, and a Supabase filter isn't recognised, so many apps skip.",
    "Of the update's headers, only an anti-CSRF token goes, as Account B's own. When Account B has none to read, a 400, 403, 419 or 422 is inconclusive.",
    "Each request carries the record's current version. A conflict (409, 412, 428) is inconclusive, and so is a 404 that Account A's own copy can't tell from a stale version.",
    "A form that edits a record Account A already had is skipped, its save stopped first. So is a GraphQL app that reads with POST /graphql.",
  ],
  related: ["access-control", "mass-assignment"],
} as const satisfies CheckPage;
