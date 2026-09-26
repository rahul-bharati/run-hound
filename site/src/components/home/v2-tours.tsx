import { aiBuiltScreens, v2Screens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { Tour, type TourTab } from "./tour";

// Full windows take the container width (as in See it run); the narrower Settings crop is capped at 768 px.
const wide =
  "(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";
const narrow = "(min-width: 832px) 768px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/** The V2 preview in the real web UI: Fernway's two accounts, a signed-in plan and the access findings (0.4.0). */
const signedInTabs: TourTab[] = [
  {
    id: "v2-accounts",
    label: "Test accounts",
    title: "Two accounts you own, saved once",
    text: "Settings → Test accounts with Fernway's two accounts: the sign-in page, the username and a password that is never shown again (the field only says it is saved). Test sign-in checks that each one signs in, and “A and B must not see each other's data” is ticked, since they are different users.",
    image: <Screenshot screen={v2Screens.accounts} sizes={narrow} className="max-w-3xl" />,
  },
  {
    id: "v2-sign-in-as",
    label: "Sign in as",
    title: "Plan the page signed in",
    text: "In New Run, pick Sign in as → Account A. Run Hound signs in first and plans Fernway's settings page as that user: the Profile form, the 8 controls and 7 links outside it, and 22 scenarios with the access checks among them.",
    image: <Screenshot screen={v2Screens.signedInPlan} sizes={wide} />,
  },
  {
    id: "v2-access-control",
    label: "Access control",
    title: "Another account can read your data",
    text: "With Fernway's planted bugs on, Run Hound replays Account A's reads as Account B: GET /api/users/alex-rivera/profile answers 200 with Account A's test record. A critical, confirmed finding, with the answer that proves it and Account A's values masked.",
    image: <Screenshot screen={v2Screens.accessControl} sizes={wide} />,
  },
  {
    id: "v2-mass-assignment",
    label: "Mass assignment",
    title: "Fields the form never sends, stored anyway",
    text: "Account A's own profile save, replayed with role, isAdmin, plan and six more fields the form never sends. Read back, the record holds all nine, so anyone could make themselves an admin. Run Hound then puts back what it changed.",
    image: <Screenshot screen={v2Screens.massAssignment} sizes={wide} />,
  },
];

/** Discovery on an app built like the ones AI builders generate: Fernway's landing page, clean (0.4.0). */
const aiBuiltTabs: TourTab[] = [
  {
    id: "ai-built-app",
    label: "Fernway",
    title: "An app built the way AI builders build them",
    text: "Fernway's landing page, the kind Lovable, Bolt and v0 generate: a waitlist form whose Team size is a Radix select, a Book a demo button that opens a form in a dialog, toasts, a carousel and a dark mode. It ships with Run Hound as a test app.",
    image: <Screenshot screen={aiBuiltScreens.fernway} sizes={wide} />,
  },
  {
    id: "ai-built-plan",
    label: "Plan",
    title: "Three forms, one of them in a dialog",
    text: "Run Hound finds the waitlist and newsletter forms, and the Book a demo form, which appears only once its button opens the dialog. With the 10 controls and 21 links outside them and the page as a whole, that makes 40 scenarios; each form's own are tagged with its name.",
    image: <Screenshot screen={aiBuiltScreens.plan} sizes={wide} />,
  },
  {
    id: "ai-built-widgets",
    label: "Widgets",
    title: "A Radix select, set the way a person sets it",
    text: "Mid-run, the live view shows the golden path on the waitlist: Run Hound has typed the work email, opened Team size (a button with a listbox, not a native select) and picked 1–5 from its list.",
    image: <Screenshot screen={aiBuiltScreens.widget} sizes={wide} />,
  },
  {
    id: "ai-built-dialog",
    label: "Dialog",
    title: "The dialog's form, opened and filled",
    text: "Each scenario for the Book a demo form opens the dialog first. Here its golden path has filled every field: name, email, the Company size select (its list still closing), the date, a note and the consent checkbox, as it presses Request demo.",
    image: <Screenshot screen={aiBuiltScreens.dialog} sizes={wide} />,
  },
  {
    id: "ai-built-clean",
    label: "Clean run",
    title: "No false findings on the clean app",
    text: "Clean Fernway is built well on purpose, so any confirmed finding would be a false positive. All 40 scenarios ran: 37 passed, 3 skipped (the page never shows saved values, so a reload has nothing to find) and none found an issue. The keyboard walk reached all 6 fields of the dialog's form.",
    image: <Screenshot screen={aiBuiltScreens.clean} sizes={wide} />,
  },
];

/** Homepage "Signed-in runs": the V2 preview in the web UI, one tab per step. */
export function SignedInTour() {
  return (
    <div className="flex flex-col gap-4">
      <Tour tabs={signedInTabs} label="A signed-in run in the web UI" />
      <p className="font-mono text-xs tracking-widest text-dim">
        REAL SCREENSHOTS: FERNWAY&apos;S TWO ACCOUNTS AND A SIGNED-IN RUN ON ITS SETTINGS PAGE, WITH ITS BUGS ON
      </p>
    </div>
  );
}

/** Homepage "Works on apps built with Lovable, Bolt and v0": Fernway's landing page, planned and run clean. */
export function AiBuiltTour() {
  return (
    <div className="flex flex-col gap-4">
      <Tour tabs={aiBuiltTabs} label="Run Hound on Fernway's landing page" />
      <p className="font-mono text-xs tracking-widest text-dim">
        REAL SCREENSHOTS: A RUN ON CLEAN FERNWAY&apos;S LANDING PAGE, SIGNED OUT
      </p>
    </div>
  );
}
