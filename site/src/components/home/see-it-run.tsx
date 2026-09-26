import { Section } from "@/components/layout";
import { screens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { Tour, type TourTab } from "./tour";

// Full container width: 1136 px from xl up, the viewport minus the gutters below that.
const sizes =
  "(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

const tabs: TourTab[] = [
  {
    id: "plan",
    label: "Plan",
    title: "A plan you approve",
    text: "Enter the address of a page on your machine. Run Hound finds the forms and controls on it (here Kennel's “Book a sitter” form with 9 fields, a button outside the form, and the page itself) and plans 20 scenarios in three groups, each saying what it tests and which test records it creates. Nothing runs until you approve. The plan comes from what Run Hound finds on the page; turn on AI and your own model reviews it and suggests extra flows, which stay unticked until you choose them.",
    image: <Screenshot screen={screens.plan} sizes={sizes} />,
  },
  {
    id: "run",
    label: "Run",
    title: "Real checks in a real browser, live",
    text: "The approved scenarios run in Chromium, group by group. The running scenario opens to show its steps as they happen, next to the live browser and a timestamped log of everything it did.",
    image: <Screenshot screen={screens.liveRunKeyboard} sizes={sizes} />,
  },
  {
    id: "report",
    label: "Report",
    title: "Every finding, with the evidence",
    text: "Each finding has its severity, what it means, the recording or annotated frame, the reproduction steps and the key facts measured during the run. In this run on Kennel, with every planted bug on, all 20 scenarios found something.",
    image: <Screenshot screen={screens.report} sizes={sizes} />,
  },
  {
    id: "test",
    label: "Playwright test",
    title: "A test you keep",
    text: "Every finding ends with what to ask your AI to fix and a generated Playwright test that reproduces it. It runs with plain Playwright, without Run Hound, so the bug stays fixed.",
    image: <Screenshot screen={screens.reportTest} sizes={sizes} />,
  },
];

/** Homepage "See it run": the real web UI, one tab per step. */
export function SeeItRun() {
  return (
    <Section
      id="see-it-run"
      title="See it run"
      intro="Plan, run, report: the local web UI that comes with Run Hound, captured from one run on Kennel with every planted bug on."
      className="border-t border-line-soft bg-band"
    >
      <Tour tabs={tabs} />
      <p className="font-mono text-xs tracking-widest text-dim">
        REAL SCREENSHOTS FROM A RUN ON KENNEL, OUR DELIBERATELY BROKEN DEMO APP
      </p>
    </Section>
  );
}
