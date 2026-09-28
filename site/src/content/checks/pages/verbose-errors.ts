import type { CheckPage } from "./types";

/**
 * /checks/verbose-errors/. Sources: app/src/checks/verbose-errors.ts (the oversized values, the malformed replay and
 * where it may go, the leak patterns, what passes), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (test records).
 */
export const page = {
  id: "verbose-errors",
  description:
    "How the verbose-errors check makes a server show its stack trace or file paths, with a real finding, the Playwright test and the fix to ask for.",
  lede: "When a save fails, a visitor should get a plain message, not the server's internals. AI-generated API handlers can pass a caught error straight back to the browser, stack trace included. Anyone sending bad input then reads your file paths.",
  severity: "medium",
  steps: [
    {
      label: "Filling free-text fields with far too much text",
      line: "Free-text fields get thousands of characters, far more than any real answer; every other field stays valid.",
    },
    {
      label: "Submitting the oversized input",
      line: "The form is sent the way a person would send it, and every answer from the server is kept.",
    },
    {
      label: "Replaying POST /api/bookings with a malformed body",
      line: "Run Hound resends the form's own save with JSON that stops halfway, only to an address it may test.",
    },
    {
      label: "Scanning the responses and the page for stack traces and file paths",
      line: "A stack trace, an internal file path or a framework's error dump in any answer or on the page fails.",
    },
  ],
  notCounted:
    "A plain error message, even with status 500. A failed save that the page doesn't show is left to other checks.",
  evidence: [
    {
      label: "error response with internals",
      caption: "The server's 500 answer, with a stack trace naming its own files.",
    },
  ],
  reproduce:
    "The exported test submits the form with the same oversized values. It fails when any answer to a save holds a stack trace or a Node internal. The malformed replay stays in Run Hound.",
  background: [
    {
      label: "OWASP: Error Handling Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html",
      why: "How to keep the details in the server's logs and send the browser a generic message.",
    },
    {
      label: "CWE-209: Generation of Error Message Containing Sensitive Information",
      href: "https://cwe.mitre.org/data/definitions/209.html",
      why: "The weakness this check looks for, and what an attacker learns from an error that says too much.",
    },
  ],
  limits: [
    "Only the form's own save is replayed, to the app's address or one the safety settings allow. Other endpoints aren't probed.",
    "It recognises stack traces and error dumps from Node, Python, Java, .NET, PHP and SQL databases. An error page in another shape passes.",
    "If the server accepts the oversized values, up to two test records are created, and Run Hound doesn't delete them.",
  ],
  related: ["source-maps", "client-only-validation", "console-network-errors"],
} as const satisfies CheckPage;
