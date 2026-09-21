export const site = {
  name: "Run Hound",
  tagline: "Your AI said it's done. Let's check.",
  description:
    "An open-source AI testing agent that explores your app in a real browser, asks before it tests, and reports broken flows, accessibility failures and leaks with proof.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  github: "https://github.com/rahul-bharati/run-hound",
  license: "Apache-2.0",
  // Planned image name; the image is not published yet.
  dockerCommand: "docker run -p 4000:4000 ghcr.io/rahul-bharati/run-hound",
  // Placeholders until real addresses exist.
  contactEmail: "[CONTACT EMAIL]",
  securityEmail: "[SECURITY EMAIL]",
} as const;

export const mainNav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/checks", label: "Checks" },
  { href: "/demo", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/open-source", label: "Open source" },
] as const;

export const legalNav = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/security", label: "Security" },
] as const;
