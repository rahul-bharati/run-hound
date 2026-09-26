import type { Severity } from "@/components/finding";

/**
 * Roadmap stage a check is in or planned for. V0 = single form on localhost (shipped, 0.1.0); V1 = single page
 * (current; page-wide checks since 0.2.0, optional AI since 0.3.0); V2 = single feature (a preview since 0.4.0:
 * signed-in runs, access checks, mass assignment and deep links, plus the write-side checks since 0.5.0; the rest is
 * planned); V4 = live staging behind domain verification.
 */
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
  /**
   * In the current release. Every V0 check is; for V1 and V2 only the checks marked shipped are (V1's page-wide checks
   * since 0.2.0, V2's preview checks since 0.4.0 and 0.5.0), the rest of their lists is still planned.
   */
  shipped?: boolean;
};

export type CheckCategory = {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  checks: Check[];
};

export const versionMeaning: Record<Version, string> = {
  V0: "One form on localhost: shipped",
  V1: "One page: available now, more to come",
  V2: "One feature, end to end: a preview is available now (signed-in runs, access checks and write-side checks)",
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
        line: "A button or control that does nothing when you use it: no request, no change on screen, no navigation. In the form since V0, and across the whole page since V1.",
        severity: "high",
        version: "V0",
        signal: "activation with no effect",
      },
      {
        name: "Forms that fail silently",
        line: "When a save fails on the server, the form should say so and keep what you typed.",
        severity: "high",
        version: "V0",
        signal: "simulated server error",
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
        severity: "medium",
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
        line: "Pages that break when you reload them or open them from a shared link. Checking the Back button is planned.",
        severity: "high",
        version: "V2",
        shipped: true,
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
        note: "localhost only",
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
        line: "The server stores fields the form never sends, such as a role, a plan or a verified flag (mass assignment).",
        severity: "high",
        version: "V2",
        shipped: true,
        signal: "replayed save on a test account you own",
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
        name: "Low contrast in any form state",
        line: "Text too faint to read, with the form empty, showing errors or after a save.",
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
        line: "The form can't be filled in and sent without a mouse: a field can't be reached with Tab or set from the keyboard.",
        severity: "high",
        version: "V0",
        signal: "keyboard traversal",
      },
      {
        name: "Errors not announced",
        line: "Validation and save errors that screen reader users never hear.",
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
        line: "Password and one-time-code fields that don't tell the browser what they hold, so password managers can't fill them.",
        severity: "low",
        version: "V0",
        signal: "autocomplete check on credential fields",
        advisory: true,
      },
      {
        name: "Label doesn't match what you see",
        line: "A button's spoken name differs from its visible text, which confuses voice control users.",
        severity: "medium",
        version: "V1",
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
        line: "Layouts that scroll sideways on a narrow phone or when zoomed in.",
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
        line: "One account can read, change or delete another account's records.",
        severity: "critical",
        version: "V2",
        shipped: true,
        signal: "compare two test accounts you own",
      },
      {
        name: "Auth only in the frontend",
        line: "Pages hide things from logged-out users, but the server hands them over, or accepts their changes, anyway.",
        severity: "critical",
        version: "V2",
        shipped: true,
        signal: "replay without a session",
      },
      {
        name: "Paid features without paying",
        line: "The paid state can be reached without a confirmed payment, for example by trusting the success page.",
        severity: "critical",
        version: "V2",
        shipped: true,
        signal: "payment state check, no provider called",
      },
      {
        name: "Cross-site request forgery",
        line: "A page on another site can make a signed-in user's browser change their data: no CSRF token, no Origin check, and a session cookie sent cross-site.",
        severity: "high",
        version: "V2",
        shipped: true,
        signal: "forged save from a cross-site page",
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
        line: "Your API echoes whatever Origin it is sent, or trusts the null origin any website can send, so other websites can read its answers, even signed-in ones.",
        severity: "high",
        version: "V1",
        shipped: true,
        signal: "requests from a sandboxed frame",
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
        line: "Emails or phone numbers typed into forms end up in analytics, ad pixels or other third-party requests, as plain text or hashed.",
        severity: "high",
        version: "V0",
        signal: "canary value in third-party requests",
      },
      {
        name: "Stack traces shown to users",
        line: "Error pages that reveal internal details about how your app is built.",
        severity: "medium",
        version: "V0",
        signal: "error response check",
      },
      {
        name: "Public source maps",
        line: "Public .map files next to your scripts let anyone download your original source code.",
        severity: "medium",
        version: "V1",
        shipped: true,
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
        line: "Standard browser protections your server never switched on: a Content-Security-Policy, nosniff, clickjacking protection and, on https, HSTS. A Referrer-Policy that leaks full URLs counts too.",
        severity: "medium",
        version: "V1",
        shipped: true,
        signal: "response header check",
      },
      {
        name: "Session cookie flags",
        line: "Session-like cookies without HttpOnly, set to SameSite=None, or without Secure on https, so scripts can read them or other sites can send them.",
        severity: "high",
        version: "V1",
        shipped: true,
        signal: "cookie inspection",
      },
      {
        name: "Login tokens in page storage",
        line: "Login tokens kept in localStorage or other places any script on the page can read.",
        severity: "medium",
        version: "V2",
        signal: "storage inspection",
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

export type PreviewGroup = "Accessibility" | "Features" | "Security";

export type PreviewCheck = {
  /** The check id as it appears in plans, reports and the CLI. */
  id: string;
  name: string;
  /** What it does, in plain words (from TESTING.md). */
  line: string;
  /** Test records a run of this check can create in the app under test. */
  records: string;
  /**
   * Stage that added the check: V0 (0.1.0) for the form checks, V1 (0.2.0) for the page-wide checks, V2 for the
   * checks of the V2 preview (0.4.0 and 0.5.0).
   */
  since: "V0" | "V1" | "V2";
  /** Findings are marked advisory when the target looks like a dev server, which doesn't send production values. */
  devServerAdvisory?: boolean;
  /** Planned only on a signed-in run, with a test account (docs: Signed-in runs and test accounts). */
  signedIn?: boolean;
  /** In the plan, but unticked until you tick it. */
  offByDefault?: boolean;
};

/**
 * The built-in checks in the current release, in the three groups the plan, run and report follow, in run order:
 * V0's form checks, V1's page-wide checks and the V2 preview's checks (0.4.0 and 0.5.0). Source of truth: app/src/checks and
 * app/src/core/types.ts (CHECK_IDS); the V2 checks in docs/v2-spec.md.
 */
export const previewGroups: { group: PreviewGroup; checks: PreviewCheck[] }[] = [
  {
    group: "Accessibility",
    checks: [
      {
        id: "axe-states",
        name: "axe-core in every form state",
        line: "Runs the axe-core WCAG 2.2 AA rules on the form empty, after an empty submit, after a server error and after a successful send.",
        records: "2",
        since: "V0",
      },
      {
        id: "keyboard-completion",
        name: "Keyboard-only completion",
        line: "Fills and sends the form with only the keyboard: Tab, arrows, Space, Enter and typing.",
        records: "1",
        since: "V0",
      },
      {
        id: "focus-visible",
        name: "Visible focus",
        line: "Tabs through the page and checks every focused control shows a visible focus indicator.",
        records: "0",
        since: "V0",
      },
      {
        id: "error-announcement",
        name: "Error announcement",
        line: "Sends the form empty and checks each required field is marked invalid with a message screen readers announce.",
        records: "0",
        since: "V0",
      },
      {
        id: "credential-fields",
        name: "Credential fields",
        line: "Pastes into password fields (nothing is sent) and checks paste works and autocomplete hints are set.",
        records: "0",
        since: "V0",
      },
      {
        id: "reflow-320",
        name: "Reflow at 320 px",
        line: "Opens the page 320 px wide (a small phone, or 400% zoom) and checks it doesn't scroll sideways.",
        records: "0",
        since: "V0",
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
        since: "V0",
      },
      {
        id: "dead-control",
        name: "Dead controls",
        line: "Clicks every button except submit and flags buttons that do nothing at all. Destructive-looking buttons are left out unless you allow them.",
        records: "0, unless a button saves something (a draft)",
        since: "V0",
      },
      {
        id: "silent-failure",
        name: "Silent failure",
        line: "Sends the form while pretending the server failed (the request never reaches your server) and checks an error is shown, announced and your input kept.",
        records: "0",
        since: "V0",
      },
      {
        id: "persistence",
        name: "Persistence",
        line: "Sends unique values, reloads the page and checks they are still shown.",
        records: "1",
        since: "V0",
      },
      {
        id: "double-submit",
        name: "Double submit",
        line: "Double-clicks submit and counts how many save requests reach the server.",
        records: "up to 2",
        since: "V0",
      },
      {
        id: "client-only-validation",
        name: "Client-only validation",
        line: "Sends the captured save request straight to the server with one field invalid and checks the server rejects it. Localhost targets only.",
        records: "up to 1, if your server accepts it",
        since: "V0",
      },
      {
        id: "page-controls",
        name: "Page controls",
        line: "Clicks the buttons and controls outside the forms, across the whole page, and flags the ones that do nothing at all. Destructive-looking controls are left out unless you allow them.",
        records: "0, unless a button saves something",
        since: "V1",
      },
      {
        id: "deep-links",
        name: "Deep links",
        line: "Opens up to 10 of the page's own links directly, as a reload or a shared link would, and flags pages that answer with an error or show a not-found view while the same link works inside the app. Never a link that signs out, deletes or accepts an invitation.",
        records: "0",
        since: "V2",
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
        since: "V0",
      },
      {
        id: "pii-leak",
        name: "Personal data leaks",
        line: "Sends a test email and phone number and checks no request to another site carries them, or their hashes.",
        records: "1",
        since: "V0",
      },
      {
        id: "verbose-errors",
        name: "Verbose errors",
        line: "Sends far too much text and a broken request body and looks for stack traces, file paths or error dumps.",
        records: "up to 2",
        since: "V0",
      },
      {
        id: "security-headers",
        name: "Security headers",
        line: "Reads the page's response headers and checks for a Content-Security-Policy that limits scripts, X-Content-Type-Options: nosniff, clickjacking protection (frame-ancestors or X-Frame-Options) and, on https, HSTS. It also flags a Referrer-Policy that leaks full URLs.",
        records: "0",
        since: "V1",
        devServerAdvisory: true,
      },
      {
        id: "cookie-flags",
        name: "Cookie flags",
        line: "Looks at the cookies the app sets and flags session-like ones without HttpOnly, set to SameSite=None, or without Secure on https.",
        records: "0",
        since: "V1",
        devServerAdvisory: true,
      },
      {
        id: "cors",
        name: "CORS",
        line: "Repeats up to 5 of the page's own GET requests from a sandboxed frame (Origin: null, which any website can send) and flags answers other websites may read, especially with the visitor's cookies.",
        records: "0",
        since: "V1",
        devServerAdvisory: true,
      },
      {
        id: "source-maps",
        name: "Public source maps",
        line: "Checks whether the page's own scripts have public source maps that anyone can download, especially ones holding your original source code. Skipped on a dev server, which always serves them.",
        records: "0",
        since: "V1",
      },
      {
        id: "access-control",
        name: "Access control",
        line: "Signed in as Account A, saves a test record, then replays the requests that returned its data as Account B and as a visitor who isn't signed in. Either one getting Account A's data back is a critical finding. Only Account A's own GET requests are replayed.",
        records: "up to 1 per scenario, in Account A",
        since: "V2",
        signedIn: true,
      },
      {
        id: "mass-assignment",
        name: "Mass assignment",
        line: "Saves the form as Account A, replays the save with fields the form never sends (role: admin, isAdmin, plan: pro, credits, verified) and reads the record again. A field the server stored is a finding. Run Hound puts back what it changed and says what it couldn't.",
        records: "up to 2, in Account A",
        since: "V2",
        signedIn: true,
        offByDefault: true,
      },
      {
        id: "write-access",
        name: "Write access",
        line: "Saves a test record as Account A, then sends the update and delete requests the app itself uses for it as Account B and as a visitor who isn't signed in. A change that shows when Account A reads the record again is a critical finding. Only that test record is ever written, and Run Hound puts it back.",
        records: "1 per scenario, in Account A",
        since: "V2",
        signedIn: true,
        offByDefault: true,
      },
      {
        id: "csrf",
        name: "Cross-site requests (CSRF)",
        line: "Saves a test record as Account A, then sends the same save from a page on another site (localhost vs 127.0.0.1) in Account A's browser, as any website could. A forged value that shows when Account A reads the record again is a finding. Inconclusive, never a pass, when no cross-site address can be set up.",
        records: "up to 2, in Account A",
        since: "V2",
        signedIn: true,
        offByDefault: true,
      },
      {
        id: "paywall-trust",
        name: "Paywall trust",
        line: "Reads Account A's plan, opens the app's own upgrade success pages and replays its own upgrade request with a zero price, then reads the plan again. A paid plan without paying is a critical finding. Never enters payment details or calls a payment provider, and puts the plan back.",
        records: "0",
        since: "V2",
        signedIn: true,
        offByDefault: true,
      },
    ],
  },
];

/**
 * The optional check added in 0.3.0. It runs only when AI is on and you tick a suggested flow, so it is listed
 * beside the built-in checks rather than counted with them.
 */
export const aiFlowCheck = {
  id: "ai-flow",
  name: "AI-suggested flows",
  group: "Features" as PreviewGroup,
  line: "Runs up to 5 extra flows your model suggests, built only from the fields and buttons Run Hound found, each ending in a deterministic check: a save succeeds, text is shown or gone, the address changes, no errors, typed values kept. Unticked by default; a failed flow is an advisory finding with a GIF, a frame and a Playwright test.",
  records: "depends on the flow",
};

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
