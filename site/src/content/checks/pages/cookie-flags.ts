import type { CheckPage } from "./types";

/**
 * /checks/cookie-flags/. Sources: app/src/checks/cookie-flags.ts (which cookies count as a session, the flags it
 * requires, CSRF tokens left out, advisory on a dev server), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (dev servers).
 */
export const page = {
  id: "cookie-flags",
  description:
    "How the cookie-flags check spots a session cookie that scripts can read or other sites can send, with a real finding, its test and the fix.",
  lede: "A session cookie should stay out of reach of the page's scripts. When an AI builder writes its own sign-in, it may set the cookie without HttpOnly. One injected script could then read the session and sign in as that visitor.",
  severity: "high",
  steps: [
    {
      label: "Reading the cookies the page set",
      line: "Run Hound loads the page and reads each cookie's flags as the browser stored them, never its value.",
    },
  ],
  notCounted:
    "Cookies whose names don't look like a session or sign-in token, and CSRF tokens, which the page must read.",
  evidence: [
    {
      label: "session cookies without protection",
      caption: "The session cookie as the browser stored it, without HttpOnly.",
    },
  ],
  reproduce:
    "The exported test loads the page, reads the browser's cookies and fails while kennel_session isn't HttpOnly.",
  background: [
    {
      label: "MDN: Set-Cookie",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie",
      why: "What HttpOnly, Secure and SameSite each do, and the values SameSite takes.",
    },
    {
      label: "OWASP: Session Management Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
      why: "How a session cookie should be set, and why page scripts should never read it.",
    },
  ],
  limits: [
    "A session is recognised by its cookie's name, such as sess, sid, auth, token or jwt. One with an unusual name is missed.",
    "A session kept in localStorage or sessionStorage isn't a cookie, so this check doesn't see it.",
    "Secure is required only on https, and on a dev server the finding is advisory: test a production build.",
  ],
  related: ["csrf", "security-headers", "cors"],
} as const satisfies CheckPage;
