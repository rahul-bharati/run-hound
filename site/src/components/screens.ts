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
