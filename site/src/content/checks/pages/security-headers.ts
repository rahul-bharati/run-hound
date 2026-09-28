import type { CheckPage } from "./types";

/**
 * /checks/security-headers/. Sources: app/src/checks/security-headers.ts (the headers it reads, how it judges a
 * policy, HSTS only on https, advisory on a dev server), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (dev servers).
 */
export const page = {
  id: "security-headers",
  description:
    "How Run Hound reads a page's response headers for a script policy, clickjacking protection and nosniff, with a real finding, its test and the fix.",
  lede: "Browsers can block injected scripts, hostile framing and file-type guessing, but only when the server asks them to. AI builders usually write the app, not its response headers, so these protections often stay off until someone adds them.",
  severity: "medium",
  steps: [
    {
      label: "Reading the headers of the page's response",
      line: "Run Hound loads the page once and reads the headers of its response. It sends nothing else.",
    },
  ],
  notCounted:
    "Strict-Transport-Security on plain http, such as localhost: browsers ignore it there, so it is only required on https.",
  evidence: [
    {
      label: "security headers of the page",
      caption: "Every header the page sent, then the three it was missing.",
    },
  ],
  reproduce:
    "The exported test reloads the page and checks each missing protection in turn: a policy, frame protection and nosniff. It passes once all three are sent.",
  background: [
    {
      label: "MDN: Content-Security-Policy",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy",
      why: "What each directive in the suggested policy allows, frame-ancestors included.",
    },
    {
      label: "OWASP: HTTP Headers Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
      why: "Recommended values for each header this check reads, with the attack each one stops.",
    },
  ],
  limits: [
    "Only the page's own document is read. Headers on its scripts, its API or its other pages aren't checked.",
    "A policy is judged on how it limits scripts and framing. Its other directives, such as where the page may connect, aren't.",
    "On a dev server the finding is advisory, since dev servers seldom send production headers: test a production build.",
  ],
  related: ["cors", "source-maps", "cookie-flags"],
} as const satisfies CheckPage;
