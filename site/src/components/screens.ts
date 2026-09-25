import type { StaticImageData } from "next/image";
// 4K masters (3840 x 2160: a 1920 x 1080 window at 2x) of the real Run Hound 0.2.0 (V1) web UI, from a run on Kennel
// with every V0 and V1 planted bug switched on (25 September 2026), captured by app/scripts/capture-site-screens.ts.
// next/image serves each visitor the size and format it needs.
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
// 0.3.0 AI screens: Settings → AI, a plan reviewed by a local 9B model on Ollama (ornith-1.5:9b) and a finding's AI
// explanation, from a run on the same Kennel (captured with --ai). Full windows or crops of 2x masters.
import aiExplanationImage from "@/assets/screens/report-ai-explanation.png";
import aiPlanImage from "@/assets/screens/new-run-plan-ai.png";
import aiSuggestedImage from "@/assets/screens/new-run-plan-ai-suggested.png";
import aiSettingsImage from "@/assets/screens/settings-ai-connected.png";

export type Screen = { src: StaticImageData; alt: string };

export const screens = {
  liveRun: {
    src: liveRunImage,
    alt: "Run Hound's live view, 8 of 20 scenarios after 33 seconds. All six accessibility scenarios and the golden path show issues. “Click every button except the submit button” is running and expanded: it has clicked the unnamed clear button and is clicking “Save draft”. On the right, the live browser shows Kennel's Book a sitter form filled with test values and the bookings list with its Refresh button, above a timestamped activity log.",
  },
  liveRunKeyboard: {
    src: liveRunKeyboardImage,
    alt: "Run Hound's live view, scenario 2 of 20: “Fill in and submit the form using only the keyboard” is expanded with its steps, Tab 4 to Tab 10: Book. The live browser shows the form filled from the keyboard, and the activity log lists each Tab stop with its time.",
  },
  plan: {
    src: planImage,
    alt: "Run Hound's plan for Kennel's Book a sitter page: found “Book a sitter”, 20 scenarios. Above the plan, what was found: the Book a sitter form (9 fields, 3 buttons), 1 control outside the forms, and the whole page (headers, cookies, CORS, scripts, layout). The Accessibility and Features groups follow; each scenario has a checkbox, a golden or danger tag, a Whole page tag where it tests the whole page, and a line on what it does and which test records it creates.",
  },
  report: {
    src: reportImage,
    alt: "Run Hound's report for the Kennel run: 20 scenarios run, 20 with issues, 1 minute 7 seconds. The double-click finding is selected: “Double-clicking Book saves 2 times”, high severity, Features, Book a sitter form, confirmed, with its recording, then the reproduction steps and key facts.",
  },
  reportTest: {
    src: reportTestImage,
    alt: "Further down the same finding: what to ask your AI to fix, and the generated Playwright test with line numbers and a Copy code button. Below it, results by group: 6 accessibility, 7 features and 7 security scenarios, every one with an issue on Kennel.",
  },
} satisfies Record<string, Screen>;

export const stepScreens = {
  explore: {
    src: stepExploreImage,
    alt: "New run: the page URL http://localhost:3160/book, the Plan checks button, and what Run Hound found: “Book a sitter”, 20 scenarios, with the Book a sitter form (9 fields, 3 buttons), 1 control outside the forms and the whole page.",
  },
  plan: {
    src: stepPlanImage,
    alt: "The plan's Accessibility group. Each scenario has a golden or danger tag and says what it does; the focus and 320 px checks carry a Whole page tag, because they test the page as a whole.",
  },
  approve: {
    src: stepApproveImage,
    alt: "The end of the plan: the Security group with its four new page-wide checks (security headers, session cookies, CORS, public source maps) tagged New in V1, the options “Allow destructive scenarios” and “Show the browser window”, both off, and the Start run (20 scenarios) button.",
  },
  run: {
    src: stepRunImage,
    alt: "The live view mid-run: 8 of 20, 33 seconds in, the finished accessibility scenarios marked with issues, and the live browser showing the form filled with test values.",
  },
  report: {
    src: stepReportImage,
    alt: "The report: 20 scenarios run, 20 with issues, 1 minute 7 seconds, test results grouped on the left and the selected double-click finding on the right with its recording.",
  },
} satisfies Record<string, Screen>;

export const aiScreens = {
  settings: {
    src: aiSettingsImage,
    alt: "Run Hound's Settings → AI card: Use AI switched on, provider Ollama, base URL http://127.0.0.1:11434/v1, and the model ornith-1.5:9b (9.0B, Q4_K_M) picked from the dropdown, which says 1 model on this server. No API key is set. Review the plan, Suggest flows and Explain findings are ticked, and below the Save and Test connection buttons: “Connected: ornith-1.5:9b answered in 0.9 s.”",
  },
  plan: {
    src: aiPlanImage,
    alt: "Run Hound's plan for Kennel's Book a sitter page with AI on: “Reviewed by ollama/ornith-1.5:9b · 4 flows suggested. Advisory: the checks still decide pass or fail.” A notice says one suggested flow was left out because a step typed more than 200 characters. In the Accessibility group each scenario carries AI and Recommended tags and, under its description, the model's one-line reason for this page, for example that the keyboard walk checks every required field (Pet name, Start date, End date, Owner email) can be reached and submitted with the keyboard alone.",
  },
  suggested: {
    src: aiSuggestedImage,
    alt: "Two scenarios tagged Suggested by AI in the plan, both unticked. “Book a sitter starting today” has the model's reason (the date fields have no stated minimum, so a booking starting today should be accepted) and six steps: type Biscuit into Pet name, the start and end dates, an owner email at kennel.test, press Enter, then “Check: the app accepts the save”. “Submit with an empty end date” leaves End date empty and ends with “Check: the filled fields keep their values”.",
  },
  explanation: {
    src: aiExplanationImage,
    alt: "Run Hound's report for a short AI run on Kennel: 4 scenarios, all with issues, including the AI-suggested “Book a sitter starting today”. The selected double-click finding shows the built-in “What to ask your AI”, then an AI explanation panel labelled Advisory: in plain words, pressing Book twice creates two bookings, with an “Ask your AI” prompt to copy, and the note “Written by ollama/ornith-1.5:9b. It doesn't change the verdict, severity or the built-in advice.” The generated Playwright test follows.",
  },
} satisfies Record<string, Screen>;
