import type { CheckPage } from "./types";

/**
 * /checks/mass-assignment/. Sources: app/src/checks/mass-assignment.ts (the fields it adds, critical or high, when it
 * skips, how it puts fields back), docs/v2-spec.md "mass-assignment", the Fernway 0.6.0 run's featured finding
 * (content/runs/fernway-0.6.0.json) and TESTING.md "Known limitations" (the exported spec has no sign-in).
 */
export const page = {
  id: "mass-assignment",
  description:
    "How the mass-assignment check adds role, admin and plan fields to a form's own save to see what the server stores, with a real finding and the fix.",
  lede: "A form's save should change only the fields the form shows. AI-generated handlers can pass the whole request body to the database. A user who adds role or plan to the request then gets whatever they typed.",
  severity: "critical",
  steps: [
    {
      label: "Saving the form as Account A",
      line: "The profile form is saved as Account A, and Run Hound keeps the JSON body it sent.",
    },
    {
      label: "Reloading to read the saved record",
      line: "A reload reads the record back, so each field's value before the replay is known.",
    },
    {
      label: "Replaying the save with privilege fields added",
      line: "The same save goes again with nine privilege fields added to its body, such as role, isAdmin, plan and credits.",
    },
    {
      label: "Restoring the fields Run Hound changed",
      line: "Stored admin fields make it critical. Run Hound then sets each changed field back and names any it can't.",
    },
  ],
  notCounted:
    "A field the server ignores or drops. Only a value that reads back from the record after the replay counts.",
  evidence: [
    {
      label: "The form's own save",
      caption: "The three fields the profile form sends by itself.",
    },
    {
      label: "Replayed with privilege fields added",
      caption: "The same save with admin, plan and verification fields added.",
    },
    {
      label: "Fields the server stored",
      caption: "The record after the replay: eight of the added fields were stored.",
    },
  ],
  reproduce:
    "The exported test sends the form's save with role, isAdmin and plan added. It fails when the answer names an admin field. Add your signed-in session first.",
  background: [
    {
      label: "OWASP: Mass Assignment Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html",
      why: "Allow lists and separate input types: ways to accept only the fields a form means to send.",
    },
    {
      label: "CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes",
      href: "https://cwe.mitre.org/data/definitions/915.html",
      why: "The weakness behind it: the client decides which of a record's attributes the server changes.",
    },
  ],
  limits: [
    "Only a form that saves JSON is tested. A form-encoded save is skipped, since extra fields can't be added to it.",
    "Unticked by default: it changes Account A's record, then puts back what it changed and names anything it couldn't.",
    "The exported test has no sign-in. Add your signed-in storage state and the form's real values before running it.",
  ],
  related: ["client-only-validation", "paywall-trust"],
} as const satisfies CheckPage;
