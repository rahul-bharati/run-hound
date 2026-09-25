import { previewGroups } from "@/components/checks/data";
import { site } from "@/lib/site";

/** Live preview links. The repo is invite-only for now. */
export const links = {
  tryLocally: site.testingGuide,
  github: site.github,
  changelog: site.changelog,
  requestAccess: site.accessMail,
} as const;

const intros: Record<string, string> = {
  Accessibility: "Can everyone use the page: keyboard users, screen reader users, people on small screens?",
  Features: "Does it actually work: every form, every button on the page, every save, every failure path?",
  Security: "Does the page leak what it shouldn't, or leave standard protections switched off?",
};

// Short homepage labels for each check id, as plain questions a builder would ask.
const labels: Record<string, string> = {
  "axe-states": "Automated accessibility scan (axe) in every form state",
  "keyboard-completion": "Forms can be completed with the keyboard only",
  "focus-visible": "Keyboard focus is always visible",
  "error-announcement": "Form errors are announced to screen readers",
  "credential-fields": "Password fields allow paste and autofill",
  "reflow-320": "Page fits a narrow (320 px) screen",
  "console-network-errors": "No console errors or failed requests",
  "dead-control": "Every button in a form does something",
  "silent-failure": "Server errors are shown and announced",
  persistence: "Submitted data is saved",
  "double-submit": "Double-clicking submit saves once",
  "client-only-validation": "The server validates input too",
  "page-controls": "Every control on the page does something",
  "bundle-secrets": "No secret keys in the page's JavaScript",
  "pii-leak": "Personal data isn't sent to third parties",
  "verbose-errors": "Errors don't reveal internals",
  "security-headers": "Security headers are set",
  "cookie-flags": "Session cookies are HttpOnly, Secure and SameSite",
  cors: "The API doesn't answer any origin",
  "source-maps": "No public source maps",
};

/**
 * The preview's checks in their three groups, in run order, from the same data the checks page and docs use
 * (V0's 15 form checks plus V1's five page-wide checks).
 */
export const checkGroups = previewGroups.map((g) => ({
  id: g.group.toLowerCase(),
  label: g.group,
  intro: intros[g.group],
  checks: g.checks.map((c) => ({ id: c.id, label: labels[c.id] ?? c.name, isNew: c.since === "V1" })),
}));

export const totalChecks = checkGroups.reduce((sum, g) => sum + g.checks.length, 0);
export const newChecks = checkGroups.reduce((sum, g) => sum + g.checks.filter((c) => c.isNew).length, 0);
