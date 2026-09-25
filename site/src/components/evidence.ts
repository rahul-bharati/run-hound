import type { StaticImageData } from "next/image";
// Evidence straight from the report of a Run Hound 0.2.0 (V1) run on Kennel with all 24 planted bugs switched on
// (25 September 2026), copied by app/scripts/capture-site-screens.ts. Keys and email addresses are fake test values.
import doubleSubmitGif from "@/assets/evidence/double-submit-recording.gif";
import doubleSubmitStill from "@/assets/evidence/double-submit-recording-still.png";
import doubleSubmitCard from "@/assets/evidence/double-submit-two-requests.png";
import corsCard from "@/assets/evidence/cors-readable-by-any-site.png";
import emailCard from "@/assets/evidence/email-to-third-party.png";
import headersCard from "@/assets/evidence/missing-security-headers.png";
import focusFrame from "@/assets/evidence/no-visible-focus.png";
import secretCard from "@/assets/evidence/secret-key-in-bundle.png";
import silentGif from "@/assets/evidence/silent-failure-recording.gif";
import silentStill from "@/assets/evidence/silent-failure-recording-still.png";

export type EvidenceShot = { src: StaticImageData; still?: StaticImageData; alt: string };

export const evidence = {
  doubleSubmitRecording: {
    src: doubleSubmitGif,
    still: doubleSubmitStill,
    alt: "Recording from Run Hound: the Book a sitter form is filled with test values, Book is double-clicked, and two identical bookings appear in the list, marked Saved copy 1 and Saved copy 2, while the facts panel lists both save requests.",
  },
  doubleSubmitCard: {
    src: doubleSubmitCard,
    alt: "Request card: POST /api/bookings sent 2 times by one double click, at +37.6 ms and +38.0 ms, each answered 201 with a different record id. Both request bodies are shown.",
  },
  noVisibleFocus: {
    src: focusFrame,
    alt: "Annotated frame: the Pet name field has keyboard focus, boxed in red and labelled No visible focus. A facts panel lists 0 of 31552 pixels changed, and identical outline, shadow, border and background at rest and focused.",
  },
  silentFailureRecording: {
    src: silentGif,
    still: silentStill,
    alt: "Recording of the Kennel booking form after a failed save: the Book button keeps spinning and, 5.0 seconds later, no error message has appeared. The facts panel records the simulated 500 and that all 9 values were kept.",
  },
  secretKey: {
    src: secretCard,
    alt: "Script card: an AI provider secret key found in /config/ai-client.js at line 6, column 12, shown redacted.",
  },
  corsNullOrigin: {
    src: corsCard,
    alt: "Request card from the V1 cors check: GET /api/__config and GET /api/bookings, sent from a sandboxed frame with Origin null, are answered with Access-Control-Allow-Origin null and Access-Control-Allow-Credentials true, so any website could read them with the visitor's cookies. The page itself, GET /book, stays unreadable.",
  },
  missingHeaders: {
    src: headersCard,
    alt: "Header card from the V1 security-headers check: the response headers of GET /book, with the session cookie's value hidden, and three problems marked: Content-Security-Policy missing, clickjacking protection (frame-ancestors or X-Frame-Options) missing, X-Content-Type-Options missing.",
  },
  emailLeak: {
    src: emailCard,
    alt: "Request card: a GET request to a third-party origin, localhost:3161/collect, carrying the test email address as plain text in the query string.",
  },
} satisfies Record<string, EvidenceShot>;
