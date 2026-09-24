import type { StaticImageData } from "next/image";
// 4K masters (3840 x 2160: a 1920 x 1080 window at 2x) of the real Run Hound web UI, from a run on Kennel with
// every planted bug switched on (25 September 2026). next/image serves each visitor the size and format it needs.
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
    alt: "Run Hound's live view, 7 of 15 scenarios done after 19 seconds. All six accessibility scenarios show issues. “Load the form and complete it with valid data” is running and expanded: loaded the form, filled every field with valid test values, submitting the form. On the right, the live browser shows Kennel's Book a sitter form filled with test values, above a timestamped activity log.",
  },
  liveRunKeyboard: {
    src: liveRunKeyboardImage,
    alt: "Run Hound's live view, scenario 2 of 15: “Fill in and submit the form using only the keyboard” is expanded with its steps, Tab 4 to Tab 10. The live browser shows the form being filled from the keyboard, and the activity log lists each Tab stop with its time.",
  },
  plan: {
    src: planImage,
    alt: "Run Hound's plan for Kennel's Book a sitter form: 9 fields and 15 scenarios, grouped into Accessibility and Features (Security follows). Each scenario has a checkbox, a golden or danger tag and a line on what it does and which test records it creates.",
  },
  report: {
    src: reportImage,
    alt: "Run Hound's report for the Kennel run: 15 scenarios run, 15 with issues, 40 seconds. The double-click finding is selected: “Double-clicking Book saves 2 times”, high severity, confirmed, with its recording showing two identical saved bookings, then the reproduction steps and key facts.",
  },
  reportTest: {
    src: reportTestImage,
    alt: "Further down the same finding: what to ask your AI to fix, and the generated Playwright test with line numbers and a Copy code button. Below it, results by group: every accessibility, features and security scenario has an issue on Kennel.",
  },
} satisfies Record<string, Screen>;

export const stepScreens = {
  explore: {
    src: stepExploreImage,
    alt: "New run: the page URL http://localhost:3160/book, the Plan checks button, and the result: found “Book a sitter”, 9 fields, 15 scenarios.",
  },
  plan: {
    src: stepPlanImage,
    alt: "The plan's Accessibility and Features groups. Each scenario has a golden or danger tag and says what it does, for example “Submit while the server answers with an error”, which simulates a 500 and creates no test records.",
  },
  approve: {
    src: stepApproveImage,
    alt: "The end of the plan: the Security group, the options “Allow destructive scenarios” and “Show the browser window”, both off, and the Start run (15 scenarios) button.",
  },
  run: {
    src: stepRunImage,
    alt: "The live view mid-run: 7 of 15, 19 seconds in, the finished accessibility scenarios marked with issues, and the live browser showing the form filled with test values.",
  },
  report: {
    src: stepReportImage,
    alt: "The report: 15 scenarios run, 15 with issues, 40 seconds, test results grouped on the left and the selected double-click finding on the right with its recording of two identical saved bookings.",
  },
} satisfies Record<string, Screen>;
