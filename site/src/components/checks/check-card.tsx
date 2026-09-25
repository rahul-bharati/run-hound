import { SeverityLabel } from "@/components/finding";
import type { Check, Version } from "@/components/checks/data";

/**
 * Small mono roadmap badge ("V0", "V1"). Checks in the current preview are lit in the accent; planned ones stay
 * neutral, and screen readers hear which is which.
 */
export function VersionBadge({ version, note, shipped }: { version: Version; note?: string; shipped?: boolean }) {
  const tone = shipped ? "border-accent/60 text-accent" : "border-line-strong text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-widest ${tone}`}
    >
      <span className="sr-only">{shipped ? "Available since " : "Planned for "}</span>
      {version}
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

/** Whether a catalog check runs in the current preview: every V0 check, and the V1 checks that have shipped. */
export function isShipped(check: Check) {
  return check.version === "V0" || check.shipped === true;
}

/** One catalog entry: name, plain-language line, typical severity, roadmap version and signal phrase. */
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
          <VersionBadge version={check.version} note={check.note} shipped={shipped} />
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
