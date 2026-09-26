import { SeverityLabel } from "@/components/finding";
import type { Check, Stage } from "@/components/checks/data";

/**
 * Small mono badge for the roadmap stage a check is in or planned for ("V0", "V1"): a stage, never a release number.
 * Checks in the current release are lit in the accent; planned ones stay neutral, and screen readers hear which is
 * which ("Available since stage V0", "Planned for stage V3").
 */
export function StageBadge({ stage, note, shipped }: { stage: Stage; note?: string; shipped?: boolean }) {
  const tone = shipped ? "border-accent/60 text-accent" : "border-line-strong text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-widest ${tone}`}
    >
      <span className="sr-only">{shipped ? "Available since stage " : "Planned for stage "}</span>
      {stage}
      {note ? <span className="ml-1.5 lowercase tracking-normal text-dim">{note}</span> : null}
    </span>
  );
}

export function AdvisoryBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-line-strong px-2 py-0.5 font-mono text-[11px] tracking-widest text-muted">
      ADVISORY
    </span>
  );
}

/** Whether a catalog check runs in the current release: every V0 check, and later stages' checks marked shipped. */
export function isShipped(check: Check) {
  return check.stage === "V0" || check.shipped === true;
}

/** One catalog entry: name, plain-language line, typical severity, roadmap stage and signal phrase. */
export function CheckCard({ check }: { check: Check }) {
  const shipped = isShipped(check);
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border bg-surface p-5 sm:p-6 ${
        shipped ? "border-line-strong" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={check.stage} note={check.note} shipped={shipped} />
          {check.advisory ? <AdvisoryBadge /> : null}
        </div>
        <span className="flex items-center gap-1.5">
          <span className="sr-only">Typical severity:</span>
          <SeverityLabel severity={check.severity} />
        </span>
      </div>
      <h3 className="font-display text-lg font-bold leading-snug">{check.name}</h3>
      <p className="text-sm leading-relaxed text-muted">{check.line}</p>
      <p className="mt-auto border-t border-line-soft pt-3 font-mono text-xs text-dim">
        <span className="tracking-widest">SIGNAL</span> <span className="text-muted">{check.signal}</span>
      </p>
    </li>
  );
}
