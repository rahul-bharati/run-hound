import type { CheckPage } from "./types";

/**
 * /checks/source-maps/. Sources: app/src/checks/source-maps.ts (how it finds a map, which scripts it checks and how
 * many, medium or low, skipped on a dev server), the Kennel 0.6.0 run's featured finding
 * (content/runs/kennel-0.6.0.json) and TESTING.md "Known limitations" (dev servers).
 */
export const page = {
  id: "source-maps",
  description:
    "How Run Hound checks whether anyone can download a site's source maps and the original code in them, with a real finding and the fix.",
  lede: "A source map turns minified scripts back into the original code. An AI builder may switch source maps on to trace an error and leave them on. Anyone can then download the app's source, comments and hidden routes included.",
  severity: "medium",
  steps: [
    {
      label: "Looking for the source map of /assets/index-CaF1WP60.js",
      line: "Run Hound looks for a map through the SourceMap header, a sourceMappingURL comment or the script's name plus .map.",
    },
    {
      label: "Looking for the source map of /config/ai-client.js",
      line: "Each of the page's own scripts is checked the same way, downloaded from inside the page without redirects.",
    },
    {
      label: "Looking for the source map of /config/supabase-client.js",
      line: "This script's map isn't public; only the first one's is, and it holds original source code: a medium finding.",
    },
  ],
  notCounted: "Maps of scripts from other sites: those are that site's business, and Run Hound doesn't request them.",
  evidence: [
    {
      label: "public source maps",
      caption: "The public map and the first four of its source files.",
    },
  ],
  reproduce:
    "The exported test asks for the same map without following redirects and fails while the server still answers 200.",
  background: [
    {
      label: "MDN: Source map",
      href: "https://developer.mozilla.org/en-US/docs/Glossary/Source_map",
      why: "What a source map holds, and how the browser finds the one for a script.",
    },
    {
      label: "CWE-540: Inclusion of Sensitive Information in Source Code",
      href: "https://cwe.mitre.org/data/definitions/540.html",
      why: "Why readable source matters: routes, flags and comments in it become public along with the code.",
    },
  ],
  limits: [
    "At most 15 of the page's own scripts are checked, the ones it loads as it opens.",
    "Skipped on a dev server, which always serves maps: run it against a production build.",
    "A map at an address the script doesn't name is found only at the script's own name plus .map.",
  ],
  related: ["bundle-secrets", "verbose-errors", "security-headers"],
} as const satisfies CheckPage;
