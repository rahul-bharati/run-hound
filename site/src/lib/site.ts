const version = "0.3.0";
const composeFileUrl = "https://raw.githubusercontent.com/rahul-bharati/run-hound/main/run-hound.compose.yml";

export const site = {
  name: "Run Hound",
  tagline: "Your AI said it's done. Let's check.",
  description:
    "Open-source (MIT), AI-assisted UI testing for AI-built apps. Point it at a page on your local app, approve the plan (optionally reviewed by your own AI model), and get a report of broken flows, accessibility failures, missing protections and leaks, each with evidence and a Playwright test. Local web UI, a CLI for CI, and Docker or Podman in one command.",
  // Current release: V1 ("Single page"), open source under MIT, with optional AI since 0.3.0. V0 ("Single form", 0.1.0) shipped before it.
  release: "V1",
  releaseName: "Single page",
  version,
  // Label for the main call to action, used in the header, heroes and page footers.
  cta: "Try V1 Locally",
  // `||`, not `??`: Docker passes an unset build arg as an empty string.
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  github: "https://github.com/rahul-bharati/run-hound",
  // The repository is public: anyone can clone it, try it and file issues.
  testingGuide: "https://github.com/rahul-bharati/run-hound/blob/main/TESTING.md",
  changelog: "https://github.com/rahul-bharati/run-hound/blob/main/CHANGELOG.md",
  feedback: "https://github.com/rahul-bharati/run-hound/issues/new/choose",
  license: "MIT",
  licenseUrl: "https://github.com/rahul-bharati/run-hound/blob/main/LICENSE",
  // No clone needed: downloads run-hound.compose.yml and starts Run Hound, Kennel and the sample apps from the
  // published images (README.md "Quickest start"). Podman: `podman compose -f run-hound.compose.yml up`.
  composeFileUrl,
  dockerCommand: `curl -fsSLO ${composeFileUrl} && mkdir -p runs && docker compose -f run-hound.compose.yml up`,
  // Images published to GHCR with the v0.3.0 release (run-hound, run-hound-kennel, run-hound-samples; linux/amd64 and
  // arm64). Until they are published, a clone builds the same images: `docker compose up --build` (docker-compose.yml).
  image: `ghcr.io/rahul-bharati/run-hound:${version}`,
  // Placeholders until real addresses exist.
  contactEmail: "contact@rahulbharati.dev",
  securityEmail: "contact@rahulbharati.dev",
  issues: "https://github.com/rahul-bharati/run-hound/issues",
  // Google Analytics 4 measurement id ("G-..."), set at build time. Empty: no analytics and no consent banner.
  gaMeasurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "",
  // Date shown as "Last updated" on the legal pages: machine-readable, and as displayed.
  legalUpdatedIso: "2026-09-26",
  legalUpdated: "26 September 2026",
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
