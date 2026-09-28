import type { Rich } from "@/content/how-it-works";
import type { LinkTarget } from "@/content/routes";
import { site } from "@/lib/site";

/**
 * Every word of /demo/ (DESIGN.md §3.12): real findings from Run Hound runs on Kennel and Fernway, each with its
 * evidence and a link to its check's page, the planted bugs the test apps are scored against, and how to run the same
 * demo. Plain data, server-only like every content module; app/demo/page.tsx renders it.
 *
 * Evidence is real (brand.md): the pictures are components/evidence.ts's and components/screens.ts's, captured from
 * Run Hound's own reports, and every number here is one they show. The planted-bug counts are the ids in
 * fixtures/kennel/bugs.json and fixtures/fernway/bugs.json, listed here and checked against those files by
 * demo.test.ts (the build reads nothing outside site/, so the ids are copied, never read).
 */

/** The evidence pictures, by their key in components/evidence.ts (content can't import images). */
export type EvidenceKey =
  | "doubleSubmitRecording"
  | "doubleSubmitCard"
  | "silentFailureRecording"
  | "noVisibleFocus"
  | "secretKey"
  | "emailLeak"
  | "corsNullOrigin"
  | "missingHeaders";

/** The web UI screenshots the Fernway section shows, by their key in components/screens.ts. */
export type ScreenKey = { readonly group: "aiBuiltScreens"; readonly key: "fernway" } | { readonly group: "v2Screens"; readonly key: "accessControl" };

export type DemoFigure = {
  readonly picture: { readonly evidence: EvidenceKey } | { readonly screen: ScreenKey };
  /** What kind of evidence it is, in the window's title bar with the check id ("Recording", "Request card"). */
  readonly label: string;
  /** At most 15 words, sentence case (brand.md, copy rules). */
  readonly caption: string;
};

/** A finding shown with its evidence. `check` is its built-in check id: the element's id and its check page's link. */
export type DemoFinding = { readonly check: string; readonly figures: readonly DemoFigure[] };

export type DemoSection = {
  /** The section's id: kept from the page before the redesign (other pages and old links name them). */
  readonly id: string;
  readonly title: string;
  readonly intro: Rich;
  readonly tone: "bg" | "band";
  readonly findings: readonly DemoFinding[];
  /** A note beside the evidence (the silent failure's "Why it matters"). */
  readonly aside?: { readonly label: string; readonly text: string };
};

/** A finding's link to its check's page (/checks/<id>/), or its card on /checks/ until that page exists. */
export const checkPageLink = (check: string): LinkTarget => ({ to: `check-${check}`, fallback: { to: "checks", hash: check } });

/** The words of the link each finding ends with; the check id follows for screen readers, so each link is unique. */
export const aboutCheck = "About this check";

// ---- Planted bugs ---------------------------------------------------------------------------------------------------

export type PlantedGroup = { readonly name: string; readonly ids: readonly string[] };
export type PlantedSet = {
  /** The test app whose fixtures/<app>/bugs.json lists these bugs. */
  readonly app: "kennel" | "fernway";
  /** A mono label of at most 3 words. */
  readonly label: string;
  readonly title: string;
  readonly text: string;
  /** Shown as a plain "Preview" tag, never a release label (brand.md). */
  readonly preview?: boolean;
  readonly groups: readonly PlantedGroup[];
};

/** The bugs of each set, by their ids in fixtures/<app>/bugs.json. */
export const planted: readonly PlantedSet[] = [
  {
    app: "kennel",
    label: "Kennel · form",
    title: "Booking form bugs",
    text: "Defects in a single form on localhost. In clean mode the target is zero confirmed findings.",
    groups: [
      { name: "Broken features", ids: ["F01", "F02", "F03", "F04", "F05"] },
      { name: "Validation", ids: ["F06"] },
      { name: "Accessibility", ids: ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09"] },
      { name: "Leaks and secrets", ids: ["S01", "S02", "S03", "S04"] },
    ],
  },
  {
    app: "kennel",
    label: "Kennel · page",
    title: "Whole-page bugs",
    text: "Defects outside the form and in how the server answers. Clean Kennel sends proper headers and cookies, so the target is zero.",
    groups: [
      { name: "Button outside the form", ids: ["F07"] },
      { name: "Security headers", ids: ["S05"] },
      { name: "Cookie flags", ids: ["S06"] },
      { name: "CORS", ids: ["S07"] },
      { name: "Public source maps", ids: ["S08"] },
    ],
  },
  {
    app: "fernway",
    label: "Fernway · W01–W10",
    title: "Bugs AI builders ship",
    text: "The usual defects, planted in custom selects, toasts, dialogs and a dashboard behind a sign-in. Each is caught by one built-in check.",
    groups: [
      { name: "Accessibility", ids: ["W01", "W05", "W07", "W10"] },
      { name: "Broken features", ids: ["W02", "W03", "W04"] },
      { name: "Leaks and security", ids: ["W06", "W08", "W09"] },
    ],
  },
  {
    app: "fernway",
    label: "Fernway · V01–V09",
    title: "Access and write bugs",
    text: "Signed in as account A, with a second account B: who can read or change whose data, and what the server trusts.",
    preview: true,
    groups: [
      { name: "Another account's data", ids: ["V01", "V02"] },
      { name: "Data without signing in", ids: ["V03"] },
      { name: "Mass assignment", ids: ["V04"] },
      { name: "Deep links", ids: ["V05"] },
      { name: "Another account's changes", ids: ["V06"] },
      { name: "Changes without signing in", ids: ["V07"] },
      { name: "Cross-site requests", ids: ["V08"] },
      { name: "A paid plan without paying", ids: ["V09"] },
    ],
  },
];

/** The bugs Kennel plants for later (D01 to D07): row-level security, server-side auth, storage and payments. */
export const kennelPlannedIds = ["D01", "D02", "D03", "D04", "D05", "D06", "D07"] as const;

const count = (sets: readonly PlantedSet[]) => sets.reduce((total, set) => total + set.groups.reduce((n, group) => n + group.ids.length, 0), 0);
/** Kennel's bugs switched on for the run this page shows: every one it builds today (19 in the form, 5 page-wide). */
export const kennelBugCount = count(planted.filter((set) => set.app === "kennel"));
/** Fernway's planted bugs: the fernway-bugs service switches all of them on. */
export const fernwayBugCount = count(planted.filter((set) => set.app === "fernway"));

// ---- The page -------------------------------------------------------------------------------------------------------

export const demoIntro = {
  title: "Proof, not adjectives.",
  lede: `Everything on this page was captured from real Run Hound runs, with AI off. Kennel, a pet-sitting booking page, ran with all ${kennelBugCount} of its planted bugs switched on. The keys and email addresses are fake test values.`,
} as const;

/** The findings, section by section, with the ids the page had before the redesign. */
export const demoSections: readonly DemoSection[] = [
  {
    id: "features",
    title: "One click, two bookings",
    intro: [
      "The double-submit check double-clicks “Book” and counts the saves. Kennel accepted both requests, 0.2 ms apart, with two different record ids.",
    ],
    tone: "bg",
    findings: [
      {
        check: "double-submit",
        figures: [
          { picture: { evidence: "doubleSubmitRecording" }, label: "Recording", caption: "Form filled, “Book” double-clicked, two identical rows saved." },
          { picture: { evidence: "doubleSubmitCard" }, label: "Request card", caption: "Both POST /api/bookings requests, and the server's two 201 answers." },
        ],
      },
    ],
  },
  {
    id: "silent-failure",
    title: "A save that fails in silence",
    intro: [
      "The silent-failure check answers the save with a simulated 500, then waits for an error people can see and screen readers can hear.",
    ],
    tone: "band",
    findings: [
      {
        check: "silent-failure",
        figures: [
          { picture: { evidence: "silentFailureRecording" }, label: "Recording", caption: "5.1 s after the failed save, the page still shows no error." },
        ],
      },
    ],
    aside: {
      label: "Why it matters",
      text: "People think they booked when they didn't, and you never hear about it. The finding says what it means, why it matters and what to ask your AI to fix, next to this evidence.",
    },
  },
  {
    id: "accessibility",
    title: "Focus you can't see, measured",
    intro: [
      "The focus-visible check compares each control focused and at rest. On Kennel, “Pet name” changes 0 of 37,296 pixels around it.",
    ],
    tone: "bg",
    findings: [
      {
        check: "focus-visible",
        figures: [{ picture: { evidence: "noVisibleFocus" }, label: "Annotated frame", caption: "The field boxed, and the measured facts beside it." }],
      },
    ],
  },
  {
    id: "security",
    title: "Leaks, with the line that proves them",
    intro: ["Security checks read every script the page loads and watch every request the form sends."],
    tone: "band",
    findings: [
      {
        check: "bundle-secrets",
        figures: [
          { picture: { evidence: "secretKey" }, label: "Script card", caption: "A secret key in the page's JavaScript, with its file, line and column." },
        ],
      },
      {
        check: "pii-leak",
        figures: [
          { picture: { evidence: "emailLeak" }, label: "Request card", caption: "The customer's email in a third-party analytics URL, in plain text." },
        ],
      },
    ],
  },
  {
    id: "whole-page",
    title: "The page as a whole",
    intro: ["Some checks look past the form, at how the server answers and who may read it. They run once for the whole page."],
    tone: "bg",
    findings: [
      {
        check: "cors",
        figures: [
          { picture: { evidence: "corsNullOrigin" }, label: "Request card", caption: "Any website could read two of Kennel's API answers with the visitor's cookies." },
        ],
      },
      {
        check: "security-headers",
        figures: [
          { picture: { evidence: "missingHeaders" }, label: "Header card", caption: "The page's response headers, and the three protections it never asks for." },
        ],
      },
    ],
  },
];

/** "Run the same demo yourself": the test lab, or Kennel from source in two terminals. */
export const tryBand = {
  id: "try",
  title: "Run the same demo yourself",
  intro: "Kennel ships with Run Hound. The test lab starts it with the other test apps, from one compose file.",
  labLabel: "The test lab, from an empty folder",
  labNext: [
    "Then open ",
    { code: "http://localhost:4000" },
    " and enter ",
    { code: "http://kennel:3000/book" },
    ". Then try the clean Kennel, ",
    { code: "http://kennel-clean:3000/book" },
    ": it should give zero confirmed findings.",
  ] satisfies Rich,
  sourceText: [
    "From source, Kennel and the web UI run in two terminals. The clean run is ",
    { code: "KENNEL_BUGS=none" },
    ".",
  ] satisfies Rich,
  sourceBlocks: [
    { label: "Terminal 1: Kennel", block: { comment: "every planted bug on", commands: ["KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel"] } },
    { label: "Terminal 2: the web UI", block: { comment: "then open http://localhost:4310 and enter http://localhost:5310/book", commands: ["pnpm serve --port 4310"] } },
  ],
  links: [
    { text: "The test lab, step by step", to: { to: "docs-test-lab", fallback: { to: "docs", hash: "kennel" } } },
    { text: "Install from source", to: { to: "docs-install", hash: "from-source", fallback: { to: "docs", hash: "install" } } },
  ],
} as const;

/** "Fernway": the AI-builder-style test app, clean and with its bugs, and one of its signed-in findings. */
export const fernwayBand = {
  id: "fernway",
  title: "Fernway: built the way AI builders build",
  intro: [
    "Fernway is a small SaaS app for planning studio projects, built with Vite, React 19, Tailwind, Radix, sonner toasts and react-hook-form with zod.",
  ] satisfies Rich,
  points: [
    {
      lead: "Its pages:",
      text: [
        "a landing page with a waitlist form and a “Book a demo” dialog, sign-up, sign-in and a three-step onboarding wizard. A dashboard and settings sit behind a real sign-in, with two accounts that each have a workspace.",
      ],
    },
    {
      lead: "Two modes:",
      text: [
        { code: "fernway" },
        " is built well on purpose, so any confirmed finding on it is a false positive. ",
        { code: "fernway-bugs" },
        ` has ${fernwayBugCount} planted bugs, each caught by one check.`,
      ],
    },
    {
      lead: "The access bugs",
      text: [
        "need a signed-in run. Set up Fernway's two accounts as test accounts A and B (details in ",
        { text: "Fernway's README", href: site.fernwayGuide, opens: "GitHub" },
        "), then plan ",
        { code: "/app" },
        " signed in as A.",
      ],
    },
  ] satisfies readonly { lead: string; text: Rich }[],
  enter: [
    "In the test lab, enter ",
    { code: "http://fernway-bugs:4110/" },
    " for the planted bugs, or ",
    { code: "http://fernway:4110/" },
    " for the clean app. With the bugs on, ",
    { code: "/app/help" },
    " answers 404 when opened directly, though its link in the sidebar works (V05).",
  ] satisfies Rich,
  /** Beside the points: signed-in runs, and the page for readers who built their own app with an AI app builder. */
  links: [
    { text: "Signed-in runs, step by step", to: { to: "docs-signed-in-runs", fallback: { to: "docs", hash: "accounts" } } },
    { text: "Test your own Lovable, Bolt or v0 app", to: { to: "ai-built-apps" } },
  ] satisfies readonly { text: string; to: LinkTarget }[],
  app: {
    label: "Fernway",
    caption: "Fernway's landing page: a waitlist form with a Radix select, and a dialog form.",
  },
  finding: {
    check: "access-control",
    figures: [
      {
        picture: { screen: { group: "v2Screens", key: "accessControl" } },
        label: "Report",
        caption: "V01: account B read account A's profile, and got A's test record back.",
      },
    ],
  } satisfies DemoFinding,
} as const;

/** "What the test apps plant": the scored sets, and what is planned. */
export const plantedBand = {
  id: "planted",
  title: "What the test apps plant",
  intro: "Every bug sits behind its own toggle. Because we know exactly what's broken, we can measure what Run Hound finds, misses and makes up.",
  plantedCount: "planted bugs",
  note: `In clean mode every bug is fixed properly, not removed, so the same flows run and any finding counts as a false positive. ${kennelPlannedIds.length} more bugs (row-level security, server-side auth, file storage and payments) are planned for a Supabase-backed Kennel. An in-browser replay of a recorded run is planned too, so you can see all this without installing anything.`,
} as const;
