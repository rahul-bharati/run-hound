// The release this site describes. It must equal app/package.json: the release workflow (release-images.yml,
// check-version) fails when they differ.
const version = "0.4.1";
// Download links (curl) are pinned to the release tag, so the compose file always names the images of this release.
const tag = `v${version}`;
const raw = (path: string) => `https://raw.githubusercontent.com/rahul-bharati/run-hound/${tag}/${path}`;
const github = "https://github.com/rahul-bharati/run-hound";
const composeFileUrl = raw("run-hound.compose.yml");
// Run Hound's image without a tag, i.e. `latest`: the main pull-and-run commands use it, so they never go stale.
const imageName = "ghcr.io/rahul-bharati/run-hound";
// The main way to run it (README.md "Quickest start"): the web UI on http://localhost:4000, reports in ./runs, apps on
// your machine reached as http://host.docker.internal:<port>. The image sets RUNHOUND_ALLOWED_HOSTS
// (host.docker.internal,host.containers.internal) and RUNHOUND_CONFIG_DIR (/repo/app/runs/.config) itself, and its
// entrypoint prints the address to open; -e still overrides either. Podman: the same with `podman`.
const runFlags = `--rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway`;
const runsMount = `-v "$PWD/runs:/repo/app/runs"`;

export const site = {
  name: "Run Hound",
  tagline: "Your AI said it's done. Let's check.",
  // Default meta description: at most about 155 characters, so search results show it whole.
  description:
    "Open-source, AI-assisted UI testing for AI-built apps. Real checks in a real browser, with evidence and a Playwright test for every finding.",
  // Current stage: V1 ("Single page"), open source under MIT, with optional AI since 0.3.0. V0 ("Single form",
  // 0.1.0) shipped before it. 0.4.0 adds the first slice of V2 as a preview (docs/v2-spec.md): test accounts and
  // signed-in runs, access checks, mass assignment and deep links. The web UI and reports call it "V2 preview".
  release: "V1",
  releaseName: "Single page",
  preview: "V2 preview",
  previewName: "Signed-in runs and access checks",
  version,
  tag,
  // Label for the main call to action, used in the header, heroes and page footers.
  cta: "Try it locally",
  // `||`, not `??`: Docker passes an unset build arg as an empty string. A production build needs the real address
  // (canonical links, og:url, sitemap.xml, robots.txt): the Dockerfile refuses to build without it, and next.config.ts
  // warns when `next build` runs without it.
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  github,
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
  imageName,
  // Pull and run, on one line (for a copy button) and as a block of three.
  dockerCommand: `docker pull ${imageName} && mkdir -p runs && docker run ${runFlags} ${runsMount} ${imageName}`,
  runCommands: `docker pull ${imageName}
mkdir -p runs                    # reports land in ./runs
docker run ${runFlags} \\
  ${runsMount} ${imageName}`,
  // The test lab, the second way: downloads run-hound.compose.yml and starts Run Hound, Kennel, Fernway and the sample
  // apps from the published images. Podman: `podman compose -f run-hound.compose.yml up`.
  composeFileUrl,
  // The documented settings file for the compose file, from the same release.
  envFileUrl: raw(".env.example"),
  labCommand: `curl -fsSLO ${composeFileUrl} && mkdir -p runs && docker compose -f run-hound.compose.yml up`,
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
