import type { StaticImageData } from "next/image";
// 4K masters (3840 x 2160: a 1920 x 1080 window at 2x) of the real Run Hound 0.4.0 web UI (V2 preview), captured by
// app/scripts/capture-site-screens.ts on 26 September 2026. next/image serves each visitor the size and format it needs.
// Default mode: a run on Kennel (its new look) with every V0 and V1 planted bug switched on, AI off.
import liveRunImage from "@/assets/screens/live-view-mid-run.png";
import liveRunKeyboardImage from "@/assets/screens/live-view-mid-run-2.png";
import planImage from "@/assets/screens/new-run-plan-groups.png";
import reportImage from "@/assets/screens/report-inline-evidence.png";
import reportTestImage from "@/assets/screens/report-playwright-test.png";
// Crops of the same masters (not resized) for the How it works steps.
import stepApproveImage from "@/assets/screens/steps/approve.png";
import stepExploreImage from "@/assets/screens/steps/explore.png";
import stepPlanImage from "@/assets/screens/steps/plan.png";
import stepReportImage from "@/assets/screens/steps/report.png";
import stepRunImage from "@/assets/screens/steps/run.png";
// --ai: Settings → AI, a plan reviewed by a local 9B model on Ollama (ornith-1.5:9b) and a finding's AI explanation,
// from a short run on the same Kennel. Full windows or crops of 2x masters.
import aiExplanationImage from "@/assets/screens/report-ai-explanation.png";
import aiPlanImage from "@/assets/screens/new-run-plan-ai.png";
import aiSuggestedImage from "@/assets/screens/new-run-plan-ai-suggested.png";
import aiSettingsImage from "@/assets/screens/settings-ai-connected.png";
// --v2: Fernway, the test app built the way AI builders build apps. Its two seeded accounts as test accounts A and B
// (the only screen that shows their usernames; no screen shows a password), and a run on /app/settings signed in as
// account A with every planted bug on (V01 and V04 among them).
import accountsImage from "@/assets/screens/settings-test-accounts.png";
import signedInPlanImage from "@/assets/screens/new-run-signed-in.png";
import accessControlImage from "@/assets/screens/report-access-control.png";
import massAssignmentImage from "@/assets/screens/report-mass-assignment.png";
// --v2: clean Fernway's landing page, signed out: the app itself, its plan, two live-view frames and the report.
import fernwayLandingImage from "@/assets/screens/fernway-landing.png";
import fernwayPlanImage from "@/assets/screens/fernway-plan-landing.png";
import fernwayWidgetImage from "@/assets/screens/fernway-live-waitlist.png";
import fernwayDialogImage from "@/assets/screens/fernway-live-dialog.png";
import fernwayCleanImage from "@/assets/screens/fernway-report-clean.png";

export type Screen = { src: StaticImageData; alt: string };

export const screens = {
  liveRun: {
    src: liveRunImage,
    alt: "Run Hound's live view, 8 of 20 scenarios after 30 seconds. All six accessibility scenarios and the golden path show issues. “Click every button except the submit button” is running and expanded: it has clicked the unnamed clear button and is clicking “Save draft”. On the right, the live browser shows Kennel's Book a sitter form filled with test values, down to the Book and Save draft buttons, above a timestamped activity log.",
  },
  liveRunKeyboard: {
    src: liveRunKeyboardImage,
    alt: "Run Hound's live view, scenario 2 of 20 after 17 seconds: “Fill in and submit the form using only the keyboard” is expanded with its steps, Tab 2 (an unnamed button) to Tab 8: Password. The live browser shows the top of Kennel's Book a sitter page, with a test pet name in the form, and the activity log lists each Tab stop with its time.",
  },
  plan: {
    src: planImage,
    alt: "Run Hound's plan for Kennel's Book a sitter page: found “Book a sitter”, 20 scenarios. Above the plan, what was found: the Book a sitter form (9 fields, 3 buttons), 1 control outside the forms, and the whole page (headers, cookies, CORS, scripts, layout), then a notice that signing in as a test account runs the access checks, with a Set up test accounts link. The Accessibility and Features groups follow; each scenario has a checkbox, a golden or danger tag, a Whole page tag where it tests the whole page, and a line on what it does and which test records it creates.",
  },
  report: {
    src: reportImage,
    alt: "Run Hound's report for the Kennel run: 20 scenarios run, 0 passed, 20 with issues, 56 seconds. The double-click finding is selected: “Double-clicking \"Book\" saves 2 times”, high severity, Features, Book a sitter form, confirmed, with its recording, then the reproduction steps and key facts.",
  },
  reportTest: {
    src: reportTestImage,
    alt: "Further down the same finding: what to ask your AI to fix, and the generated Playwright test with line numbers and a Copy code button. Below it, results by group: 6 accessibility, 7 features and 7 security scenarios, every one with an issue on Kennel, and the page tested, with the 8 test records the run may have created.",
  },
} satisfies Record<string, Screen>;

export const stepScreens = {
  explore: {
    src: stepExploreImage,
    alt: "New run: the page URL http://localhost:3160/book, the Plan checks button, Sign in as set to Not signed in with a pointer to Settings for test accounts, and what Run Hound found: “Book a sitter”, 20 scenarios, with the Book a sitter form (9 fields, 3 buttons), 1 control outside the forms and the whole page.",
  },
  plan: {
    src: stepPlanImage,
    alt: "The plan's Accessibility group. Each scenario has a golden or danger tag and says what it does; the focus and 320 px checks carry a Whole page tag, because they test the page as a whole.",
  },
  approve: {
    src: stepApproveImage,
    alt: "The end of the plan: the Security group with its four page-wide checks (security headers, session cookies, CORS, public source maps) tagged New in V1, the options “Allow destructive scenarios” and “Show the browser window”, both off, and the Start run (20 scenarios) button.",
  },
  run: {
    src: stepRunImage,
    alt: "The live view mid-run: 8 of 20, 30 seconds in, the finished accessibility scenarios marked with issues, and the live browser showing the form filled with test values.",
  },
  report: {
    src: stepReportImage,
    alt: "The report: 20 scenarios run, 20 with issues, 56 seconds, test results grouped on the left and the selected double-click finding on the right with its recording.",
  },
} satisfies Record<string, Screen>;

export const aiScreens = {
  settings: {
    src: aiSettingsImage,
    alt: "Run Hound's Settings → AI card: Use AI switched on, provider Ollama, base URL http://127.0.0.1:11434/v1, and the model ornith-1.5:9b (9.0B, Q4_K_M) picked from the dropdown, which says 1 model on this server. No API key is set. Review the plan, Suggest flows and Explain findings are ticked, and below the Save and Test connection buttons: “Connected: ornith-1.5:9b answered in 3.5 s.”",
  },
  plan: {
    src: aiPlanImage,
    alt: "Run Hound's plan for Kennel's Book a sitter page with AI on, 25 scenarios: “Reviewed by ollama/ornith-1.5:9b · 5 flows suggested. Advisory: the checks still decide pass or fail.” A notice says signing in as a test account runs the access checks. In the Accessibility group each scenario carries AI and Recommended tags and, under its description, the model's one-line reason for this page, for example that the keyboard walk verifies the whole Book a sitter form can be completed with Tab, arrows, Space, Enter and typing, including the pet type choice and the required fields.",
  },
  suggested: {
    src: aiSuggestedImage,
    alt: "Two scenarios tagged Suggested by AI in the plan, both unticked. “End date before start date” has the model's reason (the date fields have no minimum or maximum, so it checks the app still behaves sensibly when the end date comes before the start date) and seven steps: type Rex into Pet name, Dog into Pet type, 2026-10-01 into Start date and 2026-09-30 into End date, an owner email at kennel.example, click Book, then “Check: the filled fields keep their values”. “Submit without a password” leaves the optional password empty and ends with “Check: the app accepts the save”.",
  },
  explanation: {
    src: aiExplanationImage,
    alt: "Run Hound's report for a short AI run on Kennel: 4 scenarios, 3 with issues; the AI-suggested “End date before start date” passed. The selected double-click finding shows the built-in “What to ask your AI”, then an AI explanation panel labelled Advisory: in plain words, clicking Book twice quickly saves the booking twice, with an “Ask your AI” prompt to copy, and the note “Written by ollama/ornith-1.5:9b. It doesn't change the verdict, severity or the built-in advice.” The generated Playwright test follows.",
  },
} satisfies Record<string, Screen>;

export const v2Screens = {
  accounts: {
    src: accountsImage,
    alt: "Run Hound's Settings → Test accounts card. A note explains the access checks: signed in as Account A, Run Hound checks that Account B, and a visitor who isn't signed in, can't read Account A's data. Two fieldsets, Account A and Account B, each with its label, the sign-in page http://localhost:4171/login, the username (Alex's and Sam's Fernway emails) and an empty password field that only says “Saved: type a new one to replace it” and “Password saved”. Under the Save and Test sign-in buttons: “Signed in as Account A; landed on /app.” and the same for Account B. “A and B must not see each other's data” is ticked.",
  },
  signedInPlan: {
    src: signedInPlanImage,
    alt: "Run Hound's New run page: the page URL http://localhost:4171/app/settings and Sign in as set to Account A, with the hint “Run Hound signs in as Account A first, and every check runs signed in.” The plan below says “Signed in as Account A” and found “Profile”, 22 scenarios: the Profile form (4 fields, 1 button), 8 controls and 7 links outside the forms, and the whole page, then the Accessibility group.",
  },
  accessControl: {
    src: accessControlImage,
    alt: "Run Hound's report for Fernway's settings page with every planted bug on: 22 scenarios run, 14 passed, 8 with issues, 56 seconds, signed in as Account A with Account B as the other account. The Issues tab lists the 8 scenarios with issues; the selected finding, critical and confirmed, is “Account B can read Account A's data (1 endpoint)”. Its data card: GET /api/users/alex-rivera/profile answered 200 when requested as Account B, and the answer holds Account A's test record, shown masked. The reproduction steps replay the page's reads as Account B.",
  },
  massAssignment: {
    src: massAssignmentImage,
    alt: "The same report with the mass-assignment scenario selected in the Issues tab. Its first finding, critical and confirmed: “The server accepted admin fields the form never sends: role, isAdmin, is_admin and admin (mass assignment)”, one of 2 problems the scenario found. Its third card, the record after the replay, lists every injected field the server stored: role admin, isAdmin, is_admin and admin true, plan and tier pro, credits 999999, verified and emailVerified true.",
  },
} satisfies Record<string, Screen>;

export const aiBuiltScreens = {
  fernway: {
    src: fernwayLandingImage,
    alt: "Fernway's landing page in a desktop browser: “Plan every project without the chaos”, a Join the waitlist card with a Work email field and a Team size select, a Book a demo button, ratings, an illustrated product preview and a row of customer logos.",
  },
  plan: {
    src: fernwayPlanImage,
    alt: "Run Hound's plan for Fernway's landing page: found 3 forms, 40 scenarios. What was found: the Join the waitlist form (2 fields, 1 button), the Get product updates form (1 field, 1 button), the Book a demo form (6 fields, 2 buttons), 10 controls and 21 links outside the forms, and the whole page. A notice offers to plan the page again signed in as Account A. In the Accessibility group, each form gets its own scenarios, tagged with the form's name.",
  },
  widget: {
    src: fernwayWidgetImage,
    alt: "Run Hound's live view mid-run on Fernway's landing page, 12 of 40, with the accessibility scenarios passed. The live browser shows the Join the waitlist card with a test email typed and the Team size select open: its list of 1–5, 6–20, 21–50 and 51+ with 1–5 ticked.",
  },
  dialog: {
    src: fernwayDialogImage,
    alt: "Run Hound's live view mid-run, 14 of 40: in the live browser, the Book a demo dialog over the dimmed landing page, filled with test values: a full name, a work email, Company size 1–10 with its list still closing, a preferred date, a note and the ticked consent checkbox, above Cancel and Request demo.",
  },
  clean: {
    src: fernwayCleanImage,
    alt: "Run Hound's report for clean Fernway's landing page: test run complete, 40 scenarios run, 37 passed, 0 with issues, 3 skipped, 2 minutes 1 second. The selected result, passed: “Fill in and submit the form using only the keyboard (Book a demo form)”, with the result “Tab reached 6/6 target field(s); submit status 201”.",
  },
} satisfies Record<string, Screen>;
