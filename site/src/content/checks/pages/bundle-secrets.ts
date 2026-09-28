import type { CheckPage } from "./types";

/**
 * /checks/bundle-secrets/. Sources: app/src/checks/bundle-secrets.ts (which scripts it reads, how it redacts, what the
 * exported test matches), app/src/engine/redact.ts (the key shapes, the publishable keys it leaves alone), the Kennel
 * 0.6.0 run's featured finding (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (one page per run).
 */
export const page = {
  id: "bundle-secrets",
  description:
    "How Run Hound finds secret keys in the JavaScript a page ships to every visitor, with a real finding, the Playwright test and the fix to ask for.",
  lede: "A secret key in the page's JavaScript is readable by every visitor. An AI builder wiring an AI or database API into the page may paste its key into the frontend code. Anyone can then copy it and use it.",
  severity: "critical",
  steps: [
    {
      label: "Downloading every script the page loads",
      line: "Run Hound opens the page and downloads each of its own scripts again in full, plus its inline scripts.",
    },
    {
      label: "Searching 4 scripts and the HTML for secret keys",
      line: "It looks for the shapes of secret keys: AI providers, Stripe, AWS, GitHub, Slack, private keys and Supabase service_role.",
    },
    {
      label: "Found openai-key in http://localhost:3160/config/ai-client.js",
      line: "An AI provider secret key sits on line 6 of a script every visitor downloads.",
    },
    {
      label: "Found supabase-service-role in http://localhost:3160/config/supabase-client.js",
      line: "A Supabase service_role key in a second script is its own finding. Any secret key fails the check.",
    },
  ],
  notCounted:
    "Publishable keys, such as a Stripe pk_ key, a Supabase anon key or a Firebase apiKey. They are meant to be public.",
  evidence: [
    {
      label: "openai-key in the page's JavaScript",
      caption: "The script and the line holding the key, its value redacted.",
    },
  ],
  reproduce:
    "The exported test opens the page, downloads the same script and fails while its text still matches the key's pattern. The test holds the pattern, never the key.",
  background: [
    {
      label: "OWASP: Secrets Management Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
      why: "Where secret keys belong instead of frontend code, and how to rotate one that has leaked.",
    },
    {
      label: "CWE-798: Use of Hard-coded Credentials",
      href: "https://cwe.mitre.org/data/definitions/798.html",
      why: "The weakness this is: a credential written into code that people outside the company can read.",
    },
  ],
  limits: [
    "Only scripts the page loads as it opens are searched. A key in a chunk that loads later, after a click or on another page, isn't seen.",
    "Keys are recognised by their shape. A secret without a known prefix, such as a plain password in a config object, isn't.",
    "A script from another site isn't downloaded again. Only the copy the browser captured is searched, and it may be cut short.",
  ],
  related: ["source-maps", "pii-leak"],
} as const satisfies CheckPage;
