import { Container } from "@/components/layout";
import { CheckCircleIcon, DocIcon, PlayIcon, ReportIcon } from "./icons";

const steps = [
  { name: "Plan", text: "Plans scenarios from your form", Icon: DocIcon },
  { name: "Approve", text: "Review and select what to run", Icon: CheckCircleIcon },
  { name: "Run", text: "Deterministic checks in a real browser", Icon: PlayIcon, current: true },
  { name: "Report", text: "Annotated evidence and Playwright tests", Icon: ReportIcon },
];

/** The four V0 steps under the hero; "Run" is lit to match the product window. */
export function Steps() {
  return (
    <Container className="pb-16 sm:pb-20">
      <h2 className="sr-only">How a run works</h2>
      <ol className="grid gap-x-6 gap-y-8 border-t border-line-soft pt-10 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ name, text, Icon, current }, i) => (
          <li key={name} className="relative flex items-center gap-4">
            <span
              className={`grid size-14 shrink-0 place-items-center rounded-full border ${
                current
                  ? "border-accent text-accent shadow-[0_0_0_6px_rgba(94,230,163,0.08),0_0_32px_rgba(94,230,163,0.25)]"
                  : "border-line-strong text-muted"
              }`}
            >
              <Icon size={22} />
            </span>
            <span className="flex flex-col gap-1">
              <span className={`font-semibold ${current ? "text-accent" : "text-fg"}`}>
                {i + 1}. {name}
              </span>
              <span className="text-[15px] leading-snug text-muted">{text}</span>
            </span>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute -right-5 top-7 hidden h-px w-6 bg-line-strong lg:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </Container>
  );
}
