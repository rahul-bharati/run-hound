import type { ReactNode } from "react";
import { cx } from "./class-names";

export type TrailStep = { label: ReactNode; note?: ReactNode; href?: string };

/**
 * A static trail of rings joined by a dotted line (DESIGN.md §2.5), down the page, or as a row from 640 px. A check
 * page's "How Run Hound tests it" marks its last ring `fail` (the step that decides); a docs page's "On this page"
 * marks the current section `accent` with current "location". A filled accent ring is a strong accent object and
 * counts against the accent budget (§2.3's exempt list doesn't name navigation markers), so a page shows at most one
 * in any viewport. Labels are Body, inherited from the list: a text-small on `className` makes them Small. Steps
 * with an href are in-page links.
 *
 * `marker` (column trails only; ignored in a row) adds the docs "On this page" marker (§3.5, §4.3): the list sits in a
 * div.step-trail-wrap beside a hidden span.step-marker, and the server's `marked` ring stays filled. The docs shell's
 * client code then sets --marker-y on the wrap (the current item's offsetTop in px, through style.setProperty) and
 * data-ready: the marker shows, the ring fills give way to it, and each later change of --marker-y moves it in 180 ms
 * (at once while focus is inside the list). The shell moves aria-current itself.
 */
export function StepTrail({
  steps,
  orientation = "column",
  marked,
  marker = false,
  className,
}: {
  steps: readonly TrailStep[];
  orientation?: "column" | "row";
  marked?: { index: number; tone: "accent" | "fail"; current?: "location" | "step" };
  marker?: boolean;
  className?: string;
}) {
  const list = (
    <ol className={cx("step-trail", className)} data-orientation={orientation}>
      {steps.map((step, i) => {
        const mark = marked?.index === i ? marked : undefined;
        return (
          <li key={i} className="step">
            <span className="step-ring" data-tone={mark?.tone} aria-hidden="true" />
            {step.href ? (
              <a className="step-label" href={step.href} aria-current={mark?.current}>
                {step.label}
              </a>
            ) : (
              <span className="step-label" aria-current={mark?.current}>
                {step.label}
              </span>
            )}
            {step.note ? <span className="step-note">{step.note}</span> : null}
          </li>
        );
      })}
    </ol>
  );
  if (!marker || orientation !== "column") return list;
  return (
    <div className="step-trail-wrap">
      <span className="step-marker" aria-hidden="true" />
      {list}
    </div>
  );
}
