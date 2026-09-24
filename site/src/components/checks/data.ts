import type { Severity } from "@/components/finding";

/** Roadmap stage a check is planned for. V0 = single form on localhost; V4 = live staging behind domain verification. */
export type Version = "V0" | "V1" | "V2" | "V3" | "V4";

export type Check = {
  name: string;
  /** One plain-language line. */
  line: string;
  /** Typical severity when the check fails. */
  severity: Severity;
  version: Version;
  /** Short signal phrase only, never a procedure. */
  signal: string;
  /** Relies on model judgement; reported as advisory, never as a confirmed defect. */
  advisory?: boolean;
  /** Extra qualifier shown beside the version (e.g. "stretch"). */
  note?: string;
};

export type CheckCategory = {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  checks: Check[];
};

export const versionMeaning: Record<Version, string> = {
  V0: "One form on localhost: in the tester preview",
  V1: "One page",
  V2: "One feature, end to end",
  V3: "The whole app",
  V4: "Live staging, domain verified",
};

export const categories: CheckCategory[] = [
  {
    id: "broken-features",
    eyebrow: "BROKEN FEATURES",
    title: "Broken features",
    intro:
      "The things your AI said were done. Run Hound clicks, types and reloads like a user would, and records what actually happened.",
    checks: [
      {
        name: "Dead buttons and controls",
        line: "A button or link that does nothing when you use it: no request, no change on screen, no navigation.",
        severity: "high",
        version: "V0",
        signal: "activation with no effect",
      },
      {
        name: "Forms that fail silently",
        line: "When the server errors, times out or the connection drops, the form should say so and keep what you typed.",
        severity: "high",
        version: "V0",
        signal: "simulated failure on your own app",
      },
      {
        name: "Looks saved, isn't",
        line: "Data that appears saved but is gone after a reload.",
        severity: "critical",
        version: "V0",
        signal: "reload and re-read",
      },
      {
        name: "Double submit",
        line: "Clicking twice quickly creates two orders, two posts or two charges.",
        severity: "high",
        version: "V0",
        signal: "request count",
      },
      {
        name: "Calls to things that don't exist",
        line: "Console errors and failed requests, including code that calls functions or endpoints that were never built.",
        severity: "high",
        version: "V0",
        signal: "console and network capture",
      },
      {
        name: "Missing loading and empty states",
        line: "Blank screens while data loads, or nothing helpful when there is no data yet.",
        severity: "medium",
        version: "V1",
        signal: "throttled network, fresh account",
      },
      {
        name: "Stale results",
        line: "Slow responses arrive out of order and the screen shows results for an older search.",
        severity: "medium",
        version: "V1",
        signal: "latency emulation",
      },
      {
        name: "Hydration errors",
        line: "Server-rendered pages that don't match what the browser renders, causing flicker or broken UI.",
        severity: "medium",
        version: "V1",
        signal: "console capture",
      },
      {
        name: "Timezone and locale bugs",
        line: "Dates, times and numbers that go wrong for people outside your own timezone or language.",
        severity: "medium",
        version: "V1",
        signal: "timezone and locale emulation",
      },
      {
        name: "Broken mobile layouts",
        line: "Pages that break on a phone, or block pinch-to-zoom.",
        severity: "high",
        version: "V1",
        signal: "mobile viewport run",
      },
      {
        name: "Dead links and missing assets",
        line: "Links that go nowhere and images or files that fail to load.",
        severity: "medium",
        version: "V1",
        signal: "link and asset check",
      },
      {
        name: "Refresh, deep links and Back",
        line: "Pages that break when you reload them, open them from a shared link, or press Back.",
        severity: "high",
        version: "V2",
        signal: "direct load of each route",
      },
      {
        name: "Sign-in emails and redirects",
        line: "Password reset, email verification or social sign-in that fails in production, or sends people to localhost.",
        severity: "critical",
        version: "V2",
        signal: "auth flow run with an inbox you own",
      },
      {
        name: "Placeholder data shipped as real",
        line: "Demo names, sample numbers or lorem ipsum that made it into the live app.",
        severity: "high",
        version: "V2",
        signal: "seed-data heuristics",
        advisory: true,
      },
      {
        name: "Works in Chrome only",
        line: "Features that break in Safari or Firefox.",
        severity: "medium",
        version: "V3",
        signal: "cross-engine rerun",
      },
      {
        name: "Regressions after AI edits",
        line: "Something that worked last week broke when your AI changed something else.",
        severity: "high",
        version: "V3",
        signal: "re-run exported specs",
      },
      {
        name: "Production config missing",
        line: "The deployed build still points at localhost, uses undefined settings, or runs with test-mode keys.",
        severity: "high",
        version: "V4",
        signal: "request-host check",
      },
    ],
  },
  {
    id: "validation",
    eyebrow: "VALIDATION",
    title: "Validation",
    intro:
      "What happens when people type the wrong thing, too much, or nothing at all. Checks stay non-destructive and run only against apps you own.",
    checks: [
      {
        name: "Validation only in the browser",
        line: "The form rejects bad input, but the server quietly accepts it anyway.",
        severity: "high",
        version: "V0",
        note: "stretch",
        signal: "server accepts what the form rejects",
      },
      {
        name: "Input shown back unsafely",
        line: "Text people enter, or text an AI generates, is rendered as live page content instead of plain text.",
        severity: "high",
        version: "V1",
        signal: "harmless marker rendering check",
      },
      {
        name: "Server trusts extra fields",
        line: "The server accepts values the form never offered, such as a role or price.",
        severity: "high",
        version: "V2",
        signal: "compare two test accounts you own",
      },
      {
        name: "Search, sort and pagination edges",
        line: "Empty, oversized or unusual input, or the last page of results, breaks the list.",
        severity: "medium",
        version: "V2",
        signal: "boundary inputs",
      },
      {
        name: "Unsafe file uploads",
        line: "Uploaded files that are accepted without checks or served back in a risky way.",
        severity: "high",
        version: "V2",
        signal: "upload handling check",
      },
      {
        name: "Upload limits that fail silently",
        line: "A file that is too large disappears with no message.",
        severity: "medium",
        version: "V3",
        signal: "visible error expected",
      },
    ],
  },
  {
    id: "accessibility",
    eyebrow: "ACCESSIBILITY",
    title: "Accessibility",
    intro:
      "Can everyone use it, including people on a keyboard or a screen reader? Run Hound reports WCAG failures with evidence. It does not certify legal compliance.",
    checks: [
      {
        name: "Unlabeled inputs",
        line: "Fields with no label, or a placeholder as the only label, so screen readers can't say what to type.",
        severity: "high",
        version: "V0",
        signal: "axe-core rule",
      },
      {
        name: "Controls with no name",
        line: "Buttons and links a screen reader announces as just \"button\".",
        severity: "high",
        version: "V0",
        signal: "axe-core rule",
      },
      {
        name: "Low contrast in any state",
        line: "Text or controls too faint to read, including hover, focus, error and dark states.",
        severity: "high",
        version: "V0",
        signal: "contrast rule per state",
      },
      {
        name: "Focus outline removed",
        line: "Keyboard users can't see where they are on the page.",
        severity: "high",
        version: "V0",
        signal: "keyboard traversal",
      },
      {
        name: "Can't finish with a keyboard",
        line: "The form can't be completed and submitted without a mouse, focus gets trapped, or the order jumps around.",
        severity: "high",
        version: "V0",
        signal: "keyboard traversal",
      },
      {
        name: "Errors not announced",
        line: "Validation errors and status messages that screen reader users never hear.",
        severity: "high",
        version: "V0",
        signal: "live-region check after submit",
      },
      {
        name: "Paste blocked on passwords",
        line: "Login or one-time-code fields that stop password managers and pasting.",
        severity: "medium",
        version: "V0",
        signal: "paste check on credential fields",
      },
      {
        name: "Missing autocomplete",
        line: "Name, email and address fields that don't tell the browser what they are, so autofill can't help.",
        severity: "medium",
        version: "V0",
        signal: "autocomplete purpose check",
      },
      {
        name: "Label doesn't match what you see",
        line: "A button's spoken name differs from its visible text, which confuses voice control users.",
        severity: "medium",
        version: "V0",
        signal: "Label in Name rule",
      },
      {
        name: "Small targets",
        line: "Buttons and links smaller than 24 by 24 pixels, hard to hit on touch screens.",
        severity: "medium",
        version: "V0",
        signal: "axe-core target-size rule",
      },
      {
        name: "Breaks at 320px",
        line: "Layouts that overflow or hide content on a narrow phone or when zoomed in.",
        severity: "medium",
        version: "V0",
        signal: "viewport reflow check",
      },
      {
        name: "Clickable divs",
        line: "Things that look like buttons but can't be reached or used with a keyboard.",
        severity: "critical",
        version: "V1",
        signal: "keyboard activation diff",
      },
      {
        name: "Custom widgets",
        line: "Menus, tabs and pickers that don't follow the expected keyboard patterns.",
        severity: "high",
        version: "V1",
        signal: "keyboard traversal",
      },
      {
        name: "Modal focus",
        line: "Dialogs that don't move focus in, let it escape, or lose your place when they close.",
        severity: "high",
        version: "V1",
        signal: "keyboard traversal",
      },
      {
        name: "Page structure",
        line: "Broken heading order, missing landmarks, missing page language or a broken skip link.",
        severity: "medium",
        version: "V1",
        signal: "axe-core rules",
      },
      {
        name: "Focus hidden under sticky bars",
        line: "The focused element slides under a sticky header or cookie banner.",
        severity: "medium",
        version: "V1",
        signal: "keyboard traversal",
      },
      {
        name: "Alt text quality",
        line: "Images with missing alt text, or alt text that doesn't describe anything useful.",
        severity: "medium",
        version: "V1",
        signal: "axe-core rule plus model review",
        advisory: true,
      },
      {
        name: "Generic link and button text",
        line: "Many links called \"click here\" or \"learn more\" with nothing to tell them apart.",
        severity: "medium",
        version: "V1",
        signal: "duplicate name detection",
        advisory: true,
      },
      {
        name: "Motion ignores preferences",
        line: "Animations that keep running for people who asked their device to reduce motion.",
        severity: "low",
        version: "V1",
        signal: "reduced-motion emulation",
      },
      {
        name: "Route changes not announced",
        line: "In single-page apps, screen reader users aren't told the page changed.",
        severity: "medium",
        version: "V2",
        signal: "title and focus after navigation",
      },
      {
        name: "Overlays sold as compliance",
        line: "Accessibility overlay widgets or automated scores treated as proof the app is accessible.",
        severity: "high",
        version: "V3",
        signal: "overlay script detection",
      },
    ],
  },
  {
    id: "access-and-auth",
    eyebrow: "ACCESS AND AUTH",
    title: "Access and auth",
    intro:
      "Can people see or do things they shouldn't? These checks only use test accounts you create on an app you own, and confirm findings by comparison rather than guessing.",
    checks: [
      {
        name: "Data readable without signing in",
        line: "Your app's own database calls return data to anyone, for example with Supabase RLS off or open Firebase rules.",
        severity: "critical",
        version: "V1",
        signal: "anonymous access check on your own app",
      },
      {
        name: "Other users' data exposed",
        line: "One account can read or change another account's records.",
        severity: "critical",
        version: "V2",
        signal: "compare two test accounts you own",
      },
      {
        name: "Auth only in the frontend",
        line: "Pages hide things from logged-out users, but the server hands them over anyway.",
        severity: "critical",
        version: "V2",
        signal: "compare two test accounts you own",
      },
      {
        name: "Paid features without paying",
        line: "The paid state can be reached without a confirmed payment, for example by trusting the success page.",
        severity: "critical",
        version: "V2",
        signal: "payment state check",
      },
      {
        name: "Sign-in weaknesses",
        line: "Logout that doesn't end the session, sign-up left wide open, or login pages that reveal which emails have accounts.",
        severity: "medium",
        version: "V2",
        signal: "auth flow review",
      },
      {
        name: "No rate limiting",
        line: "Login, one-time-code and AI endpoints that accept unlimited attempts.",
        severity: "high",
        version: "V2",
        signal: "small, bounded burst",
      },
      {
        name: "Cross-site request forgery",
        line: "Another site can make a signed-in user's browser take actions in your app.",
        severity: "high",
        version: "V2",
        signal: "second local origin",
      },
      {
        name: "Chatbot prompt injection",
        line: "Your own AI chatbot can be talked into ignoring its instructions.",
        severity: "high",
        version: "V2",
        signal: "canned probes on your own chatbot",
      },
      {
        name: "Admin pages left public",
        line: "Internal or admin screens that open without logging in.",
        severity: "high",
        version: "V3",
        signal: "logged-out route crawl",
      },
      {
        name: "Permissive cross-origin access",
        line: "Other websites are allowed to read signed-in responses from your app.",
        severity: "high",
        version: "V4",
        signal: "cross-origin response check",
      },
      {
        name: "Open redirects",
        line: "Login links that can send people on to any site.",
        severity: "medium",
        version: "V4",
        signal: "redirect allowlist check",
      },
    ],
  },
  {
    id: "leaks",
    eyebrow: "LEAKS",
    title: "Leaks",
    intro: "Secrets and personal data ending up somewhere public: your JavaScript bundle, the URL, or someone else's servers.",
    checks: [
      {
        name: "Secret keys in the JavaScript",
        line: "API keys that should stay on the server are shipped to every visitor. Publishable keys are allowed.",
        severity: "critical",
        version: "V0",
        signal: "bundle scan",
      },
      {
        name: "Database admin key in the browser",
        line: "A Supabase service_role key in the client gives anyone full database access.",
        severity: "critical",
        version: "V0",
        signal: "bundle scan with key role check",
      },
      {
        name: "Personal data sent to trackers",
        line: "Emails, names or phone numbers typed into forms end up in analytics, ad pixels or the URL.",
        severity: "high",
        version: "V0",
        signal: "canary value in third-party requests",
      },
      {
        name: "Stack traces shown to users",
        line: "Error pages that reveal internal details about how your app is built.",
        severity: "medium",
        version: "V1",
        signal: "error response check",
      },
      {
        name: "Public source maps",
        line: "Your original source code is downloadable from the live site.",
        severity: "medium",
        version: "V1",
        signal: "source-map presence check",
      },
      {
        name: "Unpinned third-party scripts",
        line: "Scripts loaded from other domains without integrity checks, so a compromised CDN can change them.",
        severity: "medium",
        version: "V1",
        signal: "script inventory",
      },
      {
        name: "Exposed dotfiles and build files",
        line: "Configuration files or backups reachable on the real host.",
        severity: "high",
        version: "V4",
        signal: "presence check on the verified host",
      },
    ],
  },
  {
    id: "blind-spots",
    eyebrow: "BLIND SPOTS",
    title: "Blind spots for non-technical builders",
    intro:
      "Things nobody tells you to ask your AI about. Most are quick to fix once you know they exist.",
    checks: [
      {
        name: "Tracking before consent",
        line: "Analytics and ad scripts fire before someone accepts cookies, or after they click Reject.",
        severity: "high",
        version: "V1",
        signal: "third-party requests before consent",
      },
      {
        name: "Outdated framework with known holes",
        line: "Your Next.js or React version has published security vulnerabilities.",
        severity: "critical",
        version: "V1",
        signal: "version fingerprint",
      },
      {
        name: "Missing security headers",
        line: "Standard browser protections your server never switched on.",
        severity: "medium",
        version: "V1",
        signal: "response header check",
      },
      {
        name: "Cookie flags and token storage",
        line: "Session cookies missing protective flags, or login tokens kept where page scripts can read them.",
        severity: "medium",
        version: "V1",
        signal: "cookie and storage inspection",
      },
      {
        name: "Runaway AI or API bills",
        line: "AI features anyone can call without limits, on your account.",
        severity: "high",
        version: "V2",
        signal: "small, bounded burst",
      },
      {
        name: "Invisible to search and social",
        line: "Pages that show nothing without JavaScript, are marked noindex, or have no link preview.",
        severity: "medium",
        version: "V3",
        signal: "fetch without JavaScript",
      },
      {
        name: "Slow pages",
        line: "Load times and layout shifts that make the app feel broken.",
        severity: "medium",
        version: "V3",
        signal: "Lighthouse lab metrics",
      },
      {
        name: "No privacy policy or account deletion",
        line: "App stores and privacy laws expect both. Many AI-built apps have neither.",
        severity: "medium",
        version: "V3",
        signal: "link and flow presence",
      },
      {
        name: "Staging wired to production",
        line: "Your test environment writes to the real database. Run Hound checks this first, as a safety gate.",
        severity: "high",
        version: "V4",
        signal: "environment fingerprint",
      },
      {
        name: "Mixed content and indexed previews",
        line: "Insecure resources on secure pages, or preview deployments showing up in search results.",
        severity: "medium",
        version: "V4",
        signal: "console and index check",
      },
    ],
  },
];

export type V0Group = "Accessibility" | "Features" | "Security";

export type V0Check = {
  /** The check id as it appears in plans, reports and the CLI. */
  id: string;
  name: string;
  /** What it does, in plain words (from TESTING.md). */
  line: string;
  /** Test records a run of this check can create in the app under test. */
  records: string;
};

/**
 * The 15 checks in V0 0.1.0, in the three groups the plan, run and report follow.
 * Source of truth: TESTING.md ("The 15 checks").
 */
export const v0Groups: { group: V0Group; checks: V0Check[] }[] = [
  {
    group: "Accessibility",
    checks: [
      {
        id: "axe-states",
        name: "axe-core in every form state",
        line: "Runs the axe-core WCAG 2.2 AA rules on the form empty, after an empty submit, after a server error and after a successful send.",
        records: "2",
      },
      {
        id: "keyboard-completion",
        name: "Keyboard-only completion",
        line: "Fills and sends the form with only the keyboard: Tab, arrows, Space, Enter and typing.",
        records: "1",
      },
      {
        id: "focus-visible",
        name: "Visible focus",
        line: "Tabs through the page and checks every focused control shows a visible focus indicator.",
        records: "0",
      },
      {
        id: "error-announcement",
        name: "Error announcement",
        line: "Sends the form empty and checks each required field is marked invalid with a message screen readers announce.",
        records: "0",
      },
      {
        id: "credential-fields",
        name: "Credential fields",
        line: "Pastes into password fields (nothing is sent) and checks paste works and autocomplete hints are set.",
        records: "0",
      },
      {
        id: "reflow-320",
        name: "Reflow at 320 px",
        line: "Opens the page 320 px wide (a small phone, or 400% zoom) and checks it doesn't scroll sideways.",
        records: "0",
      },
    ],
  },
  {
    group: "Features",
    checks: [
      {
        id: "console-network-errors",
        name: "Console and network errors",
        line: "Fills and sends the form with valid values and flags console errors and failed requests.",
        records: "1",
      },
      {
        id: "dead-control",
        name: "Dead controls",
        line: "Clicks every button except submit and flags buttons that do nothing at all. Destructive-looking buttons are left out unless you allow them.",
        records: "0",
      },
      {
        id: "silent-failure",
        name: "Silent failure",
        line: "Sends the form while pretending the server failed (the request never reaches your server) and checks an error is shown, announced and your input kept.",
        records: "0",
      },
      {
        id: "persistence",
        name: "Persistence",
        line: "Sends unique values, reloads the page and checks they are still shown.",
        records: "1",
      },
      {
        id: "double-submit",
        name: "Double submit",
        line: "Double-clicks submit and counts how many save requests reach the server.",
        records: "up to 2",
      },
      {
        id: "client-only-validation",
        name: "Client-only validation",
        line: "Sends the captured save request straight to the server with one field invalid and checks the server rejects it. Localhost targets only.",
        records: "0",
      },
    ],
  },
  {
    group: "Security",
    checks: [
      {
        id: "bundle-secrets",
        name: "Secret keys in the bundle",
        line: "Searches every script the page loads for secret keys. Publishable keys are fine.",
        records: "0",
      },
      {
        id: "pii-leak",
        name: "Personal data leaks",
        line: "Sends a test email and phone number and checks no request to another site carries them, or their hashes.",
        records: "1",
      },
      {
        id: "verbose-errors",
        name: "Verbose errors",
        line: "Sends far too much text and a broken request body and looks for stack traces, file paths or error dumps.",
        records: "up to 2",
      },
    ],
  },
];

/** Not visible from outside: listed in every report as a checklist, never as browser checks. */
export const notVisible: { name: string; line: string }[] = [
  {
    name: "Database backups",
    line: "Whether backups exist and whether you have ever restored one.",
  },
  {
    name: "Webhook signatures",
    line: "Whether your server verifies that payment and other webhooks really come from the provider.",
  },
  {
    name: "Dependency lockfiles",
    line: "Whether your AI added packages that don't exist, or look-alikes of real ones.",
  },
  {
    name: "Legal certification",
    line: "Run Hound reports WCAG failures. It does not certify compliance with laws like the EAA or ADA.",
  },
];
