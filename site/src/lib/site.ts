// The release this site describes. It must equal app/package.json: the release workflow (release-images.yml,
// check-version) fails when they differ.
const version = "0.6.0";
// Download links (curl) are pinned to the release tag, so the compose file always names the images of this release.
const tag = `v${version}`;
const raw = (path: string) => `https://raw.githubusercontent.com/rahul-bharati/run-hound/${tag}/${path}`;
const github = "https://github.com/rahul-bharati/run-hound";
const composeFileUrl = raw("run-hound.compose.yml");
// Run Hound's image without a tag, i.e. `latest`: the main pull-and-run commands use it, so they never go stale.
const imageName = "ghcr.io/rahul-bharati/run-hound";

/**
 * Facts about Run Hound and this site: the release, dates, addresses, images and contacts, and the few names every page
 * shares. The words pages say live in src/content/, every shell command in src/content/commands.ts.
 */
export const site = {
  name: "Run Hound",
  tagline: "Your AI said it's done. Let's check.",
  // Default meta description: at most about 155 characters, so search results show it whole.
  description:
    "Open-source, AI-assisted UI testing for AI-built apps. Real checks in a real browser, with evidence and a Playwright test for every finding.",
  // The release is `version`. V0 to V4 are stages of what Run Hound can test, not releases: V0 (single form) shipped
  // in 0.1.0, V1 (single page) in 0.2.0 to 0.4.0, V2 is in preview since 0.4.0, V3 is planned, and V4 is planned as
  // 1.0.0, with 0.9.9, right before it, the `npx run-hound` release. The open-source page and docs/roadmap.md list
  // them. `preview` is the stage in preview, named as the web UI and reports name it: test accounts and signed-in
  // runs, access checks, mass assignment and deep links since 0.4.0 (docs/v2-spec.md), the CSRF check (csrf) since
  // 0.5.0, and write-access, paywall-trust and two-step and sessionStorage sign-in since 0.6.0.
  preview: "V2 preview",
  previewName: "Signed-in runs and access checks",
  version,
  tag,
  // The day `version` was released (its tag), as displayed and machine-readable: "Release 0.6.0 · 27 September 2026"
  // in the footer, dateModified in the structured data and lastModified in sitemap.xml. Update both with every release.
  released: "27 September 2026",
  releasedIso: "2026-09-27",
  // Label for the main call to action, used in the header, heroes and page footers.
  cta: "Try it locally",
  // `||`, not `??`: Docker passes an unset build arg as an empty string. A production build needs the real address
  // (canonical links, og:url, sitemap.xml, robots.txt): the Dockerfile refuses to build without it, and next.config.ts
  // warns when `next build` runs without it.
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  github,
  // Who makes Run Hound and runs this site: an individual, as LICENSE and the legal pages say. The author in each
  // page's metadata and the Person in its structured data (lib/structured-data.ts).
  maintainer: { name: "Rahul Bharati", url: "https://github.com/rahul-bharati" },
  // The repository is public: anyone can clone it, try it and file issues.
  testingGuide: `${github}/blob/main/TESTING.md`,
  changelog: `${github}/blob/main/CHANGELOG.md`,
  feedback: `${github}/issues/new/choose`,
  license: "MIT",
  licenseUrl: `${github}/blob/main/LICENSE`,
  // Documents in the repository that the docs link to for the full details.
  aiSpec: `${github}/blob/main/docs/ai-spec.md`,
  v2Spec: `${github}/blob/main/docs/v2-spec.md`,
  envExample: `${github}/blob/main/.env.example`,
  fernwayGuide: `${github}/blob/main/fixtures/fernway/README.md`,
  kennelBugs: `${github}/blob/main/fixtures/kennel/bugs.json`,
  fernwayBugs: `${github}/blob/main/fixtures/fernway/bugs.json`,
  // The commands that pull and run it are in src/content/commands.ts.
  imageName,
  // The test lab, the second way: run-hound.compose.yml starts Run Hound, Kennel, Fernway and the sample apps from the
  // published images (content/commands.ts downloads it).
  composeFileUrl,
  // The documented settings file for the compose file, from the same release.
  envFileUrl: raw(".env.example"),
  // Published on GHCR with every release, public (no login needed), for linux/amd64 and arm64: run-hound (web UI,
  // CLI and Chromium's headless shell: about 260 MB to download, 715 MB on disk), and the test apps run-hound-kennel,
  // run-hound-samples and run-hound-fernway. The four download about 0.5 GB together. In a clone,
  // `docker compose up --build` (docker-compose.yml) builds the same images from source.
  image: `${imageName}:${version}`,
  labImages: ["run-hound-kennel", "run-hound-samples", "run-hound-fernway"],
  // Placeholders until real addresses exist.
  contactEmail: "contact@rahulbharati.dev",
  securityEmail: "contact@rahulbharati.dev",
  issues: `${github}/issues`,
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
