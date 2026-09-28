import type { CheckPage } from "./types";

/**
 * /checks/paywall-trust/. Sources: app/src/checks/paywall-trust.ts (where it finds the plan, which pages it opens and
 * what it blocks, the verdict, the put-back through the app's own control), docs/v2-spec.md "`paywall-trust`", the
 * Fernway 0.6.0 run's featured finding (content/runs/fernway-0.6.0.json) and TESTING.md "Known limitations".
 */
export const page = {
  id: "paywall-trust",
  description:
    "How the paywall-trust check opens an app's success pages without paying to see if the plan changes, with a real finding, its test and the fix.",
  lede: "A paid plan should follow a confirmed payment. AI-built checkout flows may upgrade the account when the success page loads, instead of waiting for the payment provider's confirmation. Anyone who opens that address then gets the plan free.",
  severity: "critical",
  steps: [
    {
      label: "Reading Account A's plan as Account A (GET /api/users/alex-rivera/profile)",
      line: "Run Hound reads Account A's plan from the app's own answer: free, before anything is opened.",
    },
    {
      label: "Looking for success and upgrade pages among the page's links",
      line: "Success, upgraded and thank-you pages come from the page's links, then from its billing and settings pages.",
    },
    {
      label: "Opening /app/upgraded as Account A",
      line: "The upgraded page opens as Account A with every payment provider blocked, and runs as for any visitor.",
    },
    {
      label: "Reading Account A's plan again after opening /app/upgraded",
      line: "The plan now reads pro, with nothing paid: a critical finding, and no further page is opened.",
    },
    {
      label: 'Clicking the app\'s own "Cancel plan" on /app/settings to put Account A\'s plan back',
      line: "The finding stands. Run Hound then clicks the app's own Cancel plan and checks that Account A reads free again.",
    },
  ],
  notCounted:
    "Text on the page alone, such as a thank-you message. It goes in the notes; the plan must change on the server.",
  evidence: [
    {
      label: "/app/upgraded opened as Account A",
      caption: "The upgraded page says Pro is active, though nothing was paid.",
      alt: "Fernway's upgraded page opened as Account A, headed Your upgrade, with a card saying Pro is active.",
    },
    {
      label: "Account A's plan before and after",
      caption: "Account A's plan as the server answered, before and after the page opened.",
    },
  ],
  reproduce:
    "The exported test signs in as Account A with payment providers blocked and opens /app/upgraded. It fails when the plan then reads differently.",
  background: [
    {
      label: "CWE-602: Client-Side Enforcement of Server-Side Security",
      href: "https://cwe.mitre.org/data/definitions/602.html",
      why: "The weakness: the server grants the plan because a page loaded, not because it confirmed a payment.",
    },
    {
      label: "CWE-841: Improper Enforcement of Behavioral Workflow",
      href: "https://cwe.mitre.org/data/definitions/841.html",
      why: "Skipping a step that must come first, here the payment, and still getting what follows it.",
    },
  ],
  limits: [
    "Only success pages that grant a plan when opened are tested. A checkout replayed with a changed price or plan isn't yet.",
    "It reads the plan only from an answer that names Account A by username or email. A bare plan field isn't recognised.",
    "Up to 10 of the app's own success pages are opened. Every page load that leaves the app is stopped.",
    "Unticked by default: a plan it changed is put back with the app's own cancel or downgrade control.",
  ],
  related: ["client-only-validation", "deep-links"],
} as const satisfies CheckPage;
