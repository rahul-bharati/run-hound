import type { CheckPage } from "./types";

/**
 * /checks/cors/. Sources: app/src/checks/cors.ts (the sandboxed probe and its null origin, which requests it repeats
 * and which it never does, what fails and what is advisory), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (dev servers).
 */
export const page = {
  id: "cors",
  description:
    "How the CORS check asks your API from a sandboxed frame, as any website can, to see whether other sites may read its answers with cookies.",
  lede: "Another website shouldn't be able to read your API's answers with a visitor's cookies. AI-generated servers sometimes echo any Origin back to make a CORS error go away. That lets every website read those answers.",
  severity: "high",
  steps: [
    {
      label: "Sending GET /api/__config from a sandboxed frame (Origin: null)",
      line: "Run Hound repeats one of the page's own reads from a sandboxed frame, an origin any website can produce.",
    },
    {
      label: "Sending GET /api/bookings from a sandboxed frame (Origin: null)",
      line: "The next read goes the same way, sent with credentials included, as a page on any website could send it.",
    },
    {
      label: "Sending GET /book from a sandboxed frame (Origin: null)",
      line: "The page itself sends no CORS headers, so the browser blocks it; the two readable answers fail.",
    },
  ],
  notCounted:
    "Access-Control-Allow-Origin: * without credentials, which is a public API. An echo without cookies is only an advisory note.",
  evidence: [
    {
      label: "answers that other websites may read",
      caption: "Two of the three answers trust the null origin and allow cookies.",
    },
  ],
  reproduce:
    "The exported test sends both reads with an Origin: null header. It fails while the app still answers that origin by name.",
  background: [
    {
      label: "MDN: Cross-Origin Resource Sharing (CORS)",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS",
      why: "How the browser decides whether another site may read an answer, and when cookies go along.",
    },
    {
      label: "CWE-942: Permissive Cross-domain Security Policy with Untrusted Domains",
      href: "https://cwe.mitre.org/data/definitions/942.html",
      why: "The weakness this is: an allow list that lets in an origin nobody meant to trust.",
    },
  ],
  limits: [
    "Up to 5 of the page's own GET requests are repeated. Writes and endpoints the page never calls aren't probed.",
    "A read whose path acts, such as a sign-out or an unsubscribe, is never repeated, so it isn't tested.",
    "Only the null origin is tried: a server that trusts some other foreign site, but not null, isn't caught.",
    "On a dev server the finding is advisory; test a production build.",
  ],
  related: ["csrf", "security-headers"],
} as const satisfies CheckPage;
