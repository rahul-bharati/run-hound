export const site = {
  name: "Run Hound",
  tagline: "Your AI said it's done. Let's check.",
  description:
    "Open-source, AI-assisted UI testing for AI-built apps (AI planning coming soon). Point it at a page on your local app, approve the plan, and get a report of broken flows, accessibility failures, missing protections and leaks, each with evidence and a Playwright test.",
  // Current release: the V1 ("Single page") tester preview. V0 ("Single form", 0.1.0) shipped before it.
  release: "V1",
  releaseName: "Single page",
  version: "0.2.0",
  // Label for the main call to action, used in the header, heroes and page footers.
  cta: "Try V1 Locally",
  // `||`, not `??`: Docker passes an unset build arg as an empty string.
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  github: "https://github.com/rahul-bharati/run-hound",
  // The repository is invite-only while the tester preview runs.
  testingGuide: "https://github.com/rahul-bharati/run-hound/blob/main/TESTING.md",
  changelog: "https://github.com/rahul-bharati/run-hound/blob/main/CHANGELOG.md",
  feedback: "https://github.com/rahul-bharati/run-hound/issues/new/choose",
  license: "Apache-2.0",
  // Run from a clone of the repository; no image is published to a registry yet. Starts Run Hound, Kennel and the
  // sample apps. Podman: `podman compose up --build`.
  dockerCommand: "cp .env.example .env && docker compose up --build",
  // Placeholders until real addresses exist.
  contactEmail: "contact@rahulbharati.dev",
  securityEmail: "contact@rahulbharati.dev",
  // The one "ask for access" link used across the site while the repository is invite-only.
  accessMail: "mailto:contact@rahulbharati.dev?subject=Run%20Hound%20V1%20access",
  // Google Analytics 4 measurement id ("G-..."), set at build time. Empty: no analytics and no consent banner.
  gaMeasurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "",
  // Date shown as "Last updated" on the legal pages: machine-readable, and as displayed.
  legalUpdatedIso: "2026-09-25",
  legalUpdated: "25 September 2026",
} as const;

export const mainNav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/checks", label: "Checks" },
  { href: "/demo", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/open-source", label: "Open source" },
] as const;

/** Links to GitHub, shown beside the internal pages in the header and footer. */
export const externalNav = [
  { href: site.github, label: "GitHub" },
  { href: site.changelog, label: "Changelog" },
] as const;

export const legalNav = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/security", label: "Security" },
] as const;
