import { previewGroups } from "@/components/checks/data";
import { site } from "@/lib/site";

/** Calls to action. The repository is public. */
export const links = {
  tryLocally: site.testingGuide,
  github: site.github,
  changelog: site.changelog,
  issues: site.issues,
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
  "deep-links": "Pages load when opened directly (a reload, a shared link)",
  "bundle-secrets": "No secret keys in the page's JavaScript",
  "pii-leak": "Personal data isn't sent to third parties",
  "verbose-errors": "Errors don't reveal internals",
  "security-headers": "Security headers are set",
  "cookie-flags": "Session cookies are HttpOnly, Secure and SameSite",
  cors: "Other websites can't read the app's data",
  "source-maps": "No public source maps",
  "access-control": "Another account, or a visitor who isn't signed in, can't read your data",
  "mass-assignment": "The server ignores role and plan fields the form never sends",
  "write-access": "Another account, or a visitor who isn't signed in, can't change your data",
  csrf: "A page on another site can't change your data",
  "paywall-trust": "A paid plan needs a real payment",
};

/**
 * The built-in checks in their three groups, in run order, from the same data the checks page and docs use (V0's
 * form checks, V1's page-wide checks and the V2 preview's checks). The V2 preview's checks are tagged; five of them
 * run only signed in.
 */
export const checkGroups = previewGroups.map((g) => ({
  id: g.group.toLowerCase(),
  label: g.group,
  intro: intros[g.group],
  checks: g.checks.map((c) => ({
    id: c.id,
    label: labels[c.id] ?? c.name,
    preview: c.since === "V2",
    signedIn: c.signedIn === true,
  })),
}));

export const totalChecks = checkGroups.reduce((sum, g) => sum + g.checks.length, 0);
export const previewChecks = checkGroups.reduce((sum, g) => sum + g.checks.filter((c) => c.preview).length, 0);
