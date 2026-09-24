import { site } from "@/lib/site";

/** Live V0 links. The repo is invite-only for now. */
export const links = {
  tryLocally: `${site.github}/blob/main/TESTING.md`,
  github: site.github,
  changelog: `${site.github}/blob/main/CHANGELOG.md`,
  requestAccess: `mailto:${site.contactEmail}?subject=${encodeURIComponent("Run Hound V0 preview access")}`,
} as const;

/**
 * V0's 15 checks in their three groups, in run order, as the engine names them
 * (app/src/core/types.ts CHECK_GROUPS and CHECK_IDS; titles from app/src/checks/*).
 */
export const checkGroups = [
  {
    id: "accessibility",
    label: "Accessibility",
    intro: "Can everyone finish the form: keyboard users, screen reader users, people on small screens?",
    checks: [
      "Automated accessibility scan (axe) in every form state",
      "Form can be completed with the keyboard only",
      "Keyboard focus is always visible",
      "Form errors are announced to screen readers",
      "Password fields allow paste and autofill",
      "Page fits a narrow (320 px) screen",
    ],
  },
  {
    id: "features",
    label: "Features",
    intro: "Does the form actually work: every button, every save, every failure path?",
    checks: [
      "No console errors or failed requests",
      "Every button does something",
      "Server errors are shown and announced",
      "Submitted data is saved",
      "Double-clicking submit saves once",
      "The server validates input too",
    ],
  },
  {
    id: "security",
    label: "Security",
    intro: "Does the form leak what it shouldn't, to visitors or to third parties?",
    checks: [
      "No secret keys in the page's JavaScript",
      "Personal data isn't sent to third parties",
      "Errors don't reveal internals",
    ],
  },
] as const;

export const totalChecks = checkGroups.reduce((sum, g) => sum + g.checks.length, 0);
