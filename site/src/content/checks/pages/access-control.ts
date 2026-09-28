import type { CheckPage } from "./types";

/**
 * /checks/access-control/. Sources: app/src/checks/access-control.ts (the test record, which requests it replays and
 * as whom, what it matches and never prints), docs/v2-spec.md "access-control", the Fernway 0.6.0 run's featured
 * finding (content/runs/fernway-0.6.0.json) and TESTING.md "Known limitations" (signed-out replays, a cookie session
 * taken for a sessionStorage one, exported specs).
 */
export const page = {
  id: "access-control",
  description:
    "How the access-control check replays one account's requests as a second account and as a visitor, with a real finding, its test and the fix.",
  lede: "One account should never see another's data. AI-built apps may filter records in the page instead of on the server, or leave database rules open. Then any signed-in user can read other people's records.",
  severity: "critical",
  steps: [
    {
      label: "Saving a test record as Account A",
      line: "Run Hound saves a record through the page's form as Account A, tagged with this run's token.",
    },
    {
      label: "Opening the page as Account B",
      line: "A second test account, sharing nothing with Account A, signs in and loads the same page.",
    },
    {
      label: "Replaying GET /api/me as Account B",
      line: "Each read that returned Account A's data is sent again, now with Account B's session.",
    },
    {
      label: "Replaying GET /api/tasks as Account B",
      line: "The task list comes back to Account B holding Account A's test record, so the check fails.",
    },
  ],
  notCounted:
    "Answers without Account A's test record, username or email. A request that acts, such as a sign-out, is never sent.",
  evidence: [
    {
      label: "Account A's record on Account B's page",
      caption: "Signed in as Account B, the task list shows Account A's test record.",
      alt: "Fernway's dashboard signed in as Account B: the Today list shows a task marked as Account A's test record.",
    },
    {
      label: "GET /api/tasks returned Account A's test record",
      caption: "The task list as the server answered Account B.",
    },
  ],
  reproduce:
    "The exported test reads GET /api/tasks as both accounts and fails when Account B gets Account A's answer. Its sign-in posts to /api/login: adapt it to your app first.",
  background: [
    {
      label: "OWASP: Authorization Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html",
      why: "Deny by default, and check on the server that each record belongs to the user.",
    },
    {
      label: "CWE-862: Missing Authorization",
      href: "https://cwe.mitre.org/data/definitions/862.html",
      why: "The weakness: the server returns data without asking whether the caller may have it.",
    },
  ],
  limits: [
    "Only reads the page itself sent as Account A are replayed, so an endpoint the page never calls isn't tested.",
    "Signed-out replays send no credential header, not even a Supabase anon key, so a table open to it isn't caught.",
    "A cookie session whose cookie isn't HttpOnly and doesn't say session can be taken for a sessionStorage one. The check may then skip a real IDOR.",
  ],
  related: ["write-access", "cors"],
} as const satisfies CheckPage;
